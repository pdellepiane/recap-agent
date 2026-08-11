import type { PlanSnapshot } from '../core/plan';
import type { EvalTurnResult } from './case-schema';

const evaluationPlans = new WeakMap<EvalTurnResult, PlanSnapshot>();
const evaluationInputs = new WeakMap<EvalTurnResult, EvalTurnResult['input']>();
const evaluationOutputs = new WeakMap<EvalTurnResult, string>();

export function attachEvaluationState(
  turn: EvalTurnResult,
  state: {
    plan: PlanSnapshot;
    input: EvalTurnResult['input'];
    outputText: string;
  },
): void {
  evaluationPlans.set(turn, state.plan);
  evaluationInputs.set(turn, state.input);
  evaluationOutputs.set(turn, state.outputText);
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
