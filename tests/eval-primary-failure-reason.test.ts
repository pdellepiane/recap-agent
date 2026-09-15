import { describe, expect, it } from 'vitest';

import { classifyPrimaryFailureReason } from '../src/evals/reporting';

type Signal = {
  passed: boolean;
  severity: 'hard' | 'soft';
  type: string;
  message: string;
};

function hard(type: string, message: string): Signal {
  return { passed: false, severity: 'hard', type, message };
}

function classify(args: {
  status?: 'passed' | 'failed' | 'errored' | 'skipped';
  executionUncertain?: boolean;
  planDiffSummary?: string[];
  expectationResults?: Signal[];
}) {
  return classifyPrimaryFailureReason({
    status: args.status ?? 'failed',
    executionUncertain: args.executionUncertain,
    planDiffSummary: args.planDiffSummary ?? [],
    expectationResults: args.expectationResults ?? [],
  });
}

describe('O5 one primary reason per failure', () => {
  it('returns null for passed and skipped results', () => {
    expect(classify({ status: 'passed' })).toBeNull();
    expect(classify({ status: 'skipped' })).toBeNull();
  });

  it('treats errored, uncertain and transport failures as infrastructure', () => {
    expect(classify({ status: 'errored' })).toBe('infrastructure_error');
    expect(classify({ status: 'failed', executionUncertain: true })).toBe('infrastructure_error');
    expect(classify({
      status: 'failed',
      planDiffSummary: ['Transport gate failures: turn 0 reply missing total payload.'],
      expectationResults: [hard('text_semantic', 'score 0.2 below 0.9')],
    })).toBe('infrastructure_error');
    expect(classify({
      status: 'failed',
      planDiffSummary: ['Runtime error: RSVP isolation setup failed: locked.'],
    })).toBe('infrastructure_error');
  });

  it('treats judge and receipt-evidence gaps as evaluator defects', () => {
    expect(classify({
      status: 'failed',
      expectationResults: [hard('text_semantic', 'Judge gate failed: timeout')],
    })).toBe('evaluator_defect');
    expect(classify({
      status: 'failed',
      expectationResults: [hard('text_semantic', 'Silence requires a mandatory judge: skipped')],
    })).toBe('evaluator_defect');
    expect(classify({
      status: 'failed',
      expectationResults: [hard('fixture_effect_count', 'Missing fixture receipt evidence for rsvp.write; it is not zero.')],
    })).toBe('evaluator_defect');
    expect(classify({
      status: 'failed',
      expectationResults: [hard('text_semantic', 'Missing wire-delivered candidate evidence for semantic judging.')],
    })).toBe('evaluator_defect');
  });

  it('treats wrong-event writes, duplicates and false success as product effect/identity', () => {
    // Wrong-event write: effect count mismatch against the typed receipt.
    expect(classify({
      status: 'failed',
      expectationResults: [hard(
        'fixture_effect_count',
        'Fixture rsvp.write was attempts=1 successes=1 replays=0 outcome=success instead of attempts=0 successes=0 replays=0.',
      )],
    })).toBe('product_effect_identity');
    // Duplicate write / replay.
    expect(classify({
      status: 'failed',
      expectationResults: [hard(
        'fixture_effect_count',
        'Fixture provider.quote.write was attempts=2 successes=2 replays=1 outcome=success instead of attempts=1 successes=1 replays=0.',
      )],
    })).toBe('product_effect_identity');
    // Unauthorized tool path.
    expect(classify({
      status: 'failed',
      expectationResults: [hard('tool_usage', 'Missing=none; forbidden=guest_rsvp; total=2.')],
    })).toBe('product_effect_identity');
    // Rewritten delivery (origin mismatch) even when prose reads fine.
    expect(classify({
      status: 'failed',
      planDiffSummary: ['Output-origin gate failures: turn 1: mismatch.'],
    })).toBe('product_effect_identity');
  });

  it('treats invented absence, contradictory facts and false success as fact/completeness', () => {
    expect(classify({
      status: 'failed',
      expectationResults: [hard('text_semantic', 'score 0.3 below 0.9: invented absence of the pending order')],
    })).toBe('product_fact_completeness');
    expect(classify({
      status: 'failed',
      expectationResults: [hard('text_contains', 'Text containment checks failed.')],
    })).toBe('product_fact_completeness');
    expect(classify({
      status: 'failed',
      expectationResults: [hard('plan_field_equals', 'Plan field user_auth.status was "pending" instead of "authenticated".')],
    })).toBe('product_fact_completeness');
  });

  it('reserves unnecessary interaction for quality-only failures', () => {
    expect(classify({
      status: 'failed',
      expectationResults: [hard('trajectory_invariants', 'repeated question detected')],
    })).toBe('unnecessary_interaction');
    expect(classify({
      status: 'failed',
      expectationResults: [hard('budget_constraints', 'toolCalls=9')],
    })).toBe('unnecessary_interaction');
    // A repeated question alongside a factual failure keeps the factual reason.
    expect(classify({
      status: 'failed',
      expectationResults: [
        hard('trajectory_invariants', 'repeated question detected'),
        hard('text_semantic', 'score 0.1 below 0.9'),
      ],
    })).toBe('product_fact_completeness');
  });

  it('applies deterministic priority across mixed signals', () => {
    // Infrastructure outranks content.
    expect(classify({
      status: 'failed',
      planDiffSummary: ['Transport gate failures: missing bytes.'],
      expectationResults: [hard('fixture_effect_count', 'Fixture rsvp.write was attempts=1 successes=1 replays=0 outcome=success instead of attempts=0 successes=0 replays=0.')],
    })).toBe('infrastructure_error');
    // Evaluator outranks product verdicts.
    expect(classify({
      status: 'failed',
      expectationResults: [
        hard('text_semantic', 'Judge gate failed: malformed JSON.'),
        hard('fixture_effect_count', 'Fixture rsvp.write was attempts=1 successes=1 replays=0 outcome=success instead of attempts=0 successes=0 replays=0.'),
      ],
    })).toBe('evaluator_defect');
    // Effect/identity outranks fact/completeness.
    expect(classify({
      status: 'failed',
      expectationResults: [
        hard('text_semantic', 'score 0.2 below 0.9'),
        hard('tool_usage', 'Missing=lookup_guest_orders_by_phone; forbidden=none; total=0.'),
      ],
    })).toBe('product_effect_identity');
    // Soft failures alone never set a reason without a hard signal.
    expect(classify({
      status: 'failed',
      expectationResults: [{ passed: false, severity: 'soft', type: 'text_semantic', message: 'low score' }],
    })).toBe('product_fact_completeness');
  });

  it('never requires a preferred sentence: wording alone is not a defect signal', () => {
    // A failure message about preferred phrasing with no factual defect
    // still lands in the diagnostic fact bucket by content, and the
    // classifier never matches on quoted preferred words.
    const reason = classify({
      status: 'failed',
      expectationResults: [hard('text_semantic', 'score 0.85 below 0.9')],
    });
    expect(reason).toBe('product_fact_completeness');
  });
});
