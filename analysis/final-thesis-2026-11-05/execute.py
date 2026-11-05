import hashlib,json,os,pathlib,shutil,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2]; dest=pathlib.Path(__file__).resolve().parent
frozen=dest/'frozen.json'; protocol=json.loads((root/'evals/studies/final-thesis-2026-11-05.json').read_text())
env=os.environ.copy();env.update(AWS_PROFILE='se-dev',AWS_REGION='us-east-1')
args=['npm','run','eval:behavior-live','--','--label','final-thesis-2026-11-05','--case-concurrency','1','--judge-concurrency','1','--master-study',str(frozen)]
for item in protocol['population']: args.extend(['--case',item['id']])
with (dest/'execution.log').open('x') as log: result=subprocess.run(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
(dest/'exit-status.txt').write_text(str(result.returncode)+'\n')
finished=pathlib.Path(str(frozen)+'.finished.json')
if not finished.exists(): print('No final manifest; retain execution log and partial .eval-runs.',flush=True);sys.exit(1)
meta=json.loads(finished.read_text()); source=pathlib.Path(meta['runDir']); archive=dest/'artifacts';shutil.copytree(source,archive)
files=[{'path':str(f.relative_to(archive)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(archive.rglob('*')) if f.is_file()]
(dest/'artifact-index.json').write_text(json.dumps({'runId':meta['runId'],'files':files},indent=2)+'\n')
with (dest/'analysis.log').open('x') as log: a=subprocess.run(['node','--import','tsx','src/evals/master-study-cli.ts','analyze',str(frozen),str(archive/'report.json')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
print(json.dumps({'runId':meta['runId'],'runExit':result.returncode,'analysisExit':a.returncode,'deploymentUnchanged':meta['deploymentUnchanged']}),flush=True)
sys.exit(result.returncode or a.returncode)
