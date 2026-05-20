# Batch 4 — Selection Continuity, Zero-Result Needs, Partial Close, Missing Links

> **Images:** 3, 7, 8, 9, 14  
> **Risk:** High. State-machine changes, new provider need status, close-flow blocking logic.  
> **Goal:** Fix selection continuity, prevent phantom pending needs, allow partial close, and fix missing provider links.

---

## 4.1 Image 3 — Bot asks to choose provider when one is already selected

**Problem:** User already confirmed "La Botanería" for catering. Later says "cerremos" and bot says "falta elegir un proveedor para el catering."

**Root cause:** The `crear_lead_cerrar` prompt tells the model to "asegurar que todas las necesidades de proveedores están cubiertas." The model may hallucinate that a need is uncovered even when `selected_provider_id` is present. The snapshot includes `selected_provider_id` but not the selected provider's title, and the prompt does not explicitly instruct the model to check it.

**Files to change:**
- `prompts/nodes/crear_lead_cerrar/system.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `src/runtime/openai-agent-runtime.ts`

**Changes:**

### Step 1 — Strengthen prompt instructions

Update `prompts/nodes/crear_lead_cerrar/system.txt`:
```
Objetivo del nodo:
- guiar al cierre definitivo del plan de evento.
- antes de pedir datos de contacto, verifica explícitamente el campo selected_provider_id de cada necesidad en el plan.
- si una necesidad ya tiene selected_provider_id, nunca pidas elegir otro proveedor para esa necesidad.
- si el usuario quiere cerrar solo algunas necesidades, permite el cierre parcial listando qué se cierra y qué se omite.
```

Update `prompts/nodes/crear_lead_cerrar/response_contract.txt`, prepend:
```
La respuesta debe:
- antes de pedir datos de contacto, verificar el campo selected_provider_id de cada necesidad;
- si todas las necesidades que el usuario quiere cerrar ya tienen proveedor seleccionado, salta directamente a solicitar contacto o confirmación;
```

### Step 2 — Enrich snapshot with selected provider titles

In `src/runtime/openai-agent-runtime.ts`, method `buildPromptPlanSnapshot`, update the `provider_needs` block:
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

This makes it unambiguous to the model which provider is selected for each need.

**Verification:**
1. Select a provider for catering.
2. Enter the close flow.
3. Verify the bot does NOT ask to choose a provider for catering again. It should proceed directly to contact info or confirmation.

---

## 4.2 Images 8, 9, 14 — Zero-result needs treated as "pending to resume"

**Problem:** Organization had zero results. User later wants to close with photography. Bot still treats organization as pending. Image 14 explicitly says: "si un proveedor ya fue descartado por no disponibilidad, no debería volver a mencionarse más adelante."

**Root cause:** When search returns zero results, the need stays in status `search_ready` or `shortlisted` (with empty list). `resolveResumeNode` and `seguir_refinando_guardar_plan` continue to treat it as an open item.

**Files to change:**
- `src/core/plan.ts`
- `src/runtime/agent-service.ts`
- `src/core/decision-flow.ts`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`

**Changes:**

### Step 1 — Add new terminal status

In `src/core/plan.ts`, add to `providerNeedStatusValues`:
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

### Step 2 — Set status on zero results

In `src/runtime/agent-service.ts`, around line 530-535, when search returns empty:
```ts
if (providerResults.length === 0) {
  currentNode = 'refinar_criterios';
  nodePath.push('hay_resultados', currentNode);
  planAfterFlow = mergePlan(planAfterFlow, {
    current_node: currentNode,
    provider_needs: activeNeed
      ? [{
          ...activeNeed,
          status: 'no_providers_available',
          missing_fields: [],
        }]
      : [],
  });
}
```

### Step 3 — Preserve status across merges

In `src/core/plan.ts`, `mergeProviderNeed` (line 193-200), add preservation logic:
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

### Step 4 — Prevent resume into unavailable needs

