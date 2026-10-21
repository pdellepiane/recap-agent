/**
 * WP2 — Decisions API router: the isolated client.
 *
 * The installed `openai` SDK has no `decisions` resource, so the router uses
 * its own raw-fetch client instead of upgrading the SDK or touching the
 * agents runtime. The vendor shape stops here: everything downstream sees
 * typed answers and a discriminated result.
 *
 * The client NEVER throws upstream errors to its caller. A failure becomes
 * the `unavailable` branch so the turn flow can fall back to the existing
 * classifier path. Failures are classified with the shared retry classifier.
 */
import crypto from 'node:crypto';

import { z } from 'zod';

import type { RouterDecisionTrace } from '../core/trace';
import type {
  OpenAiCallRef,
  OpenAiRequestMetrics,
  OpenAiTransportMetrics,
  TokenUsage,
} from './contracts';
import {
  isRouterRoute,
  type RouterQuestion,
  type RouterQuestionName,
  type RouterRoute,
} from './decisions-router-questions';
import { executeOpenAiStage, type OpenAiStageLog } from './openai-stage-execution';
import { classifyOpenAiRetry } from './openai-retry';

export const DECISIONS_ROUTER_MODEL = 'gpt-6-luna';

/** Default number of attempts for a retryable failure. */
export const DECISIONS_ROUTER_MAX_ATTEMPTS = 2;

/** Fallback backoff between retryable attempts, in milliseconds. */
const DECISIONS_ROUTER_BACKOFF_MS = 250;

/**
 * Bytes per token used when the API response carries no usage block. The
 * router then reports an ESTIMATED input token count and marks it as such:
 * an absent usage block is never reported as zero tokens.
 */
const BYTES_PER_TOKEN_ESTIMATE = 4;

export type RouterRouteProbability = {
  readonly value: RouterRoute;
  readonly probability: number;
};

export type RouterLevelProbability = {
  readonly label: string;
  readonly probability: number;
};

export type RouterParsedAnswers = {
  /** Probability of `needs_human_now`, 0..1. */
  readonly needsHumanNow: number;
  /** Probability of `capability_blocked`, 0..1. */
  readonly capabilityBlocked: number;
  /** Route chosen by the router. */
  readonly route: RouterRoute;
  /** Per-route probabilities. */
  readonly routeProbabilities: readonly RouterRouteProbability[];
  /** Rubric level of `loop_risk`, 0..4 (the level with the highest probability). */
  readonly loopRisk: number;
  /** Raw weighted-average score returned by the API. */
  readonly loopRiskScore: number;
  /** Per-level probabilities. */
  readonly loopRiskProbabilities: readonly RouterLevelProbability[];
  /** Questions the model refused to answer. */
  readonly refusals: readonly RouterQuestionName[];
};

export type DecisionsRouterResult =
  | {
      readonly status: 'ok';
      readonly answers: RouterParsedAnswers;
      readonly call: OpenAiCallRef;
      readonly tokenUsage: TokenUsage;
      /** True when the input token count was estimated from the sent bytes. */
      readonly inputTokensEstimated: boolean;
      /** Redacted decision evidence: route names and numbers only. */
      readonly decision: RouterDecisionTrace;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: string;
      readonly retryable: boolean;
    };

export type DecisionsRouterClientOptions = {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** The rendered router input. Text only: no image bytes ever travel. */
  readonly input: string;
  readonly questions: readonly RouterQuestion[];
  readonly fetchImpl?: FetchImplementation;
  readonly log?: (record: OpenAiStageLog) => void;
  readonly maxAttempts?: number;
};

type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const predicateAnswerSchema = z.object({
  type: z.literal('predicate'),
  name: z.string(),
  probability: z.number().min(0).max(1),
});

const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  name: z.string(),
  choice: z.string(),
  probabilities: z.array(z.object({
    value: z.string(),
    probability: z.number().min(0).max(1),
  })),
  confidence: z.number().optional(),
});

const scoreAnswerSchema = z.object({
  type: z.literal('score'),
  name: z.string(),
  score: z.number(),
  probabilities: z.array(z.object({
    // The Decisions API returns the LEVEL INDEX as the level value (a number),
    // not the label: {"value": 0, "label": "0", "probability": 0.06}. The
    // label is the rubric label, and the rubric level is read from it.
    value: z.union([z.string(), z.number()]),
    label: z.string(),
    probability: z.number().min(0).max(1),
  })),
  confidence: z.number().optional(),
});

const refusalAnswerSchema = z.object({
  type: z.literal('refusal'),
  name: z.string(),
});

const answerSchema = z.discriminatedUnion('type', [
  predicateAnswerSchema,
  choiceAnswerSchema,
  scoreAnswerSchema,
  refusalAnswerSchema,
]);

const decisionsResponseSchema = z.object({
  id: z.string().nullish(),
  answers: z.array(answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().nullish(),
    prompt_tokens: z.number().int().nonnegative().nullish(),
  }).nullish(),
});

/**
 * Run the router against the Decisions API.
 *
 * Returns `ok` with typed answers, or `unavailable` with the reason. The
 * caller decides what to do when the router is unavailable; the client never
 * guesses a route.
 */
