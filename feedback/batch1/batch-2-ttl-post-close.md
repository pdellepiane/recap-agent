# Batch 2 — Remove TTL Cooling Period + Post-Close Messaging

> **Images:** 4, 5  
> **Risk:** Low. Small runtime + prompt changes.  
> **Goal:** Eliminate the 24-hour cooling period for finished plans, and explain post-close contact flow to users.

---

## 2.1 Image 5 — Remove the 24-hour cooling period (TTL)

**Explicit stakeholder decision:** The TTL/enfriamiento mechanism is to be removed for voluntary plan deletion after closing. Users should be able to start a new plan immediately.

**Root cause analysis:** The `FINISHED_PLAN_TTL_SECONDS` constant (24h) drives a TTL epoch calculation in the `finish_plan` tool. The tool calls `request.onPlanFinished?.(ttlEpochSeconds)`, which is wired into `AgentService.persistPlan` so that a `ttlEpochSeconds` is passed to `PlanStore.save`. However, looking at the current `DynamoPlanStore.save()` implementation, the TTL attribute is **not actually written** to DynamoDB — the `Item` only contains `pk`, `sk`, `reason`, and the plan fields. This means the TTL is currently a dead code path. The cleanest fix is to remove the entire TTL infrastructure.

**Files to change:**
- `src/core/plan.ts`
- `src/runtime/contracts.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/storage/plan-store.ts`
- `src/storage/dynamo-plan-store.ts`
- `infra/cloudformation/stack.yaml` *(if TTL is configured)*

**Changes:**

### Step 1 — `src/core/plan.ts`
Remove the constant:
```ts
// DELETE this line entirely
export const FINISHED_PLAN_TTL_SECONDS = 24 * 60 * 60;
```

### Step 2 — `src/storage/plan-store.ts`
Remove TTL from the save contract:
```ts
export type SavePlanInput = {
  plan: PlanSnapshot;
  reason: string;
  // REMOVE: ttlEpochSeconds?: number;
};
```

### Step 3 — `src/storage/dynamo-plan-store.ts`
No changes needed because it never wrote TTL. If you previously added TTL writing, remove it. Current code is already clean.

### Step 4 — `src/runtime/contracts.ts`
Remove the callback from `ComposeReplyRequest`:
```ts
export type ComposeReplyRequest = {
  // ... other fields ...
  // REMOVE: onPlanFinished?: (ttlEpochSeconds: number) => void;
};
```

### Step 5 — `src/runtime/agent-service.ts`
- Remove `let planFinishTtlEpochSeconds: number | undefined;` (around line 228).
- Remove the `onPlanFinished` callback from every `composeReply` call (lines 330-332, 591-593).
- In `persistPlan`, remove the conditional spread:
```ts
const persistPlan = async (plan: PlanSnapshot, reason: string) => {
  const savePlanStartedAt = Date.now();
  await this.dependencies.planStore.save({
    plan,
    reason,
    // REMOVE the ttlEpochSeconds conditional block entirely
  });
  timingMs.save_plan += Date.now() - savePlanStartedAt;
};
```

### Step 6 — `src/runtime/openai-agent-runtime.ts`
- Remove `FINISHED_PLAN_TTL_SECONDS` from the import on line 8.
- In the `finish_plan` tool (around line 1009), remove TTL calculation:
```ts
// OLD
let ttlEpochSeconds = 0;
if (overallStatus !== 'failed') {
  ttlEpochSeconds = Math.floor(Date.now() / 1000) + FINISHED_PLAN_TTL_SECONDS;
  const snapshot = mergePlan(plan as PlanSnapshot, {
    lifecycle_state: 'finished',
    current_node: 'necesidad_cubierta',
    intent: 'cerrar',
    updated_at: new Date().toISOString(),
  });
  Object.assign(plan, snapshot);
  request.onPlanFinished?.(ttlEpochSeconds);  // REMOVE this line
}

// NEW
if (overallStatus !== 'failed') {
  const snapshot = mergePlan(plan as PlanSnapshot, {
    lifecycle_state: 'finished',
    current_node: 'necesidad_cubierta',
    intent: 'cerrar',
    updated_at: new Date().toISOString(),
  });
  Object.assign(plan, snapshot);
}
```
- Remove `ttl_epoch_seconds` from the tool result object:
```ts
const result = {
  status: overallStatus,
  contacted_providers: contactedProviders,
  // REMOVE: ttl_epoch_seconds: ttlEpochSeconds,
};
```

