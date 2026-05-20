# How To Repeat

## Prerequisites

- Repository checkout at `/Users/leonardocandio/Work/thesis/recap-agent`.
- ImageMagick available as `magick` for contact-sheet regeneration.
- No external credentials are required for the static investigation.
- AWS profile `se-dev` is required for DynamoDB perf-log validation.

## Commands

```bash
pwd
rg --files feedback/batch2 | sort
sed -n '1,260p' feedback/batch2/dump.md
find feedback/batch2/images -maxdepth 1 -type f -name '*.jpeg' -print | sort | nl -w2 -s': '

mkdir -p analysis/batch2-feedback-fix-plan/artifacts
files=()
i=1
while IFS= read -r f; do
  out="analysis/batch2-feedback-fix-plan/artifacts/img-$(printf '%02d' "$i").jpeg"
  magick "$f" -resize 420x420 -gravity north -extent 420x420 -background white -splice 0x36 -gravity north -pointsize 20 -annotate +0+8 "$(printf '%02d' "$i") $(basename "$f" | sed 's/WhatsApp Image 2026-05-18 at //; s/.jpeg//')" "$out"
  files+=("$out")
  i=$((i+1))
done < <(find feedback/batch2/images -maxdepth 1 -type f -name '*.jpeg' -print | sort)
magick montage "${files[@]}" -tile 4x -geometry +12+12 analysis/batch2-feedback-fix-plan/artifacts/contact-sheet-2026-05-20.jpeg

rg -n "contact_name|contact_email|contact_phone|telefono|teléfono|extension|extensión|finish|cerrar|confirm|selected|provider|proveedor|sin proveedor|ninguna|ningún" src prompts tests docs feedback/batch1 -S
nl -ba src/runtime/agent-service.ts | sed -n '387,468p'
nl -ba src/runtime/agent-service.ts | sed -n '720,821p'
nl -ba src/runtime/agent-service.ts | sed -n '2538,2645p'
nl -ba src/runtime/openai-agent-runtime.ts | sed -n '104,166p'
nl -ba src/runtime/openai-agent-runtime.ts | sed -n '669,698p'
nl -ba src/runtime/openai-agent-runtime.ts | sed -n '1358,1372p'
nl -ba src/runtime/finish-plan-tool.ts | sed -n '1,140p'
nl -ba src/runtime/message-renderer.ts | sed -n '229,313p'
nl -ba src/runtime/sinenvolturas-gateway.ts | sed -n '140,245p'
nl -ba src/runtime/sinenvolturas-gateway.ts | sed -n '510,557p'

aws cloudformation describe-stacks \
  --stack-name recap-agent-runtime \
  --query "Stacks[0].Outputs" \
  --output json \
  --profile se-dev \
  --region us-east-1

HASH="$(printf '%s' '954779067' | shasum -a 256 | awk '{print $1}')"
aws dynamodb query \
  --table-name recap-agent-runtime-perf \
  --index-name channel-user-turns \
  --key-condition-expression "gsi1pk = :pk AND gsi1sk BETWEEN :from AND :to" \
  --expression-attribute-values "{\":pk\": {\"S\": \"CHANNEL_USER#web_chat#$HASH\"}, \":from\": {\"S\": \"TURN#2026-05-15T00:00:00.000Z\"}, \":to\": {\"S\": \"TURN#2026-05-16T00:00:00.000Z\"}}" \
  --profile se-dev \
  --region us-east-1 \
  --output json > analysis/batch2-feedback-fix-plan/artifacts/perf-logs/web_chat-954779067-2026-05-15.json
```

## Expected Outputs

- `analysis/batch2-feedback-fix-plan/artifacts/contact-sheet-2026-05-20.jpeg`
- `analysis/batch2-feedback-fix-plan/artifacts/img-01.jpeg` through `img-24.jpeg`
- `analysis/batch2-feedback-fix-plan/artifacts/perf-logs/web_chat-954779067-2026-05-15.json`
- `analysis/batch2-feedback-fix-plan/artifacts/perf-logs/web_chat-5b8dd4cf18f7-2026-05-15.json`
- `analysis/batch2-feedback-fix-plan/artifacts/perf-logs/web_chat-f6b10567e6b5-2026-05-15.json`

## Validation

- Open the contact sheet and verify 24 labeled tiles appear in sorted filename order.
- Compare the evidence map in `fix-plan.md` against `dump.md` line numbers and the visual index.
- Confirm the code references still point to the described logic; if line numbers drift, rerun the `nl -ba` commands and update `fix-plan.md`.
