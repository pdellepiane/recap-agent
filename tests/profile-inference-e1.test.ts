import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EvalLoader } from '../src/evals/loader';
import { resolveJudgeOnlyImageGroundTruth } from '../src/evals/runner';

const ledgerRowSchema = z.object({
  case: z.string().min(1),
  expectation: z.string().min(1),
  type: z.string().min(1),
  disposition: z.enum(['retain', 'revise', 'replace']),
  rationale: z.string().min(1),
});

const ledgerSchema = z.object({
  packet: z.literal('E1'),
  totalCases: z.number().int().positive(),
  totalExpectations: z.number().int().positive(),
  removed: z.array(z.object({
    case: z.string().min(1),
    expectation: z.string().min(1),
    disposition: z.enum(['retain', 'revise', 'replace']),
  })).default([]),
  added: z.array(z.object({
    case: z.string().min(1),
    expectation: z.string().min(1),
  })).default([]),
  rows: z.array(ledgerRowSchema).min(1),
});

const inventorySchema = z.object({
  count: z.number().int().positive(),
  cases: z.array(z.object({ id: z.string().min(1) })).min(1),
});

async function loadCatalog() {
  const evalDirectory = path.resolve(process.cwd(), 'evals');
  return new EvalLoader(evalDirectory).loadCatalog();
}

