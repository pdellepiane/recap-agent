import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
const root='analysis/bounded-outcome-validation-2026-10-29';
const shape=z.object({id:z.string(),description:z.string(),inputs:z.array(z.object({text:z.string(),sessionId:z.string()}).passthrough()),expectations:z.array(z.object({id:z.string(),type:z.string()}).passthrough()),notes:z.array(z.string()).optional()}).passthrough();
const source=shape.parse(YAML.parse(fs.readFileSync('evals/cases/live-behavior-master-provider-details.yaml','utf8')) as unknown);
const cases=JSON.parse(fs.readFileSync(`${root}/selection.json`,'utf8')) as Array<{id:string;family:string;scenario:string;repetition:number}>;
for(let r=1;r<=3;r++){
 const c=structuredClone(source);c.id=`live_behavior.bounded_fixture_details_r${r}`;c.description='Bounded fixture provider identity, category, minimum price and location in the delivered response.';
 c.inputs[0].sessionId=c.id;c.inputs[0].text='Para Mesa Accesible, ¿cuál es su categoría, el precio mínimo registrado y la ciudad?';
 c.expectations.push({id:'fixture-category-mentioned',type:'text_contains',allOf:['Catering'],severity:'hard'});
 c.expectations.push({id:'other-provider-price-not-mentioned',type:'text_not_contains',phrases:['8000','8,000'],severity:'hard'});
 c.notes=['Synthetic provider fixture is the authoritative test world; literal-presence checks cannot establish correct association, negation, or comprehensive prose faithfulness.'];
 const output=`evals/cases/${c.id.replace('live_behavior.','live-behavior-').replaceAll('_','-')}.yaml`;fs.writeFileSync(output,YAML.stringify(c),{flag:'wx'});
 cases.push({id:c.id,family:'fixture_details',scenario:'fixture_provider',repetition:r});
}
const suite='evals/suites/live_behavior_regression.yaml';const text=fs.readFileSync(suite,'utf8');const marker='tags:\n  - live\n';if(!text.includes(marker))throw new Error('Missing suite marker');fs.writeFileSync(suite,text.replace(marker,cases.slice(-3).map(c=>`  - ${c.id}\n`).join('')+marker));fs.writeFileSync(`${root}/selection.json`,JSON.stringify(cases,null,2)+'\n');console.log(`Selected ${cases.length} cases.`);
