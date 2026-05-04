# Batch 4 — Selection Continuity, Zero-Result Needs, Partial Close, Missing Links
## Structured-Output-Aware Revision

> **Images:** 3, 7, 8, 9, 14  
> **Risk:** High. State-machine changes, new provider need status, close-flow blocking logic.  
> **Goal:** Fix selection continuity, prevent phantom pending needs, allow partial close with proper structured-message types, and fix missing provider links.

---

## How Structured Outputs Change This Batch

The system now uses **deterministic `StructuredMessage` rendering** instead of free-text LLM output. This changes the fix strategy for several items:

| Sub-issue | Old approach (free-text) | New approach (structured) |
|---|---|---|
| Partial close (Image 9) | Prompt the model to write two lists in free text | Use the existing **`close_confirmation`** message type, which has `selected_providers_es` and `unselected_needs_es` arrays. The `WhatsAppMessageRenderer` and `WebChatMessageRenderer` already render these deterministically. |
| Selection continuity (Image 3) | Prompt fix only | Still needs prompt strengthening **plus** snapshot enrichment (`selected_provider_title`) so the model cannot hallucinate that a selected need is uncovered. |
| Missing link (Image 7) | Prompt fallback text | No prompt change needed. Fix the **gateway** so `detailUrl` is populated; the renderer automatically omits the Ficha line when `detailUrl` is null and shows it when present. |
| Zero-result needs (Images 8, 9, 14) | Status + prompt | Same state-machine changes, but `resolveResumeNode` and `seguir_refinando_guardar_plan` prompt must be updated to skip `no_providers_available` needs. |
| Block close with unselected shortlists (Image 14) | Code block + deterministic message | Code detection is still required. The blocking message can be composed by the model via `errorMessage` operational note, keeping tone natural while enforcing the business rule. |

---

## 4.1 Image 3 — Bot asks to choose provider when one is already selected

**Problem:** User already confirmed "La Botanería" for catering. Later says "cerremos" and bot says "falta elegir un proveedor para el catering."

**Root cause:** The `crear_lead_cerrar` prompt tells the model to "asegurar que todas las necesidades de proveedores están cubiertas," but the model does not reliably check `selected_provider_id`. The snapshot includes the ID but not the provider title, making it harder to verify.

### Changes

#### Step 1 — Enrich snapshot with selected provider titles

**File:** `src/runtime/openai-agent-runtime.ts`, method `buildPromptPlanSnapshot`

Update the `provider_needs` block:
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

This makes it unambiguous which provider is selected.

#### Step 2 — Strengthen prompt instructions

**File:** `prompts/nodes/crear_lead_cerrar/system.txt`

Replace the first paragraph with:
```
Objetivo del nodo:
- guiar al cierre definitivo del plan de evento.
- antes de pedir datos de contacto, verifica explícitamente el campo selected_provider_id de cada necesidad en el plan.
- si una necesidad ya tiene selected_provider_id (y selected_provider_title no es nulo), nunca pidas elegir otro proveedor para esa necesidad; considérala cubierta.
- si el usuario quiere cerrar solo algunas necesidades, permite el cierre parcial listando qué se cierra y qué se omite.
```

#### Step 3 — Update response contract to use `close_confirmation` for the confirmation phase

**File:** `prompts/nodes/crear_lead_cerrar/response_contract.txt`