describe('packet E1 profile-inference expectation audit', () => {
  it('ledger covers every expectation of every inventory case with a discovered count', async () => {
    const planDirectory = path.resolve(process.cwd(), 'docs/plan/2026-09-09-lean-conversation');
    const ledger = ledgerSchema.parse(JSON.parse(
      await fs.readFile(path.join(planDirectory, 'profile-inference-disposition-ledger.json'), 'utf8'),
    ) as unknown);
    const inventory = inventorySchema.parse(JSON.parse(
      await fs.readFile(path.join(planDirectory, 'profile-inference-test-inventory-2026-09-15.json'), 'utf8'),
    ) as unknown);
    const catalog = await loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));

    const inventoryIds = new Set(inventory.cases.map((entry) => entry.id));
    expect(ledger.totalCases).toBe(inventoryIds.size);
    expect(ledger.totalExpectations).toBe(ledger.rows.length + ledger.removed.length - ledger.added.length);
    expect(ledger.totalExpectations).toBe(
      [...inventoryIds].reduce(
        (sum, id) => sum + (casesById.get(id)?.expectations.length ?? 0),
        0,
      ) + ledger.removed.length - ledger.added.length,
    );

    const ledgerCases = new Set(ledger.rows.map((row) => row.case));
    expect(ledgerCases).toEqual(inventoryIds);
    for (const id of inventoryIds) {
      const live = casesById.get(id);
      expect(live, `inventory case ${id} missing from catalog`).toBeDefined();
      const ledgerIds = new Set(
        ledger.rows.filter((row) => row.case === id).map((row) => row.expectation),
      );
      const liveIds = new Set((live?.expectations ?? []).map((e) => e.id ?? `${e.type}-unnamed`));
      expect(ledgerIds).toEqual(liveIds);
    }
  });

  it('host-declining is split into unique-guest and distinguishable-identity tests', async () => {
    const catalog = await loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    const unique = casesById.get('live_behavior.rsvp_host_set_declining_unique_guest');
    const consistent = casesById.get('live_behavior.rsvp_host_set_declining_consistent');
    expect(unique).toBeDefined();
    expect(consistent).toBeDefined();
    expect(unique?.backendFixture?.scenario).toBe('rsvp-host-declining-unique');
    expect(consistent?.backendFixture?.scenario).toBe('rsvp-host-declining');

    const evalDirectory = path.resolve(process.cwd(), 'evals/fixtures');
    const uniqueFixture = JSON.parse(
      await fs.readFile(path.join(evalDirectory, 'rsvp-host-declining-unique.json'), 'utf8'),
    ) as {
      eventDetails: Record<string, { attendance: { has_responded: boolean; will_attend: number } }>;
    };
    const uniqueEvents = Object.values(uniqueFixture.eventDetails);
    expect(uniqueEvents).toHaveLength(1);
    expect(uniqueEvents[0]?.attendance.has_responded).toBe(false);
    expect(uniqueEvents[0]?.attendance.will_attend).toBe(0);

    const splitFixture = JSON.parse(
      await fs.readFile(path.join(evalDirectory, 'rsvp-host-declining.json'), 'utf8'),
    ) as {
      eventDetails: Record<string, { event: { datetime: string }; attendance: { will_attend: number } }>;
    };
    const datetimes = new Set(Object.values(splitFixture.eventDetails).map((d) => d.event.datetime));
    expect(datetimes.size).toBe(Object.keys(splitFixture.eventDetails).length);

    const crossGuest = JSON.parse(
      await fs.readFile(path.join(evalDirectory, 'rsvp-same-event-cross-guest.json'), 'utf8'),
    ) as { scenario: string };
    expect(crossGuest.scenario).toBe('rsvp-same-event-cross-guest');
  });

  it('S07 evaluates the complete utterance with zero-write authority and keeps its threshold', async () => {
    const catalog = await loadCatalog();
    const s07 = catalog.cases.find((c) => c.id === 'live_behavior.s07_attending_identical_no_write');
    expect(s07?.version).toBe(2);
    const rubric = s07?.expectations.find((e) => e.id === 'reports-confirmed-without-new-registration');
    expect(rubric?.type).toBe('text_semantic');
    if (rubric?.type !== 'text_semantic') throw new Error('S07 rubric shape changed');
    expect(rubric.minScore).toBe(0.9);
    expect(rubric.requireJudge).toBe(true);
    expect(rubric.rubric).toMatch(/complete utterance/i);
    expect(rubric.rubric).toMatch(/zero-write/i);
  });

  it('delayed-image ground truth is digest-bound and judge-only', async () => {
    const catalog = await loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    for (const id of ['live_behavior.image_file_delayed_question', 'live_behavior.image_readable_captionless']) {
      const live = casesById.get(id);
      const truth = live?.judgeGroundTruth;
      expect(truth, `${id} needs judgeGroundTruth`).toBeDefined();
      if (!truth) throw new Error(`missing ground truth for ${id}`);
      const boundInput = live?.inputs[truth.boundInputTurn];
      const image = boundInput?.image;
      const imageData = image !== undefined && image !== null && 'data' in image ? image.data : null;
      expect(typeof imageData === 'string' && imageData.length > 0).toBe(true);
      if (typeof imageData !== 'string') throw new Error(`missing image data for ${id}`);
      const digest = crypto.createHash('sha256').update(imageData, 'utf8').digest('hex');
      expect(digest).toBe(truth.imageDigest);

      const section = resolveJudgeOnlyImageGroundTruth(live);
      expect(section).not.toBeNull();
      expect(section ?? '').toMatch(/JUDGE-ONLY IMAGE GROUND TRUTH/);
      expect(section ?? '').toMatch(/never runtime input/);
      expect(section ?? '').toContain(truth.verifiedText);
    }
  });

  it('ambiguous selection proves continuation instead of pinning a counter', async () => {
    const catalog = await loadCatalog();
    const ambiguous = catalog.cases.find(
      (c) => c.id === 'live_behavior.rsvp_ambiguous_event_requires_grounded_selection',
    );
    // Packet C v5: the internal node pin is replaced by an observable
    // zero-write receipt; the id is retained for ledger continuity.
    expect(ambiguous?.version).toBe(5);
    const ids = (ambiguous?.expectations ?? []).map((e) => e.id);
    expect(ids).not.toContain('records-one-ambiguous-attempt');
    expect(ids).not.toContain('projection-carries-candidate-dates');
    expect((ambiguous?.expectations ?? []).some((e) => e.type === 'text_contains')).toBe(false);
    expect((ambiguous?.expectations ?? []).some((e) => e.type === 'node_transition')).toBe(false);
    const stayInSelection = ambiguous?.expectations.find((e) => e.id === 'remains-in-rsvp-node');
    expect(stayInSelection?.type).toBe('fixture_effect_count');
    const continuation = ambiguous?.expectations.find((e) => e.id === 'continuation-answers-on-chosen-candidate');
    expect(continuation?.type).toBe('text_semantic');
    if (continuation?.type !== 'text_semantic') throw new Error('continuation shape changed');
    expect(continuation.turnIndex).toBe(1);
    expect(continuation.requireJudge).toBe(true);
    expect(ambiguous?.budget?.maxTurns).toBe(2);
  });

  it('wedding-planner literal pins are a semantic outcome check', async () => {
    const catalog = await loadCatalog();
    const planner = catalog.cases.find(
      (c) => c.id === 'live_behavior.wedding_planner_location_completes_search',
    );
    expect(planner?.version).toBe(2);
    expect((planner?.expectations ?? []).some((e) => e.type === 'text_contains')).toBe(false);
    const outcome = planner?.expectations.find((e) => e.id === 'explicit-need-asks-missing-context');
    expect(outcome?.type).toBe('text_semantic');
    if (outcome?.type !== 'text_semantic') throw new Error('planner outcome shape changed');
    expect(outcome.requireJudge).toBe(true);
  });

  it('E1 coverage entries point at mandatory-suite cases with hard structure and hard judges', async () => {
    const evalDirectory = path.resolve(process.cwd(), 'evals');
    const registry = z.object({
      behaviorChanges: z.array(z.object({
        id: z.string().min(1),
        liveCaseIds: z.array(z.string().min(1)).min(1),
      })).min(1),
    }).parse(YAML.parse(
      await fs.readFile(path.join(evalDirectory, 'live-behavior-coverage.yaml'), 'utf8'),
    ) as unknown);
    const catalog = await loadCatalog();
    const suite = catalog.suites.find((candidate) => candidate.id === 'live_behavior_regression');
    const registered = new Set(suite?.caseIds ?? []);
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    const e1 = registry.behaviorChanges.filter((change) => change.id.startsWith('e1-'));
    expect(e1.length).toBeGreaterThan(0);
    for (const change of e1) {
      for (const caseId of change.liveCaseIds) {
        const live = casesById.get(caseId);
        expect(live, `${change.id} references missing case ${caseId}`).toBeDefined();
        expect(registered.has(caseId), `${caseId} is not in the mandatory suite`).toBe(true);
        expect(
          live?.expectations.some((e) => e.severity === 'hard' && e.type !== 'text_semantic' && e.type !== 'budget_constraints' && e.type !== 'token_usage_present'),
          `${caseId} needs a hard structural expectation`,
        ).toBe(true);
        expect(
          live?.expectations.some((e) => e.type === 'text_semantic' && e.severity === 'hard' && e.requireJudge === true),
          `${caseId} needs a hard required semantic judge`,
        ).toBe(true);
      }
    }
  });
});
