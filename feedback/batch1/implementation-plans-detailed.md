# Detailed Implementation Plans — Webchat Feedback

> Generated from feedback/images/one.jpeg through fourteen.jpeg  
> Grouped by simultaneously-implementable batches  
> Each batch: exact file references, code snippets, open questions, and verification steps

---

## Batch 1 — Stylistic & Presentation Fixes (Prompt-only, zero runtime risk)

**Images covered:** 1, 2, 6  
**Why together:** All are prompt-level response-formatting changes. No TypeScript code changes, no state-machine changes, no risk of breaking flows. Can be deployed independently.

### 1.1 Image 1 — Welcome-message bullet formatting
**Problem:** Bullets start with lowercase, end with commas, no final period.  
**Exact location:** `prompts/nodes/contacto_inicial/response_contract.txt` (the welcome message is composed by the reply model following this contract).  
**Fix:**

Add a new shared prompt file `prompts/shared/response_formatting.txt`:
```
Reglas de formato para todas las respuestas:
- Cuando uses viñetas o listas numeradas, la primera letra de cada ítem debe ser mayúscula.
- No uses coma al final de un ítem de lista; cada ítem debe terminar con punto final.
- Cuando escribas una pregunta dentro de una lista, la pregunta también debe terminar con punto (no con signo de interrogación seguido de coma).
```

Wire it into `src/runtime/prompt-manifest.ts` by appending to `conversationSharedPromptFiles`:
```ts
export const conversationSharedPromptFiles = [
  'shared/base_system.txt',
  'shared/domain_scope.txt',
  'shared/domain_knowledge.txt',
  'shared/output_style.txt',
  'shared/flow_discipline.txt',
  'shared/question_strategy.txt',
  'shared/common_anti_patterns.txt',
  'shared/response_formatting.txt',  // NEW
] as const;
```

Update `prompts/nodes/contacto_inicial/response_contract.txt` to reference the new rules:
```
La respuesta debe:
- saludar en una sola frase;
- explicar brevemente que ayudas a planear distintos tipos de eventos y a responder preguntas sobre Sin Envolturas;
- preguntar al usuario si quiere planificar un evento o hacer una pregunta;
- si quiere planificar, invitarlo a compartir en un solo mensaje los datos base: tipo de evento, ubicación, primer frente/proveedor, invitados aproximados y presupuesto referencial;
- sonar útil, no ceremonial.
- seguir las reglas de formato de viñetas (mayúscula inicial, punto final, sin coma al cierre).
```

**Open question:** Does the terminal client currently strip trailing punctuation? No — `renderReply` in `src/terminal/client.ts` just wraps the raw text in `boxen`. The model output goes straight to the user. So fixing the prompt is sufficient.

**Verification:** Run the terminal client, send `/exit`, start fresh, and check that the welcome message bullets are properly formatted.

---

