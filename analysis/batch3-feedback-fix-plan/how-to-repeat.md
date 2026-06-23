# How To Repeat

## Prerequisites

- Repository root: `/Users/leonardocandio/Work/thesis/recap-agent`.
- AWS profile with access to the development DynamoDB tables: `se-dev`.
- Region: `us-east-1`.
- Python with `pypdf` available for PDF extraction.

## Commands

```bash
mkdir -p analysis/batch3-feedback-fix-plan/artifacts/dynamo

python3 - <<'PY'
from pathlib import Path
from pypdf import PdfReader
pdf = Path("feedback/batch3/Feedback del asistente - Gaby.pdf")
reader = PdfReader(str(pdf))
out = []
for i, page in enumerate(reader.pages, start=1):
    out.append(f"--- PAGE {i} ---")
    out.append(page.extract_text() or "")
Path("analysis/batch3-feedback-fix-plan/artifacts/gaby-feedback-pdf-text.txt").write_text("\n".join(out), encoding="utf-8")
PY

cp feedback/batch3/dump.md analysis/batch3-feedback-fix-plan/artifacts/dump-source.md
cp -R feedback/batch3/images analysis/batch3-feedback-fix-plan/artifacts/screenshots

AWS_PROFILE=se-dev AWS_REGION=us-east-1 AWS_SDK_LOAD_CONFIG=1 AWS_PAGER= \
  aws dynamodb scan \
  --table-name recap-agent-runtime-perf \
  --output json \
  > analysis/batch3-feedback-fix-plan/artifacts/dynamo/perf-scan-current-2026-06-19.json

AWS_PROFILE=se-dev AWS_REGION=us-east-1 AWS_SDK_LOAD_CONFIG=1 AWS_PAGER= \
  aws dynamodb scan \
  --table-name recap-agent-runtime-plans \
  --output json \
  > analysis/batch3-feedback-fix-plan/artifacts/dynamo/plans-scan-current-2026-06-19.json

python3 - <<'PY'
import csv, json
from pathlib import Path

base = Path("analysis/batch3-feedback-fix-plan/artifacts/dynamo")
raw = json.loads((base / "perf-scan-current-2026-06-19.json").read_text())

def av(v):
    if "S" in v:
        return v["S"]
    if "N" in v:
        n = v["N"]
        return float(n) if "." in n else int(n)
    if "BOOL" in v:
        return v["BOOL"]
    if "NULL" in v:
        return None
    if "L" in v:
        return [av(x) for x in v["L"]]
    if "M" in v:
        return {k: av(x) for k, x in v["M"].items()}
    return v

items = [{k: av(v) for k, v in item.items()} for item in raw["Items"]]
items.sort(key=lambda x: str(x.get("createdAt", "")))
(base / "perf-scan-current-2026-06-19-normalized.json").write_text(
    json.dumps(items, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

terms = ["baby baloo", "baby loli", "ujabule", "oxxo", "confirmados", "no me llega", "problema con mi evento"]
matches = [
    row for row in items
    if any(t in json.dumps(row, ensure_ascii=False).lower() for t in terms)
]
(base / "batch3-term-matches-2026-06-19.json").write_text(
    json.dumps(matches, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

web = [row for row in items if row.get("channel") == "web_chat" and str(row.get("createdAt", "")).startswith("2026-06-17")]
web.sort(key=lambda x: (x.get("channelUserIdHash", ""), x.get("createdAt", "")))
fields = ["createdAt", "channelUserIdHash", "stateBefore", "stateAfter", "intent", "toolNames", "userMessagePreview", "nextActionNote", "missingFieldsAfter", "selectedProviderIdsAfter", "deferredProviderIdsAfter"]
with (base / "web-chat-2026-06-17-turns.csv").open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    for row in web:
        writer.writerow({field: json.dumps(row.get(field), ensure_ascii=False) if isinstance(row.get(field), (list, dict)) else row.get(field) for field in fields})
PY
```

## Expected Outputs

- `analysis/batch3-feedback-fix-plan/artifacts/`
- `analysis/batch3-feedback-fix-plan/artifacts/dynamo/perf-scan-current-2026-06-19.json`
- `analysis/batch3-feedback-fix-plan/artifacts/dynamo/plans-scan-current-2026-06-19.json`
- `analysis/batch3-feedback-fix-plan/artifacts/dynamo/perf-scan-current-2026-06-19-normalized.json`
- `analysis/batch3-feedback-fix-plan/artifacts/dynamo/batch3-term-matches-2026-06-19.json`

## Validation

- Confirm `aws sts get-caller-identity` succeeds for `AWS_PROFILE=se-dev`.
- Confirm `recap-agent-runtime-perf` scan returns rows and contains June 17 `web_chat` turns.
- Confirm the relevant sessions in `web-chat-2026-06-17-turns.csv` include the problem-help flow, Baby Baloo/Baby Loli flow, and confirmed-guests FAQ misroute.
