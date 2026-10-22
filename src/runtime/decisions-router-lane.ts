/**
 * WP3 — the customer-assistance lane router entry.
 *
 * One shared entry decides the lane of a turn: the Decisions API router
 * proposes a route, the deterministic policy owns the effect. The router is
 * injected as a narrow port so the turn flow never depends on the vendor
 * shape and so the lane can be switched off without touching the flow.
 *
 * When the lane is off, or the API is unavailable, the caller falls back to
 * the existing classifier path. Nothing here writes a reply, reads the
 * customer message or infers intent from text.
 */
import type { RouterDecisionTrace } from '../core/trace';
import type { ConversationHealthState } from '../core/plan';
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
import {
  decideRouterPolicy,
  routerPolicyThresholds,
  type RouterPolicyOutcome,
} from './decisions-router-policy';
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
   * Consecutive turns in which the request depended on a capability the
   * runtime cannot execute, including this turn. The turn flow persists it
   * so the next turn can count the streak.
   */
  readonly capabilityBlockedStreak: number;
  /** Redacted decision evidence: route names and numbers only. */
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
    const capabilityBlockedStreak = nextCapabilityBlockedStreak({
      capabilityBlocked: result.answers.capabilityBlocked,
      previousStreak: args.plan.conversation_health.capability_blocked_streak,
    });
    return {
      status: 'ok',
      outcome: decideRouterPolicy({
        needsHumanNow: result.answers.needsHumanNow,
        capabilityBlocked: result.answers.capabilityBlocked,
        loopRisk: result.answers.loopRisk,
        route: result.answers.route,
        repeatCount: args.plan.support_outcome?.repeat_count ?? 0,
        unresolvedMoney: args.plan.support_outcome?.unresolved_money ?? false,
        capabilityBlockedStreak,
      }),
      answers: result.answers,
      capabilityBlockedStreak,
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
 * WP3 — the router's `loop_risk` rubric mapped onto the conversation-health
 * state.
 *
 * The classifier no longer provides `conversation_health` on this lane, so
 * the health state is derived from the router level. The mapping is fixed
 * and named: 0 progressing, 1 uncertain, 2 stalled by a repeated question,
 * 3 frustrated by a repeated correction, 4 frustrated by an explicit
 * money-action demand.
 */
export const routerLoopRiskHealth: Readonly<Record<number, {
  readonly status: ConversationHealthState['status'];
  readonly reason: ConversationHealthState['reason'];
}>> = {
  0: { status: 'progressing', reason: 'normal_progress' },
  1: { status: 'uncertain', reason: 'insufficient_context' },
  2: { status: 'stalled', reason: 'repeated_question' },
  3: { status: 'frustrated', reason: 'repeated_correction' },
  4: { status: 'frustrated', reason: 'explicit_frustration' },
};

/** The highest rubric level the mapping defines. */
export const ROUTER_LOOP_RISK_MAX_LEVEL = 4;

/**
 * Health state derived from the router level.
 *
 * `consecutive_non_progress_turns` stays monotonic: a stalled or frustrated
 * level grows the streak, a progressing level resets it, and an uncertain
 * level keeps it. The stored help-offer state is preserved: the router
 * decides when an offer is opened, never the health reduction.
 */
export function conversationHealthFromRouter(args: {
  readonly loopRisk: number;
  readonly previous: ConversationHealthState;
  readonly nowIso: string;
}): ConversationHealthState {
  const level = clampLoopRisk(args.loopRisk);
  const mapped = routerLoopRiskHealth[level];
  const isNonProgress = mapped.status === 'stalled' || mapped.status === 'frustrated';
  const consecutiveNonProgressTurns = isNonProgress
    ? args.previous.consecutive_non_progress_turns + 1
    : mapped.status === 'progressing'
      ? 0
      : args.previous.consecutive_non_progress_turns;
  return {
    status: mapped.status,
    reason: mapped.reason,
    consecutive_non_progress_turns: consecutiveNonProgressTurns,
    capability_blocked_streak: args.previous.capability_blocked_streak,
    help_offer_status: args.previous.help_offer_status,
    help_offered_at: args.previous.help_offered_at,
    last_assessed_at: args.nowIso,
  };
}

/**
 * The capability-blocked streak of the turn, including this turn.
 *
 * A request that depends on a capability the runtime cannot execute is
 * counted while it keeps coming back: a turn the router judges
 * capability-blocked grows the streak, a turn it does not resets it. The
 * streak is the deterministic evidence that the request is not moving, and
 * the capability-blocked repeat backstop escalates on the second one.
 */
export function nextCapabilityBlockedStreak(args: {
  readonly capabilityBlocked: number;
  readonly previousStreak: number;
}): number {
  return args.capabilityBlocked >= routerPolicyThresholds.capabilityBlockedEscalation
    ? Math.max(0, args.previousStreak) + 1
    : 0;
}

function clampLoopRisk(loopRisk: number): number {
  if (!Number.isFinite(loopRisk)) {
    return 0;
  }
  const level = Math.trunc(loopRisk);
  if (level < 0) {
    return 0;
  }
  return Math.min(level, ROUTER_LOOP_RISK_MAX_LEVEL);
}
