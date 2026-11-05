import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
const root='analysis/bounded-outcome-validation-2026-10-29';fs.mkdirSync(root,{recursive:true});
const cases: Array<{id:string;family:string;scenario:string;repetition:number}> = [];
const inputSchema=z.object({text:z.string(),sessionId:z.string()}).passthrough();
const caseSchema=z.object({id:z.string(),version:z.number(),description:z.string(),inputs:z.array(inputSchema),expectations:z.array(z.object({id:z.string(),type:z.string()}).passthrough()),seedPlan:z.unknown().optional(),notes:z.array(z.string()).optional()}).passthrough();
const groups=['wedding','birthday','baby-shower','corporate','social'];
function write(source:unknown, id:string, family:string, scenario:string, repetition:number):void {
 const c=caseSchema.parse(source);c.id=id;c.description=`Bounded ${family}: ${c.description}`;
 for(const input of c.inputs)input.sessionId=id;
 c.notes=[`New preregistered bounded ${family} scenario; no semantic judge. Public provider reads are live only where the fixture enables them; all SE effects remain mocked.`, 'Source cases and all earlier study results remain unchanged.'];
 fs.writeFileSync(`evals/cases/${id.replace('live_behavior.','live-behavior-').replaceAll('_','-')}.yaml`,YAML.stringify(c),{flag:'wx'});
 cases.push({id,family,scenario,repetition});
}
for(const group of groups){
 const source=caseSchema.parse(YAML.parse(fs.readFileSync(`evals/cases/live-behavior-july-breadth-${group}-05-phonefixed.yaml`,'utf8')) as unknown);
 for(let r=1;r<=3;r++){
  const c=structuredClone(source);c.inputs[1].text='Elijo la segunda opción.';
  c.expectations.push({id:'two-options-available',type:'provider_result_count',min:2,turnIndex:0,severity:'hard'});
  c.expectations.push({id:'second-displayed-provider-selected',type:'provider_displayed_selection',sourceTurnIndex:0,turnIndex:1,ordinal:2,severity:'hard'});
  write(c,`live_behavior.bounded_second_${group.replaceAll('-','_')}_r${r}`,'selection',group,r);
 }
}
const quoteSource=caseSchema.parse(YAML.parse(fs.readFileSync('evals/cases/live-behavior-master-v2-completion.yaml','utf8')) as unknown);
const planSchema=z.object({provider_needs:z.array(z.unknown())}).passthrough();
for(const group of ['one','two'])for(let r=1;r<=3;r++){
 const c=structuredClone(quoteSource);const plan=planSchema.parse(c.seedPlan);
 if(group==='one'){
  plan.provider_needs=plan.provider_needs.slice(0,1);c.seedPlan=plan;
  c.inputs[0].text='Mi evento es el 18 de octubre de 2028. Por favor envía la cotización al proveedor elegido para cerrar el plan.';
  c.expectations=c.expectations.map(e=>e.id==='both-quote-receipts-match-selected-providers-and-date'?{...e,expected:[{providerId:101,eventDate:'2028-10-18',resultStatus:'confirmed'}]}:e.id==='multi-need-selection-preserved'?{...e,expected:[{category:'Catering',selected_provider_ids:[101]}]}:e);
 }
 c.expectations.push({id:'expected-simulated-quote-count',type:'fixture_effect_count',operation:'provider.quote.write',turnIndex:0,expectedAttempts:group==='one'?1:2,expectedSuccesses:group==='one'?1:2,expectedReplays:0,severity:'hard'});
 c.expectations.push({id:'no-repeat-quote-on-recall',type:'fixture_effect_count',operation:'provider.quote.write',turnIndex:1,expectedAttempts:0,expectedSuccesses:0,expectedReplays:0,severity:'hard'});
 write(c,`live_behavior.bounded_quote_${group}_r${r}`,'quote',group,r);
}
const suitePath='evals/suites/live_behavior_regression.yaml';const text=fs.readFileSync(suitePath,'utf8');const marker='tags:\n  - live\n';if(!text.includes(marker))throw new Error('Missing suite marker.');
fs.writeFileSync(suitePath,text.replace(marker,cases.map(c=>`  - ${c.id}\n`).join('')+marker));
fs.writeFileSync(`${root}/selection.json`,JSON.stringify(cases,null,2)+'\n',{flag:'wx'});console.log(`Created ${cases.length} targeted cases.`);
