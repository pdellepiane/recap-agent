# Batch 6 — Perf Table Expansion

> **Scope:** Telemetry / observability  
> **Risk:** Medium. Schema change to perf records; must stay within DynamoDB 400KB item limit.  
> **Goal:** Store enough data in the perf table to reconstruct a conversation offline.

---

## 6.1 Expand TurnPerfRecord for conversation reconstruction

**Current gaps:**
- `user_message_preview` is only 160 characters (truncated).
- `outbound_text` (the bot's reply) is **not stored at all**.
- No pruned plan snapshot.
- No turn sequence number.

**What we need minimally:**
1. Full inbound `user_message`
2. Full outbound `outbound_text`
3. A compact `plan_snapshot_json` with key decision fields (no `recommended_providers` blobs)
4. Optional: `turn_index` for ordering within a conversation

**Files to change:**
- `src/logs/trace/perf.ts`
- `src/lambda/handler.ts`

**Changes:**

### Step 1 — Expand TurnPerfRecord schema

In `src/logs/trace/perf.ts`, add new fields to `TurnPerfRecord`:
```ts
export type TurnPerfRecord = {
  // ... all existing fields ...
  user_message: string;
  outbound_text: string;
  plan_snapshot_json: string;
};
```

### Step 2 — Expand buildTurnPerfRecord signature

Add parameters to `buildTurnPerfRecord`:
```ts
export function buildTurnPerfRecord(args: {
  trace: TurnTrace;
  channel: string;
  externalUserId: string;
  messageId: string;
  userMessage: string;
  outboundText: string;        // NEW
  retentionDays: number;
  capturedAt?: Date;
}): TurnPerfRecord {
```

Populate the new fields:
```ts
user_message: args.userMessage,
outbound_text: args.outboundText,
plan_snapshot_json: JSON.stringify({
  plan_id: args.trace.plan_id,
  current_node: args.trace.plan_summary.current_node,
  lifecycle_state: args.trace.plan_summary.lifecycle_state,
  event_type: args.trace.plan_summary.event_type,
  active_need_category: args.trace.plan_summary.active_need_category,
  provider_need_statuses: args.trace.plan_summary.provider_need_statuses,
  contact_fields_present: args.trace.plan_summary.contact_fields_present,
}),
```

Why not store the full plan? `recommended_providers` blobs can be large (up to 15 providers with descriptions, URLs, etc.). The pruned snapshot above is typically < 2 KB.

### Step 3 — Pass outbound text from handler

In `src/lambda/handler.ts`, update the perf record construction:
```ts
const perfRecord = buildTurnPerfRecord({
  trace: response.trace,
  channel,
  externalUserId: body.user_id,
  messageId,
  userMessage: body.text,
  outboundText: response.outbound.text,  // NEW
  retentionDays: config.performance.retentionDays,
});
```

### Step 4 — Keep CLI summary lightweight

`toCliPerfSummary` should **not** include the new heavy fields. No changes needed there — it already cherry-picks a subset of fields.

**Open question:** Do we also need the full extraction result? `TurnTrace` already stores `extraction_summary`, which is a rich summary (intent, event type, vendor category, contact fields present, etc.). That is sufficient for debugging. If we later need the raw extraction, we can add `extraction_json` in a follow-up.

**DynamoDB size check:** A typical perf record today is ~3-5 KB. Adding:
- `user_message`: ~100 B (typical WhatsApp message)
- `outbound_text`: ~1-2 KB (typical bot reply)
- `plan_snapshot_json`: ~1 KB

Total increase: ~2-3 KB. Well within the 400KB item limit.

**Verification:**
1. Run a few terminal turns.
2. Query the perf table (`recap-agent-runtime-perf`) in DynamoDB.
3. Verify the items contain `user_message`, `outbound_text`, and `plan_snapshot_json`.
4. Verify `plan_snapshot_json` is valid JSON and contains `provider_need_statuses`.

---

## Files changed in this batch

- `src/logs/trace/perf.ts`
- `src/lambda/handler.ts`
