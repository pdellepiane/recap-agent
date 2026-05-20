# Batch 5 — Provider Filtering by Budget/Event Type

> **Images:** 2 (second part)  
> **Risk:** Low. Prompt-only change.  
> **Goal:** Prevent the model from recommending high-end or mismatched-event providers when the user's budget or event type clearly conflicts.

---

## 5.1 Image 2 — Don't show high-end providers for low-budget events

**Problem:** User specified a low budget (S/ 1,000) for a birthday. The recommendations include **Paola Puerta Catering**, whose description indicates it is for weddings and high-budget events (`$$$$`).

**Why not filter in the gateway?** The marketplace API does not support reliable budget or event-type filtering. Hard-filtering in the gateway would risk dropping valid providers when metadata is incomplete. Teaching the model to skip clearly mismatched providers is safer and preserves recall.

**Files to change:**
- `prompts/nodes/recomendar/response_contract.txt`

**Changes:**

Add filtering rules after line 3 in `prompts/nodes/recomendar/response_contract.txt`:
```
- si el presupuesto del usuario es claramente bajo y un proveedor tiene un nivel de precio muy superior (por ejemplo $$$$ cuando el usuario indicó ~1000 soles), no lo incluyas en la shortlist salvo que no haya otras opciones;
- si el tipo de evento del usuario es claramente diferente a la especialidad del proveedor (por ejemplo cumpleaños vs matrimonios), prioriza proveedores con experiencia en ese tipo de evento; si no hay, menciona la especialidad pero no lo presentes como opción principal;
```

**Data availability:** The model already receives `budget_signal` and `event_type` in `buildPromptPlanSnapshot` (`openai-agent-runtime.ts` lines 1058-1085). No runtime changes are needed.

**Open question:** Should we add a `priceLevel` filter to the gateway's `selectProvidersForPlan`? No. The gateway should remain category/location-first. The model is the right layer for semantic budget/event-type filtering because it can interpret relative terms like "bajo" vs "$$$$".

**Verification:**
1. Create a plan with `event_type: "cumpleaños"`, `budget_signal: "S/ 1000"`.
2. Search for catering.
3. Verify the recommendation does NOT include a `$$$$` wedding specialist as a top option (it may mention it as "también existe X, pero es más orientado a matrimonios" if no alternatives exist).

---

## Files changed in this batch

- `prompts/nodes/recomendar/response_contract.txt`
