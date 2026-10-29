import fs from 'node:fs';
import { z } from 'zod';

const directory = process.argv[2] ?? 'analysis/expanded-current-study-2026-10-27';
const mapping = z.array(z.object({ id:z.string(), stratum:z.string(), julyId:z.string(), routeFamily:z.string(), fixture:z.string() })).parse(JSON.parse(fs.readFileSync(`${directory}/july-scenario-mapping.json`,'utf8')) as unknown);
const original = z.object({ scenarios:z.array(z.object({id:z.string(),expectedNeedCategories:z.array(z.string())})) }).parse(JSON.parse(fs.readFileSync('evals/studies/technical-evaluation-50-v3.json','utf8')) as unknown);
const summary = z.object({provider_need_statuses:z.array(z.object({category:z.string(),has_recommendations:z.boolean()})).optional()}).passthrough();
const report = z.object({runId:z.string(),results:z.array(z.object({caseId:z.string(),status:z.string(),hardGatePassed:z.boolean(),turns:z.array(z.object({trace:z.object({plan_summary:summary.nullable().optional()}).passthrough()}))}))}).parse(JSON.parse(fs.readFileSync(`${directory}/artifacts/master-live-run/report.json`,'utf8')) as unknown);
const entries = mapping.map(m => ({...m, expectedNeeds:original.scenarios.find(s => s.id === m.julyId)?.expectedNeedCategories ?? []}));
const rows = report.results.flatMap(r => {
  const base = r.caseId.replace(/\.master_r[123]$/u, '');
  const entry = entries.find(e => e.id === base);
  return entry ? [{...entry,executionId:r.caseId,status:r.status,passed:r.status === 'passed' && r.hardGatePassed, turns:r.turns}] : [];
});
const families = [...new Set(entries.map(e => e.routeFamily))].map(routeFamily => {
  const members = rows.filter(r => r.routeFamily === routeFamily);
  return { routeFamily, scheduled:entries.filter(e=>e.routeFamily === routeFamily).length * 3, observed:members.length,
    passed:members.filter(r=>r.passed).length, failed:members.filter(r=>r.status === 'failed').length, errored:members.filter(r=>r.status === 'errored').length };
});
const needs = rows.flatMap(row => row.expectedNeeds.map(category => {
  const summaries = row.turns.map(t => t.trace.plan_summary?.provider_need_statuses);
  const observed = summaries.some(s => s?.some(n => n.category === category));
  const recommended = summaries.some(s => s?.some(n => n.category === category && n.has_recommendations));
  const completeEvidence = summaries.length > 0 && summaries.every(s => s !== undefined);
  return {executionId:row.executionId,category,extracted:observed ? 'yes' : completeEvidence ? 'no' : 'unknown',
    planHasRecommendations:recommended ? 'yes' : completeEvidence ? 'no' : 'unknown'};
}));
const outcome = {runId:report.runId, population:'july-derived-scenarios-only', plannedConversations:entries.length*3, observedConversations:rows.length,
  routeFamilies:families, needEvidence: { planned:entries.reduce((n,e)=>n+e.expectedNeeds.length*3,0), observed:needs.length,
    extractedYes:needs.filter(n=>n.extracted==='yes').length, extractedNo:needs.filter(n=>n.extracted==='no').length, extractedUnknown:needs.filter(n=>n.extracted==='unknown').length,
    planRecommendationsYes:needs.filter(n=>n.planHasRecommendations==='yes').length, planRecommendationsNo:needs.filter(n=>n.planHasRecommendations==='no').length,
    planRecommendationsUnknown:needs.filter(n=>n.planHasRecommendations==='unknown').length,
    limitation:'Plan-state category and recommendation-presence flags across turns; not independently verified relevance, displayed recommendations, factual grounding, or exact replication of July scoring.' }, needs };
fs.writeFileSync(`${directory}/july-breadth-summary.json`,JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...outcome,needs:undefined},null,2));
