import fs from 'node:fs';
import { z } from 'zod';
import { checkFirstSelection, inspectProviderCards, type BoundedFieldResult, type ProviderEvidence } from '../src/evals/bounded-response-checks';
const root='analysis/automated-thesis-study-options/artifacts/bounded-coverage-2026-10-29';
const rows=z.object({rows:z.array(z.object({executionId:z.string(),caseId:z.string(),repetition:z.number(),phase:z.string(),julyId:z.string().optional()})).length(252)}).parse(JSON.parse(fs.readFileSync('analysis/expanded-current-study-2026-10-27/reconstructed-three-phase-summary.json','utf8')) as unknown).rows;
const rowSchema=z.object({caseId:z.string(),turns:z.array(z.object({turnIndex:z.number(),outputText:z.string(),deliveredText:z.string().nullable().optional(),outputOrigin:z.object({status:z.string()}).nullable().optional(),trace:z.object({provider_results:z.array(z.object({id:z.number(),detailUrl:z.string().nullable().optional(),priceLevel:z.string().nullable().optional(),location:z.string().nullable().optional(),minPrice:z.string().nullable().optional()})),plan_summary:z.object({selected_provider_ids:z.array(z.number()).optional()}).nullable().optional()}).passthrough()}))});
const read=(path:string)=>z.object({runId:z.string(),results:z.array(rowSchema)}).parse(JSON.parse(fs.readFileSync(path,'utf8')) as unknown);
const reports={
 'original-executed':read('analysis/expanded-current-study-2026-10-27/artifacts/master-live-run/report.json'),
 recovery:read('analysis/july-breadth-recovery-2026-10-28/artifacts/master-live-run/report.json'),
 continuation:read('analysis/july-breadth-unstarted-continuation-2026-10-29/artifacts/report.json'),
};
const evidence: Array<{executionId:string;turn:number;ordinal:number;providerId:number|null;linkEvidence:string;priceLevel:BoundedFieldResult;minimumPrice:BoundedFieldResult;location:BoundedFieldResult}> = [];
const selections: Array<{executionId:string;result:string}> = [];
let totalTurns=0, verifiedTurns=0, turnsWithProviderLinks=0, turnsWithNumberedCards=0, unverifiedProviderLinkTurns=0;
for(const row of rows){
 const phase = row.phase as keyof typeof reports; if (!(phase in reports)) throw new Error(`Unknown phase ${phase}`);
 const sourceId=phase==='original-executed'?row.executionId:phase==='recovery'?`${row.caseId}_phonefixed.master_r${row.repetition}`:`${row.caseId}_phonefixed`;
 const result=reports[phase].results.find(r=>r.caseId===sourceId);if(!result)throw new Error(`Missing ${sourceId}`);
 for(const turn of result.turns){
  totalTurns+=1; const text=turn.deliveredText ?? turn.outputText;
  const links=text.includes('https://sinenvolturas.com/proveedores/');
  if(turn.outputOrigin?.status!=='verified'){if(links)unverifiedProviderLinkTurns+=1;continue;}
  verifiedTurns+=1;if(links)turnsWithProviderLinks+=1;
  const cards=inspectProviderCards(text,turn.trace.provider_results as ProviderEvidence[]);
  if(cards.length>0)turnsWithNumberedCards+=1;
  for(const card of cards)evidence.push({executionId:row.executionId,turn:turn.turnIndex,...card});
 }
 if(row.julyId?.endsWith('.05')){
  const first=result.turns[0];const second=result.turns[1];
  const usable=first?.outputOrigin?.status==='verified'&&second?.outputOrigin?.status==='verified';
  const selection=usable ? checkFirstSelection(inspectProviderCards(first.deliveredText ?? first.outputText,first.trace.provider_results),second.trace.plan_summary?.selected_provider_ids ?? null) : 'unassessable';
  selections.push({executionId:row.executionId,result:selection});
 }
}
const count=(field:'priceLevel'|'minimumPrice'|'location')=>Object.fromEntries(['matched','different','unassessable','not_detected'].map(v=>[v,evidence.filter(e=>e[field]===v).length]));
const summary={population:'post-hoc reconstructed expanded study: 252 planned conversations across three separate execution phases',sources:Object.fromEntries(Object.entries(reports).map(([k,v])=>[k,v.runId])),totalConversations:rows.length,totalTurns,verifiedTurns,turnsWithProviderLinks,turnsWithNumberedCards,unverifiedProviderLinkTurns,numberedCards:evidence.length,linkedToExactlyOneSameTurnTraceProvider:evidence.filter(e=>e.linkEvidence==='matched').length,linkUnassessable:evidence.filter(e=>e.linkEvidence==='unassessable').length,priceLevel:count('priceLevel'),minimumPrice:count('minimumPrice'),location:count('location'),selection:{scheduled:selections.length,...Object.fromEntries(['matched','different','not_selected','unassessable'].map(v=>[v,selections.filter(x=>x.result===v).length]))},limitations:['Detected numbered cards and explicit location/price-level fields only; minimum-price detection is restricted to a positive explicit phrase and compares numeric values only; currency is not verified. Other prose, prices, categories, services, negation and mentions are not comprehensively parsed.','Evidence is the retained normalized same-turn trace, not an independently archived authoritative marketplace response. Agreement is trace consistency, not proof of factual truth.','A different location is a non-exact string, not necessarily a factual contradiction; granularity and equivalent wording can differ.','Selection comparison is valid only when a unique first numbered card with a unique trace ID and one selected ID are observable. Ambiguous cases are unassessable.','This is post-hoc analysis, not an original assertion or a replacement for historical scores.']};
fs.writeFileSync(`${root}/summary.json`,JSON.stringify(summary,null,2)+'\n');fs.writeFileSync(`${root}/cards.json`,JSON.stringify(evidence,null,2)+'\n');fs.writeFileSync(`${root}/selection.json`,JSON.stringify(selections,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
