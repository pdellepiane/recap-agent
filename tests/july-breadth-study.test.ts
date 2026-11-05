import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalLoader } from '../src/evals/loader';
import { masterProtocolSchema, resolveMasterCases } from '../src/evals/master-study';

describe('expanded July breadth study', () => {
  it('preserves five event groups and ten route families with explicitly bounded objective cases', async () => {
    const protocol = masterProtocolSchema.parse(JSON.parse(await fs.readFile('evals/studies/current-expanded-july-breadth-2026-10-27.json', 'utf8')) as unknown);
    const mapping = JSON.parse(await fs.readFile('analysis/expanded-current-study-2026-10-27/july-scenario-mapping.json', 'utf8')) as Array<{id:string;stratum:string;routeFamily:string;fixture:string}>;
    const catalog = await new EvalLoader(path.resolve('evals')).loadCatalog();
    expect(() => resolveMasterCases(protocol, catalog.cases)).toThrow('synthetic contact phone');
    const cases = catalog.cases.filter(c => protocol.population.some(p => p.id === c.id));
    expect(cases).toHaveLength(84);
    expect(mapping).toHaveLength(50);
    expect(new Set(mapping.map(x => x.id)).size).toBe(50);
    expect(new Set(mapping.map(x => x.routeFamily)).size).toBe(10);
    for (const stratum of ['july_wedding','july_birthday','july_baby_shower','july_corporate','july_social']) {
      const group = mapping.filter(x => x.stratum === stratum);
      expect(group).toHaveLength(10);
      expect(new Set(group.map(x => x.routeFamily)).size).toBe(10);
    }
    expect(mapping.filter(x => x.fixture === 'master-provider-empty')).toHaveLength(5);
    expect(mapping.filter(x => x.fixture === 'master-provider-live-public')).toHaveLength(45);
    expect(cases.some(c => /otp/iu.test(c.id))).toBe(false);
    expect(cases.some(c => c.id === 'live_behavior.target_calculator_public_link_r1')).toBe(true);
    for (const entry of mapping) {
      const current = cases.find(c => c.id === entry.id);
      expect(current?.expectations.some(e => e.id === 'event-type-retained' && e.severity === 'hard')).toBe(true);
      expect(current?.expectations.some(e => e.id === 'answer-delivered' && e.severity === 'hard')).toBe(true);
      expect(current?.expectations.some(e => e.type === 'fixture_effect_count' && e.operation === 'provider.quote.write' && e.expectedAttempts === 0)).toBe(true);
      expect(current?.inputs.every(input => input.backendFixture?.scenario === entry.fixture)).toBe(true);
    }
  });
});

describe('July breadth infrastructure recovery', () => {
  it('rejects the prior missing-phone cases before dispatch and preserves all prompts in fixture-backed recovery cases', async () => {
    const oldProtocol = masterProtocolSchema.parse(JSON.parse(await fs.readFile('evals/studies/current-expanded-july-breadth-2026-10-27.json','utf8')) as unknown);
    const recovery = masterProtocolSchema.parse(JSON.parse(await fs.readFile('evals/studies/july-breadth-infrastructure-recovery-2026-10-28.json','utf8')) as unknown);
    const catalog = await new EvalLoader(path.resolve('evals')).loadCatalog();
    expect(() => resolveMasterCases(oldProtocol, catalog.cases)).toThrow('synthetic contact phone');
    const cases = resolveMasterCases(recovery, catalog.cases);
    expect(cases).toHaveLength(50);
    for (const current of cases) {
      const old = catalog.cases.find(c => `${c.id}_phonefixed` === current.id);
      expect(old).toBeDefined();
      expect(current.inputs.map(i => i.text)).toEqual(old?.inputs.map(i => i.text));
      expect(current.expectations).toEqual(old?.expectations);
      expect(current.inputs.every(i => i.channel === 'whatsapp' && i.contactPhone === '+51900007000' && i.backendFixture?.scenario)).toBe(true);
    }
  });
});