### Step 7 — `src/runtime/finish-plan-tool.ts`
- Remove `ttl_epoch_seconds` from all result types:
```ts
export type FinishPlanToolResult = {
  status: 'success' | 'partial' | 'failed';
  contacted_providers: Array<{ providerId: number; category: string; success: boolean; error?: string }>;
  // REMOVE: ttl_epoch_seconds: number;
};

export type FinishPlanToolErrorResult = {
  status: 'failed';
  error: 'missing_contact_info' | 'no_selected_providers';
  detail: string;
  // REMOVE: ttl_epoch_seconds: number;
};
```
- Remove the `ttlEpochSeconds` variable and related logic in `executeFinishPlanTool`.

### Step 8 — CloudFormation (`infra/cloudformation/stack.yaml`)
If the plans table has a `TimeToLiveSpecification`, remove it:
```yaml
# REMOVE if present
TimeToLiveSpecification:
  AttributeName: ttl_epoch_seconds
  Enabled: true
```

**Open question:** The implementation log (2026-04-20) claims TTL was enabled on DynamoDB, but the current `dynamo-plan-store.ts` does not write the attribute. This suggests either a prior regression or the log documented intent that was never fully wired. Regardless, the stakeholder decision is to remove TTL entirely.

**Verification:**
1. Finish a plan via the terminal client.
2. Check DynamoDB: the `PLAN` item should have `lifecycle_state: finished` but **no** `ttl_epoch_seconds` attribute.
3. Start a new conversation with the same user ID. The runtime should create a fresh empty plan immediately (no "cooling period" message).

---

## 2.2 Image 4 — Post-close explanation of what happens next

**Problem:** After closing, the user asks "¿qué pasa a continuación?" and the bot repeats the generic cooling message instead of explaining the actual contact flow.

**Files to change:**
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/necesidad_cubierta/response_contract.txt`
- `src/runtime/agent-service.ts` (finished-plan short-circuit reply)

**Changes:**

### Step 1 — Prompt updates

Update `prompts/nodes/crear_lead_cerrar/response_contract.txt`, replace line 5:
```
- tras confirmación y llamada exitosa a finish_plan: confirmar que las solicitudes fueron enviadas, mencionar qué proveedores fueron contactados, explicar brevemente que el proveedor se pondrá en contacto directamente por email o teléfono en un plazo aproximado de 24 a 48 horas, y despedirse con calidez.
```

Update `prompts/nodes/necesidad_cubierta/response_contract.txt`:
```
La respuesta debe:
- confirmar que el objetivo actual quedó cubierto;
- explicar brevemente que los proveedores contactados se comunicarán por email o teléfono en un plazo aproximado de 24 a 48 horas;
- dejar abierta la puerta para retomar si cambia algo.
```

### Step 2 — Remove cooling message from runtime

In `src/runtime/agent-service.ts`, the finished-plan short-circuit (around line 115) currently:
1. Replies with the post-close message.
2. Immediately replaces the finished plan with a fresh empty plan in DynamoDB so the user can start over on their next message.

Replace the reply text with:
```ts
text: 'Este plan de evento ya está cerrado y en la fase de contacto con proveedores. Los proveedores seleccionados se comunicarán contigo por email o teléfono en un plazo aproximado de 24 a 48 horas. Si quieres organizar otro frente o iniciar un plan nuevo, puedo ayudarte desde cero.',
```

And add the plan-reset logic after computing the response but before returning:
```ts
const freshPlan = createEmptyPlan({
  planId: ulid(),
  channel: inbound.channel,
  externalUserId: inbound.externalUserId,
});
await this.dependencies.planStore.save({
  plan: freshPlan,
  reason: 'reset_after_finished',
});
```

**Open question:** Should we mention WhatsApp/chat as a contact channel? **No.** The marketplace `createQuoteRequest` API only sends email/phone to the vendor. We should not promise channels we cannot guarantee.

**Verification:**
1. Close a plan successfully.
2. Send a follow-up question like "¿Qué proveedor elegimos?"
3. Verify the bot answers from the finished plan context and the plan stays finished.
4. Send an FAQ question like "¿Cuánto cuesta el plan premium?"
5. Verify the bot routes to `consultar_faq` and the plan stays finished.
6. Send a planning intent like "Quiero planear otro evento."
7. Verify the plan resets to active and the bot enters the normal planning flow.
8. Verify the bot no longer mentions "enfriamiento" or 24h waiting period.

---

## Files changed in this batch

- `src/core/plan.ts`
- `src/runtime/contracts.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/storage/plan-store.ts`
- `src/storage/dynamo-plan-store.ts` (verify no TTL writing exists)
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/necesidad_cubierta/response_contract.txt`
- `infra/cloudformation/stack.yaml` (if TTL is configured)
- `tests/agent-service.test.ts`
- `tests/plan-lifecycle.test.ts`
- `docs/implementation-log.md`
