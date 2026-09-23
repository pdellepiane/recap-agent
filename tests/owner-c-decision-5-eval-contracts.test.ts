import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EvalLoader } from '../src/evals/loader';

const RUN_ID = 'eval-2026-09-22T21-54-01-651Z-54da3f5a';

const reportRowSchema = z.object({
  caseId: z.string(),
  status: z.string(),
  finalScore: z.number(),
  hardGatePassed: z.boolean(),
  expectationResults: z.array(z.object({
    id: z.string().optional(),
    type: z.string(),
    severity: z.string(),
    passed: z.boolean(),
    score: z.number().optional(),
    message: z.string().optional(),
  })),
});

const ledgerFailureSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.string(),
  score: z.number().nullable(),
  message: z.string().nullable(),
  classification: z.enum([
    'product-fact-effect',
    'product-helpfulness',
    'oracle-fixture',
    'planning-accepted',
  ]),
  contract: z.string(),
  note: z.string().min(1),
});

const ledgerRowSchema = z.object({
  caseId: z.string(),
  suite: z.string(),
  status: z.string(),
  finalScore: z.number(),
  hardGatePassed: z.boolean(),
  turns: z.array(z.object({
    turnIndex: z.number(),
    deliveredText: z.string().nullable(),
    toolsCalled: z.array(z.string()),
  })),
  failedExpectations: z.array(ledgerFailureSchema),
});

const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  counts: z.object({
    rows: z.number(),
    passed: z.number(),
    failed: z.number(),
    failedExpectations: z.number(),
  }),
  rows: z.array(ledgerRowSchema),
});

const REVISED_VERSIONS: Record<string, number> = {
  'live_behavior.gift_mixed_order_distinguishes_items': 4,
  'live_behavior.purchase_current_pending_over_old_approved': 3,
  'live_behavior.purchase_delia_status_by_phone': 5,
  'live_behavior.purchase_martha_accountless_selection': 5,
  'live_behavior.purchase_kiara_pending_by_phone': 3,
  'live_behavior.s08_kiara_approved_replay': 6,
  'live_behavior.s01_frozen_kiara_pending_replay': 4,
  'live_behavior.phone_purchase_missing_hands_off_once': 2,
  'live_behavior.image_distractor_history_preserves_current_question': 3,
  'live_behavior.image_readable_captionless': 6,
};
// The frozen ledger retains the contract revision it originally reviewed.
// A later, separately versioned oracle correction must not rewrite history.
const CURRENT_VERSION_OVERRIDES: Record<string, number> = {
  'live_behavior.image_readable_captionless': 7,
};

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsKey(entry, key));
  }
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([entryKey, entryValue]) => entryKey === key || containsKey(entryValue, key),
    );
  }
  return false;
}

