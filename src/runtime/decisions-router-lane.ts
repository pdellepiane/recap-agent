/**
 * WP3 — the customer-assistance lane router entry.
 *
 * One shared entry decides the lane of a turn: the Decisions API router
 * proposes a route and two facts about the request; the deterministic policy
 * owns the effect. The router is injected as a narrow port so the turn flow
 * never depends on the vendor shape and so the lane can be switched off
 * without touching the flow.
 *
 * When the lane is off, or the API is unavailable, the caller falls back to
 * the existing classifier path. Nothing here writes a reply, reads the
 * customer message or infers intent from text.
 */
import { currentOpenRequest, type OpenRequest } from '../core/open-request';
import type { ConversationHealthState } from '../core/plan';
import type { RouterDecisionTrace } from '../core/trace';
import type { OpenAiCallRef, TokenUsage } from './contracts';
import {
  runDecisionsRouter,
  type RouterParsedAnswers,
} from './decisions-router-client';
import {
  buildRouterInput,
  loadRouterInputTemplate,
  type RouterInputArgs,
} from './decisions-router-input';
import { loadRouterQuestions, type RouterQuestions } from './decisions-router-questions';
import { decideRouterPolicy, type RouterPolicyOutcome } from './decisions-router-policy';
import type { PromptLoader } from './prompt-loader';

/**
 * Narrow fetch port for the Decisions API. Structurally the same shape the
 * router client accepts; declared here so the lane can be exercised offline
 * without touching the client module.
 */
export type DecisionsRouterFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** The router decision that reaches the turn flow. */
export type SupportLaneRouterResult = {
  readonly status: 'ok';
  /** The deterministic policy outcome that owns this turn. */
  readonly outcome: RouterPolicyOutcome;
  readonly answers: RouterParsedAnswers;
  /**
   * The request the policy decided on: the record the thread held before this
   * turn. The turn flow advances it once the effect is known.
   */
  readonly current: OpenRequest | null;
  /**
   * Whether the record is about this turn. False means the turn opened a new
   * request, so it can never inherit a parked or unresolved state.
   */
  readonly sameOpenRequest: boolean;
  /**
   * False when the router refused one of the two record facts. The record then
   * stays exactly as it was: an unanswered question never moves it.
   */
  readonly recordFactsAnswered: boolean;
  /** Redacted decision evidence: route names, two booleans and numbers. */
  readonly decision: RouterDecisionTrace;
  readonly call: OpenAiCallRef;
  readonly tokenUsage: TokenUsage;
} | {
  readonly status: 'unavailable';
  readonly reason: string;
  readonly retryable: boolean;
};

/**
 * The port the turn flow depends on. `enabled` false keeps the classifier
 * path: the lane flag is the only switch.
 */
export type SupportLaneRouterPort = {
  readonly enabled: boolean;
  run(args: RouterInputArgs): Promise<SupportLaneRouterResult>;
};

export type SupportLaneRouterOptions = {
  /** Lane flag. Off keeps the existing classifier path untouched. */
  readonly enabled: boolean;
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly promptLoader: PromptLoader;
  /** Injected transport. Absent uses the global fetch. */
  readonly fetchImpl?: DecisionsRouterFetch;
};

/**
 * Production router: the Decisions API client behind the narrow port.
 *
 * The questions and the input template are loaded once through the
 * PromptLoader; every turn then renders the input deterministically and
 * asks the API. A failure never throws upstream: it becomes the
 * `unavailable` branch so the turn can fall back to the classifier path.
 */
export class OpenAiSupportLaneRouter implements SupportLaneRouterPort {
  readonly enabled: boolean;

  private readonly options: SupportLaneRouterOptions;
  private loaded: Promise<{ questions: RouterQuestions; template: string }> | null = null;

  constructor(options: SupportLaneRouterOptions) {
    this.enabled = options.enabled;
    this.options = options;
  }

  async run(args: RouterInputArgs): Promise<SupportLaneRouterResult> {
    const loaded = await this.loadedPrompts();
    const input = buildRouterInput(args, loaded.template);
    const result = await runDecisionsRouter({
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      model: this.options.model,
      timeoutMs: this.options.timeoutMs,
      input,
      questions: loaded.questions.questions,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
    if (result.status === 'unavailable') {
      return {
        status: 'unavailable',
        reason: result.reason,
        retryable: result.retryable,
      };
    }
    const current = currentOpenRequest(args.plan.open_requests);
    const recordFactsAnswered =
      !result.answers.refusals.includes('same_open_request') &&
      !result.answers.refusals.includes('request_settled');
    // A refused or missing record fact is never read as "same request": the
    // turn opens nothing and the record stays as it was.
    const sameOpenRequest = result.answers.sameOpenRequest;
    return {
      status: 'ok',
      outcome: decideRouterPolicy({
        route: result.answers.route,
        sameOpenRequest,
        current,
        helpOfferPending: args.plan.conversation_health.help_offer_status === 'offered',
      }),
      answers: result.answers,
      current,
      sameOpenRequest,
      recordFactsAnswered,
      decision: result.decision,
      call: result.call,
      tokenUsage: result.tokenUsage,
    };
  }

  private loadedPrompts(): Promise<{ questions: RouterQuestions; template: string }> {
    this.loaded ??= Promise.all([
      loadRouterQuestions(this.options.promptLoader),
      loadRouterInputTemplate(this.options.promptLoader),
    ]).then(([questions, template]) => ({ questions, template: template.template }));
    return this.loaded;
  }
}

/**
 * Conversation health derived from the open-request record.
 *
 * The classifier lane still writes its own health from the response
 * classifier. On this lane the record is the only evidence: a request that
 * stays open is the non-progress, and nothing else is.
 */
export function conversationHealthFromRecord(args: {
  readonly current: OpenRequest | null;
  readonly previous: ConversationHealthState;
  readonly nowIso: string;
}): ConversationHealthState {
  const state = args.current?.state ?? null;
  const unresolved = state === 'unresolved';
  const turnsOpen = unresolved ? (args.current?.turns ?? 0) : 0;
  const status: ConversationHealthState['status'] = unresolved
    ? turnsOpen >= 2
      ? 'stalled'
      : 'uncertain'
    : state === 'needs_input'
      ? 'uncertain'
      : 'progressing';
  const reason: ConversationHealthState['reason'] = unresolved
    ? turnsOpen >= 2
      ? 'repeated_question'
      : 'insufficient_context'
    : state === 'needs_input'
      ? 'insufficient_context'
      : 'normal_progress';
  return {
    status,
    reason,
    consecutive_non_progress_turns: turnsOpen,
    help_offer_status: args.previous.help_offer_status,
    help_offered_at: args.previous.help_offered_at,
    last_assessed_at: args.nowIso,
  };
}
