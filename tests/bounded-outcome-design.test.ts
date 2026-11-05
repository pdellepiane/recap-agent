import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalLoader } from '../src/evals/loader';
import { assertLiveRegressionFixtureCoverage } from '../src/evals/runner';
import { assertLiveBehaviorPrerequisites } from '../src/evals/live-behavior-cli';

describe('bounded outcome validation design', () => {
  it('has 24 distinct mandatory, fixture-backed objective cases with three repetitions per scenario', async () => {
    const entries=JSON.parse(await fs.readFile('analysis/bounded-outcome-validation-2026-10-29/selection.json','utf8')) as Array<{id:string;family:string;scenario:string;repetition:number}>;
    const catalog=await new EvalLoader(path.resolve('evals')).loadCatalog();
    const cases=entries.map(entry=>{const c=catalog.cases.find(item=>item.id===entry.id);if(!c)throw new Error(entry.id);return c;});
    expect(entries).toHaveLength(24);expect(new Set(entries.map(e=>e.id)).size).toBe(24);
    for(const key of new Set(entries.map(e=>`${e.family}/${e.scenario}`)))expect(entries.filter(e=>`${e.family}/${e.scenario}`===key).map(e=>e.repetition)).toEqual([1,2,3]);
    expect(entries.filter(e=>e.family==='selection')).toHaveLength(15);
    expect(entries.filter(e=>e.family==='quote')).toHaveLength(6);
    expect(entries.filter(e=>e.family==='fixture_details')).toHaveLength(3);
    expect(cases.every(c=>c.suite==='live_behavior_regression'&&c.expectations.every(e=>e.type!=='text_semantic'))).toBe(true);
    assertLiveRegressionFixtureCoverage(cases);await assertLiveBehaviorPrerequisites(cases);
    for(const c of cases.filter(c=>c.id.includes('bounded_second')))expect(c.expectations.some(e=>e.type==='provider_displayed_selection'&&e.ordinal===2&&e.sourceTurnIndex===0&&e.turnIndex===1)).toBe(true);
    for(const c of cases.filter(c=>c.id.includes('bounded_quote')))expect(c.expectations.some(e=>e.type==='fixture_effect_count'&&e.operation==='provider.quote.write'&&e.expectedSuccesses>0)).toBe(true);
  });
});
