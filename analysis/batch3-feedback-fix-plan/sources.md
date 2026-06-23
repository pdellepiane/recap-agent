# Sources

| Name | Path or URL | Type | Date Checked | Why It Matters | Caveats |
| --- | --- | --- | --- | --- | --- |
| Batch 3 dump | `feedback/batch3/dump.md` | Markdown source | 2026-06-19 | Primary written feedback and issue inventory. | Reviewer feedback mixes objective defects, tone preferences, and product decisions. |
| Gaby assistant feedback PDF | `feedback/batch3/Feedback del asistente - Gaby.pdf` | PDF | 2026-06-19 | Primary annotated feedback with expected assistant behavior and wording concerns. | PDF extraction preserves text but not all visual context. |
| Extracted PDF text | `analysis/batch3-feedback-fix-plan/artifacts/gaby-feedback-pdf-text.txt` | Generated text artifact | 2026-06-19 | Searchable copy of PDF feedback. | Generated from PDF; use PDF/images for visual confirmation. |
| Numbered PDF text | `analysis/batch3-feedback-fix-plan/artifacts/gaby-feedback-pdf-text-numbered.txt` | Generated text artifact | 2026-06-19 | Stable line-numbered artifact for analysis. | Line numbers refer to extracted text, not original PDF pages. |
| Batch 3 screenshots | `feedback/batch3/images/` | Images | 2026-06-19 | Visual evidence for repeated menus, contact wording, and code recovery behavior. | Screenshots do not expose internal state/tool calls. |
| Contact sheet | `analysis/batch3-feedback-fix-plan/artifacts/contact-sheet-2026-06-19.jpeg` | Generated image artifact | 2026-06-19 | Consolidated visual review of all batch screenshots. | Downscaled preview; inspect originals for exact text. |
| Runtime perf DynamoDB scan | `analysis/batch3-feedback-fix-plan/artifacts/dynamo/perf-scan-current-2026-06-19.json` | DynamoDB export | 2026-06-19 | Raw runtime turn logs from `recap-agent-runtime-perf`. | Does not include final assistant response text. |
| Normalized runtime perf scan | `analysis/batch3-feedback-fix-plan/artifacts/dynamo/perf-scan-current-2026-06-19-normalized.json` | Generated JSON artifact | 2026-06-19 | Typed/normalized view used for turn analysis. | Derived from current DynamoDB state at scan time. |
| Relevant batch term matches | `analysis/batch3-feedback-fix-plan/artifacts/dynamo/batch3-term-matches-2026-06-19.json` | Generated JSON artifact | 2026-06-19 | Filtered turns mentioning relevant batch terms. | Keyword search only for discovery, not flow decisions. |
| Web chat turn summary | `analysis/batch3-feedback-fix-plan/artifacts/dynamo/web-chat-2026-06-17-turns.md` | Generated Markdown artifact | 2026-06-19 | Human-readable turn-by-turn validation for June 17 web chat sessions. | Summarizes persisted turn metadata only. |
| Runtime plans DynamoDB scan | `analysis/batch3-feedback-fix-plan/artifacts/dynamo/plans-scan-current-2026-06-19.json` | DynamoDB export | 2026-06-19 | Cross-checks persisted plan data. | Broad scan, not all items are relevant to batch 3. |
