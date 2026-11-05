import fs from 'node:fs';
import YAML from 'yaml';
const mapping=JSON.parse(fs.readFileSync('analysis/expanded-current-study-2026-10-27/july-scenario-mapping.json','utf8')) as Array<{id:string;stratum:string;julyId:string;routeFamily:string;fixture:string}>;
const files=fs.readdirSync('evals/cases');
const rows=[];const ids=[];
for(const entry of mapping){
 const suffix=entry.id.replace('live_behavior.july_breadth_','').replaceAll('_','-');
 const file=files.find(name=>name===`live-behavior-july-breadth-${suffix}.yaml`);
 if(!file)throw new Error(`Missing case for ${entry.id}`);
 const data=YAML.parse(fs.readFileSync(`evals/cases/${file}`,'utf8')) as {id:string;inputs:Array<{contactPhone?:string;sessionId?:string}>};
 if(data.id!==entry.id)throw new Error('Unexpected case ID');
 const id=`${entry.id}_phonefixed`;data.id=id;
 for(const input of data.inputs){input.contactPhone='+51900007000';input.sessionId=id;}
 const output=`evals/cases/live-behavior-july-breadth-${suffix}-phonefixed.yaml`;
 fs.writeFileSync(output,YAML.stringify(data),{flag:'wx'});
 rows.push({...entry,id});ids.push(id);
}
const suitePath='evals/suites/live_behavior_regression.yaml';const suite=fs.readFileSync(suitePath,'utf8');const marker='tags:\n  - live\n';if(!suite.includes(marker))throw new Error('Missing suite marker');
fs.writeFileSync(suitePath,suite.replace(marker,ids.map(id=>`  - ${id}\n`).join('')+marker));
fs.writeFileSync('analysis/july-breadth-recovery-2026-10-28/july-scenario-mapping.json',JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
const old=JSON.parse(fs.readFileSync('evals/studies/current-expanded-july-breadth-2026-10-27.json','utf8')) as Record<string,unknown>;
old.id='july-breadth-infrastructure-recovery-2026-10-28';old.seed=28102650;old.population=rows.map(({id,stratum})=>({id,stratum}));
old.analysis={primary:'All objective hard obligations met / 150 scheduled conversations. This is an infrastructure recovery run; preserve the original 150 HTTP 400 errors.',uncertainty:'10000 seeded stratified scenario-cluster bootstrap over five event strata, retaining repetitions; not a customer-population confidence interval.',claimBoundary:'Designed July-derived provider scenarios only; earlier current-system results remain a separate run. No causal comparison or pooling.',fixtureBoundary:'Five no-result worlds use empty fixtures; other public provider reads are live; all private customer data and SE effects mocked.',routeLimit:'Route labels are inputs, not proof of semantic correctness; selection identity and no-results prose are not comprehensively checked.',historicalPopulation:'July V4 and all October runs are preserved separately.'};
fs.writeFileSync('evals/studies/july-breadth-infrastructure-recovery-2026-10-28.json',JSON.stringify(old,null,2)+'\n',{flag:'wx'});console.log(`Created ${rows.length} new recovery cases`);
