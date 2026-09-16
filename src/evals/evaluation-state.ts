import type { PlanSnapshot } from '../core/plan';
import type { EvalTurnResult } from './case-schema';
import type { FixtureEffectReceipt } from '../runtime/eval-fixture-state';

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

/**
 * Attaches the private per-turn evidence for judges and silence checks. This
 * private state is never serialized into persisted artifacts: reporting
 * projections rebuild redacted public views from the turn, while expectations
 * and silence validation read back this attached snapshot. Callers keep
 * passing the full private plan here even though the turn may carry a
 * redacted public projection.
 */
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

/**
 * S3 private/public separation. Silence validation and image-ref checks must
 * read the private plan snapshot through this accessor, never the serialized
 * public plan carried on the turn: the public projection omits raw file IDs,
 * URLs, and content digests and scrubs last-response text, while the private
 * snapshot keeps the real Files refs and original text needed for invocation
 * linkage and native follow-up. Redaction is never weakened to make a judge
 * find its evidence; when no private snapshot was attached (unit probes),
 * this falls back to the turn's own plan.
 */
export function getPrivatePlanForEvidence(turn: EvalTurnResult): PlanSnapshot {
  return getEvaluationPlan(turn);
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

/**
 * Recheck b9a7662d task 1: evidence-preserving snapshot helper. The runner
 * calls this at the snapshot boundary before teardown. Each public turn is
 * independently JSON-cloned and every attached private plan/input/output/
 * effect snapshot is independently cloned and re-attached to the clone.
 * Absent private effects stay absent (never empty or invented). Public
 * serialization stays redacted downstream; this helper never weakens
 * redaction and never bypasses output-origin checks.
 */
export function snapshotEvaluationTurns(turns: readonly EvalTurnResult[]): EvalTurnResult[] {
  return turns.map((original) => {
    const cloned = JSON.parse(JSON.stringify(original)) as EvalTurnResult;
    const plan = getEvaluationPlan(original);
    const input = getEvaluationInput(original);
    const outputText = getEvaluationOutputText(original);
    const effects = getEvaluationFixtureEffects(original);
    attachEvaluationState(cloned, {
      plan: JSON.parse(JSON.stringify(plan)) as PlanSnapshot,
      input: JSON.parse(JSON.stringify(input)) as EvalTurnResult['input'],
      outputText,
      ...(effects === null ? {} : { fixtureEffects: JSON.parse(JSON.stringify(effects)) as FixtureEffectSummary[] }),
    });
    return cloned;
  });
}

const RECEIPT_EFFECT_OPERATIONS: readonly string[] = [
  'otp.request',
  'otp.verify',
  'rsvp.write',
  'handoff.write',
  'provider.quote.write',
  'provider.favorite.write',
  'provider.review.write',
];

const RECEIPT_SUCCESS_STATUSES: Record<string, ReadonlySet<string>> = {
  'otp.request': new Set(['sent']),
  'otp.verify': new Set(['authenticated']),
  'rsvp.write': new Set(['responded']),
  'handoff.write': new Set(['success']),
  'provider.quote.write': new Set(['simulated', 'confirmed']),
  'provider.favorite.write': new Set(['simulated', 'confirmed']),
  'provider.review.write': new Set(['simulated', 'confirmed']),
};

function dedupeReceiptsByIdentity(receipts: readonly FixtureEffectReceipt[]): FixtureEffectReceipt[] {
  const seen = new Set<string>();
  const out: FixtureEffectReceipt[] = [];
  for (const receipt of receipts) {
    if (seen.has(receipt.syntheticId)) continue;
    seen.add(receipt.syntheticId);
    out.push(receipt);
  }
  return out.sort((left, right) => left.attempt - right.attempt);
}

/**
 * Recheck b9a7662d task 2: verified effect ledger from recorded receipts.
 * Derives attempts/successes/replays from receipt identity and recorded
 * outcomes only. A tool call without a receipt is never a write. Missing
 * collection is represented by the caller attaching no effects (null), never
 * by synthesizing zeros here. `intent` markers for provider writes are
 * attempt starts, not terminal outcomes: when terminals exist the intents are
 * ignored; a lone intent means an attempted write with no successful result.
 * Never fills from expected fixture answers.
 */
export function buildFixtureEffectSummariesFromReceipts(
  receipts: readonly FixtureEffectReceipt[],
): FixtureEffectSummary[] {
  return RECEIPT_EFFECT_OPERATIONS.map((operation) => {
    const relevant = dedupeReceiptsByIdentity(
      receipts.filter((receipt) => receipt.operation === operation),
    );
    const intents = relevant.filter((receipt) => receipt.resultStatus === 'intent');
    const terminals = relevant.filter((receipt) => receipt.resultStatus !== 'intent');
    if (intents.length > 0 && terminals.length === 0) {
      const attempts = intents.length;
      const replays = Math.min(intents.filter((receipt) => receipt.replayed).length, attempts);
      return {
        operation,
        attempts,
        successes: 0,
        replays,
        outcome: 'failed' as const,
        receiptPresent: true,
      };
    }
    const effective = terminals;
    const attempts = effective.length;
    const successSet = RECEIPT_SUCCESS_STATUSES[operation] ?? new Set<string>();
    const successes = Math.min(
      effective.filter((receipt) => successSet.has(receipt.resultStatus)).length,
      attempts,
    );
    const replays = Math.min(
      effective.filter((receipt) => receipt.replayed).length,
      attempts,
    );
    let outcome: FixtureEffectSummary['outcome'];
    if (attempts === 0) {
      outcome = 'none';
    } else if (successes === attempts) {
      outcome = 'success';
    } else if (effective.some((receipt) => receipt.resultStatus === 'unknown')) {
      outcome = 'unknown';
    } else {
      outcome = 'failed';
    }
    return { operation, attempts, successes, replays, outcome, receiptPresent: true };
  });
}
