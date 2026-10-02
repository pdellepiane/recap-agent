import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

type ClassificationCase = {
  caseId: string;
  currentStatus: string;
  boundary: string;
  failedAssertions: string;
};

type ClassificationLike = {
  baselineCommit: string;
  artifactModel: string;
  asOfTime: string;
  totalCases: number;
  cases: ClassificationCase[];
  incidentSpecs: unknown[];
  heldOutSupportReviewSet: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(relative: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(REPO, relative), 'utf8')) as unknown;
}

function fixtureWorld(fixture: unknown, key: string): { pending_orders: Array<{ payment_status: string }> } {
  if (!isRecord(fixture)) throw new Error('Bad fixture.');
  const orders = fixture['guestOrders'];
  if (!isRecord(orders)) throw new Error('Bad guestOrders.');
  const world = orders[key];
  if (!isRecord(world)) throw new Error('Missing fixture world.');
  const pending = world['pending_orders'];
  if (!Array.isArray(pending)) throw new Error('Bad pending orders.');
  return { pending_orders: pending as Array<{ payment_status: string }> };
}

describe('S01 frozen incident regression worlds', () => {
  it('freezes Kiara pending world on a synthetic identity with a declared fixture', () => {
    const fixture = readJson('evals/fixtures/purchase-kiara-frozen.json');
    if (!isRecord(fixture)) throw new Error('Bad Kiara fixture.');
    expect(fixture['scenario']).toBe('purchase-kiara-frozen');
    const world = fixtureWorld(fixture, '51900027635');
    expect(world.pending_orders.length).toBe(1);
    expect(world.pending_orders[0]?.payment_status).toBe('pending');
  });

  it('freezes Martha multi-record world on a synthetic identity with a declared fixture', () => {
    const fixture = readJson('evals/fixtures/purchase-martha-frozen.json');
    if (!isRecord(fixture)) throw new Error('Bad Martha fixture.');
    expect(fixture['scenario']).toBe('purchase-martha-frozen');
    const world = fixtureWorld(fixture, '51900070122');
    expect(world.pending_orders.length).toBeGreaterThanOrEqual(2);
    const events = fixture['guestEvents'];
    if (!isRecord(events)) throw new Error('Bad guestEvents.');
    const entry = events['51900070122'];
    if (!isRecord(entry)) throw new Error('Missing Martha guest events.');
    expect(entry['events']).toEqual([]);
    // 2026-09-17 hardening item 5: node pin replaced by zero-effect receipt pins.
  });

  it('classifies the 59-case baseline with artifact identity and 16 failures by boundary', () => {
    const classification = readJson('evals/baseline/s01-59-case-classification.json') as ClassificationLike;
    expect(classification.baselineCommit).toBe('55a6c99bba6e2d1162aee071204f41aeebb8fba9');
    expect(classification.artifactModel).toBe('gpt-5.6-luna');
    expect(classification.asOfTime).toBe('2026-09-05T01:33:57.291Z');
    expect(classification.totalCases).toBe(59);
    expect(classification.cases.length).toBe(59);
    const failures = classification.cases.filter((c) => c.currentStatus === 'failed');
    expect(failures.length).toBe(16);
    for (const failure of failures) {
      expect(typeof failure.boundary).toBe('string');
      expect(failure.boundary.length).toBeGreaterThan(0);
      expect(typeof failure.failedAssertions).toBe('string');
    }
    const ids = new Set(classification.cases.map((c) => c.caseId));
    expect(ids.has('live_behavior.purchase_kiara_pending_by_phone')).toBe(true);
    expect(ids.has('live_behavior.purchase_martha_accountless_selection')).toBe(true);
    expect(classification.incidentSpecs.length).toBe(4);
    expect(classification.heldOutSupportReviewSet.length).toBeGreaterThan(0);
  });

  it('records frozen baseline identity in the eval runner', () => {
    const source = fs.readFileSync(path.join(REPO, 'src/evals/runner.ts'), 'utf8');
    expect(source).toContain('S01_FROZEN_BASELINE');
    expect(source).toContain('55a6c99bba6e2d1162aee071204f41aeebb8fba9');
  });
});
