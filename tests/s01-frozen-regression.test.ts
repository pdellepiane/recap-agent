import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

type EvalExpectationLike = {
  type: string;
  severity: string;
  requireJudge?: boolean;
};

type EvalCaseLike = {
  id: string;
  suite: string;
  targetModes: string[];
  backendFixture?: { scenario: string };
  inputs: Array<{ contactPhone?: string | null }>;
  expectations: EvalExpectationLike[];
};

type CoverageLike = {
  behaviorChanges: Array<{ id: string; liveCaseIds: string[] }>;
};

type SuiteLike = { caseIds: string[] };

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

function readYaml(relative: string): unknown {
  return YAML.parse(fs.readFileSync(path.join(REPO, relative), 'utf8'));
}

function readJson(relative: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(REPO, relative), 'utf8')) as unknown;
}

function asCase(value: unknown): EvalCaseLike {
  if (!isRecord(value)) throw new Error('Expected case record.');
  const id = value['id'];
  const suite = value['suite'];
  const targetModes = value['targetModes'];
  const inputs = value['inputs'];
  const expectations = value['expectations'];
  if (typeof id !== 'string' || typeof suite !== 'string') throw new Error('Bad case identity.');
  if (!Array.isArray(targetModes) || !Array.isArray(inputs) || !Array.isArray(expectations)) {
    throw new Error('Bad case shape.');
  }
  return value as unknown as EvalCaseLike;
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
    const kase = asCase(readYaml('evals/cases/live-behavior-purchase-kiara-phone-orders.yaml'));
    expect(kase.id).toBe('live_behavior.purchase_kiara_pending_by_phone');
    expect(kase.backendFixture?.scenario).toBe('purchase-kiara-frozen');
    expect(kase.inputs[0]?.contactPhone).toBe('+51900027635');
    expect(kase.inputs[0]?.contactPhone).not.toContain('999927635');
    const fixture = readJson('evals/fixtures/purchase-kiara-frozen.json');
    if (!isRecord(fixture)) throw new Error('Bad Kiara fixture.');
    expect(fixture['scenario']).toBe('purchase-kiara-frozen');
    const world = fixtureWorld(fixture, '51900027635');
    expect(world.pending_orders.length).toBe(1);
    expect(world.pending_orders[0]?.payment_status).toBe('pending');
    const types = kase.expectations.map((e) => `${e.type}:${e.severity}`);
    expect(types).toContain('node_transition:hard');
    expect(types).toContain('tool_usage:hard');
    const semantic = kase.expectations.find((e) => e.type === 'text_semantic');
    expect(semantic?.severity).toBe('hard');
    expect(semantic?.requireJudge).toBe(true);
  });

  it('freezes Martha multi-record world on a synthetic identity with a declared fixture', () => {
    const kase = asCase(readYaml('evals/cases/live-behavior-purchase-martha-accountless.yaml'));
    expect(kase.id).toBe('live_behavior.purchase_martha_accountless_selection');
    expect(kase.backendFixture?.scenario).toBe('purchase-martha-frozen');
    expect(kase.inputs[0]?.contactPhone).toBe('+51900070122');
    expect(kase.inputs[0]?.contactPhone).not.toContain('922701221');
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
    const types = kase.expectations.map((e) => `${e.type}:${e.severity}`);
    // 2026-09-17 hardening item 5: node pin replaced by zero-effect receipt pins.
    expect(types).toContain('fixture_effect_count:hard');
    expect(types).toContain('tool_usage:hard');
    const semantic = kase.expectations.find((e) => e.type === 'text_semantic');
    expect(semantic?.severity).toBe('hard');
    expect(semantic?.requireJudge).toBe(true);
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

  it('freezes the current no-metadata message shape', () => {
    const source = fs.readFileSync(
      path.join(REPO, 'src/runtime/agent-conversation-gateway.ts'),
      'utf8',
    );
    const start = source.indexOf('const messageSchema');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('});', start));
    for (const field of ['event_id', 'campaign_id', 'invitation_id', 'recipient_name', 'campaign_reference', 'guest_id']) {
      expect(block).not.toContain(`${field}:`);
    }
    for (const field of ['id:', 'direction:', 'source:', 'body:', 'status:', 'sent_at:', 'created_at:']) {
      expect(block).toContain(field);
    }
  });

  it('registers an S01 live case with hard structural and hard semantic gates', () => {
    const kase = asCase(readYaml('evals/cases/live-behavior-s01-frozen-world-identity.yaml'));
    expect(kase.suite).toBe('live_behavior_regression');
    expect(kase.targetModes).toContain('live_lambda');
    expect(kase.backendFixture?.scenario).toBe('purchase-kiara-frozen');
    const hasHardStructural = kase.expectations.some(
      (e) => e.severity === 'hard' && e.type !== 'text_semantic' && e.type !== 'budget_constraints' && e.type !== 'token_usage_present',
    );
    expect(hasHardStructural).toBe(true);
    const hasHardJudge = kase.expectations.some(
      (e) => e.type === 'text_semantic' && e.severity === 'hard' && e.requireJudge === true,
    );
    expect(hasHardJudge).toBe(true);
    const suite = readYaml('evals/suites/live_behavior_regression.yaml') as SuiteLike;
    expect(suite.caseIds).toContain(kase.id);
    const registry = readYaml('evals/live-behavior-coverage.yaml') as CoverageLike;
    const entry = registry.behaviorChanges.find((b) => b.id === 's01-frozen-incident-worlds');
    expect(entry).toBeDefined();
    expect(entry?.liveCaseIds).toContain(kase.id);
  });

  it('records frozen baseline identity in the eval runner', () => {
    const source = fs.readFileSync(path.join(REPO, 'src/evals/runner.ts'), 'utf8');
    expect(source).toContain('S01_FROZEN_BASELINE');
    expect(source).toContain('55a6c99bba6e2d1162aee071204f41aeebb8fba9');
  });
});
