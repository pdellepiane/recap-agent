import hashlib, json, os, pathlib, re, shutil, subprocess, sys
root=pathlib.Path('/Users/leonardocandio/Work/thesis/recap-agent')
dest=root/'analysis/bounded-outcome-validation-2026-10-29'
env=os.environ.copy();env.update({'AWS_PROFILE':'se-dev','AWS_REGION':'us-east-1'})
frozen=json.loads((dest/'frozen.json').read_text())
with (dest/'identity-before.log').open('w') as log:
 pre=subprocess.run(['npx','tsx','scripts/verify-bounded-outcome-freeze.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
if pre.returncode:
 print('Preflight identity failed; no model calls.',flush=True);sys.exit(1)
args=['npm','run','eval:behavior-live','--','--label','bounded-outcome-2026-10-29','--case-concurrency','1','--judge-concurrency','1']
for case in frozen['caseIds']:args.extend(['--case',case])
(dest/'started.json').write_text(json.dumps({'caseCount':len(frozen['caseIds']),'frozenSha256':hashlib.sha256((dest/'frozen.json').read_bytes()).hexdigest()})+'\n')
with (dest/'execution.log').open('w') as log:
 result=subprocess.run(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
(dest/'exit-status.txt').write_text(str(result.returncode)+'\n')
match=re.findall(r'"runId"\s*:\s*"(eval-[^"]+)"',(dest/'execution.log').read_text())
if not match:
 print('No completed run ID; original execution log retained.',flush=True);sys.exit(1)
run_id=match[-1];archive=dest/'artifacts';shutil.copytree(root/'.eval-runs'/run_id,archive)
files=[{'path':str(f.relative_to(archive)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(archive.rglob('*')) if f.is_file()]
(dest/'artifact-index.json').write_text(json.dumps({'runId':run_id,'files':files},indent=2)+'\n')
with (dest/'identity-after.log').open('w') as log:
 post=subprocess.run(['npx','tsx','scripts/verify-bounded-outcome-freeze.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
report=json.loads((archive/'report.json').read_text());results={r['caseId']:r for r in report['results']}
rows=[]
for case in frozen['population']:
 r=results.get(case['id'])
 rows.append({**case,'status':r['status'] if r else 'missing','passed':bool(r and r['status']=='passed' and r['hardGatePassed']),
              'failedHardAssertions':[{'id':e['id'],'message':e['message']} for e in r['expectationResults'] if e['severity']=='hard' and not e['passed']] if r else []})
summary={'runId':run_id,'population':'24 targeted cases, eight designed scenarios, three repetitions','scheduled':len(rows),'observed':len(results),'passed':sum(r['passed'] for r in rows),'family':[{'family':fam,'scheduled':sum(r['family']==fam for r in rows),'passed':sum(r['family']==fam and r['passed'] for r in rows)} for fam in ['selection','quote','fixture_details']],'unassessableSelectionAssertions':sum(any('Selection evidence is unassessable' in e['message'] or 'comparison: unassessable' in e['message'] for e in r['failedHardAssertions']) for r in rows),'deploymentAndInputsUnchanged':post.returncode==0,'estimatedCost':report.get('costSummary'),'rows':rows}
(dest/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
with (root/'docs/implementation-log.md').open('a') as log:
 log.write(f"\n**Bounded outcome targeted result:** Run `{run_id}`: {summary['passed']}/{summary['scheduled']} passed; source/deployment identity unchanged: {summary['deploymentAndInputsUnchanged']}. Complete reports, failures and family breakdown in `analysis/bounded-outcome-validation-2026-10-29/`; separate from historical studies.\n")
print(json.dumps({k:v for k,v in summary.items() if k!='rows'}),flush=True)
sys.exit(post.returncode)