export async function runDecisionsRouter(
  options: DecisionsRouterClientOptions,
): Promise<DecisionsRouterResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return unavailable('fetch_unavailable', false);
  }
  const apiKey = options.apiKey;
  if (apiKey === null || apiKey.trim().length === 0) {
    return unavailable('missing_api_key', false);
  }
  if (options.questions.length === 0) {
    return unavailable('missing_questions', false);
  }

  const body = JSON.stringify({
    model: options.model,
    input: options.input,
    questions: options.questions,
  });
  const url = `${options.baseUrl.replace(/\/+$/u, '')}/decisions`;
  const instructionBytes = instructionBytesFor(options.questions);
  const inputBytes = Buffer.byteLength(options.input, 'utf8');
  const totalPayloadBytes = Buffer.byteLength(body, 'utf8');
  const maxAttempts = Math.max(1, options.maxAttempts ?? DECISIONS_ROUTER_MAX_ATTEMPTS);

  let attemptCount = 0;
  let statusCode: number | null = null;
  let requestId: string | null = null;

  try {
    const response = await executeOpenAiStage({
      stage: 'router',
      model: options.model,
      timeoutMs: options.timeoutMs,
      ...(options.log ? { log: options.log } : {}),
      operation: async (signal) => {
        for (let attempt = 1; ; attempt += 1) {
          attemptCount = attempt;
          try {
            const raw = await fetchImpl(url, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
              },
              body,
              signal,
            });
            statusCode = raw.status;
            requestId = raw.headers.get('x-request-id')
              ?? raw.headers.get('openai-request-id');
            const payloadText = await raw.text();
            if (!raw.ok) {
              throw new DecisionsRouterHttpError(raw.status);
            }
            return { payloadText };
          } catch (error) {
            if (signal.aborted) {
              throw error;
            }
            const classification = classifyOpenAiRetry(error, {
              statusCode: statusCode ?? undefined,
            });
            if (!classification.retryable || attempt >= maxAttempts) {
              throw error;
            }
            await delay(classification.delayMs ?? DECISIONS_ROUTER_BACKOFF_MS * attempt);
          }
        }
      },
    });

    const parsed = parseDecisionsResponse(response.payloadText);
    if (parsed === null) {
      return unavailable('malformed_response', false);
    }
    const answers = parseRouterAnswers(parsed.answers);
    if (answers === null) {
      return unavailable('malformed_answers', false);
    }

    const transport: OpenAiTransportMetrics = {
      observedRequestCount: 1,
      totalPayloadBytes,
      instructionBytes,
      inputBytes,
      toolBytes: 0,
      outputSchemaBytes: 0,
      requests: [{
        sequence: 0,
        stage: 'router',
        requestId,
        responseId: parsed.id ?? null,
        statusCode,
        succeeded: true,
        totalPayloadBytes,
        instructionBytes,
        inputBytes,
        toolBytes: 0,
        outputSchemaBytes: 0,
        requestBodySha256: crypto
          .createHash('sha256')
          .update(body, 'utf8')
          .digest('hex'),
      }],
    };
    const requestMetrics: OpenAiRequestMetrics = {
      instructionBytes,
      inputBytes,
      toolCount: 0,
      schemaPropertyCount: options.questions.length,
      transport,
    };
    const call: OpenAiCallRef = {
      responseId: parsed.id ?? null,
      requestId,
      model: options.model,
      attemptCount,
      requestMetrics,
    };

    const measuredInputTokens = parsed.usage?.input_tokens
      ?? parsed.usage?.prompt_tokens
      ?? null;
    const inputTokensEstimated = measuredInputTokens === null;
    const inputTokens = measuredInputTokens
      ?? Math.ceil((instructionBytes + inputBytes) / BYTES_PER_TOKEN_ESTIMATE);
    const tokenUsage: TokenUsage = {
      input_tokens: inputTokens,
      // The Decisions API bills input tokens only: there are no output tokens.
      output_tokens: 0,
      total_tokens: inputTokens,
    };

    return {
      status: 'ok',
      answers,
      call,
      tokenUsage,
      inputTokensEstimated,
      decision: toRouterDecisionTrace(answers),
    };
  } catch (error) {
    const classification = classifyOpenAiRetry(error, {
      statusCode: statusCode ?? undefined,
    });
    return unavailable(classification.reason, classification.retryable);
  }
}

/**
 * Redacted decision evidence: the route name and the numbers. No message
 * text, no identifiers, no prompt bytes.
 */
export function toRouterDecisionTrace(answers: RouterParsedAnswers): RouterDecisionTrace {
  const chosen = answers.routeProbabilities.find(
    (entry) => entry.value === answers.route,
  );
  return {
    route: answers.route,
    route_probability: chosen?.probability ?? 0,
    route_probabilities: answers.routeProbabilities.map((entry) => ({
      value: entry.value,
      probability: entry.probability,
    })),
    needs_human_now: answers.needsHumanNow,
    capability_blocked: answers.capabilityBlocked,
    loop_risk: answers.loopRisk,
  };
}

