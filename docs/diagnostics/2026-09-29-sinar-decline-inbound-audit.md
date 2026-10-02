# Sinar decline inbound audit — 2026-09-29

## Question

What did the adapter actually send for Sinar's WhatsApp decline, and what was
the exact request and outcome at the Lambda?

## Observed facts (all times UTC, 2026-09-28)

- Agent API message `28488` is an **inbound** row, status `received`, stored at
  `16:18:50Z`, body `Hola, qué tal? Lamentablemente, no podré asistir. Ya le
  envié un mensaje a Paula. Gracias.` It carries **no native WhatsApp message
  ID** (`whatsapp_message_id_present: false`).
- DynamoDB `recap-agent-runtime-perf` GSI `channel-user-turns` has **zero**
  records for identity `whatsapp:+96170197268` in `16:00–16:40Z` and in the
  wider `16:18Z–2026-09-29T12:00Z` window.
- Lambda log group `/aws/lambda/recap-agent-runtime` has **zero** events for
  that identity hash in both windows.
- Audit diagnosis: `inbound_stored_without_runtime_dispatch`.
- No **outbound** message to that identity exists in the ~20h window after the
  decline. The inbound row is stuck at `received` with no terminal outcome: an
  orphaned inbound incident.
- Production Lambda request `732f10a2-2aa5-45bf-94a8-78bcfe398fce` at
  `16:19:02.181Z` is authenticated (matched bearer index 1) and returned **400
  `invalid_request`** with a single validation issue on `contact_phone`. The
  log records no phone, no message ID, and no body bytes.
- Four earlier requests with the same bearer hash in `16:02–16:13Z`
  (`ff1838ff…`, `1f23cbf6…`, `a8ac59d4…`, `4c5ba4da…`) failed identically on
  `contact_phone`.
- This AWS account (`684516060775`, `us-east-1`) has **no adapter log group**:
  only `recap-agent-runtime`, `recap-agent-runtime-dev`,
  `recap-agent-runtime-hotfix-dev`, `recap-agent-knowledge-sync-dev`, and
  `recap-agent-provider-sync-dev` exist. The adapter repository is not in this
  workspace.
- Read-only Agent API checks for the display-derived identity `+961` /
  `70197268` (investigation only, never authorization):
  - `GET /guest/events` → HTTP 200, one event: `Paula & Fernando`,
    `event_id 34413`, `datetime 12/12/2026 15:30`, `timezone America/Lima`.
    The downstream API **accepts +961 reads**.
  - `GET /event?event_id=34413` → HTTP 200, attendance `guest_id 580449`,
    name `Sinar`, `has_responded: true`, `will_attend: false`.

## Conclusions

1. The nearby production 400 **cannot be attributed to Sinar**. No native
   message ID, adapter request ID, or phone survives in the Lambda record, and
   four identical sibling 400s share the bearer. It remains uncorrelated.
2. The exact adapter payload (native sender, native message ID, normalized
   JSON, destination URL, response, retries) is **unobtainable from in-scope
   systems**. Adapter evidence must come from the adapter owner.
3. The `+961` foreign-number explanation is **credible but not proven** as the
   posted value: the display digits parse to a valid Lebanese mobile, the
   current Lambda parser rejects every non-`+51/+52/+1` code with exactly the
   observed `contact_phone` 400, and all five same-bearer 400s fail on that
   field. Correlation still requires the adapter record.
4. Sinar's attendance is **already recorded as declining**
   (`has_responded: true`, `will_attend: false`) outside this runtime (no
   runtime effect receipt exists). Per the work package, the exact invitation
   is not unanswered, so **no RSVP write was attempted**: a replay would risk
   a duplicate write. Recovery status: effect already correct; the missing
   customer reply is owned by human support with this evidence.
5. Going forward, the `x-recap-correlation-id` contract plus protected
   exact-payload capture (body sha256/bytes, structural skeleton, hashed
   identity fields, phone parse outcome on every pre-validation 400) make this
   class of failure attributable without exposing raw customer content.

## Evidence commands (all read-only, `se-dev` / `us-east-1`)

- `audit-message.mjs --phone 96170197268 --from 2026-09-28T16:00:00Z --to 2026-09-28T16:40:00Z`
- Same script `--from 2026-09-28T16:18:00Z --to 2026-09-29T12:00:00Z`
  (outbound check).
- `aws logs get-log-events` on stream
  `2026/09/28/recap-agent-runtime[$LATEST]70f56b6481024cfdbe8c5965bed77a33`.
- `aws logs filter-log-events` for bearer hash `52df7dc1…` in `15:20–16:20Z`.
- `GET /guest/events` and `GET /event` for `+961` / `70197268` (GET only).
