import fs from 'node:fs/promises';
import path from 'node:path';

type WorksheetRow = {
  scenario: string;
  eventGroup: string;
  turn: number;
  responseReference: string;
};

type ProviderEvidence = {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  location?: unknown;
  priceLevel?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  promoBadge?: unknown;
  promoSummary?: unknown;
  descriptionSnippet?: unknown;
  serviceHighlights?: unknown;
  termsHighlights?: unknown;
  reason?: unknown;
};

type ReviewCase = WorksheetRow & {
  traceId: string;
  repetition: string;
  input: string;
  response: string;
  providerEvidence: ProviderEvidence[];
  toolEvidence: unknown[];
  constraints: {
    eventType: unknown;
    location: unknown;
    budget: unknown;
    guestRange: unknown;
    preferences: unknown;
    hardConstraints: unknown;
    expectedNeedCategories: unknown;
  };
};

const root = process.cwd();
const analysisDir = path.join(root, 'analysis', 'technical-evaluation-study');
const studyDir = path.join(
  analysisDir,
  'artifacts',
  'technical-study-2026-07-02T06-40-49-761Z',
);
const worksheetPath = path.join(analysisDir, 'independent-grounding-review.csv');
const outputPath = path.join(analysisDir, 'independent-grounding-review.html');

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseWorksheet(content: string): WorksheetRow[] {
  return content.trim().split(/\r?\n/u).slice(1).map((line) => {
    const columns = line.split(',');
    return {
      scenario: columns[0] ?? '',
      eventGroup: columns[1] ?? '',
      turn: Number(columns[2] ?? '0'),
      responseReference: columns[3] ?? '',
    };
  });
}

async function findCaseArtifacts(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findCaseArtifacts(entryPath);
    }
    return entry.name.startsWith('study.') && entry.name.endsWith('.json')
      ? [entryPath]
      : [];
  }));
  return nested.flat();
}

function findTurn(document: unknown, traceId: string): {
  turn: Record<string, unknown>;
  plan: Record<string, unknown>;
} | null {
  const documentRecord = asRecord(document);
  for (const turnValue of asArray(documentRecord?.turns)) {
    const turn = asRecord(turnValue);
    const trace = asRecord(turn?.trace);
    if (asString(trace?.trace_id) === traceId) {
      return {
        turn: turn ?? {},
        plan: asRecord(turn?.plan) ?? {},
      };
    }
  }
  return null;
}

function findTurnByIndexAndLength(
  document: unknown,
  turnIndex: number,
  responseLength: number,
): {
  turn: Record<string, unknown>;
  plan: Record<string, unknown>;
} | null {
  const documentRecord = asRecord(document);
  for (const turnValue of asArray(documentRecord?.turns)) {
    const turn = asRecord(turnValue);
    if (
      turn?.turnIndex === turnIndex &&
      asString(turn.outputText).length === responseLength
    ) {
      return {
        turn,
        plan: asRecord(turn.plan) ?? {},
      };
    }
  }
  return null;
}

async function materializeCases(rows: WorksheetRow[]): Promise<ReviewCase[]> {
  const artifactPaths = await findCaseArtifacts(path.join(studyDir, 'runs'));
  const cases: ReviewCase[] = [];

  for (const row of rows) {
    const traceId = row.responseReference.replace(/^[^-]+-/u, '');
    const candidatePaths = artifactPaths.filter(
      (artifactPath) => path.basename(artifactPath, '.json') === row.scenario,
    );
    let matched: ReviewCase | null = null;
    const responseLength = Number(row.responseReference.match(/^([0-9]+)-/u)?.[1]);

    for (const artifactPath of candidatePaths) {
      const document = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as unknown;
      const found = findTurn(document, traceId) ?? (
        Number.isFinite(responseLength)
          ? findTurnByIndexAndLength(document, row.turn, responseLength)
          : null
      );
      if (!found) {
        continue;
      }
      const trace = asRecord(found.turn.trace) ?? {};
      const input = asRecord(found.turn.input) ?? {};
      const providerNeeds = asArray(found.plan.provider_needs)
        .map(asRecord)
        .filter((need): need is Record<string, unknown> => need !== null);
      matched = {
        ...row,
        traceId: asString(trace.trace_id),
        repetition: artifactPath.match(/study-repetition-(\d+)/u)?.[1] ?? 'unknown',
        input: asString(input.text),
        response: asString(found.turn.outputText),
        providerEvidence: asArray(trace.provider_results)
          .map(asRecord)
          .filter((provider): provider is Record<string, unknown> => provider !== null),
        toolEvidence: asArray(trace.tool_outputs),
        constraints: {
          eventType: found.plan.event_type ?? null,
          location: found.plan.location ?? null,
          budget: found.plan.budget_signal ?? null,
          guestRange: found.plan.guest_range ?? null,
          preferences: found.plan.preferences ?? [],
          hardConstraints: found.plan.hard_constraints ?? [],
          expectedNeedCategories: providerNeeds.map((need) => need.category),
        },
      };
      break;
    }

    if (!matched) {
      throw new Error(`Could not find trace ${traceId} for ${row.scenario}.`);
    }
    cases.push(matched);
  }
  return cases;
}