In `src/core/decision-flow.ts`, update `resolveResumeNode`:
```ts
export function resolveResumeNode(plan: PersistedPlan): DecisionNode {
  if (plan.lifecycle_state === 'finished') {
    return 'necesidad_cubierta';
  }
  // ... existing guardar_cerrar_temporalmente and consultar_faq logic ...

  const activeNeed = getActiveNeed(plan);

  // NEW: if active need has no providers available, find another need
  if (activeNeed?.status === 'no_providers_available') {
    const nextNeed = plan.provider_needs.find(
      (need) => need.status !== 'no_providers_available',
    );
    if (nextNeed) {
      // We can't change active_need_category here (this is a pure resolver),
      // but we can signal that the active need is not resumable.
      // The caller (AgentService) should handle switching active need.
    }
  }

  if (activeNeed?.selected_provider_id) {
    return 'seguir_refinando_guardar_plan';
  }
  // ... rest of existing logic ...
}
```

**Open question:** `resolveResumeNode` is a pure function that only returns a node name. It cannot mutate the plan to switch `active_need_category`. The actual switch should happen in `AgentService.handleTurn` after calling `resolveResumeNode`. We need to add logic there: if the resumed active need is `no_providers_available`, pick the next available need as active.

Add in `AgentService.handleTurn`, after `resolveResumeNode`:
```ts
const workingPlan = mergePlan(loadedPlan, {
  current_node: existingPlan ? resolveResumeNode(existingPlan) : 'deteccion_intencion',
});
// NEW: if active need is no_providers_available, switch to next available need
if (workingPlan.active_need_category) {
  const activeNeed = getActiveNeed(workingPlan);
  if (activeNeed?.status === 'no_providers_available') {
    const nextNeed = workingPlan.provider_needs.find(
      (need) => need.status !== 'no_providers_available',
    );
    if (nextNeed) {
      Object.assign(workingPlan, mergePlan(workingPlan, {
        active_need_category: nextNeed.category,
      }));
    }
  }
}
```

### Step 5 — Update prompt to not offer resuming unavailable needs

Append to `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`:
```
- no ofrezcas retomar necesidades cuyo estado sea no_providers_available;
```

### Step 6 — Update provider need summary

In `src/core/plan.ts`, update `summarizeProviderNeeds`:
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

**Verification:**
1. Search for organization → zero results.
2. Switch to photography → select a provider.
3. Try to close or continue.
4. Verify the bot does NOT mention organization as "pending to resume."

---

## 4.3 Images 8, 9, 14 — Allow partial close with explicit acknowledgment

**Problem:** User wants to close plan with photography selected, but organization had no results. Bot should allow partial close with clear lists.

**Current behavior:** The `finish_plan` tool already iterates only over needs with `selected_provider_id`. Partial close is supported at the tool level. The problem is conversational — the bot blocks or confuses the user.

**Files to change:**
- `prompts/nodes/crear_lead_cerrar/system.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`

**Changes:**

Update `prompts/nodes/crear_lead_cerrar/system.txt`:
```
Objetivo del nodo:
- guiar al cierre definitivo del plan de evento.
- el usuario puede cerrar el plan con solo algunas necesidades resueltas; no es obligatorio que todas tengan proveedor.
- antes de cerrar, muestra un resumen dividido en DOS listas:
  1. Necesidades que SE cerrarán (las que tienen selected_provider_id).
  2. Necesidades que NO se cerrarán (las que no tienen proveedor seleccionado o tienen estado no_providers_available).
- pide confirmación explícita del cierre parcial.
```

Update `prompts/nodes/crear_lead_cerrar/response_contract.txt`:
```
La respuesta debe:
- si faltan datos de contacto: pedirlos de forma clara y amable;
- si ya hay contacto: mostrar DOS listas claras:
  - "Se enviarán solicitudes para:" (necesidades con proveedor seleccionado)
  - "Se dejarán sin proveedor:" (necesidades sin selected_provider_id o con estado no_providers_available)
- pedir confirmación explícita antes de enviar;
- tras confirmación: llamar finish_plan y confirmar.
```

**Verification:** Close a plan where one need has a selected provider and another has `no_providers_available`. Verify the bot presents two lists and asks for confirmation of the partial close.

---

## 4.4 Images 8, 9, 14 — Block close when unselected shortlists exist

**Problem:** User says "no quiero retomar lo pendiente" and the system closes, even though organization still has a shortlist the user never reviewed. The user explicitly requests: "debería agregarse un mensaje que indique que no se puede cerrar si aún hay un pedido o una necesidad por confirmar."