### 1.2 Image 2 — Remove raw Markdown asterisks, replace "refinar"
**Problem:** `**` visible in webchat (WhatsApp doesn't render Markdown). The word "refinar" is confusing.  
**Exact locations:**
- `prompts/nodes/recomendar/response_contract.txt` (line 9 has "refinar esta necesidad")
- `prompts/nodes/refinar_criterios/system.txt` (title mentions "refinar")
- `prompts/nodes/refinar_criterios/response_contract.txt` (mentions "refinar")
- `prompts/shared/output_style.txt` (no Markdown rule yet)

**Fix:**

Update `prompts/shared/output_style.txt`, add after line 9:
```
- No uses sintaxis Markdown (asteriscos dobles **, guiones bajos _, backticks `) en las respuestas; el canal de WhatsApp no las renderiza como negrita o cursiva.
- Para destacar títulos de proveedores, escríbelos en mayúsculas iniciales o entre comillas; no uses asteriscos.
```

Replace "refinar" across all prompts:
- `prompts/nodes/recomendar/response_contract.txt` line 9: `refinar esta necesidad` → `afinar esta necesidad` or `ajustar esta necesidad`
- `prompts/nodes/refinar_criterios/system.txt` title: `ajustar criterios` instead of `refinar criterios`
- `prompts/nodes/refinar_criterios/response_contract.txt` line 2: `ejes claros para ajustar` (already says ajustar — verify)
- `prompts/shared/common_anti_patterns.txt`: add line: `- no uses la palabra "refinar"; usa "afinar" o "ajustar" en su lugar.`

**Open question:** The user says "Pondría en negrita los títulos" but WhatsApp doesn't support Markdown bold. Alternative: use ALL CAPS for titles or wrap in quotes. We should add a rule in `output_style.txt`.

Add to `output_style.txt`:
```
- Cuando presentes opciones de proveedores, escribe el nombre del proveedor en mayúsculas iniciales o entre comillas para destacarlo; no uses Markdown.
```

**Verification:** Trigger a recommendation and verify no `**` appear in the terminal output.

---

### 1.3 Image 6 — Ficha link placement
**Problem:** "Ficha: https://…" is inline with description text.  
**Exact location:** `prompts/nodes/recomendar/response_contract.txt` line 5.  
**Fix:**

Update line 5 in `recomendar/response_contract.txt`:
```
- incluir el enlace a la ficha de Sin Envolturas de cada proveedor cuando esté disponible; coloca la palabra "Ficha:" y el enlace en una línea aparte, al final de la tarjeta del proveedor;
```

**Open question:** The current `summarizeRecommendedProviders` in `src/core/plan.ts` line 423 formats providers as compact text. The model composes the actual human-readable recommendation from the prompt context. So the prompt instruction is the right place to fix this.

**Verification:** Check that model-generated recommendations place Ficha on its own line.

---

## Batch 2 — Remove TTL Cooling Period + Post-Close Messaging (Small runtime + prompt changes)

**Images covered:** 4, 5  
**Why together:** Both touch the close/finish flow and the `necesidad_cubierta` node. The TTL removal is a single constant change; the messaging change is a prompt update.

### 2.1 Image 5 — Remove the 24-hour cooling period
**Explicit stakeholder decision:** The TTL/enfriamiento mechanism is to be removed for voluntary plan deletion after closing.  
**Exact locations:**
- `src/core/plan.ts` line 31: `FINISHED_PLAN_TTL_SECONDS = 24 * 60 * 60`
- `src/runtime/openai-agent-runtime.ts` lines 1009-1011 and 1019: TTL calculation and callback
- `src/runtime/finish-plan-tool.ts` lines 113, 115: TTL logic
- `src/lambda/handler.ts`: no direct TTL code, but `onPlanFinished` callback passes TTL through `AgentService`
- `src/storage/dynamo-plan-store.ts`: does NOT currently write TTL attribute — it only writes `pk`, `sk`, `reason`, and the plan fields. The TTL must be added.

Wait — looking at `DynamoPlanStore.save()` (line 58-69), it does NOT write `ttl_epoch_seconds`. But `AgentService.persistPlan` (line 229-239) receives `ttlEpochSeconds` via the `onPlanFinished` callback. Looking more carefully at `AgentService`:

In `AgentService.handleTurn`, `persistPlan` is defined as:
```ts
const persistPlan = async (plan: PlanSnapshot, reason: string) => {
  const savePlanStartedAt = Date.now();
  await this.dependencies.planStore.save({
    plan,
    reason,
    ...(planFinishTtlEpochSeconds !== undefined
      ? { ttlEpochSeconds: planFinishTtlEpochSeconds }
      : {}),
  });
  timingMs.save_plan += Date.now() - savePlanStartedAt;
};
```

And `PlanStore.save` in `src/storage/plan-store.ts` takes `SavePlanInput`. Let me check that interface.

**Fix:**

Step 1 — Update `src/core/plan.ts`:
```ts
// OLD
export const FINISHED_PLAN_TTL_SECONDS = 24 * 60 * 60;
// NEW
export const FINISHED_PLAN_TTL_SECONDS = 0;
```

Step 2 — Update `src/runtime/openai-agent-runtime.ts` lines 1009-1020:
```ts
// OLD
let ttlEpochSeconds = 0;
if (overallStatus !== 'failed') {
  ttlEpochSeconds = Math.floor(Date.now() / 1000) + FINISHED_PLAN_TTL_SECONDS;
  // ...
  request.onPlanFinished?.(ttlEpochSeconds);
}
// NEW
let ttlEpochSeconds = 0;
if (overallStatus !== 'failed') {
  ttlEpochSeconds = 0; // No TTL for finished plans
  // ...
  request.onPlanFinished?.(ttlEpochSeconds);
}
```

Actually, a cleaner approach: change `FINISHED_PLAN_TTL_SECONDS` to `0`, and then in `DynamoPlanStore.save()`, skip writing the TTL attribute when `ttlEpochSeconds` is `0` or `undefined`.

Check `src/storage/plan-store.ts`:

Let me read it.

Actually, from the earlier `read` of `dynamo-plan-store.ts`, I see `save()` takes `SavePlanInput` but doesn't destructure `ttlEpochSeconds`. Let me read `plan-store.ts`.

**Open question:** Does DynamoDB have TTL enabled on the plans table? If so, we need to either disable it in CloudFormation or ensure we never write `ttl_epoch_seconds`. The current `DynamoPlanStore.save()` doesn't write TTL at all — it only writes `pk`, `sk`, `reason`, and the plan fields. So the TTL might not even be working today.

Wait, looking at `dynamo-plan-store.ts`:
```ts
async save(input: SavePlanInput): Promise<void> {
  await this.documentClient.send(
    new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: this.pk(input.plan.channel, input.plan.external_user_id),
        sk: 'PLAN',
        reason: input.reason,
        ...input.plan,
      } satisfies StoredItem,
    }),
  );
}
```

It does NOT include `ttlEpochSeconds` in the Item. So the TTL is NOT being persisted! The `onPlanFinished` callback sets `planFinishTtlEpochSeconds` but it's never passed to DynamoDB.

**This is actually a bug.** The TTL was supposed to be written but isn't. We need to:
1. Either fix the TTL writing (if we want TTL)
2. Or remove TTL entirely (per stakeholder decision)

Since the stakeholder says remove it, we should:
- Remove `FINISHED_PLAN_TTL_SECONDS` constant entirely
- Remove `ttlEpochSeconds` from `SavePlanInput` and `onPlanFinished` callback
- Update `AgentService` to not track `planFinishTtlEpochSeconds`
- Update `DynamoPlanStore` to not handle TTL
- Update CloudFormation to remove TTL attribute from the plans table

**Detailed fix:**

In `src/storage/plan-store.ts`:
```ts
export type SavePlanInput = {
  plan: PlanSnapshot;
  reason: string;
};
```
(Remove `ttlEpochSeconds?: number`)

In `src/runtime/contracts.ts`:
Remove `onPlanFinished?: (ttlEpochSeconds: number) => void;` from `ComposeReplyRequest`.

In `src/runtime/agent-service.ts`:
- Remove `let planFinishTtlEpochSeconds: number | undefined;`
- Remove the `onPlanFinished` callback from `composeReply` calls
- Remove `...(planFinishTtlEpochSeconds !== undefined ? { ttlEpochSeconds: planFinishTtlEpochSeconds } : {})` from `persistPlan`

In `src/runtime/openai-agent-runtime.ts`:
- Remove `import { FINISHED_PLAN_TTL_SECONDS, ... }`
- In `finish_plan` tool execution, remove `ttl_epoch_seconds` from result
- Remove `request.onPlanFinished?.(...)`

In `src/core/plan.ts`:
- Remove `FINISHED_PLAN_TTL_SECONDS`

In `src/runtime/finish-plan-tool.ts`:
- Remove `ttl_epoch_seconds` from result types

In CloudFormation `infra/cloudformation/stack.yaml`:
- Remove `TimeToLiveSpecification` from the plans table if present

**Open question:** The implementation log (2026-04-20) says "Enabled DynamoDB TTL on the plans table (`ttl_epoch_seconds`) and taught `DynamoPlanStore` to write and strip that attribute separately from the Zod plan payload." But the current code in `dynamo-plan-store.ts` does NOT write TTL. This suggests a regression or the code was changed after that log entry. We need to check if there's a separate branch of DynamoPlanStore or if the log is stale. Regardless, the decision now is to remove TTL entirely.

---

### 2.2 Image 4 — Post-close explanation of what happens next
**Problem:** After closing, user asks "¿qué pasa a continuación?" and bot repeats generic cooling message.  
**Exact locations:**
- `prompts/nodes/crear_lead_cerrar/response_contract.txt` (post-confirmation message)
- `prompts/nodes/necesidad_cubierta/response_contract.txt`

**Fix:**

Update `crear_lead_cerrar/response_contract.txt`, add after line 5:
```
- tras confirmación y llamada exitosa a finish_plan: confirmar que las solicitudes fueron enviadas, mencionar qué proveedores fueron contactados, explicar brevemente que el proveedor se pondrá en contacto directamente por email o teléfono en un plazo aproximado de 24 a 48 horas, y despedirse con calidez.
```

Update `necesidad_cubierta/response_contract.txt`:
```
La respuesta debe:
- confirmar que el objetivo actual quedó cubierto;
- explicar brevemente que los proveedores contactados se comunicarán por email o teléfono en un plazo aproximado de 24 a 48 horas;
- dejar abierta la puerta para retomar si cambia algo.
```

**Open question:** Should we mention "chat" or "mensaje" as contact channels? The feedback specifically asks: "si él me contactará, por qué medio lo hará (chat, correo, mensaje o llamada)". We should say the vendor will contact them by email or phone. We should NOT promise chat/WhatsApp because that's not what the marketplace API guarantees.

---

## Batch 3 — Contact Field Validation (Runtime deterministic validation)

**Images covered:** 10, 11, 12, 13  
**Why together:** Both are about contact field handling in `AgentService.applyExtraction` and the close flow. They touch the same code paths.

### 3.1 Images 10, 11, 12 — Phone validation must happen immediately upon extraction
**Problem:** 3-digit phone `967` is accepted; validation only appears at `finish_plan` time.  
**Exact location:** `src/runtime/agent-service.ts`, method `applyExtraction` (line 811-853).  

**Fix:**

Add a private validation method in `AgentService`:
```ts
private validateContactFields(
  plan: PlanSnapshot,
): { valid: true } | { valid: false; field: string; reason: string } {
  if (plan.contact_phone) {
    const digitsOnly = plan.contact_phone.replace(/\D/g, '');
    if (digitsOnly.length < 6) {
      return { valid: false, field: 'contact_phone', reason: 'El teléfono debe tener al menos 6 dígitos.' };
    }
  }
  if (plan.contact_email) {
    if (!plan.contact_email.includes('@')) {
      return { valid: false, field: 'contact_email', reason: 'El correo electrónico debe contener un @.' };
    }
  }
  return { valid: true };
}
```

In `applyExtraction`, after computing `candidate` (line 849), before returning:
```ts
const validation = this.validateContactFields(candidate);
if (!validation.valid && candidate.current_node === 'crear_lead_cerrar') {
  // Inject operational note so the model knows to ask again
  // We can't easily inject into reply context from here, but we can set a flag on the plan
  // Actually, applyExtraction doesn't have access to errorMessage. 
  // Better approach: return the validation result and let handleTurn use it.
}
```

Wait — `applyExtraction` returns `PlanSnapshot`, and `handleTurn` then uses `errorMessage` in `composeReply`. We need to thread validation errors through.

**Better approach:** Change `applyExtraction` to also return validation errors:
```ts
private applyExtraction(
  plan: PlanSnapshot,
  extraction: ExtractionResult,
  extractionNode: DecisionNode,
  userMessage: string,
): { plan: PlanSnapshot; validationError: string | null } {
  // ... existing logic ...
  const validation = this.validateContactFields(merged);
  return {
    plan: merged,
    validationError: validation.valid ? null : validation.reason,
  };
}
```

Then in `handleTurn` (line 206-213):
```ts
const applyExtractionStartedAt = Date.now();
const extractionNode = this.resolveExtractionNode(workingPlan, extraction);
const { plan: mergedPlan, validationError } = this.applyExtraction(
  workingPlan,
  extraction,
  extractionNode,
  inbound.text,
);
// If there's a validation error and we're in/entering crear_lead_cerrar, override errorMessage
if (validationError) {
  errorMessage = validationError;
}
timingMs.apply_extraction += Date.now() - applyExtractionStartedAt;
```

Also update `extractors/field_definitions.txt` to guide the extractor:
```
- contactPhone: número de teléfono del usuario. Debe tener al menos 6 dígitos numéricos. Si el usuario envía menos, indica que no es válido.
- contactEmail: dirección de correo. Debe contener @. Si no lo contiene, indica que no es válido.
```

**Open question:** Should we validate in the extractor schema (Zod) or in runtime? The Zod schema currently uses `z.string().nullable()` for phone. We could tighten it to `z.string().min(6).nullable()` but that would cause extraction failures. Better to keep extraction lenient and validate in runtime, so the bot can ask again gracefully.

Also update `crear_lead_cerrar/response_contract.txt`:
```
- si el teléfono tiene menos de 6 dígitos o el email no parece válido, recházalo inmediatamente, explica el problema y pide el dato de nuevo antes de continuar.
```

---

### 3.2 Image 13 — Partial contact update should overwrite without re-asking for confirmation
**Problem:** User sends corrected phone in standalone message, but system keeps old phone and asks for confirmation sentence.  
**Exact location:** `src/runtime/agent-service.ts` lines 842-844 in `applyExtraction`:
```ts
contact_name: guardedExtraction.contactName ?? plan.contact_name,
contact_email: guardedExtraction.contactEmail ?? plan.contact_email,
contact_phone: guardedExtraction.contactPhone ?? plan.contact_phone,
```

**Root cause:** The `??` operator means if the extractor returns `null` for a field, we keep the old value. This is correct for most fields. But for the close flow, when the user sends ONLY a phone number, the extractor might return `contactName: null, contactEmail: null, contactPhone: "954779071"`. The `??` logic would correctly update the phone.

Wait — the image says: "Todavía no se pudo enviar: el sistema sigue teniendo registrado el teléfono anterior. Por favor, revisa el dato de contacto y envíamelo de nuevo junto con una confirmación clara de que quieres cerrar y enviar la solicitud."

This suggests the extractor is NOT updating `contactPhone` when the user sends only a phone number. Why?

Possibility 1: The extractor returns `contactPhone: null` because it sees the message as just a number and doesn't recognize it as a contact field update.
Possibility 2: The runtime has some logic that prevents partial updates.

Looking at `applyExtraction` lines 842-844:
```ts
contact_name: guardedExtraction.contactName ?? plan.contact_name,
contact_email: guardedExtraction.contactEmail ?? plan.contact_email,
contact_phone: guardedExtraction.contactPhone ?? plan.contact_phone,
```

If `guardedExtraction.contactPhone` is `"954779071"`, this SHOULD update the plan. So why doesn't it?

Possibility: The extractor sees the standalone phone number and doesn't know it's a correction. The extractor prompt says "null si no se menciona en este turno". A standalone number might not be recognized as a contactPhone.

**Fix:**

Step 1 — Update `extractors/field_definitions.txt`:
```
- contactPhone: número de teléfono del usuario. Si el usuario envía solo un número de teléfono en un turno donde ya estamos pidiendo contacto, trátalo como contactPhone aunque no haya nombre ni email.
- contactName: nombre completo. Si el usuario no lo menciona pero sí actualiza otro dato de contacto, mantén el nombre anterior.
- contactEmail: email. Si el usuario no lo menciona pero sí actualiza otro dato de contacto, mantén el email anterior.
```

Step 2 — In `AgentService.applyExtraction`, make contact fields ALWAYS overwrite when the extractor provides them, even if other contact fields are null. The current `??` logic already does this. But we need to ensure that when the user sends a message like "954779071", the extractor actually emits `contactPhone`.

Step 3 — Update `crear_lead_cerrar/response_contract.txt`:
```
- si el usuario envía solo un dato de contacto para corregirlo (por ejemplo, solo el teléfono), acepta la corrección sin pedir nombre y email de nuevo;
```

**Open question:** Is there a case where the extractor returns `contactPhone: null` even when the user sends a valid phone? If so, we might need deterministic regex parsing in `AgentService` for standalone phone numbers, similar to `inferGuestRangeFromMessage`.

Add to `AgentService`:
```ts
private inferContactPhoneFromMessage(text: string): string | null {
  // Match Peruvian phone patterns: +51 XXX XXX XXX, 9XX XXX XXX, etc.
  const patterns = [
    /\+51\s?\d{9}/,
    /\b9\d{8}\b/,
    /\b9\d{2}\s?\d{3}\s?\d{3}\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].replace(/\s/g, '');
    }
  }
  return null;
}
```

And in `applyExtraction`:
```ts
contact_phone: guardedExtraction.contactPhone
  ?? this.inferContactPhoneFromMessage(userMessage)
  ?? plan.contact_phone,