function htmlDocument(cases: ReviewCase[]): string {
  const embeddedCases = JSON.stringify(cases).replace(/</gu, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Independent Grounding Review</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#667085; --line:#d0d5dd; --accent:#3451b2; --soft:#f7f8fa; }
    * { box-sizing: border-box; }
    body { margin:0; font:15px/1.5 system-ui,-apple-system,sans-serif; color:var(--ink); background:#eef1f5; }
    header { position:sticky; top:0; z-index:5; padding:14px 22px; background:#fff; border-bottom:1px solid var(--line); }
    header h1 { margin:0 0 4px; font-size:20px; }
    header p { margin:0; color:var(--muted); }
    .toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:10px; }
    button { border:0; border-radius:7px; padding:9px 13px; cursor:pointer; background:var(--accent); color:#fff; font-weight:650; }
    button.secondary { background:#475467; }
    progress { width:180px; height:14px; }
    main { max-width:1200px; margin:22px auto; padding:0 18px 80px; }
    .case { margin:0 0 22px; padding:20px; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 2px 8px #1018280d; }
    .case h2 { margin:0 0 4px; font-size:18px; }
    .meta { margin-bottom:15px; color:var(--muted); font-family:ui-monospace,monospace; font-size:12px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .panel { min-width:0; padding:13px; border:1px solid var(--line); border-radius:8px; background:var(--soft); }
    .panel h3 { margin:0 0 7px; font-size:14px; }
    pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.45 ui-monospace,SFMono-Regular,monospace; }
    details { margin-top:10px; }
    summary { cursor:pointer; font-weight:650; }
    .judgments { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:16px; }
    label { display:block; font-weight:650; }
    select, textarea, input { width:100%; margin-top:5px; border:1px solid #98a2b3; border-radius:6px; padding:8px; background:#fff; font:inherit; }
    textarea { min-height:74px; resize:vertical; }
    .complete { border-left:6px solid #12b76a; }
    .warning { padding:10px 12px; background:#fffaeb; border:1px solid #fedf89; border-radius:7px; }
    @media (max-width:800px) { .grid,.judgments { grid-template-columns:1fr; } header { position:static; } }
  </style>
</head>
<body>
<header>
  <h1>Independent Grounding Review</h1>
  <p>Judge only the evidence shown here. Do not consult the primary reviewer worksheet.</p>
  <div class="toolbar">
    <label>Reviewer <input id="reviewer" placeholder="Name or reviewer ID"></label>
    <button id="export">Export completed CSV</button>
    <button id="clear" class="secondary">Clear saved answers</button>
    <progress id="progress" max="${cases.length}" value="0"></progress>
    <span id="progressText">0/${cases.length} complete</span>
  </div>
</header>
<main>
  <p class="warning"><strong>Scoring:</strong> pass, fail, or not_applicable. A case is fully grounded only when every applicable dimension passes.</p>
  <div id="cases"></div>
</main>
<script>
const cases = ${embeddedCases};
const dimensions = [
  ['provider_existence','Provider existence','Every named/displayed provider exists in captured evidence.'],
  ['attribute_faithfulness','Attribute faithfulness','Category, location, price, promotion and service facts agree with evidence.'],
  ['rationale_support','Rationale support','Each reason for fit is supported by evidence or explicit user criteria.'],
  ['hard_constraint_consistency','Hard-constraint consistency','No recommendation contradicts location, category, budget or exclusions.']
];
const storageKey = 'independent-grounding-review-v1';
const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
const reviewer = document.getElementById('reviewer');
reviewer.value = saved.reviewer || '';
const root = document.getElementById('cases');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = value => JSON.stringify(value, null, 2);

for (const [index, item] of cases.entries()) {
  const answers = saved[item.responseReference] || {};
  const section = document.createElement('section');
  section.className = 'case';
  section.dataset.reference = item.responseReference;
  section.innerHTML = \`
    <h2>\${index + 1}. \${esc(item.scenario)}</h2>
    <div class="meta">group=\${esc(item.eventGroup)} · repetition=\${esc(item.repetition)} · turn=\${item.turn} · reference=\${esc(item.responseReference)}</div>
    <div class="grid">
      <div class="panel"><h3>User request</h3><pre>\${esc(item.input)}</pre></div>
      <div class="panel"><h3>Extracted constraints</h3><pre>\${esc(pretty(item.constraints))}</pre></div>
      <div class="panel"><h3>Agent response</h3><pre>\${esc(item.response)}</pre></div>
      <div class="panel"><h3>Provider evidence</h3><pre>\${esc(pretty(item.providerEvidence))}</pre></div>
    </div>
    <details><summary>Raw tool evidence</summary><div class="panel"><pre>\${esc(pretty(item.toolEvidence))}</pre></div></details>
    <div class="judgments">
      \${dimensions.map(([key,label,help]) => \`<label>\${label}<select data-key="\${key}">
        <option value="">Choose…</option><option value="pass">pass</option><option value="fail">fail</option><option value="not_applicable">not_applicable</option>
      </select><small>\${help}</small></label>\`).join('')}
    </div>
    <label style="margin-top:12px">Notes<textarea data-key="notes" placeholder="Brief evidence-based justification"></textarea></label>
  \`;
  for (const element of section.querySelectorAll('[data-key]')) {
    element.value = answers[element.dataset.key] || '';
    element.addEventListener('input', save);
  }
  root.appendChild(section);
}
reviewer.addEventListener('input', save);

function currentAnswers(section) {
  const answer = {};
  for (const element of section.querySelectorAll('[data-key]')) answer[element.dataset.key] = element.value;
  return answer;
}
function isComplete(answer) {
  return dimensions.every(([key]) => answer[key]) && Boolean(answer.notes?.trim());
}
function save() {
  const state = { reviewer: reviewer.value };
  let complete = 0;
  for (const section of document.querySelectorAll('.case')) {
    const answer = currentAnswers(section);
    state[section.dataset.reference] = answer;
    const done = isComplete(answer);
    section.classList.toggle('complete', done);
    if (done) complete += 1;
  }
  localStorage.setItem(storageKey, JSON.stringify(state));
  document.getElementById('progress').value = complete;
  document.getElementById('progressText').textContent = \`\${complete}/\${cases.length} complete\`;
}
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
document.getElementById('export').addEventListener('click', () => {
  save();
  if (!reviewer.value.trim()) return alert('Enter the independent reviewer name or ID first.');
  const rows = [['scenario','event_group','turn','response_reference','provider_existence','attribute_faithfulness','rationale_support','hard_constraint_consistency','reviewer','notes']];
  for (const [index,item] of cases.entries()) {
    const section = document.querySelector(\`[data-reference="\${item.responseReference}"]\`);
    const answer = currentAnswers(section);
    if (!isComplete(answer)) return alert(\`Complete all judgments and notes for case \${index + 1}: \${item.scenario}\`);
    rows.push([item.scenario,item.eventGroup,item.turn,item.responseReference,answer.provider_existence,answer.attribute_faithfulness,answer.rationale_support,answer.hard_constraint_consistency,reviewer.value.trim(),answer.notes.trim()]);
  }
  const blob = new Blob([rows.map(row => row.map(csvCell).join(',')).join('\\n') + '\\n'], {type:'text/csv;charset=utf-8'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'independent-grounding-review-completed.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
document.getElementById('clear').addEventListener('click', () => {
  if (!confirm('Clear every locally saved judgment?')) return;
  localStorage.removeItem(storageKey);
  location.reload();
});
save();
</script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const rows = parseWorksheet(await fs.readFile(worksheetPath, 'utf8'));
  const cases = await materializeCases(rows);
  await fs.writeFile(outputPath, htmlDocument(cases), 'utf8');
  process.stdout.write(`Generated ${outputPath} with ${cases.length} blinded review cases.\n`);
}

void main();