Replace the entire file with:
```
La respuesta debe adaptarse a la fase actual del cierre:

1. Si faltan datos de contacto (contact_name, contact_email o contact_phone son nulos):
   - tipo: contact_request
   - intro_es: explica brevemente que se necesitan los datos para enviar las solicitudes.
   - requested_fields_es: lista solo los campos que faltan.
   - actions: debe incluir provide_contact.

2. Si ya hay contacto completo y el usuario está confirmando el cierre:
   - tipo: close_confirmation
   - summary_es: resumen amable del cierre.
   - selected_providers_es: array con una línea por cada necesidad que tiene selected_provider_id (ej: "catering: La Botanería").
   - unselected_needs_es: array con las categorías que NO tienen proveedor seleccionado o tienen estado no_providers_available.
   - actions: debe incluir confirm y decline.

3. Tras confirmación y llamada exitosa a finish_plan:
   - tipo: close_result
   - success_es: confirma que las solicitudes fueron enviadas y menciona qué proveedores fueron contactados.
   - contact_explanation_es: explica que los proveedores se pondrán en contacto directamente por email o teléfono en un plazo aproximado de 24 a 48 horas. Despídete con calidez.

4. Si Nota operativa indica un bloqueo por shortlist sin seleccionar:
   - tipo: generic
   - paragraphs_es: explica que antes de cerrar hay una necesidad con opciones pendientes, pregunta si quiere elegir alguna o dejarla sin proveedor. Menciona que puede responder "ninguna" para dejarla sin proveedor.
   - actions: incluir select_provider y decline.

5. Si Nota operativa indica que un teléfono o email es inválido:
   - tipo: generic
   - paragraphs_es: explica el problema y pide solo ese dato corregido; no vuelvas a pedir los datos que ya están presentes en el plan.
   - actions: incluir provide_contact.

Reglas generales:
- nunca cerrar el plan sin confirmación explícita del usuario;
- no fingir que se contactaron proveedores si finish_plan no fue llamado o retornó error;
- no usar Markdown ni asteriscos;
- no mencionar períodos de enfriamiento ni tiempos de espera para iniciar un nuevo plan.
```

#### Step 4 — Align message type hint with close phase

**File:** `src/runtime/openai-agent-runtime.ts`, method `resolveMessageTypeHint`

Make it state-aware for `crear_lead_cerrar`:
```ts
private resolveMessageTypeHint(request: ComposeReplyRequest): string {
  const node = request.currentNode;
  if (node === 'crear_lead_cerrar') {
    const hasContact =
      request.plan.contact_name &&
      request.plan.contact_email &&
      request.plan.contact_phone;
    if (!hasContact) {
      return 'Tipo de mensaje estructurado esperado: contact_request. Devuelve el JSON correspondiente a este tipo.';
    }
    // After finish_plan succeeds, the tool sets lifecycle_state to 'finished'.
    // If the model is about to emit the final message, guide it toward close_result.
    if (request.plan.lifecycle_state === 'finished') {
      return 'Tipo de mensaje estructurado esperado: close_result. Devuelve el JSON correspondiente a este tipo.';
    }
    return 'Tipo de mensaje estructurado esperado: close_confirmation. Devuelve el JSON correspondiente a este tipo.';
  }
  const typeMap: Record<string, string> = {
    contacto_inicial: 'welcome',
    recomendar: 'recommendation',
  };
  const messageType = typeMap[node] ?? 'generic';
  return `Tipo de mensaje estructurado esperado: ${messageType}. Devuelve el JSON correspondiente a este tipo.`;
}
```

**Note:** `finish_plan` mutates `request.plan.lifecycle_state` to `'finished'` inside the tool execution. When the model emits the final message in the same turn, the hint will correctly suggest `close_result`.

**Verification:**
1. Select a provider for catering.
2. Enter the close flow.
3. Verify the bot does NOT ask to choose a provider for catering again. It should proceed directly to contact request or close confirmation with the correct `close_confirmation` type and the provider listed in `selected_providers_es`.

---

## 4.2 Images 8, 9, 14 — Zero-result needs treated as "pending to resume"

**Problem:** Organization had zero results. User later wants to close with photography. Bot still treats organization as pending. Image 14 explicitly says: "si un proveedor ya fue descartado por no disponibilidad, no debería volver a mencionarse más adelante."

**Root cause:** When search returns zero results, the need stays in status `search_ready` (or `shortlisted` with empty list). `resolveResumeNode` and `seguir_refinando_guardar_plan` continue to treat it as an open item.

### Changes

#### Step 1 — Add new terminal status

**File:** `src/core/plan.ts`

Add to `providerNeedStatusValues`:
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

#### Step 2 — Set status on zero results

**File:** `src/runtime/agent-service.ts`