```

This ensures standalone phone numbers are captured even if the extractor misses them.

---

## Batch 4 — Selection Continuity, Zero-Result Needs, Partial Close, Missing Links (State machine changes)

**Images covered:** 3, 7, 8, 9, 14  
**Why together:** All involve `AgentService` state transitions, `providerNeedStatusValues`, and `resolveResumeNode`. They are interdependent.

### 4.1 Image 3 — Bot asks to choose provider when one is already selected
**Problem:** User selected "La Botanería" for catering. Later says "cerremos" and bot says "falta elegir un proveedor para el catering."  
**Exact location:** The `crear_lead_cerrar` node receives a plan snapshot. Looking at `buildPromptPlanSnapshot` in `openai-agent-runtime.ts` line 1058-1085, the snapshot includes `provider_needs` but only shows:
```ts
provider_needs: plan.provider_needs.map((need) => ({
  category: need.category,
  status: need.status,
  missing_fields: need.missing_fields,
  selected_provider_id: need.selected_provider_id,
  recommended_provider_ids: need.recommended_provider_ids.slice(0, 6),
})),
```

The snapshot DOES include `selected_provider_id`. So the model should see it. But the prompt in `crear_lead_cerrar/system.txt` says:
"guiar al cierre definitivo del plan de evento tras asegurar que todas las necesidades de proveedores están cubiertas."

This phrasing implies the model should verify coverage. If the model hallucinates that catering is not covered, it might be because:
1. The snapshot doesn't clearly show which needs have selected providers
2. The prompt doesn't explicitly tell the model to check `selected_provider_id`

**Fix:**

Update `crear_lead_cerrar/system.txt`:
```
Objetivo del nodo:
- guiar al cierre definitivo del plan de evento.
- antes de pedir datos de contacto, verifica explícitamente el campo selected_provider_id de cada necesidad en el plan.
- si una necesidad ya tiene selected_provider_id, nunca pidas elegir otro proveedor para esa necesidad.
- si el usuario quiere cerrar solo algunas necesidades, permite el cierre parcial listando qué se cierra y qué se omite.
```

Update `crear_lead_cerrar/response_contract.txt`:
```
La respuesta debe:
- antes de pedir datos de contacto, verificar el campo selected_provider_id de cada necesidad;
- si todas las necesidades que el usuario quiere cerrar ya tienen proveedor seleccionado, salta directamente a solicitar contacto o confirmación;
- si faltan datos de contacto: pedirlos de forma clara y amable (nombre completo, email y teléfono);
```

Also update `buildPromptPlanSnapshot` in `openai-agent-runtime.ts` to include provider titles for selected providers:
```ts
provider_needs: plan.provider_needs.map((need) => ({
  category: need.category,
  status: need.status,
  missing_fields: need.missing_fields,
  selected_provider_id: need.selected_provider_id,
  selected_provider_title: need.recommended_providers.find(p => p.id === need.selected_provider_id)?.title ?? null,
  recommended_provider_ids: need.recommended_provider_ids.slice(0, 6),
})),
```

This makes it crystal clear to the model which provider is selected.

---

### 4.2 Images 8, 9, 14 — Zero-result needs treated as "pending to resume"
**Problem:** Organization had zero results. User later wants to close with photography. Bot still treats organization as pending. Image 14: "si un proveedor ya fue descartado por no disponibilidad, no debería volver a mencionarse más adelante con mensajes como 'cuando quieras retomamos lo otro'."  
**Exact location:** `src/core/plan.ts` `providerNeedStatusValues`, `mergeProviderNeed`, and `resolveResumeNode`.

**Fix:**

Step 1 — Add `no_providers_available` to status values in `src/core/plan.ts`:
```ts
export const providerNeedStatusValues = [
  'identified',
  'search_ready',
  'shortlisted',
  'selected',
  'deferred',
  'no_providers_available',  // NEW
] as const;
```

Step 2 — In `AgentService.handleTurn`, when search returns zero results (around line 530-535), set status to `no_providers_available`:
```ts
if (providerResults.length === 0) {
  currentNode = 'refinar_criterios';
  nodePath.push('hay_resultados', currentNode);
  planAfterFlow = mergePlan(planAfterFlow, {
    current_node: currentNode,
    provider_needs: activeNeed
      ? [{
          ...activeNeed,
          status: 'no_providers_available',  // NEW
          missing_fields: [],
        }]
      : [],
  });
}
```

Step 3 — In `mergeProviderNeed` (plan.ts line 182-220), ensure `no_providers_available` is preserved and not overwritten:
```ts
let status = update.status ?? current?.status ?? 'identified';
if (selectedProviderId) {
  status = 'selected';
} else if (recommendedProviders.length > 0 || recommendedProviderIds.length > 0) {
  status = 'shortlisted';
} else if ((update.missing_fields ?? current?.missing_fields ?? []).length === 0) {
  status = 'search_ready';
}
// Preserve no_providers_available unless new results appeared
if (current?.status === 'no_providers_available' && recommendedProviders.length === 0) {
  status = 'no_providers_available';
}
```

Step 4 — Update `seguir_refinando_guardar_plan/response_contract.txt`:
```
- no ofrezcas retomar necesidades cuyo estado sea no_providers_available;
```

Step 5 — Update `resolveResumeNode` in `src/core/decision-flow.ts`:
```ts
export function resolveResumeNode(plan: PersistedPlan): DecisionNode {
  if (plan.lifecycle_state === 'finished') {
    return 'necesidad_cubierta';
  }
  // ... existing logic ...
  const activeNeed = getActiveNeed(plan);
  // Don't resume into no_providers_available needs
  if (activeNeed?.status === 'no_providers_available') {
    // Find next need that is not no_providers_available
    const nextNeed = plan.provider_needs.find(
      (need) => need.status !== 'no_providers_available',
    );
    if (!nextNeed) {
      return 'entrevista'; // All needs are resolved or unavailable
    }
  }
  // ... rest of logic ...
}
```

**Open question:** Should `no_providers_available` needs be visible in the plan summary the model sees? Yes, but with a clear label so the model knows not to offer them. Update `summarizeProviderNeeds` in `plan.ts`:
```ts
export function summarizeProviderNeeds(providerNeeds: ProviderNeed[]): string {
  if (providerNeeds.length === 0) {
    return 'No hay necesidades de proveedores registradas todavía.';
  }
  return providerNeeds
    .map((need, index) => {
      const selected = need.selected_provider_id
        ? `, proveedor elegido ${need.selected_provider_id}`
        : '';
      const unavailable = need.status === 'no_providers_available'
        ? ' (sin proveedores disponibles)'  
        : '';
      return `${index + 1}. ${need.category} [${need.status}]${selected}${unavailable}`;
    })
    .join('\n');
}
```

---

### 4.3 Images 8, 9, 14 — Partial close: allow closing with some needs skipped
**Problem:** User wants to close plan with photography selected, but organization had no results. Bot should allow partial close.  
**Exact location:** `src/runtime/agent-service.ts` `cerrar` branch (lines 306-372) and `finish_plan` tool.

**Current behavior:** The `finish_plan` tool iterates over ALL `provider_needs` with `selected_provider_id` and sends quotes for each. This already supports partial closure! The issue is conversational: the bot blocks the user or treats the pending need as a problem.

**Fix:**

Update `crear_lead_cerrar/system.txt`:
```
Objetivo del nodo:
- guiar al cierre definitivo del plan de evento.
- el usuario puede cerrar el plan con solo algunas necesidades resueltas; no es obligatorio que todas tengan proveedor.
- antes de cerrar, muestra un resumen dividido en DOS listas:
  1. Necesidades que SE cerrarán (las que tienen selected_provider_id).
  2. Necesidades que NO se cerrarán (las que no tienen proveedor seleccionado o tienen estado no_providers_available).
