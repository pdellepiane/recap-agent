# Sources

| Name | Path or URL | Type | Date Checked | Why It Matters | Caveats |
| --- | --- | --- | --- | --- | --- |
| Frozen manifest | `evals/studies/technical-evaluation-50-v1.json` | JSON | 2026-07-02 | Exact cases and expectations | Contains audited expectation defects |
| Iteration-3 summary | `artifacts/technical-study-2026-07-02T06-40-49-761Z/summary.json` | JSON | 2026-07-02 | Aggregate metrics | Derivative of raw reports |
| Conversations | `artifacts/technical-study-2026-07-02T06-40-49-761Z/conversations.csv` | CSV | 2026-07-02 | Conversation-level outcomes | Strict status inherits manifest defects |
| Raw reports | `artifacts/technical-study-2026-07-02T06-40-49-761Z/runs/` | JSON/JSONL | 2026-07-02 | Authoritative traces and evidence | Large artifact set |
| Manual audit | `artifacts/technical-study-2026-07-02T06-40-49-761Z/manual-grounding-audit.csv` | CSV | 2026-07-02 | Primary grounding assessment | Historical iteration-3 sample |
| Independent audit | `/Users/leonardocandio/Downloads/independent-grounding-review-completed.csv` | CSV | 2026-07-02 | Blinded second grounding assessment | Reviewer identity ignored; notes and judgments retained |
| Independent review summary | `artifacts/independent-review-summary.json` | JSON | 2026-07-02 | Agreement and independent pass counts | Historical iteration-3 sample, not the final confirmatory run |
| Clean provider index | OpenAI vector store `vs_6a46f023fcec8191ac12fe2c44b1612b` | Vector store | 2026-07-02 | One 182-provider evidence snapshot used by deployed runtime | Live catalog snapshot can change on a later sync |
| Clean-index gate | `.eval-confirmatory-gates/eval-2026-07-02T23-17-44-525Z-2b735984/report.json` | JSON | 2026-07-02 | Final targeted behavior check | 12/13 harness passes; all explicit safety gates passed |
| Method | `methodology.md`, `metric-expansion.md` | Markdown | 2026-07-02 | Metric definitions and protocol | Technical study only |
