import hashlib, json, os, pathlib, shutil, subprocess, sys
root=pathlib.Path('/Users/leonardocandio/Work/thesis/recap-agent')
dest=root/'analysis/master-thesis-study-followup-2026-10-27'
frozen=dest/'frozen-master.json'
p=json.loads((root/'evals/studies/current-master-followup-2026-10-27.json').read_text())
env=os.environ.copy();env.update({'AWS_PROFILE':'se-dev','AWS_REGION':'us-east-1'})
args=['npm','run','eval:behavior-live','--','--label','master-followup-2026-10-27','--case-concurrency','1','--judge-concurrency','1','--master-study',str(frozen)]
for c in p['population']: args += ['--case',c['id']]
with (dest/'execution.log').open('w') as log:
 result=subprocess.run(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
(dest/'exit-status.txt').write_text(str(result.returncode)+'\n')
finished=pathlib.Path(str(frozen)+'.finished.json')
if not finished.exists():
 print('Run did not complete; retain execution log.',flush=True);sys.exit(1)
meta=json.loads(finished.read_text());source=pathlib.Path(meta['runDir']);source=source if source.is_absolute() else root/source
archive=dest/'artifacts'/'master-live-run';archive.parent.mkdir(exist_ok=True);shutil.copytree(source,archive)
files=[]
for f in sorted(archive.rglob('*')):
 if f.is_file(): files.append({'path':str(f.relative_to(archive)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(dest/'artifacts'/'master-live-run-index.json').write_text(json.dumps({'runId':meta['runId'],'files':files},indent=2)+'\n')
with (dest/'analysis.log').open('w') as log:
 a=subprocess.run(['node','--import','tsx','src/evals/master-study-cli.ts','analyze',str(frozen),str(archive/'report.json')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
print(json.dumps({'runId':meta['runId'],'runExit':result.returncode,'analysisExit':a.returncode,'deploymentUnchanged':meta['deploymentUnchanged'],'artifacts':str(archive)}),flush=True)
sys.exit(a.returncode)