**Decision:** Block close **only** when a need has status `shortlisted` with non-empty `recommended_providers` and no `selected_provider_id`. Allow the user to explicitly opt out by saying "ninguna".

**Files to change:**
- `src/runtime/agent-service.ts`

**Changes:**

### Step 1 — Add detection helper

In `src/runtime/agent-service.ts`, add:
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

### Step 2 — Block close in `handleTurn`

In `handleTurn`, before the `extraction.intent === 'cerrar'` branch (line 306), add:
```ts
if (extraction.intent === 'cerrar') {
  const unselected = this.hasUnselectedShortlist(mergedPlan);
  if (unselected && !inbound.text.toLowerCase().includes('ninguna')) {
    currentNode = 'crear_lead_cerrar';
    nodePath.push(currentNode);
    errorMessage = `Antes de cerrar, necesito saber: ¿quieres elegir alguna opción de ${unselected.category} o prefieres dejarla sin proveedor? Responde "ninguna" si no quieres ninguna.`;
    const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
    await persistPlan(planToSave, 'crear_lead_cerrar');
    planPersisted = true;
    planPersistReason = 'crear_lead_cerrar';

    // Load prompt bundle and compose reply (duplicated logic — see note below)
    const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
    const reply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode,
      userMessage: inbound.text,
      plan: planToSave,
      missingFields: sufficiency.missingFields,
      searchReady: sufficiency.searchReady,
      providerResults,
      errorMessage,
      promptBundleId: bundle.id,
      promptFilePaths: bundle.filePaths,
      toolUsage,
    });
    // ... build trace and return ...
    return {
      plan: planToSave,
      outbound: { text: reply.text, conversationId: planToSave.conversation_id },
      trace: this.buildTrace({ /* ... */ }),
    };
  }
  // else: fall through to normal cerrar branch
}
```

**Open question / Refactoring note:** The `cerrar` branch and the general reply branch both duplicate compose-reply logic. `AgentService.handleTurn` is already 500+ lines. For maintainability, consider extracting a private method `composeAndReturn` that handles prompt loading, reply composition, and trace building. This is not strictly required for the fix, but the blocking logic introduces a third early-return path and increases duplication.

**Verification:**
1. Get recommendations for a need but do NOT select a provider.
2. Try to close the plan.
3. Verify the bot blocks the close and asks: "¿quieres elegir alguna opción de X o prefieres dejarla sin proveedor? Responde 'ninguna' si no quieres ninguna."
4. Reply "ninguna".
5. Verify the close proceeds.

---

## 4.5 Image 7 — Missing link for María Bashi

**Problem:** "Ficha: no disponible en los resultados visibles" for María Bashi.  
**Root cause:** `toProviderSummary` builds `detailUrl` from `slug`. If `slug` is null, URL is null. Even after `getProviderDetail` enrichment, the URL stays null because `toProviderDetail` calls `toProviderSummary` internally.

**Files to change:**
- `src/runtime/sinenvolturas-gateway.ts`

**Changes:**

Add fallback URL by provider ID:
```ts
private buildDetailUrlFromId(providerId: number): string | null {
  return `https://sinenvolturas.com/proveedores/${providerId}`;
}
```

Update `toProviderSummary` (around line 519):
```ts
detailUrl: this.buildDetailUrl(provider.slug ?? null) ?? this.buildDetailUrlFromId(provider.id),
```

**Open question:** Does the marketplace support ID-based detail URLs? We need to verify by visiting `https://sinenvolturas.com/proveedores/{id}` with a known provider ID. If it 404s, this fallback does not work and we should instead improve the model message.

If ID URLs do **not** work, skip the gateway change and instead update `prompts/nodes/recomendar/response_contract.txt`:
```
- cuando no exista enlace a la ficha, di "Ficha no disponible en este momento" en lugar de "no disponible en los resultados visibles";
```

**Verification:**
1. Trigger a recommendation that includes a provider with no slug.
2. Verify the detail URL uses the numeric ID fallback OR the model says "Ficha no disponible en este momento."

---

## Files changed in this batch

- `src/core/plan.ts`
- `src/core/decision-flow.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `prompts/nodes/crear_lead_cerrar/system.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
