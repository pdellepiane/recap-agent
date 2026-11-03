import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { EvalLoader } from '../src/evals/loader';
import { assertLiveBehaviorPrerequisites } from '../src/evals/live-behavior-cli';
import { assertLiveRegressionFixtureCoverage } from '../src/evals/runner';
import { describeMasterDeployment, masterCasesDigest, masterInputDigests } from '../src/evals/master-study';
async function main(): Promise<void> {
const dir='analysis/bounded-outcome-validation-2026-10-29';
const selectionPath=`${dir}/selection.json`;
const entries=z.array(z.object({id:z.string(),family:z.string(),scenario:z.string(),repetition:z.number().int().min(1).max(3)})).length(24).parse(JSON.parse(await fs.readFile(selectionPath,'utf8')) as unknown);
if(new Set(entries.map(e=>e.id)).size!==24)throw new Error('Duplicate targeted case.');
const catalog=await new EvalLoader(path.resolve('evals')).loadCatalog();
const suite=new Set(catalog.suites.find(s=>s.id==='live_behavior_regression')?.caseIds ?? []);
const cases=entries.map(e=>{const c=catalog.cases.find(x=>x.id===e.id);if(!c||!suite.has(e.id)||c.expectations.some(x=>x.type==='text_semantic'))throw new Error(`Invalid case ${e.id}`);return c;});
assertLiveRegressionFixtureCoverage(cases);await assertLiveBehaviorPrerequisites(cases);
const additional=['scripts/freeze-bounded-outcome-validation.ts','scripts/generate-bounded-outcome-cases.ts','scripts/generate-bounded-fixture-details.ts','tests/bounded-outcome-design.test.ts','tests/bounded-response-checks.test.ts'];
const fileHashes=await Promise.all(additional.map(async file=>({file,sha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
const frozen={frozenAt:new Date().toISOString(),caseIds:entries.map(e=>e.id),population:entries,casesDigest:masterCasesDigest(cases),sourceFiles:await masterInputDigests(process.cwd(),selectionPath),additionalFiles:fileHashes,deployment:await describeMasterDeployment()};
await fs.writeFile(`${dir}/frozen.json`,JSON.stringify(frozen,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({scenarios:8,cases:cases.length,turns:cases.reduce((n,c)=>n+c.inputs.length,0),deployment:frozen.deployment}));

}
void main().catch((error: unknown) => { console.error(error); process.exitCode=1; });
