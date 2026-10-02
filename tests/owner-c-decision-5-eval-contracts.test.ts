import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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

// The frozen ledger retains the contract revision it originally reviewed.
// A later, separately versioned oracle correction must not rewrite history.

// 2026-09-30 live compression: two revised threads merged into surviving
// carriers. The frozen ledger keeps the original ids; live assertions resolve
// to the survivor, whose version pins the merged contract.

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

describe('Owner C decision 5 eval contracts', () => {
  it('keeps the frozen run immutable at 77 pass / 61 fail', () => {
    const runDir = path.resolve(process.cwd(), 'tests/fixtures/frozen-evaluation', RUN_ID);
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
    const runDir = path.resolve(process.cwd(), 'tests/fixtures/frozen-evaluation', RUN_ID);
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

});
