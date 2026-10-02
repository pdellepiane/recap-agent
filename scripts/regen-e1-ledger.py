#!/usr/bin/env python3
"""Regenerate the packet E1 disposition ledger + test inventory from the live catalog.

The E1 audit test (tests/profile-inference-e1.test.ts) requires the ledger to
exactly mirror every expectation of every catalog case. Case condensation,
merges, and renames legitimately invalidate the snapshot, so this script
rebuilds it:

- inventory: all current catalog cases with per-expectation review detail.
- ledger rows: kept verbatim where (case, expectation, type) still exists;
  new pairs get disposition retain with an honest cohort rationale (they were
  authored under the current directive and were not individually E1-audited
  at regen time).
- removed/added: historical churn preserved; dropped pairs appended to
  removed with their last disposition, new pairs appended to added.
  totalExpectations stays the Sep-15 baseline (rows + removed - added).

Fidelity: plain YAML parsing matches EvalLoader exactly (163 cases / 1405
expectations on 2026-09-30); the E1 test self-verifies every regen.
Requires: python3 + pyyaml. Usage: python3 scripts/regen-e1-ledger.py
"""

import glob
import json
from collections import defaultdict

import yaml

PLAN = 'docs/plan/2026-09-09-lean-conversation'
LEDGER_PATH = f'{PLAN}/profile-inference-disposition-ledger.json'
INVENTORY_PATH = f'{PLAN}/profile-inference-test-inventory-2026-09-15.json'

COHORT_RATIONALE = (
    'Post-Sep-15 addition (condensation-era case/expectation); retained as '
    'authored under the current E1 directive. Not individually E1-audited '
    'at regen time; future audits may revise.'
)
DROP_REASON = 'absent from 2026-09-30 catalog (condensation merge/deletion/rename)'


def load_live():
    cases = []
    for path in sorted(glob.glob('evals/cases/*.yaml')):
        with open(path, encoding='utf-8') as handle:
            data = yaml.safe_load(handle)
        if not isinstance(data, dict) or 'id' not in data:
            continue
        expectations = []
        for entry in data.get('expectations') or []:
            exp_type = entry.get('type')
            expectations.append({
                'id': entry.get('id') or f'{exp_type}-unnamed',
                'type': exp_type,
                'severity': entry.get('severity'),
                'requireJudge': entry.get('requireJudge'),
                'turnIndex': entry.get('turnIndex'),
                'text': entry.get('rubric') or entry.get('text'),
                'path': entry.get('path'),
                'expected': entry.get('expected'),
            })
        backend = data.get('backendFixture') or {}
        cases.append({
            'id': data['id'],
            'file': path.split('/')[-1],
            'version': data.get('version'),
            'fixture': backend.get('scenario'),
            'expectations': expectations,
        })
    return sorted(cases, key=lambda c: c['id'])


def main():
    with open(LEDGER_PATH, encoding='utf-8') as handle:
        ledger = json.load(handle)
    live = load_live()
    live_pairs = {(c['id'], e['id']): (c, e) for c in live for e in c['expectations']}

    old_rows = {(r['case'], r['expectation']): r for r in ledger['rows']}
    rows = []
    added_new = []
    for (case_id, exp_id), (case, exp) in sorted(live_pairs.items()):
        old = old_rows.get((case_id, exp_id))
        if old is not None and old.get('type') == exp['type']:
            rows.append(old)
            continue
        rows.append({
            'case': case_id,
            'file': case['file'],
            'expectation': exp_id,
            'type': exp['type'],
            'severity': exp['severity'],
            'requireJudge': exp['requireJudge'],
            'turnIndex': exp['turnIndex'],
            'disposition': 'retain',
            'rationale': COHORT_RATIONALE,
            'source': 'rule:post-inventory-retain',
        })
        added_new.append({'case': case_id, 'expectation': exp_id})

    removed_new = []
    for (case_id, exp_id), row in sorted(old_rows.items()):
        current = live_pairs.get((case_id, exp_id))
        if current is not None and current[1]['type'] == row.get('type'):
            continue
        removed_new.append({
            'case': case_id,
            'expectation': exp_id,
            'type': row.get('type'),
            'disposition': row.get('disposition', 'retain'),
            'rationale': row.get('rationale', ''),
            'reason': DROP_REASON,
        })

    with open(INVENTORY_PATH, encoding='utf-8') as handle:
        inventory = json.load(handle)
    inventory['count'] = len(live)
    inventory['cases'] = [{
        'id': c['id'],
        'version': c['version'],
        'fixture': c['fixture'],
        'review': [{
            'id': e['id'],
            'type': e['type'],
            'severity': e['severity'],
            'requireJudge': e['requireJudge'],
            'text': e['text'],
            'path': e['path'],
            'expected': e['expected'],
        } for e in c['expectations']],
    } for c in live]

    counts: dict = defaultdict(int)
    by_type: dict = defaultdict(lambda: defaultdict(int))
    for row in rows:
        counts[row['disposition']] += 1
        by_type[row['type']][row['disposition']] += 1

    ledger['totalCases'] = len(live)
    ledger['currentExpectations'] = len(rows)
    ledger['removed'] = list(ledger.get('removed', [])) + removed_new
    ledger['added'] = list(ledger.get('added', [])) + added_new
    ledger['rows'] = rows
    ledger['counts'] = dict(counts)
    ledger['byType'] = {k: dict(v) for k, v in sorted(by_type.items())}
    # totalExpectations is the Sep-15 baseline: rows + removed - added.
    ledger['totalExpectations'] = len(rows) + len(ledger['removed']) - len(ledger['added'])

    with open(LEDGER_PATH, 'w', encoding='utf-8') as handle:
        json.dump(ledger, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
    with open(INVENTORY_PATH, 'w', encoding='utf-8') as handle:
        json.dump(inventory, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
    print(f'cases={len(live)} rows={len(rows)} kept={len(rows) - len(added_new)} '
          f'new={len(added_new)} dropped={len(removed_new)} '
          f'totalExpectations={ledger["totalExpectations"]}')


if __name__ == '__main__':
    main()
