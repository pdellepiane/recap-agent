import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvalLoader } from '../src/evals/loader';
import { expandMasterCases, masterProtocolSchema, masterSchedule, resolveMasterCases, summarizeMasterResults } from '../src/evals/master-study';

async function load() {
  const protocol = masterProtocolSchema.parse(JSON.parse(await fs.readFile('evals/studies/current-master-2026-10-27.json', 'utf8')) as unknown);
  const catalog = await new EvalLoader(path.resolve('evals')).loadCatalog();
  return { protocol, catalog, cases: resolveMasterCases(protocol, catalog.cases) };
}

describe('single frozen master study', () => {
  it('covers three strata with unique fixture-backed objective scenarios and exactly three isolated repetitions', async () => {
    const { protocol, cases } = await load();
    expect(cases).toHaveLength(30);
    const schedule = masterSchedule(protocol);
    expect(schedule).toHaveLength(90);
    expect(schedule).toEqual(masterSchedule(protocol));
    for (const current of cases) {
      expect(schedule.filter(a => a.caseId === current.id).map(a => a.repetition)).toEqual([1, 2, 3]);
    }
    const expanded = expandMasterCases(protocol, cases);
    expect(new Set(expanded.map(c => c.id)).size).toBe(90);
    expect(expanded.every(c => c.backendFixture?.scenario)).toBe(true);
    expect(expanded.every(c => c.scorers.every(s => s.type === 'expectation_pass_rate'))).toBe(true);
    expect(expanded.reduce((n, c) => n + c.inputs.length, 0)).toBeGreaterThan(90);
  });

  it('freezes the separately declared expanded follow-up population', async () => {
    const protocol = masterProtocolSchema.parse(JSON.parse(await fs.readFile('evals/studies/current-master-followup-2026-10-27.json', 'utf8')) as unknown);
    const catalog = await new EvalLoader(path.resolve('evals')).loadCatalog();
    const cases = resolveMasterCases(protocol, catalog.cases);
    expect(cases).toHaveLength(36);
    expect(masterSchedule(protocol)).toHaveLength(108);
    for (const stratum of ['provider', 'faq_customer_service', 'continuity_auth_effects']) {
      expect(protocol.population.filter(c => c.stratum === stratum)).toHaveLength(12);
    }
    expect(new Set(masterSchedule(protocol).map(a => `${a.caseId}:${a.repetition}`)).size).toBe(108);
  });

  it('rejects missing scenarios, duplicate slots and semantic judges before dispatch', async () => {
    const { protocol, cases } = await load();
    expect(() => resolveMasterCases(protocol, cases.slice(1))).toThrow('unavailable');
    const uncovered = structuredClone(cases);
    delete uncovered[0].inputs[0].backendFixture;
    expect(() => resolveMasterCases(protocol, uncovered)).toThrow('every turn');
    const duplicate = structuredClone(protocol);
    duplicate.population[1] = duplicate.population[0];
    expect(() => masterProtocolSchema.parse(duplicate)).toThrow('distinct');
    const judged = structuredClone(cases);
    judged[0].scorers = [{ id: 'judge', type: 'text_semantic', weight: 1, rubric: 'not allowed' }];
    expect(() => resolveMasterCases(protocol, judged)).toThrow('zero judges');
  });

  it('retains failures and scenario clusters rather than treating 90 trials as independent scenarios', async () => {
    const { protocol } = await load();
    const outcomes = new Map(protocol.population.map((c, i) => [c.id, i < 3 ? [false, false, false] : [true, true, true]]));
    const summary = summarizeMasterResults(protocol, outcomes);
    expect(summary.passed).toBe(81);
    expect(summary.passRate).toBe(0.9);
    expect(summary.allThreePassScenarios).toBe(27);
    expect(summary.scenarioClusterBootstrap95?.lower).toBeLessThan(0.9);
    expect(summary).toEqual(summarizeMasterResults(protocol, outcomes));
    outcomes.delete(protocol.population[0].id);
    expect(summarizeMasterResults(protocol, outcomes).scenarioClusterBootstrap95).toBeNull();
    outcomes.set(protocol.population[0].id, [true, true, true, true]);
    expect(() => summarizeMasterResults(protocol, outcomes)).toThrow('Unplanned');
  });

  it('FAQ bounded-value oracles reject wrong published values and use live retrieval rather than canned passages', async () => {
    const { cases } = await load();
    const correct: Record<string, string> = {
      calculator: 'https://sinenvolturas.com/coste-del-servicio',
      transfer_example: 'US$105 y US$100', card_example: 'US$108 y US$100',
      paypal_example: 'US$110 y US$100', additional_transfer: 'US$5',
      support_hours: '9:30 a 13:30 y 15:30 a 19:30', validation_window: '24 a 72 horas hábiles',
      support_contact: 'https://wa.me/51915092358',
    };
    for (const [suffix, text] of Object.entries(correct)) {
      const current = cases.find(c => c.id === `live_behavior.master_faq_${suffix}`);
      expect(current).toBeDefined();
      const check = current?.expectations.find(e => e.id === 'requested-published-value-delivered');
      if (!check || check.type !== 'text_contains') throw new Error('Missing bounded-value oracle');
      const matches = (value: string) => check.allOf.every(p => value.includes(p)) && check.regex.every(p => new RegExp(p, 'u').test(value));
      expect(matches(text), suffix).toBe(true);
      const corrupted = /\d/u.test(text) ? text.replace(/\d/gu, '8') : text.replace('sinenvolturas.com', 'incorrect.example');
      expect(matches(corrupted), suffix).toBe(false);
      expect(matches(''), suffix).toBe(false);
    }
    const world = JSON.parse(await fs.readFile('evals/fixtures/master-faq-public-empty.json', 'utf8')) as Record<string, unknown>;
    expect(world.knowledgeBase).toBeUndefined();
  });
});
