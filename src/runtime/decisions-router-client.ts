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
  routerRequestSettledValues,
  routerSameOpenRequestValues,
  type RouterQuestion,
  type RouterQuestionName,
  type RouterRequestSettledAnswer,
  type RouterRoute,
  type RouterSameOpenRequestAnswer,
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

export type RouterParsedAnswers = {
  /** Route chosen by the router. */
  readonly route: RouterRoute;
  /** Per-route probabilities. */
  readonly routeProbabilities: readonly RouterRouteProbability[];
  /** Whether this turn is about the request the record already holds. */
  readonly sameOpenRequest: boolean;
  /** Probability the API assigned to the chosen value. */
  readonly sameOpenRequestProbability: number;
  /** Whether the turn leaves the request settled. */
  readonly requestSettled: boolean;
  /** Probability the API assigned to the chosen value. */
  readonly requestSettledProbability: number;
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

const refusalAnswerSchema = z.object({
  type: z.literal('refusal'),
  name: z.string(),
});

const answerSchema = z.discriminatedUnion('type', [
  choiceAnswerSchema,
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
    same_open_request: answers.sameOpenRequest,
    same_open_request_probability: answers.sameOpenRequestProbability,
    request_settled: answers.requestSettled,
    request_settled_probability: answers.requestSettledProbability,
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
 * Map the three answers onto the typed router answers.
 *
 * A refusal is never an escalation trigger: the refused question contributes
 * its neutral value (route `answer_with_records`, `same_open_request` false so
 * the record opens a new request, `request_settled` false so the reply is not
 * told the turn settled anything) and is listed in `refusals` so the turn flow
 * can report it and keep the record still.
 */
function parseRouterAnswers(
  answers: readonly z.infer<typeof answerSchema>[],
): RouterParsedAnswers | null {
  const refusals: RouterQuestionName[] = [];
  let route: RouterRoute = 'answer_with_records';
  let routeProbabilities: readonly RouterRouteProbability[] = [];
  let sameOpenRequest: RouterSameOpenRequestAnswer = 'new';
  let sameOpenRequestProbability = 0;
  let requestSettled: RouterRequestSettledAnswer = 'open';
  let requestSettledProbability = 0;

  let sawRoute = false;
  let sawSameOpenRequest = false;
  let sawRequestSettled = false;

  for (const answer of answers) {
    if (answer.type === 'refusal') {
      refusals.push(answer.name as RouterQuestionName);
      // A refused question counts as answered with its neutral value: it is
      // never an escalation trigger.
      if (answer.name === 'route') sawRoute = true;
      if (answer.name === 'same_open_request') sawSameOpenRequest = true;
      if (answer.name === 'request_settled') sawRequestSettled = true;
      continue;
    }
    switch (answer.name) {
      case 'route':
        if (!isRouterRoute(answer.choice)) return null;
        route = answer.choice;
        routeProbabilities = answer.probabilities
          .filter((entry): entry is { value: RouterRoute; probability: number } =>
            isRouterRoute(entry.value))
          .map((entry) => ({ value: entry.value, probability: entry.probability }));
        sawRoute = true;
        break;
      case 'same_open_request': {
        const parsed = parseChoiceValue(answer, routerSameOpenRequestValues);
        if (parsed === null) return null;
        sameOpenRequest = parsed.value;
        sameOpenRequestProbability = parsed.probability;
        sawSameOpenRequest = true;
        break;
      }
      case 'request_settled': {
        const parsed = parseChoiceValue(answer, routerRequestSettledValues);
        if (parsed === null) return null;
        requestSettled = parsed.value;
        requestSettledProbability = parsed.probability;
        sawRequestSettled = true;
        break;
      }
      default:
        break;
    }
  }

  if (!sawRoute || !sawSameOpenRequest || !sawRequestSettled) {
    return null;
  }

  return {
    route,
    routeProbabilities,
    sameOpenRequest: sameOpenRequest === 'same',
    sameOpenRequestProbability,
    requestSettled: requestSettled === 'settled',
    requestSettledProbability,
    refusals,
  };
}

/**
 * Read one two-value choice answer. The chosen value is the API's `choice`;
 * its probability comes from the same answer so the trace can report how
 * confident the API was without inventing a threshold.
 */
function parseChoiceValue<T extends string>(
  answer: { readonly choice: string; readonly probabilities: readonly { value: string; probability: number }[] },
  allowed: readonly T[],
): { value: T; probability: number } | null {
  const value = answer.choice.trim();
  if (!(allowed as readonly string[]).includes(value)) {
    return null;
  }
  const match = answer.probabilities.find((entry) => entry.value === value);
  return { value: value as T, probability: match?.probability ?? 0 };
}

function instructionBytesFor(questions: readonly RouterQuestion[]): number {
  let total = 0;
  for (const question of questions) {
    total += Buffer.byteLength(question.instructions, 'utf8');
    for (const choice of question.choices) {
      total += Buffer.byteLength(choice.description, 'utf8');
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
