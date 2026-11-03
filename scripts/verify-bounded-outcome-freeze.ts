import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { EvalLoader } from '../src/evals/loader';
import { describeMasterDeployment, masterCasesDigest, masterInputDigests } from '../src/evals/master-study';
import { digestJson } from '../src/evals/run-manifest';
async function main(): Promise<void> {
 const dir='analysis/bounded-outcome-validation-2026-10-29';
 const f=z.object({caseIds:z.array(z.string()).length(24),casesDigest:z.string(),sourceFiles:z.array(z.object({file:z.string(),sha256:z.string()})),deployment:z.object({codeSha256:z.string(),lastModified:z.string(),configurationDigest:z.string()})}).parse(JSON.parse(await fs.readFile(`${dir}/frozen.json`,'utf8')) as unknown);
 const catalog=await new EvalLoader(path.resolve('evals')).loadCatalog();
 const cases=f.caseIds.map(id=>{const c=catalog.cases.find(x=>x.id===id);if(!c)throw new Error(`Missing ${id}`);return c;});
 const sources=await masterInputDigests(process.cwd(),`${dir}/selection.json`);
 if(masterCasesDigest(cases)!==f.casesDigest || digestJson(sources)!==digestJson(f.sourceFiles))throw new Error('Frozen evaluation inputs drifted.');
 const deployment=await describeMasterDeployment();if(digestJson(deployment)!==digestJson(f.deployment))throw new Error('Frozen development deployment drifted.');
 console.log(JSON.stringify({inputsUnchanged:true,deploymentUnchanged:true,deployment}));
}
void main().catch((error:unknown)=>{console.error(error);process.exitCode=1;});