In the search result handling block (around line 540-560), when `providerResults.length === 0`:
```ts
// BEFORE (current):
status: providerResults.length > 0 ? 'shortlisted' : 'search_ready',

// AFTER:
status: providerResults.length > 0 ? 'shortlisted' : 'no_providers_available',
```

Also clear `missing_fields` for the need so it doesn't appear as "search ready but missing data":
```ts
provider_needs: activeNeed
  ? [
      {
        ...activeNeed,
        recommended_provider_ids: [],
        recommended_providers: [],
        missing_fields: [],
        selected_provider_id: null,
        selected_provider_hint: null,
        status: providerResults.length > 0 ? 'shortlisted' : 'no_providers_available',
      },
    ]
  : [],
```

#### Step 3 — Preserve terminal statuses in merge logic

**File:** `src/core/plan.ts`, function `mergeProviderNeed`

Replace the status inference block with:
```ts
let status = update.status ?? current?.status ?? 'identified';

if (update.status) {
  // Explicit status update always wins
  status = update.status;
} else if (selectedProviderId) {
  status = 'selected';
} else if (current?.status === 'no_providers_available' && recommendedProviders.length === 0) {
  // Preserve terminal "no providers" status unless new results arrived
  status = 'no_providers_available';
} else if (current?.status === 'deferred') {
  // Preserve deferred unless explicitly changed or selected
  status = 'deferred';
} else if (recommendedProviders.length > 0 || recommendedProviderIds.length > 0) {
  status = 'shortlisted';
} else if ((update.missing_fields ?? current?.missing_fields ?? []).length === 0) {
  status = 'search_ready';
}
```

This prevents `mergeProviderNeed` from clobbering `no_providers_available` back to `search_ready` on subsequent merges.

#### Step 4 — Skip unavailable needs when resuming

**File:** `src/runtime/agent-service.ts`, in `handleTurn`

Before calling `resolveResumeNode`, switch away from `no_providers_available` active needs:
```ts
let planToResume = loadedPlan;
if (loadedPlan.active_need_category) {
  const activeNeed = getActiveNeed(loadedPlan);
  if (activeNeed?.status === 'no_providers_available') {
    const nextNeed = loadedPlan.provider_needs.find(
      (need) => need.status !== 'no_providers_available',
    );
    if (nextNeed) {
      planToResume = mergePlan(loadedPlan, {
        active_need_category: nextNeed.category,
      });
    }
  }
}

const workingPlan = mergePlan(planToResume, {
  current_node: existingPlan ? resolveResumeNode(planToResume) : 'deteccion_intencion',
});
```

#### Step 5 — Update `resolveResumeNode` to not resume into unavailable needs

**File:** `src/core/decision-flow.ts`

Update `resolveResumeNode` to treat `no_providers_available` as non-resumable:

```ts
export function resolveResumeNode(plan: PersistedPlan): DecisionNode {
  if (plan.lifecycle_state === 'finished') {
    return 'necesidad_cubierta';
  }

  if (isDecisionNode(plan.current_node) && plan.current_node === LEAD_CLOSE_RESUME_NODE) {
    return LEAD_CLOSE_RESUME_NODE;
  }

  if (plan.current_node === 'guardar_cerrar_temporalmente') {
    return 'entrevista';
  }

  if (plan.current_node === 'consultar_faq') {
    if (plan.intent && plan.event_type) {
      return 'entrevista';
    }
    return 'deteccion_intencion';
  }

  const activeNeed = getActiveNeed(plan);

  if (activeNeed?.status === 'no_providers_available') {
    // If the active need has no providers, there's nothing to resume here.
    // The caller (AgentService) should have switched active_need_category before calling this.
    // If we reach here, fall through to entrevista so we don't loop on a dead need.
    return 'entrevista';
  }

  if (activeNeed?.selected_provider_id) {
    return 'seguir_refinando_guardar_plan';
  }

  if ((activeNeed?.recommended_provider_ids ?? []).length > 0) {
    return 'recomendar';
  }

  if ((plan.missing_fields ?? []).length > 0) {
    return 'entrevista';
  }

  return 'entrevista';
}
```

#### Step 6 — Update prompt to not offer resuming unavailable needs

