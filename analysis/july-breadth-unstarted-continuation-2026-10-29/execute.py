import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

root = pathlib.Path('/Users/leonardocandio/Work/thesis/recap-agent')
dest = root / 'analysis/july-breadth-unstarted-continuation-2026-10-29'
selection = json.loads((dest / 'selection.json').read_text())
env = os.environ.copy()
env.update({'AWS_PROFILE': 'se-dev', 'AWS_REGION': 'us-east-1'})
args = ['npm', 'run', 'eval:behavior-live', '--', '--label', 'july-unstarted-continuation-2026-10-29', '--case-concurrency', '1', '--judge-concurrency', '1']
for case in selection['cases']:
    args.extend(['--case', case['caseId']])
with (dest / 'execution.log').open('w') as log:
    result = subprocess.run(args, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
(dest / 'exit-status.txt').write_text(str(result.returncode) + '\n')
log_text = (dest / 'execution.log').read_text()
match = re.findall(r'"runId"\s*:\s*"(eval-[^"]+)"', log_text)
if not match:
    print('No completed report identity. Execution log retained.', flush=True)
    sys.exit(1)
run_id = match[-1]
source = root / '.eval-runs' / run_id
archive = dest / 'artifacts'
shutil.copytree(source, archive)
files = [{'path': str(f.relative_to(archive)), 'bytes': f.stat().st_size, 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(archive.rglob('*')) if f.is_file()]
(dest / 'artifact-index.json').write_text(json.dumps({'runId': run_id, 'files': files}, indent=2) + '\n')
report = json.loads((archive / 'report.json').read_text())
identity_command = "import {EvalLoader} from './src/evals/loader';import {readFrozenMaster,describeMasterDeployment} from './src/evals/master-study';import {digestJson} from './src/evals/run-manifest';(async()=>{const c=await new EvalLoader('evals').loadCatalog();const f=await readFrozenMaster('analysis/july-breadth-recovery-2026-10-28/frozen-master.json',c.cases);console.log(JSON.stringify({inputsUnchanged:true,deploymentUnchanged:digestJson(await describeMasterDeployment())===digestJson(f.deployment)}))})()"
identity = subprocess.run(['npx', 'tsx', '-e', identity_command], cwd=root, env=env, text=True, capture_output=True)
(dest / 'identity-after.json').write_text(identity.stdout if identity.returncode == 0 else json.dumps({'verified': False, 'error': identity.stderr}) + '\n')
with (root / 'docs/implementation-log.md').open('a') as log:
    log.write(f"\n**Unstarted continuation result:** Run `{run_id}`: {report.get('passedCases')} passed, {report.get('failedCases')} failed, {report.get('erroredCases')} errored and {report.get('skippedCases')} skipped of {report.get('totalCases')} selected. Post-run identity verification exit: {identity.returncode}. Retained results under `analysis/july-breadth-unstarted-continuation-2026-10-29/`. No original result was changed.\n")
print(json.dumps({'runId': run_id, 'runExit': result.returncode, 'identityExit': identity.returncode, 'totalCases': report.get('totalCases'), 'passedCases': report.get('passedCases')}), flush=True)
