import fs from 'node:fs';
import { z } from 'zod';
import { masterProtocolSchema, summarizeMasterResults } from '../src/evals/master-study';
const d='analysis/expanded-current-study-2026-10-27';
const original=z.object({runId:z.string(),results:z.array(z.object({caseId:z.string(),status:z.string(),hardGatePassed:z.boolean(),turns:z.array(z.unknown()),planDiffSummary:z.array(z.string())}))}).parse(JSON.parse(fs.readFileSync(`${d}/artifacts/master-live-run/report.json`,'utf8')) as unknown);
const newer=z.object({runIds:z.array(z.string()).length(2),deploymentCodeSha256:z.string(),rows:z.array(z.object({executionId:z.string(),caseId:z.string(),repetition:z.number(),status:z.string(),passed:z.boolean(),phase:z.string(),julyId:z.string()})).length(150)}).parse(JSON.parse(fs.readFileSync('analysis/july-breadth-unstarted-continuation-2026-10-29/combined-study-summary.json','utf8')) as unknown);
const frozen=z.object({protocol:masterProtocolSchema,deployment:z.object({codeSha256:z.string()}),schedule:z.array(z.object({caseId:z.string(),stratum:z.string(),repetition:z.number()}))}).parse(JSON.parse(fs.readFileSync(`${d}/frozen-master.json`,'utf8')) as unknown);
if(frozen.deployment.codeSha256!==newer.deploymentCodeSha256)throw new Error('Artifact identities differ.');
const org=new Map(original.results.map(r=>[r.caseId,r]));const replacements=new Map(newer.rows.map(r=>[`${r.caseId.replace(/_phonefixed$/u,'')}.master_r${r.repetition}`,r]));
if(org.size!==252||replacements.size!==150)throw new Error('Unexpected counts.');
const rows=frozen.schedule.map(s=>{
 const executionId=`${s.caseId}.master_r${s.repetition}`;const prior=org.get(executionId);if(!prior)throw new Error(`Missing ${executionId}`);
 const replacement=replacements.get(executionId);
 if(replacement){if(prior.status!=='errored'||prior.turns.length!==0||!prior.planDiffSummary.some(m=>m.includes('contact_phone is required')))throw new Error(`Unverified setup rejection ${executionId}`);return {executionId,caseId:s.caseId,repetition:s.repetition,stratum:s.stratum,phase:replacement.phase,status:replacement.status,passed:replacement.passed,julyId:replacement.julyId};}
 if(prior.status!=='passed'&&prior.status!=='failed')throw new Error(`Unexpected original outcome ${executionId}`);
 return {executionId,caseId:s.caseId,repetition:s.repetition,stratum:s.stratum,phase:'original-executed',status:prior.status,passed:prior.status==='passed'&&prior.hardGatePassed};
});
const outcomes=new Map<string,boolean[]>();for(const r of rows)outcomes.set(r.caseId,[...(outcomes.get(r.caseId)??[]),r.passed]);
const summary={label:'post-hoc reconstruction of the intended expanded population across three execution phases',runIds:[original.runId,...newer.runIds],deploymentCodeSha256:frozen.deployment.codeSha256,...summarizeMasterResults(frozen.protocol,outcomes),phases:['original-executed','recovery','continuation'].map(phase=>({phase,observed:rows.filter(r=>r.phase===phase).length,passed:rows.filter(r=>r.phase===phase&&r.passed).length})),strata:[...new Set(rows.map(r=>r.stratum))].map(stratum=>({stratum,observed:rows.filter(r=>r.stratum===stratum).length,passed:rows.filter(r=>r.stratum===stratum&&r.passed).length})),caveat:'Post-hoc infrastructure recovery of 150 cases rejected before model invocation; synthetic phone added and schedule changed. Multiple dates, live catalog may change. This is not a single contiguous run and not a controlled comparison with July V4.',rows};
fs.writeFileSync(`${d}/reconstructed-three-phase-summary.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,rows:undefined},null,2));