**File:** `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`

Append:
```
- no ofrezcas retomar necesidades cuyo estado sea no_providers_available;
- si todas las necesidades sin proveedor están en estado no_providers_available, no las presentes como "pendientes para retomar después";
```

#### Step 7 — Update provider need summary

**File:** `src/core/plan.ts`, function `summarizeProviderNeeds`

Update to include the unavailable annotation:
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
3. The bot should NOT mention organization as "pending to resume" in `seguir_refinando_guardar_plan`.
4. Try to close. The bot should proceed directly to close confirmation because photography is selected and organization is `no_providers_available`.

---

## 4.3 Images 8, 9, 14 — Allow partial close with explicit acknowledgment

**Problem:** User wants to close plan with photography selected, but organization had no results. Bot should allow partial close with clear lists.

**Current behavior:** `finish_plan` already iterates only over needs with `selected_provider_id`. Partial close is supported at the tool level. The problem is conversational — the bot must present two clear lists.

### Changes

With structured outputs, this is handled by the **`close_confirmation`** message type (see 4.1, Step 3). The model populates:
- `selected_providers_es`: needs with `selected_provider_id`
- `unselected_needs_es`: needs without `selected_provider_id` or with `no_providers_available`

The renderer already outputs:
```
Se enviarán solicitudes para:
- Fotografía: Foto Uno.

Se dejarán sin proveedor:
- Organización.
```

**No additional code changes are needed for partial close rendering.** The prompt changes in 4.1 ensure the model emits the correct type.

**Verification:** Close a plan where one need has a selected provider and another has `no_providers_available`. Verify the bot presents two lists and asks for confirmation of the partial close.

---

## 4.4 Images 8, 9, 14 — Block close when unselected shortlists exist

**Problem:** User says "no quiero retomar lo pendiente" and the system closes, even though organization still has a shortlist the user never reviewed. The user explicitly requests: "debería agregarse un mensaje que indique que no se puede cerrar si aún hay un pedido o una necesidad por confirmar."

**Decision:** Block close **only** when a need has status `shortlisted` with non-empty `recommended_providers` and no `selected_provider_id`. Allow the user to explicitly opt out by saying "ninguna", which sets the need to `deferred`.

### Changes

#### Step 1 — Add detection helper

**File:** `src/runtime/agent-service.ts`

Add inside `AgentService`:
```ts
private hasUnselectedShortlist(plan: PlanSnapshot): ProviderNeed | null {
  return (
    plan.provider_needs.find(
      (need) =>
        need.status === 'shortlisted' &&
        need.recommended_providers.length > 0 &&
        need.selected_provider_id === null,
    ) ?? null
  );
}
```

#### Step 2 — Block close in `handleTurn`

In the `extraction.intent === 'cerrar'` branch (currently line 336), add blocking logic BEFORE routing to `crear_lead_cerrar`:

```ts
if (extraction.intent === 'cerrar') {
  const unselected = this.hasUnselectedShortlist(mergedPlan);
  const userDeclinedShortlist = inbound.text.toLowerCase().includes('ninguna');

  if (unselected && !userDeclinedShortlist) {
    // Block close and ask user to choose or explicitly decline
    currentNode = 'crear_lead_cerrar';
    nodePath.push(currentNode);
    errorMessage = `Antes de cerrar, necesito saber: ¿quieres elegir alguna opción de ${unselected.category} o prefieres dejarla sin proveedor? Responde "ninguna" si no quieres ninguna.`;
    const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
    await persistPlan(planToSave, 'crear_lead_cerrar');
    planPersisted = true;
    planPersistReason = 'crear_lead_cerrar';

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
    tokenUsage.reply = reply.tokenUsage ?? null;
    tokenUsage.total = this.sumTokenUsage(tokenUsage.extraction, tokenUsage.reply);
    const recommendationFunnel = this.resolveRecommendationFunnel(
      reply.recommendationFunnel ?? null,
      providerResults,
    );

    await persistPlan(planToSave, planPersistReason ?? currentNode);
    timingMs.total = Date.now() - handleTurnStartedAt;

    return {
      plan: planToSave,
      outbound: {
        text: this.renderReply(reply, providerResults, inbound.channel),
        conversationId: planToSave.conversation_id,
      },
      trace: this.buildTrace({
        plan: planToSave,
        previousNode,
        currentNode,
        nodePath,
        extraction,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage,
        providerResults,
        recommendationFunnel,
        planPersisted: true,
        planPersistReason,
        timingMs,
        tokenUsage,
        searchStrategy,
        operationalNote: errorMessage,
      }),
    };
  }

  if (unselected && userDeclinedShortlist) {
    // User explicitly declined the shortlist; set need to deferred and proceed with close
    const deferredNeed: ProviderNeed = {
      ...unselected,
      status: 'deferred',
      selected_provider_id: null,
      selected_provider_hint: null,
    };
    const planWithDeferred = mergePlan(mergedPlan, {
      provider_needs: [deferredNeed],
    });
    mergedPlan = planWithDeferred;
  }

  // Proceed to normal close flow
  currentNode = 'crear_lead_cerrar';
  nodePath.push(currentNode);
  // ... rest of existing cerrar branch ...
}
```

