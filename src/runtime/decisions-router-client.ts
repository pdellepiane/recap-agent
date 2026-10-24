/**
 * WP2 — Decisions API router: the isolated client.
 *
 * The Decisions API is GA and the installed `openai` SDK exposes it as
 * `client.decisions.create`. The vendor shape stops here: everything
 * downstream sees typed answers and a discriminated result.
 *
 * The client NEVER throws upstream errors to its caller. A failure becomes
 * the `unavailable` branch so the turn flow can fall back to the existing
 * classifier path. Failures are classified with the shared retry classifier.
 */
import crypto from 'node:crypto';

import OpenAI from 'openai';
import type { Decision, DecisionCreateParams } from 'openai/resources/decisions';
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
  type RouterQuestion,
  type RouterQuestionName,
  type RouterRequestSettledAnswer,
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

export type RouterParsedAnswers = {
  /** Route chosen by the router. */
  readonly route: RouterRoute;
  /** Per-route probabilities. */
  readonly routeProbabilities: readonly RouterRouteProbability[];
  /** Whether this turn is about the request the record already holds. */
  readonly sameOpenRequest: boolean;
  readonly selectedRequestKey: string | null;
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
  // GA invariant: every choice question carries between 2 and 255 options.
  // The binding omits same_open_request when nothing is retained, so a
  // single-choice question here is a programming error, not a conversation.
  if (options.questions.some((question) => question.choices.length < 2 || question.choices.length > 255)) {
    return unavailable('invalid_question_choices', false);
  }

  const params: DecisionCreateParams = {
    model: options.model,
    input: options.input,
    questions: options.questions.map((question) => ({
      type: 'choice',
      name: question.name,
      instructions: question.instructions,
      choices: question.choices.map((choice) => ({
        value: choice.value,
        description: choice.description,
      })),
    })),
  };
  // The request body the SDK sends is the serialized params. The metrics and
  // the request digest are measured from it, never estimated.
  const body = JSON.stringify(params);
  const instructionBytes = instructionBytesFor(options.questions);
  const inputBytes = Buffer.byteLength(options.input, 'utf8');
  const totalPayloadBytes = Buffer.byteLength(body, 'utf8');
  const maxAttempts = Math.max(1, options.maxAttempts ?? DECISIONS_ROUTER_MAX_ATTEMPTS);

  const client = new OpenAI({
    apiKey,
    baseURL: options.baseUrl.replace(/\/+$/u, ''),
    // The SDK types its fetch port as string | URL | Request. The router only
    // ever receives the absolute URL string the SDK builds from baseURL.
    fetch: (input, init) => fetchImpl(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
      init,
    ),
    maxRetries: 0,
    timeout: options.timeoutMs,
  });

  let attemptCount = 0;
  let statusCode: number | null = null;
  let requestId: string | null = null;
  let stageTimedOut = false;

  try {
    const decision = await executeOpenAiStage({
      stage: 'router',
      model: options.model,
      timeoutMs: options.timeoutMs,
      ...(options.log ? { log: options.log } : {}),
      operation: async (signal) => {
        for (let attempt = 1; ; attempt += 1) {
          attemptCount = attempt;
          try {
            const response = await client.decisions.create(params, {
              signal,
              maxRetries: 0,
              timeout: options.timeoutMs,
            });
            statusCode = 200;
            requestId = readRequestId(response) ?? requestId;
            return response;
          } catch (error) {
            if (signal.aborted) {
              stageTimedOut = true;
              throw error;
            }
            statusCode = readStatusCode(error) ?? statusCode;
            requestId = readErrorRequestId(error) ?? requestId;
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

    const parsed = parseDecisionsResponse(decision);
    if (parsed === null) {
      return unavailable('malformed_response', false);
    }
    const answers = parseRouterAnswers(parsed.answers, options.questions);
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
    // The SDK parses the response body itself; an unparsable body reaches
    // this boundary as a SyntaxError and stays a malformed response instead
    // of being reported as a transport failure.
    if (error instanceof SyntaxError) {
      return unavailable('malformed_response', false);
    }
    if (stageTimedOut) {
      return unavailable('transient_timeout', true);
    }
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

function parseDecisionsResponse(raw: unknown): z.infer<typeof decisionsResponseSchema> | null {
  const parsed = decisionsResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Map the answers onto the typed router answers.
 *
 * A refusal is never an escalation trigger: the refused question contributes
 * its neutral value (route `answer_with_records`, `same_open_request` false so
 * the record opens a new request, `request_settled` false so the reply is not
 * told the turn settled anything) and is listed in `refusals` so the turn flow
 * can report it and keep the record still.
 *
 * `same_open_request` is only asked when the plan retains at least one
 * request: the GA API rejects a choice question with fewer than two options,
 * and with nothing retained the only truthful answer is `new`.
 */
function parseRouterAnswers(
  answers: readonly z.infer<typeof answerSchema>[],
  questions: readonly RouterQuestion[],
): RouterParsedAnswers | null {
  if (answers.length !== questions.length) return null;
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = questions.find((entry) => entry.name === answer.name);
    if (!question || seen.has(answer.name)) return null;
    seen.add(answer.name);
    if (answer.type === 'choice') {
      const allowed = new Set(question.choices.map((entry) => entry.value));
      if (!allowed.has(answer.choice)) return null;
      const probabilities = new Set<string>();
      for (const entry of answer.probabilities) {
        if (!allowed.has(entry.value) || probabilities.has(entry.value)) return null;
        probabilities.add(entry.value);
      }
      if (answer.probabilities.length > 0 && !probabilities.has(answer.choice)) return null;
    }
  }
  const sameOpenRequestQuestion = questions.find(
    (question) => question.name === 'same_open_request',
  );
  const refusals: RouterQuestionName[] = [];
  let route: RouterRoute = 'answer_with_records';
  let routeProbabilities: readonly RouterRouteProbability[] = [];
  let sameOpenRequest = 'new';
  let sameOpenRequestProbability = 0;
  let requestSettled: RouterRequestSettledAnswer = 'open';
  let requestSettledProbability = 0;

  let sawRoute = false;
  let sawSameOpenRequest = sameOpenRequestQuestion === undefined;
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
        if (sameOpenRequestQuestion === undefined) return null;
        const parsed = parseChoiceValue(
          answer,
          sameOpenRequestQuestion.choices.map((choice) => choice.value),
        );
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
    sameOpenRequest: sameOpenRequest !== 'new',
    selectedRequestKey: sameOpenRequest === 'new' ? null : sameOpenRequest.replace(/^request:/u, ''),
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

function readRequestId(decision: Decision): string | null {
  const value = (decision as { readonly _request_id?: unknown })._request_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStatusCode(error: unknown): number | null {
  const value = (error as { readonly status?: unknown }).status;
  return typeof value === 'number' ? value : null;
}

function readErrorRequestId(error: unknown): string | null {
  const value = (error as { readonly request_id?: unknown }).request_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function unavailable(reason: string, retryable: boolean): DecisionsRouterResult {
  return { status: 'unavailable', reason, retryable };
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
