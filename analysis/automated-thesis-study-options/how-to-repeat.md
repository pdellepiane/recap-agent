# How To Repeat

Run only read-only inventory commands from the repository root. Do not run
eval:study, regenerateTechnicalStudyArtifacts, deployment, sync, or live CLIs.
The regeneration helper writes into its supplied study directory.

```bash
git rev-parse HEAD
git status --short
cat evals/studies/technical-evaluation-50-v4.json
cat analysis/technical-evaluation-study/artifacts/technical-study-2026-07-03T00-36-35-880Z/raw-artifact-index.json
git show c384d80:package.json
```

Hydrate the current catalog without executing cases or loading credentials:

```bash
node --import tsx --input-type=module - <<'JS'
import loaderModule from './src/evals/loader.ts';
const c = await new loaderModule.EvalLoader('evals').loadCatalog();
const s = c.suites.find(s => s.id === 'live_behavior_regression');
const cases = c.cases.filter(c => s.caseIds.includes(c.id));
console.log({
  totalCatalogCases: c.cases.length,
  mandatoryCases: cases.length,
  turns: cases.reduce((n, c) => n + c.inputs.length, 0),
  hardAssertions: cases.reduce((n, c) => n + c.expectations.filter(e => e.severity === 'hard').length, 0),
  fixtureBacked: cases.filter(c => c.backendFixture?.scenario).length,
  scorerTypes: [...new Set(cases.flatMap(c => c.scorers.map(s => s.type)))],
});
JS
```

Reconcile July counts, delivered-text availability, trace records and the bounded
URL probe independently of current evaluation schemas:

```bash
python3 - <<'PY'
from pathlib import Path
from collections import Counter
import json
p = Path('analysis/technical-evaluation-study/artifacts/technical-study-2026-07-03T00-36-35-880Z')
reports = [json.loads(q.read_text()) for q in sorted(p.rglob('report.json'))]
cases = [c for r in reports for c in r['results']]
turns = [t for c in cases for t in c['turns']]
print('reports/cases/turns', len(reports), len(cases), len(turns))
print('status', Counter(c['status'] for c in cases))
print('nonempty delivered text', sum(bool(t['outputText']) for t in turns))
print('trace provider records', sum(len(t['trace']['provider_results']) for t in turns))
print('exact URL probe', sum(bool(p.get('detailUrl') and p['detailUrl'] in t['outputText']) for t in turns for p in t['trace']['provider_results']))
print('failed assertions', Counter(a['id'] for c in cases for a in c['expectationResults'] if not a['passed']))
PY
```

The exact URL probe is a measurement warning, not validated display detection.
Read findings.md before interpreting it. All new study implementation/execution
steps remain proposals. Store derivatives in a new folder; retain original hashes,
failures, scores, model/price identities and uncertainty definitions.

## Prerequisites

- Local checkout, Python 3 and repository-installed Node/tsx dependencies. No AWS
  or OpenAI credentials are needed for the read-only probes above.

## Expected Outputs

- Counts matching artifacts/inventory.json when run against the same source
  files. Current catalog counts can drift as development continues.

## Validation

- Reconcile 3 × 50 July cases, 270 replies and 133 passes. Compare SHA-256 hashes
  before treating a subsequent inventory as the same evidence snapshot.

## Current primary study handoff (2026-10-27)

Read `analysis/master-thesis-study-followup-2026-10-27/frozen-master.json`, `master-summary.json`, `results.md`, and `artifacts/master-live-run/report.json`. Check separate calculator run `analysis/targeted-calculator-followup-2026-10-27/protocol.md` and its report. Recompute scenario denominators directly from the frozen protocol and raw report; do not pool runs or alter the original primary endpoint. Drafting the handoff uses retained artifacts only and requires no new model calls.
