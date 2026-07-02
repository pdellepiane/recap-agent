import { decisionNodes } from '../core/decision-nodes';
import type {
  BenchmarkMetrics,
  EvalResult,
  EvalTurnResult,
  ExpectationResult,
} from './case-schema';

export type WilsonInterval = {
  lower: number;
  upper: number;
};

export function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper;
}

export function wilsonInterval(successes: number, total: number, z = 1.959963984540054): WilsonInterval {
  if (total === 0) {
    return { lower: 0, upper: 0 };
  }
  const proportion = successes / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (proportion + (z ** 2) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((proportion * (1 - proportion)) / total + (z ** 2) / (4 * total ** 2));
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function computeBenchmarkMetrics(
  turns: readonly EvalTurnResult[],
  expectations: readonly ExpectationResult[],
): BenchmarkMetrics {
  const latencies = turns.map((turn) => turn.latencyMs);
  const actualTools = turns.flatMap((turn) => turn.trace.tools_called);
  const expectedToolResults = expectations.filter((result) => result.type === 'tool_usage');
  const toolRecall = passRate(expectedToolResults);
  const forbiddenToolFailures = expectedToolResults.filter((result) => !result.passed).length;
  const toolPrecision =
    actualTools.length === 0
      ? forbiddenToolFailures === 0 ? 1 : 0
      : Math.max(0, 1 - forbiddenToolFailures / actualTools.length);
  const stateExpectations = expectations.filter((result) =>
    ['plan_field_equals', 'plan_field_subset', 'trace_field_equals', 'trace_field_subset']
      .includes(result.type),
  );
  const trajectoryExpectations = expectations.filter((result) =>
    ['node_transition', 'node_path_contains', 'trajectory_invariants'].includes(result.type),
  );
  const visitedNodes = new Set(
    turns.flatMap((turn) => [
      turn.trace.previous_node,
      turn.trace.next_node,
      ...turn.trace.node_path,
    ]),
  );
  const inputTokens = turns.reduce(
    (sum, turn) => sum + (turn.trace.token_usage.total?.input_tokens ?? 0),
    0,
  );
  const cachedTokens = turns.reduce(
    (sum, turn) => sum + (turn.trace.token_usage.total?.cached_input_tokens ?? 0),
    0,
  );
  const totalTokens = turns.reduce(
    (sum, turn) => sum + (turn.trace.token_usage.total?.total_tokens ?? 0),
    0,
  );
  const persistedTurns = turns.filter((turn) => turn.trace.plan_persisted).length;
  const toolF1 =
    toolPrecision + toolRecall === 0
      ? 0
      : (2 * toolPrecision * toolRecall) / (toolPrecision + toolRecall);

  return {
    turn_count: turns.length,
    avg_latency_ms: mean(latencies),
    p95_latency_ms: percentile(latencies, 95),
    tool_calls_total: actualTools.length,
    unique_tools_called: new Set(actualTools).size,
    tool_call_rate_per_turn: turns.length === 0 ? 0 : actualTools.length / turns.length,
    tool_precision: toolPrecision,
    tool_recall: toolRecall,
    tool_f1: toolF1,
    branch_coverage: visitedNodes.size / decisionNodes.length,
    state_expectation_pass_rate: passRate(stateExpectations),
    trajectory_expectation_pass_rate: passRate(trajectoryExpectations),
    plan_persistence_rate: turns.length === 0 ? 0 : persistedTurns / turns.length,
    total_tokens: totalTokens,
    cache_hit_rate: inputTokens === 0 ? 0 : cachedTokens / inputTokens,
  };
}

export function passRate(results: readonly ExpectationResult[]): number {
  return results.length === 0
    ? 1
    : results.filter((result) => result.passed).length / results.length;
}

export function observedTransitionSet(results: readonly EvalResult[]): Set<string> {
  return new Set(results.flatMap((result) => result.nodeTransitions));
}