**Note:** This introduces early-return duplication inside `handleTurn`. The existing `cerrar` branch already duplicates the compose-reply logic. To keep this batch maintainable, we accept the duplication for now. A future refactoring can extract a private `composeAndReturn` method.

**Verification:**
1. Get recommendations for a need but do NOT select a provider.
2. Try to close the plan.
3. Verify the bot blocks the close and asks: "¿quieres elegir alguna opción de X o prefieres dejarla sin proveedor? Responde 'ninguna' si no quieres ninguna."
4. Reply "ninguna".
5. Verify the need's status becomes `deferred` and the close proceeds.

---

## 4.5 Image 7 — Missing link for María Bashi

**Problem:** "Ficha: no disponible en los resultados visibles" for María Bashi.

**Root cause:** `toProviderSummary` builds `detailUrl` from `slug`. If `slug` is null, URL is null. The renderer skips the Ficha line entirely when `detailUrl` is null (which is better than the old free-text "no disponible", but still loses the link).

### Changes

#### Step 1 — Add fallback URL by provider ID

**File:** `src/runtime/sinenvolturas-gateway.ts`

Add helper:
```ts
private buildDetailUrlFromId(providerId: number): string | null {
  return `https://sinenvolturas.com/proveedores/${providerId}`;
}
```

Update `toProviderSummary` (around line 519):
```ts
detailUrl: this.buildDetailUrl(provider.slug ?? null) ?? this.buildDetailUrlFromId(provider.id),
```

**Open question / verification:** The endpoint `https://sinenvolturas.com/proveedores/{id}` returned HTTP 500 for ID `1` during planning. This may mean:
- ID `1` does not exist in the marketplace, OR
- The marketplace does not support numeric-ID detail URLs.

**Verification step required before deploying:**
1. Visit `https://sinenvolturas.com/proveedores/{id}` with a known real provider ID (e.g., from the marketplace database).
2. If it 404s or 500s for all IDs, **revert the gateway change** and instead accept that the renderer cleanly omits the Ficha line when `detailUrl` is null.
3. If it works for real IDs, keep the fallback.

---

## Files changed in this batch

| File | Change |
|---|---|
| `src/core/plan.ts` | Add `no_providers_available` status; fix `mergeProviderNeed` to preserve terminal statuses; update `summarizeProviderNeeds` |
| `src/core/decision-flow.ts` | Defensive check for `no_providers_available` in `resolveResumeNode` |
| `src/runtime/agent-service.ts` | Set `no_providers_available` on zero results; switch active need before resume; block close with unselected shortlists; handle "ninguna" decline |
| `src/runtime/openai-agent-runtime.ts` | Enrich snapshot with `selected_provider_title`; make `resolveMessageTypeHint` state-aware for `crear_lead_cerrar` |
| `src/runtime/sinenvolturas-gateway.ts` | Add ID-based detail URL fallback (pending live verification) |
| `prompts/nodes/crear_lead_cerrar/system.txt` | Strengthen selection continuity checks; allow partial close |
| `prompts/nodes/crear_lead_cerrar/response_contract.txt` | State-aware structured types: `contact_request`, `close_confirmation`, `close_result`, `generic` for blocks/validation |
| `prompts/nodes/crear_lead_cerrar/tool_policy.txt` | Add rule: do not call `finish_plan` if operational note indicates unselected shortlist block |
| `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt` | Do not offer resuming `no_providers_available` needs |
| `tests/agent-service.test.ts` | Add tests for zero-result status, close blocking, "ninguna" decline, selection continuity |
| `tests/message-renderer.test.ts` | Verify `close_confirmation` renders selected/unselected lists correctly (already covered; may add partial-close case) |

