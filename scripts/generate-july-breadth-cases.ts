import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';

const original = z.object({ scenarios: z.array(z.object({
  id: z.string(), eventGroup: z.enum(['wedding', 'birthday', 'baby_shower', 'corporate', 'social']),
  routeFamily: z.enum(['recommendation', 'clarification', 'multi_need', 'refinement', 'selection', 'pause_resume', 'closure', 'faq', 'no_results', 'error_recovery']),
  description: z.string(), inputs: z.array(z.string()).min(1), expectedEventType: z.string(),
  expectedNeedCategories: z.array(z.string()),
})).length(50) }).parse(JSON.parse(fs.readFileSync('evals/studies/technical-evaluation-50-v3.json', 'utf8')) as unknown);
const cases: string[] = [];
const rows: Array<{id:string; stratum:string; julyId:string; routeFamily:string; fixture:string}> = [];
for (const s of original.scenarios) {
  const id = `live_behavior.july_breadth_${s.id.replace(/^study\./u, '').replaceAll('.', '_')}`;
  const fixture = s.routeFamily === 'no_results' ? 'master-provider-empty' : 'master-provider-live-public';
  const last = s.inputs.length - 1;
  const expectations: Array<Record<string, unknown>> = [
    { id: 'event-type-retained', type: 'plan_field_equals', path: 'event_type', expected: s.expectedEventType, turnIndex: last, severity: 'hard' },
    { id: 'answer-delivered', type: 'text_contains', regex: ['[\\s\\S]+'], turnIndex: last, severity: 'hard' },
    { id: 'no-provider-quote-without-explicit-date', type: 'fixture_effect_count', operation: 'provider.quote.write', expectedAttempts: 0, expectedSuccesses: 0, expectedReplays: 0, severity: 'hard' },
    { id: 'no-unrequested-rsvp', type: 'fixture_effect_count', operation: 'rsvp.write', expectedAttempts: 0, expectedSuccesses: 0, expectedReplays: 0, severity: 'hard' },
    { id: 'no-unrequested-handoff', type: 'fixture_effect_count', operation: 'handoff.write', expectedAttempts: 0, expectedSuccesses: 0, expectedReplays: 0, severity: 'hard' },
  ];
  if (s.expectedNeedCategories.length > 0) expectations.push({ id: 'requested-needs-retained', type: 'plan_field_subset', path: 'provider_needs', expected: s.expectedNeedCategories.map(category => ({ category })), turnIndex: last, severity: 'hard' });
  if (s.routeFamily === 'recommendation' || s.routeFamily === 'multi_need') {
    expectations.push({ id: 'recommendation-has-candidates', type: 'provider_result_count', min: 1, turnIndex: 0, severity: 'hard' });
    expectations.push({ id: 'recommendation-delivers-provider-link', type: 'text_contains', regex: ['https://sinenvolturas\\.com/proveedores/[\\p{L}\\p{N}%_-]+'], turnIndex: 0, severity: 'hard' });
  }
  if (s.routeFamily === 'selection') expectations.push({ id: 'provider-selection-recorded', type: 'plan_field_subset', path: 'provider_needs', expected: [{ category: s.expectedNeedCategories[0], status: 'selected' }], turnIndex: last, severity: 'hard' });
  if (s.routeFamily === 'clarification') expectations.push({ id: 'location-not-invented', type: 'plan_field_equals', path: 'location', expected: null, turnIndex: 0, severity: 'hard' });
  if (s.routeFamily === 'no_results') expectations.push({ id: 'empty-world-has-no-shortlist', type: 'plan_field_equals', path: 'recommended_provider_ids', expected: [], turnIndex: 0, severity: 'hard' });
  const value = {
    id, suite: 'live_behavior_regression', version: 1,
    description: `July breadth ${s.id}: ${s.description}`,
    tags: ['live','behavior','july-breadth', s.eventGroup, s.routeFamily],
    targetModes: ['live_lambda'], backendFixture: { scenario: fixture },
    inputs: s.inputs.map(text => ({ text, channel: 'whatsapp', contactPhone: '+51900007000', sessionId: id, backendFixture: { scenario: fixture } })),
    expectations, scorers: [{ id: 'objective-obligations', type: 'expectation_pass_rate', weight: 1 }],
    budget: { maxTurns: s.inputs.length },
    notes: [ `Derived from ${s.id}, route ${s.routeFamily}; prompts are preserved, assertions use current objective contracts, so results are not directly comparable to July.`,
      fixture === 'master-provider-empty' ? 'Controlled empty provider world; this does not establish that the real catalog has no match.' : 'Live public provider reads; private customer reads and all SE effects are mocked.',
      'For selection, the selected state is checked but correctness of the first displayed provider identity is not independently verified. Other unscored semantic outcomes must not be inferred.' ],
  };
  const destination = path.join('evals/cases', `live-behavior-july-breadth-${s.eventGroup.replaceAll('_','-')}-${s.id.split('.').at(-1)}.yaml`);
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
  fs.writeFileSync(destination, YAML.stringify(value));
  cases.push(id);rows.push({id,stratum:`july_${s.eventGroup}`,julyId:s.id,routeFamily:s.routeFamily,fixture});
}
const suitePath = 'evals/suites/live_behavior_regression.yaml';
const suite = fs.readFileSync(suitePath,'utf8');
const marker = 'tags:\n  - live\n';
if (!suite.includes(marker)) throw new Error('Suite marker missing');
fs.writeFileSync(suitePath, suite.replace(marker, cases.map(id => `  - ${id}\n`).join('') + marker));
fs.mkdirSync('analysis/expanded-current-study-2026-10-27', { recursive: true });
fs.writeFileSync('analysis/expanded-current-study-2026-10-27/july-scenario-mapping.json', JSON.stringify(rows,null,2)+'\n', {flag:'wx'});
console.log(`Generated ${cases.length} July breadth cases.`);