describe('Owner C decision 5 eval contracts', () => {
  it('keeps the frozen run immutable at 77 pass / 61 fail', () => {
    const runDir = path.resolve(process.cwd(), '.eval-runs', RUN_ID);
    const manifest = readJson(path.join(runDir, 'manifest.json')) as {
      cases: { orderedIds: string[] };
      referenceStatus: string;
    };
    expect(manifest.referenceStatus).toBe('red');
    expect(manifest.cases.orderedIds.length).toBe(138);
    const report = readJson(path.join(runDir, 'report.json')) as {
      totalCases: number;
      passedCases: number;
      failedCases: number;
      erroredCases: number;
      skippedCases: number;
    };
    expect(report).toMatchObject({
      totalCases: 138,
      passedCases: 77,
      failedCases: 61,
      erroredCases: 0,
      skippedCases: 0,
    });
  });

  it('builds a 138-row ledger from the frozen run without rescoring', () => {
    const runDir = path.resolve(process.cwd(), '.eval-runs', RUN_ID);
    const manifest = readJson(path.join(runDir, 'manifest.json')) as {
      cases: { orderedIds: string[] };
    };
    const report = readJson(path.join(runDir, 'report.json')) as {
      results: unknown[];
    };
    const reportRows = report.results.map((row) => reportRowSchema.parse(row));
    const reportById = new Map(reportRows.map((row) => [row.caseId, row]));
    const ledger = ledgerSchema.parse(
      readJson(path.resolve(process.cwd(), 'evals/ledgers', `${RUN_ID}.json`)),
    );

    expect(ledger.runId).toBe(RUN_ID);
    expect(ledger.counts).toEqual({ rows: 138, passed: 77, failed: 61, failedExpectations: 87 });
    expect(ledger.rows.length).toBe(138);
    expect(ledger.rows.map((row) => row.caseId)).toEqual(manifest.cases.orderedIds);

    for (const row of ledger.rows) {
      const frozen = reportById.get(row.caseId);
      expect(frozen, `ledger row ${row.caseId} matches a frozen result`).toBeDefined();
      if (!frozen) {
        continue;
      }
      // No rescoring: status, score, and gate are copied from the frozen report.
      expect(row.status).toBe(frozen.status);
      expect(row.finalScore).toBe(frozen.finalScore);
      expect(row.hardGatePassed).toBe(frozen.hardGatePassed);
      const frozenFailures = frozen.expectationResults.filter(
        (expectation) => expectation.passed === false,
      );
      expect(row.failedExpectations.length).toBe(frozenFailures.length);
      for (const failure of row.failedExpectations) {
        const frozenFailure = frozenFailures.find((entry) => entry.id === failure.id);
        expect(frozenFailure, `${row.caseId}::${failure.id} failed in the frozen run`).toBeDefined();
        expect(failure.type).toBe(frozenFailure?.type);
        expect(failure.severity).toBe(frozenFailure?.severity);
        expect(failure.score ?? undefined).toBe(frozenFailure?.score);
      }
      if (frozenFailures.length > 0) {
        expect(row.turns.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps frozen ledger revisions linked while allowing a later versioned correction', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    const ledger = ledgerSchema.parse(
      readJson(path.resolve(process.cwd(), 'evals/ledgers', `${RUN_ID}.json`)),
    );
    const revisedByCase = new Map<string, string>();
    for (const row of ledger.rows) {
      for (const failure of row.failedExpectations) {
        if (failure.contract === 'kept') {
          continue;
        }
        const seen = revisedByCase.get(row.caseId);
        if (seen !== undefined) {
          expect(failure.contract).toBe(seen);
        } else {
          revisedByCase.set(row.caseId, failure.contract);
        }
      }
    }
    expect([...revisedByCase.keys()].sort()).toEqual(Object.keys(REVISED_VERSIONS).sort());
    for (const [caseId, contract] of revisedByCase) {
      const evalCase = casesById.get(caseId);
      expect(evalCase, `${caseId} still exists (no case deletion)`).toBeDefined();
      expect(contract).toBe(`revised-to-v${REVISED_VERSIONS[caseId]}`);
      expect(evalCase?.version).toBe(
        CURRENT_VERSION_OVERRIDES[caseId] ?? REVISED_VERSIONS[caseId],
      );
    }
    const suite = catalog.suites.find((candidate) => candidate.id === 'live_behavior_regression');
    expect(suite?.caseIds.length).toBe(138);
  });

  it('keeps hard severity, judges, and thresholds on every revised contract', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    for (const caseId of Object.keys(REVISED_VERSIONS)) {
      const evalCase = casesById.get(caseId);
      expect(evalCase).toBeDefined();
      if (!evalCase) {
        continue;
      }
      for (const expectation of evalCase.expectations) {
        expect(expectation.severity, `${caseId}::${expectation.id} stays hard`).toBe('hard');
      }
      for (const expectation of evalCase.expectations) {
        if (expectation.type !== 'text_semantic') {
          continue;
        }
        expect(expectation.requireJudge, `${caseId}::${expectation.id} keeps its judge`).toBe(true);
        expect(expectation.minScore, `${caseId}::${expectation.id} keeps its threshold`).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('replaces exact tool-label pins with authorized evidence and coverage assertions', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    const toolPinCases = [
      'live_behavior.purchase_current_pending_over_old_approved',
      'live_behavior.purchase_delia_status_by_phone',
      'live_behavior.purchase_martha_accountless_selection',
      'live_behavior.purchase_kiara_pending_by_phone',
      'live_behavior.s08_kiara_approved_replay',
      'live_behavior.s01_frozen_kiara_pending_replay',
    ];
    for (const caseId of toolPinCases) {
      const evalCase = casesById.get(caseId);
      expect(evalCase).toBeDefined();
      if (!evalCase) {
        continue;
      }
      for (const expectation of evalCase.expectations) {
        if (expectation.type !== 'tool_usage') {
          continue;
        }
        const labels = [...expectation.mustCall, ...expectation.mustNotCall];
        expect(
          labels.filter((label) => label.startsWith('lookup_')),
          `${caseId} drops lookup-label pins`,
        ).toEqual([]);
      }
      const evidence = evalCase.expectations.find(
        (expectation) => expectation.type === 'trace_field_subset',
      );
      expect(evidence?.severity, `${caseId} adds hard evidence proof`).toBe('hard');
      if (evidence?.type === 'trace_field_subset') {
        expect(evidence.path).toBe('information_execution_summary');
        expect(containsKey(evidence.expected, 'coverage')).toBe(true);
        expect(containsKey(evidence.expected, 'purchaseFact')).toBe(true);
      }
    }
  });

  it('drops only the shipping-only paymentStatus demand from the mixed-gift trace pin', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const evalCase = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.gift_mixed_order_distinguishes_items',
    );
    const pin = evalCase?.expectations.find((expectation) => expectation.id === 'mixed-gift-evidence-in-trace');
    expect(pin?.type).toBe('trace_field_subset');
    if (pin?.type === 'trace_field_subset') {
      expect(containsKey(pin.expected, 'paymentStatus')).toBe(false);
      expect(containsKey(pin.expected, 'eventLabel')).toBe(true);
    }
  });

  it('requires an offer, not an unrequested handoff effect, for the missing-purchase case', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const evalCase = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.phone_purchase_missing_hands_off_once',
    );
    const byId = new Map((evalCase?.expectations ?? []).map((expectation) => [expectation.id, expectation]));
    const toolPin = byId.get('scoped-lookup-and-handoff');
    expect(toolPin?.type).toBe('tool_usage');
    if (toolPin?.type === 'tool_usage') {
      expect(toolPin.mustCall).toEqual(['lookup_guest_orders_by_phone']);
      expect(toolPin.mustNotCall).toContain('request_human_takeover');
    }
    const planPin = byId.get('manual-help-requested');
    expect(planPin?.type).toBe('plan_field_equals');
    if (planPin?.type === 'plan_field_equals') {
      expect(planPin.expected).toBe('none');
    }
    const effectPin = byId.get('missing-purchase-handoff-effect');
    expect(effectPin?.type).toBe('fixture_effect_count');
    if (effectPin?.type === 'fixture_effect_count') {
      expect(effectPin.expectedAttempts).toBe(0);
      expect(effectPin.expectedSuccesses).toBe(0);
    }
    const semantic = byId.get('scoped-missing-data-handoff-not-account-login');
    expect(semantic?.type).toBe('text_semantic');
    if (semantic?.type === 'text_semantic') {
      expect(semantic.rubric).toContain('offer human help');
      expect(semantic.rubric).toContain('without claiming a handoff was requested');
      expect(semantic.minScore).toBe(0.9);
    }
  });

  it('judges distractor T0 by bounded reconciliation and captionless T1 by the asked amount', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const distractor = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.image_distractor_history_preserves_current_question',
    );
    const persistPin = distractor?.expectations.find(
      (expectation) => expectation.id === 'distractor-image-silent-persist-reason',
    );
    expect(persistPin?.type).toBe('text_semantic');
    if (persistPin?.type === 'text_semantic') {
      expect(persistPin.requireJudge).toBe(true);
      expect(persistPin.minScore).toBe(0.8);
      expect(persistPin.rubric).toContain('S/ 149.90');
    }
    const captionless = catalog.cases.find(
      (candidate) => candidate.id === 'live_behavior.image_readable_captionless',
    );
    const delayed = captionless?.expectations.find(
      (expectation) => expectation.id === 'image-delayed-question-answered',
    );
    expect(delayed?.type).toBe('text_semantic');
    if (delayed?.type === 'text_semantic') {
      expect(delayed.minScore).toBe(0.8);
      expect(delayed.rubric).toContain('S/ 149.90');
      expect(delayed.rubric).toContain('not required');
      expect(delayed.rubric).toContain('Merchant, date, operation number, and card digits are optional');
      expect(delayed.rubric).not.toContain('plus identifying context');
    }
  });

  it('keeps hard checks for entity, effect, balance, delivery, and handoff truth', async () => {
    const catalog = await new EvalLoader(path.resolve(process.cwd(), 'evals')).loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    // Image tool pin stands: the tool was in scope and native availability is unproven.
    const receiptThread = casesById.get('live_behavior.image_url_receipt_payment_thread');
    const nativePin = receiptThread?.expectations.find(
      (expectation) => expectation.id === 'receipt-url-uses-native-context',
    );
    expect(nativePin?.type).toBe('tool_usage');
    if (nativePin?.type === 'tool_usage') {
      expect(nativePin.mustCall).toContain('image_url_context');
      expect(nativePin.severity).toBe('hard');
    }
    // False-effect language still fails.
    const noRepeat = casesById.get('live_behavior.wait_followup_no_repeat');
    expect(
      noRepeat?.expectations.some(
        (expectation) => expectation.id === 'turn2-short-no-repeat' && expectation.severity === 'hard',
      ),
    ).toBe(true);
    // Plus-one saved receipts still require confirmation without hedging.
    const combined = casesById.get('live_behavior.rsvp_guest_and_plus_one_combined_saved');
    const combinedSaved = combined?.expectations.find((expectation) => expectation.id === 'combined-saved');
    expect(combinedSaved?.type).toBe('text_semantic');
    if (combinedSaved?.type === 'text_semantic') {
      expect(combinedSaved.severity).toBe('hard');
      expect(combinedSaved.requireJudge).toBe(true);
    }
    // Confirmed-handoff truth still requires an explicit requested statement.
    const repeatedOtp = casesById.get('live_behavior.repeated_otp_failure_preserves_gift_query');
    const handoffConfirmed = repeatedOtp?.expectations.find(
      (expectation) => expectation.id === 'turn0-auth-episode-ended-handoff-confirmed',
    );
    expect(handoffConfirmed?.type).toBe('text_semantic');
    if (handoffConfirmed?.type === 'text_semantic') {
      expect(handoffConfirmed.severity).toBe('hard');
      expect(handoffConfirmed.rubric).toContain('has been requested');
    }
  });
});