---

## Test plan

### Unit tests to add

1. **Zero-result search sets `no_providers_available`**
   - Seed plan with active need "organización".
   - Mock gateway to return empty results.
   - Verify `response.plan.provider_needs[0].status === 'no_providers_available'`.

2. **`mergeProviderNeed` preserves `no_providers_available`**
   - Create a need with status `no_providers_available` and empty recommendations.
   - Call `mergePlan` with an update that does not explicitly set status.
   - Verify status remains `no_providers_available`.

3. **Resume skips `no_providers_available` active need**
   - Seed plan with photography (selected) and organization (`no_providers_available`), active_need_category = 'organization'.
   - Send any message.
   - Verify `response.plan.active_need_category` becomes 'fotografía'.
   - Verify `response.plan.current_node` is `seguir_refinando_guardar_plan` (not `entrevista`).

4. **Close blocked by unselected shortlist**
   - Seed plan with photography (selected) and music (shortlisted with providers, no selection).
   - Send "quiero cerrar".
   - Verify `response.plan.current_node === 'crear_lead_cerrar'`.
   - Verify `response.outbound.text` contains the blocking question.
   - Verify `finish_plan` is NOT called.

5. **"Ninguna" declines shortlist and proceeds to close**
   - Seed plan with photography (selected) and music (shortlisted).
   - Previous turn already blocked close.
   - Send "ninguna".
   - Verify music need status becomes `deferred`.
   - Verify bot proceeds to `crear_lead_cerrar` contact/confirmation flow.

6. **Close proceeds when only `no_providers_available` needs are unselected**
   - Seed plan with photography (selected) and organization (`no_providers_available`).
   - Send "quiero cerrar".
   - Verify close is NOT blocked (no unselected shortlist).
   - Verify bot proceeds directly to `crear_lead_cerrar`.

7. **Snapshot includes `selected_provider_title`**
   - Seed plan with need having `selected_provider_id` and matching provider in `recommended_providers`.
   - Send message that triggers `composeReply`.
   - Verify the `ComposeReplyRequest.plan` snapshot (via runtime spy) contains `selected_provider_title`.

8. **`crear_lead_cerrar` emits `close_confirmation` when contact is complete**
   - Seed plan with complete contact and selected provider.
   - Mock runtime to capture the structured message type.
   - Verify `reply.structuredMessage.type === 'close_confirmation'`.

---

## Implementation order (recommended)

1. **Schema & merge logic** (`src/core/plan.ts`) — foundation for everything else.
2. **Zero-result handling** (`src/runtime/agent-service.ts`) + **resume skip** (`src/core/decision-flow.ts` + `AgentService`).
3. **Snapshot enrichment** (`src/runtime/openai-agent-runtime.ts`).
4. **Close blocking** (`src/runtime/agent-service.ts`) + **prompt updates** (`crear_lead_cerrar`).
5. **Message type hint alignment** (`src/runtime/openai-agent-runtime.ts`).
6. **Seguir refinando prompt** (`seguir_refinando_guardar_plan/response_contract.txt`).
7. **Missing link fallback** (`src/runtime/sinenvolturas-gateway.ts`) — verify live before merging.
8. **Tests** — add all new unit tests.
9. **Full test suite** — `npm run test`, `npm run typecheck`, `npm run lint`.
10. **Update `docs/implementation-log.md`**.