function parseDecisionsResponse(payloadText: string): z.infer<typeof decisionsResponseSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadText);
  } catch {
    return null;
  }
  const parsed = decisionsResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Map the four answers onto the typed router answers.
 *
 * A refusal is never an escalation trigger: the refused question contributes
 * its neutral default (probability 0, route `answer_with_records`, rubric
 * level 0) and is listed in `refusals` so the turn flow can report it.
 */
function parseRouterAnswers(
  answers: readonly z.infer<typeof answerSchema>[],
): RouterParsedAnswers | null {
  const refusals: RouterQuestionName[] = [];
  let needsHumanNow = 0;
  let capabilityBlocked = 0;
  let route: RouterRoute = 'answer_with_records';
  let routeProbabilities: readonly RouterRouteProbability[] = [];
  let loopRisk = 0;
  let loopRiskScore = 0;
  let loopRiskProbabilities: readonly RouterLevelProbability[] = [];

  let sawNeedsHumanNow = false;
  let sawCapabilityBlocked = false;
  let sawRoute = false;
  let sawLoopRisk = false;

  for (const answer of answers) {
    if (answer.type === 'refusal') {
      refusals.push(answer.name as RouterQuestionName);
      // A refused question counts as answered with its neutral default: it
      // is never an escalation trigger.
      if (answer.name === 'needs_human_now') sawNeedsHumanNow = true;
      if (answer.name === 'capability_blocked') sawCapabilityBlocked = true;
      if (answer.name === 'route') sawRoute = true;
      if (answer.name === 'loop_risk') sawLoopRisk = true;
      continue;
    }
    switch (answer.name) {
      case 'needs_human_now':
        if (answer.type !== 'predicate') return null;
        needsHumanNow = answer.probability;
        sawNeedsHumanNow = true;
        break;
      case 'capability_blocked':
        if (answer.type !== 'predicate') return null;
        capabilityBlocked = answer.probability;
        sawCapabilityBlocked = true;
        break;
      case 'route':
        if (answer.type !== 'choice') return null;
        if (!isRouterRoute(answer.choice)) return null;
        route = answer.choice;
        routeProbabilities = answer.probabilities
          .filter((entry): entry is { value: RouterRoute; probability: number } =>
            isRouterRoute(entry.value))
          .map((entry) => ({ value: entry.value, probability: entry.probability }));
        sawRoute = true;
        break;
      case 'loop_risk':
        if (answer.type !== 'score') return null;
        loopRiskScore = answer.score;
        loopRiskProbabilities = answer.probabilities.map((entry) => ({
          label: entry.label,
          probability: entry.probability,
        }));
        loopRisk = modalLevel(answer.probabilities);
        sawLoopRisk = true;
        break;
      default:
        break;
    }
  }

  if (!sawNeedsHumanNow || !sawCapabilityBlocked || !sawRoute || !sawLoopRisk) {
    return null;
  }

  return {
    needsHumanNow,
    capabilityBlocked,
    route,
    routeProbabilities,
    loopRisk,
    loopRiskScore,
    loopRiskProbabilities,
    refusals,
  };
}

/**
 * The rubric level the router chose: the level with the highest probability.
 * Ties resolve to the higher level, so an ambiguous answer never understates
 * the loop risk. The API's weighted-average score is kept as evidence.
 */
function modalLevel(
  probabilities: readonly { value: string | number; label: string; probability: number }[],
): number {
  let best: { value: string | number; label: string; probability: number } | null = null;
  for (const entry of probabilities) {
    if (entry.probability > (best?.probability ?? -1)) {
      best = entry;
    }
  }
  if (best === null) {
    return 0;
  }
  // The rubric level is the label the router was given ("0".."4"). The
  // API's own level index (the numeric `value`) is the fallback.
  const fromLabel = Number.parseInt(best.label, 10);
  if (Number.isFinite(fromLabel) && fromLabel >= 0 && fromLabel <= 4) {
    return fromLabel;
  }
  const fromValue = typeof best.value === 'number'
    ? best.value
    : Number.parseInt(best.value, 10);
  if (Number.isFinite(fromValue) && fromValue >= 0 && fromValue <= 4) {
    return fromValue;
  }
  return 0;
}

function instructionBytesFor(questions: readonly RouterQuestion[]): number {
  let total = 0;
  for (const question of questions) {
    total += Buffer.byteLength(question.instructions, 'utf8');
    if (question.type === 'choice') {
      for (const choice of question.choices) {
        total += Buffer.byteLength(choice.description, 'utf8');
      }
    }
    if (question.type === 'score') {
      for (const level of question.levels) {
        total += Buffer.byteLength(level.description, 'utf8');
      }
    }
  }
  return total;
}

function unavailable(reason: string, retryable: boolean): DecisionsRouterResult {
  return { status: 'unavailable', reason, retryable };
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Non-retryable upstream status. The body never travels into the message. */
class DecisionsRouterHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Decisions API responded with HTTP ${status}`);
    this.name = 'DecisionsRouterHttpError';
    this.status = status;
  }
}
