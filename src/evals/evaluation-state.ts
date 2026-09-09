import type { PlanSnapshot } from '../core/plan';
import type { EvalTurnResult } from './case-schema';

const evaluationPlans = new WeakMap<EvalTurnResult, PlanSnapshot>();
const evaluationInputs = new WeakMap<EvalTurnResult, EvalTurnResult['input']>();
const evaluationOutputs = new WeakMap<EvalTurnResult, string>();
const evaluationFixtureEffects = new WeakMap<EvalTurnResult, FixtureEffectSummary[]>();

export type FixtureEffectSummary = {
  operation: string;
  attempts: number;
  successes: number;
  replays: number;
  outcome: 'success' | 'failed' | 'unknown' | 'disabled' | 'none';
  receiptPresent: boolean;
};

export function attachEvaluationState(
  turn: EvalTurnResult,
  state: {
    plan: PlanSnapshot;
    input: EvalTurnResult['input'];
    outputText: string;
    fixtureEffects?: FixtureEffectSummary[];
  },
): void {
  evaluationPlans.set(turn, state.plan);
  evaluationInputs.set(turn, state.input);
  evaluationOutputs.set(turn, state.outputText);
  if (state.fixtureEffects !== undefined) {
    evaluationFixtureEffects.set(turn, [...state.fixtureEffects]);
  }
}

export function getEvaluationPlan(turn: EvalTurnResult): PlanSnapshot {
  return evaluationPlans.get(turn) ?? turn.plan;
}

export function getEvaluationInput(turn: EvalTurnResult): EvalTurnResult['input'] {
  return evaluationInputs.get(turn) ?? turn.input;
}

export function getEvaluationOutputText(turn: EvalTurnResult): string {
  return evaluationOutputs.get(turn) ?? turn.outputText;
}

export function getEvaluationFixtureEffects(turn: EvalTurnResult): FixtureEffectSummary[] | null {
  return evaluationFixtureEffects.get(turn) ?? null;
}

const FIXTURE_OPERATION_TOOLS: Record<string, string[]> = {
  'otp.request': ['request_user_login_code'],
  'otp.verify': ['verify_user_login_code'],
  'rsvp.write': ['guest_rsvp'],
  'handoff.write': ['request_human_takeover'],
  'provider.quote.write': ['create_quote_request', 'finish_plan'],
  'provider.favorite.write': ['add_vendor_to_event_favorites'],
  'provider.review.write': ['create_provider_review'],
};

export function buildCumulativeFixtureEffectSummaries(
  turns: EvalTurnResult[],
  uptoIndex: number,
): FixtureEffectSummary[] {
  const effective = turns.filter((turn) => turn.turnIndex <= uptoIndex);
  return Object.entries(FIXTURE_OPERATION_TOOLS).map(([operation, tools]) => {
    let attempts = 0;
    for (const turn of effective) {
      for (const called of turn.trace.tools_called ?? []) {
        if (tools.includes(called)) attempts += 1;
      }
    }
    const last = effective.at(-1);
    const plan = last ? getEvaluationPlan(last) : null;
    let successes = 0;
    let outcome: FixtureEffectSummary['outcome'] = 'none';
    if (operation === 'handoff.write') {
      const status = (plan as unknown as { human_escalation?: { status?: string } } | null)?.human_escalation?.status;
      if (attempts > 0 && status === 'requested') {
        successes = 1;
        outcome = 'success';
      } else if (attempts > 0) {
        const lastError = (plan as unknown as { human_escalation?: { last_error?: string | null } } | null)?.human_escalation?.last_error ?? '';
        outcome = String(lastError).includes('unknown') || String(lastError).includes('outcome_unknown') ? 'unknown' : 'failed';
      }
    } else if (operation === 'otp.verify') {
      const authStatus = (plan as unknown as { user_auth?: { status?: string } } | null)?.user_auth?.status;
      if (attempts > 0 && authStatus === 'authenticated') {
        successes = 1;
        outcome = 'success';
      } else if (attempts > 0) {
        outcome = 'failed';
      }
    } else if (attempts > 0) {
      successes = attempts;
      outcome = 'success';
    }
    const receiptPresent = effective.some((turn) =>
      (turn.trace.tool_outputs ?? []).some((entry) => tools.includes(entry.tool)),
    ) || attempts === 0;
    return {
      operation,
      attempts,
      successes: Math.min(successes, attempts),
      replays: 0,
      outcome,
      receiptPresent,
    };
  });
}