- pide confirmación explícita del cierre parcial.
```

Update `crear_lead_cerrar/response_contract.txt`:
```
La respuesta debe:
- si faltan datos de contacto: pedirlos de forma clara y amable;
- si ya hay contacto: mostrar DOS listas claras:
  - "Se enviarán solicitudes para:" (necesidades con proveedor seleccionado)
  - "Se dejarán sin proveedor:" (necesidades sin selected_provider_id o con estado no_providers_available)
- pedir confirmación explícita antes de enviar;
- tras confirmación: llamar finish_plan y confirmar.
```

**Open question:** The `finish_plan` tool already sends quotes only for selected providers. No code change needed there. But we need to make sure the bot doesn't say "No hay proveedores seleccionados" when there IS at least one selected provider but other needs are empty.

Looking at `finish_plan` tool in `openai-agent-runtime.ts` lines 948-956:
```ts
if (selectedProviders.length === 0) {
  const errorResult = {
    status: 'failed',
    error: 'no_selected_providers',
    detail: 'No hay proveedores seleccionados...',
    ttl_epoch_seconds: 0,
  };
}
```

This is correct — it only fails if ZERO needs have selected providers. So partial close is already supported at the tool level.

---

### 4.4 Images 8, 9, 14 — Block close when unselected shortlists exist
**Problem:** Carolina's flow (Image 9/14) says "Se cerró cuando indiqué que no quería retomar lo pendiente; debería agregarse un mensaje que indique que no se puede cerrar si aún hay un pedido o una necesidad por confirmar."  
**Exact location:** `AgentService.handleTurn`, before entering `cerrar` branch.

**Decision:** Block close ONLY if there's a need with status `shortlisted` (has recommendations but no selection) and the user hasn't explicitly said they want to skip it.

**Fix:**

In `AgentService.handleTurn`, before line 306 (`if (extraction.intent === 'cerrar')`), add:
```ts
if (extraction.intent === 'cerrar') {
  const unselectedShortlist = mergedPlan.provider_needs.find(
    (need) => need.status === 'shortlisted' && need.recommended_providers.length > 0 && need.selected_provider_id === null
  );
  if (unselectedShortlist && !inbound.text.toLowerCase().includes('ninguna')) {
    // Stay in crear_lead_cerrar but with a note
    currentNode = 'crear_lead_cerrar';
    nodePath.push(currentNode);
    errorMessage = `Todavía tienes opciones de ${unselectedShortlist.category} por revisar. Si no quieres ninguna, dime "ninguna" para dejarla sin proveedor y cerrar.`;
    // Skip the normal cerrar branch and go straight to composeReply
  } else {
    // Normal cerrar branch
    currentNode = 'crear_lead_cerrar';
    // ... existing logic ...
  }
}
```

Wait, this is fragile. A better approach: don't block in runtime; instead, update the prompt to handle this. Let the model decide. But the user explicitly wants deterministic blocking.

**Better approach:** Add a new private method:
```ts
private hasUnselectedShortlist(plan: PlanSnapshot): ProviderNeed | null {
  return plan.provider_needs.find(
    (need) =>
      need.status === 'shortlisted' &&
      need.recommended_providers.length > 0 &&
      need.selected_provider_id === null,
  ) ?? null;
}
```

In `handleTurn`, before the `cerrar` branch:
```ts
if (extraction.intent === 'cerrar') {
  const unselected = this.hasUnselectedShortlist(mergedPlan);
  if (unselected && extraction.intent !== 'pausar') {
    currentNode = 'crear_lead_cerrar';
    nodePath.push(currentNode);
    errorMessage = `Antes de cerrar, necesito saber: ¿quieres elegir alguna opción de ${unselected.category} o prefieres dejarla sin proveedor? Responde "ninguna" si no quieres ninguna.`;
    // Persist and compose reply without entering full close flow
    const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
    await persistPlan(planToSave, 'crear_lead_cerrar');
    // ... compose reply with errorMessage ...
    // Then return early
  } else {
    // Normal close flow
  }
}
```

This requires extracting the compose-reply logic into a reusable method or duplicating it. Looking at the code, the `cerrar` branch (lines 306-372) and `pause` branch (lines 241-304) and the general branch (lines 573-632) all have similar compose-reply logic. We could extract a private method `composeAndReturn`.

**Open question:** Is it worth extracting the compose-reply logic? The `AgentService.handleTurn` method is already 500+ lines. Extracting would improve maintainability. But for this fix, we can add the check and return early by duplicating the compose-reply block (or better, extracting it).

---

### 4.5 Image 7 — Missing link for María Bashi
**Problem:** "Ficha: no disponible en los resultados visibles" for María Bashi.  
**Exact location:** `src/runtime/sinenvolturas-gateway.ts`, `toProviderSummary` (line 487-529).  

**Root cause:** `detailUrl` is built from `slug`. If API returns `slug: null`, URL is null.

**Fix:**

In `toProviderSummary`, add fallback URL from ID:
```ts
detailUrl: this.buildDetailUrl(provider.slug ?? null) ?? this.buildDetailUrlFromId(provider.id),
```

Add new method:
```ts
private buildDetailUrlFromId(providerId: number): string | null {
  return `https://sinenvolturas.com/proveedores/${providerId}`;
}
```

**Open question:** Does the marketplace support ID-based URLs? We need to verify. If not, we should at least improve the message to "Ficha no disponible en este momento" instead of "no disponible en los resultados visibles".

If ID URLs don't work, update `recomendar/response_contract.txt`:
```
- cuando no exista enlace a la ficha, di "Ficha no disponible en este momento" en lugar de "no disponible en los resultados visibles";
```

Also, in `enrichProviders` in `AgentService`, after fetching detail, merge the detail URL:
```ts
return normalizeProviderSummary({
  ...provider,
  ...detail,
  detailUrl: detail?.detailUrl ?? provider.detailUrl,  // Ensure detail URL is preserved
  reason: provider.reason ?? detail.reason ?? null,
});
```

Wait, looking at `enrichProviders`:
```ts
return normalizeProviderSummary({
  ...provider,
  ...detail,
  reason: provider.reason ?? detail.reason ?? null,
});
```

The spread `...detail` would overwrite `detailUrl` if detail has one. But `detail` might be null. The current code already does `...detail` which would merge detailUrl. So if `getProviderDetail` returns a URL, it should work.

Let me check `toProviderDetail` in gateway.ts line 531-554:
```ts
private toProviderDetail(provider: ProviderApiItem): ProviderDetail {
  const summary = this.toProviderSummary(provider);
  // ...
  return {
    ...summary,
    description: ...,
    // ...
    raw: provider,
  };
}
```

So `toProviderDetail` calls `toProviderSummary` which builds `detailUrl` from slug. If slug is null, detailUrl is null. So even after enrichment, detailUrl remains null.

**Conclusion:** The ID fallback is the best fix.

---

## Batch 5 — Provider Filtering by Budget/Event Type (Prompt-only)

**Images covered:** 2  
**Why separate:** This is purely a prompt change to the recommendation node. Low risk but affects search quality.

### 5.1 Image 2 — Don't show high-end providers for low-budget events
**Problem:** User specified low budget (S/ 1,000) for birthday. Recommendations include Paola Puerta Catering (matrimonios, `$$$$`).  
**Exact location:** `prompts/nodes/recomendar/response_contract.txt`  

**Fix:**

Update `recomendar/response_contract.txt`, add after line 3:
```
- si el presupuesto del usuario es claramente bajo y un proveedor tiene un nivel de precio muy superior (por ejemplo $$$$ cuando el usuario indicó ~1000 soles), no lo incluyas en la shortlist salvo que no haya otras opciones;
- si el tipo de evento del usuario es claramente diferente a la especialidad del proveedor (por ejemplo cumpleaños vs matrimonios), prioriza proveedores con experiencia en ese tipo de evento; si no hay, menciona la especialidad pero no lo presentes como opción principal;
```

Also update `buildPromptPlanSnapshot` in `openai-agent-runtime.ts` to ensure `budget_signal` and `event_type` are prominently visible. They already are in the snapshot.

**Open question:** Should we add hard filtering in the gateway? No — the marketplace API doesn't support reliable budget filtering, and we'd lose valid providers. Teaching the model to skip mismatched providers is safer.

**Verification:** Create an eval case where plan has `budget_signal: "S/ 1000"`, `event_type: "cumpleaños"`, and verify the model doesn't recommend a `$$$$` wedding specialist.

---

## Batch 6 — Perf Table Expansion (Telemetry)

**Scope:** Reconstruct conversations from perf table  
**Why last:** Independent of all other changes. Can be deployed anytime.

### 6.1 Expand TurnPerfRecord for conversation reconstruction
**Current gaps:**
- Only `user_message_preview` (160 chars)
- No outbound text
- No full extraction
- No plan snapshot
- No turn index

**Files to change:**
- `src/logs/trace/perf.ts`
- `src/lambda/handler.ts`
- `src/core/trace.ts` (if needed)

**Detailed fix:**

In `src/logs/trace/perf.ts`, add to `TurnPerfRecord`:
```ts
export type TurnPerfRecord = {
  // ... existing fields ...
  user_message: string;
  outbound_text: string;
  extraction_json: string;
  plan_snapshot_json: string;
  conversation_turn_index: number;
};
```

In `buildTurnPerfRecord`, populate:
```ts
user_message: args.userMessage,
outbound_text: args.outboundText,  // NEW parameter
extraction_json: JSON.stringify(args.extractionJson ?? {}),
plan_snapshot_json: JSON.stringify(args.planSnapshotJson ?? {}),
conversation_turn_index: args.turnIndex,
```

This requires changing the signature of `buildTurnPerfRecord` to accept the outbound text, extraction, and plan snapshot. Update `src/lambda/handler.ts`:
```ts
const perfRecord = buildTurnPerfRecord({
  trace: response.trace,
  channel,
  externalUserId: body.user_id,
  messageId,
  userMessage: body.text,
  outboundText: response.outbound.text,  // NEW
  extractionJson: response.trace.extraction_summary,  // Or full extraction if we thread it
  planSnapshotJson: prunePlanForPerf(response.plan),  // NEW helper
  turnIndex: response.trace.node_path.length,  // Or better, count turns
  retentionDays: config.performance.retentionDays,
});
```

Wait — `buildTurnPerfRecord` doesn't currently receive the full extraction or plan snapshot. We need to thread these through from `AgentService.handleTurn`.

**Better approach:** Keep `buildTurnPerfRecord` signature minimal. Instead, add the heavy fields as optional parameters:
```ts
export function buildTurnPerfRecord(args: {
  trace: TurnTrace;
  channel: string;
  externalUserId: string;
  messageId: string;
  userMessage: string;
  outboundText: string;
  turnIndex: number;
  retentionDays: number;
}): TurnPerfRecord {
```

And in handler.ts, compute `turnIndex` by querying DynamoDB? No, that's expensive. Better: the `AgentService` should track turn index on the plan itself, or we can compute it from the number of perf records already stored.

**Simpler approach:** Don't add `turnIndex`. Just add `user_message`, `outbound_text`, and a pruned `plan_snapshot_json`. For extraction, the existing `extraction_summary` in `TurnTrace` is already quite detailed.

Let me check the existing `extraction_summary` in `trace.ts`:
```ts
export type ExtractionDebugSummary = {
  intent_confidence: number | null;
  event_type: string | null;
  // ... many fields
  contact_fields_present: { name: boolean; email: boolean; phone: boolean };
};
```

This is a summary, not the full extraction. But it's probably enough for debugging.

**Final plan for perf expansion:**

1. Add `user_message: string` to `TurnPerfRecord`
2. Add `outbound_text: string` to `TurnPerfRecord`
3. Add `plan_snapshot_json: string` — a compact JSON of the plan with only key fields (no `recommended_providers` blobs)
4. Keep `extraction_summary` as-is (it's already stored)

In `src/logs/trace/perf.ts`:
```ts
export type TurnPerfRecord = {
  // ... existing fields ...
  user_message: string;
  outbound_text: string;
  plan_snapshot_json: string;
};
```

Update `buildTurnPerfRecord`:
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

This uses existing `plan_summary` fields from the trace, so no need to thread extra data through.

Wait — `buildTurnPerfRecord` currently doesn't receive `outboundText`. We need to add that parameter.

In `src/lambda/handler.ts`:
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

And update the signature in `perf.ts`.

**Open question:** How big can `user_message` and `outbound_text` be? WhatsApp messages are limited to ~65K chars, but typical messages are short. DynamoDB items have a 400KB limit. Our perf records are currently small. Adding two text fields is safe.

**Verification:** Run a few turns, scan the perf table, and verify the new fields are populated.

---

## Cross-batch dependencies and ordering

| Batch | Depends on | Can deploy with |
|-------|-----------|-----------------|
| 1 (Style) | Nothing | Any time |
| 2 (TTL + Post-close) | Nothing | Any time, but 2.1 touches same files as 4.1 |
| 3 (Validation) | Nothing | Any time |
| 4 (State machine) | Nothing | Any time, but most complex |
| 5 (Filtering) | Nothing | Any time |
| 6 (Perf) | Nothing | Any time |

**Recommended order:**
1. Batch 6 first (so all subsequent runs capture full data)
2. Batch 1 (safe prompt changes)
3. Batch 2 (small runtime change)
4. Batch 3 (runtime validation)
5. Batch 4 (state machine — most testing needed)
6. Batch 5 (prompt-only, validate carefully)

**Files changed summary:**
- `prompts/shared/output_style.txt`
- `prompts/shared/common_anti_patterns.txt`
- `prompts/shared/response_formatting.txt` *(new)*
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/recomendar/response_contract.txt`
- `prompts/nodes/recomendar/system.txt`
- `prompts/nodes/refinar_criterios/system.txt`
- `prompts/nodes/crear_lead_cerrar/system.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/crear_lead_cerrar/tool_policy.txt`
- `prompts/nodes/necesidad_cubierta/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
- `prompts/extractors/field_definitions.txt`
- `src/runtime/prompt-manifest.ts`
- `src/core/plan.ts`
- `src/core/decision-flow.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/runtime/contracts.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/storage/plan-store.ts`
- `src/storage/dynamo-plan-store.ts`
- `src/logs/trace/perf.ts`
- `src/lambda/handler.ts`
