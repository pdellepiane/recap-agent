# Batch 3 — Contact Field Validation

> **Images:** 10, 11, 12, 13  
> **Risk:** Medium. Runtime deterministic validation.  
> **Goal:** Reject invalid phone/email **immediately** upon extraction, and accept partial contact updates without friction.

---

## 3.1 Images 10, 11, 12 — Phone/email validation must happen immediately upon extraction

**Problem:** User sends a 3-digit phone (`967`). Bot accepts it. Only at the very end of the close flow (when `finish_plan` tries to call the quote endpoint) does the bot complain. The validation should happen the moment the phone is extracted.

**Current behavior:** `finish_plan` tool checks presence (`!plan.contact_name || !plan.contact_email || !plan.contact_phone`) but does not validate format. `AgentService.applyExtraction` merges contact fields without validation.

**Files to change:**
- `src/runtime/agent-service.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`

**Changes:**

### Step 1 — Add deterministic runtime validator

In `src/runtime/agent-service.ts`, add a private method:
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

### Step 2 — Thread validation errors through `applyExtraction`

Change the return type of `applyExtraction`:
```ts
private applyExtraction(
  plan: PlanSnapshot,
  extraction: ExtractionResult,
  extractionNode: DecisionNode,
  userMessage: string,
): { plan: PlanSnapshot; validationError: string | null } {
  // ... existing logic up to line 849 ...
  const validation = this.validateContactFields(candidate);
  return {
    plan: candidate,
    validationError: validation.valid ? null : validation.reason,
  };
}
```

### Step 3 — Consume validation error in `handleTurn`

In `handleTurn`, around line 206-213, update:
```ts
const applyExtractionStartedAt = Date.now();
const extractionNode = this.resolveExtractionNode(workingPlan, extraction);
const { plan: mergedPlan, validationError } = this.applyExtraction(
  workingPlan,
  extraction,
  extractionNode,
  inbound.text,
);
if (validationError) {
  errorMessage = validationError;
}
timingMs.apply_extraction += Date.now() - applyExtractionStartedAt;
```

The `errorMessage` is already passed into `composeReply` as `errorMessage`, so the model will see it and can ask again.

### Step 4 — Update extractor guidance

Append to `prompts/extractors/field_definitions.txt`:
```
- contactPhone: número de teléfono del usuario. Debe tener al menos 6 dígitos numéricos. Si el usuario envía menos, indica que no es válido.
- contactEmail: dirección de correo. Debe contener @. Si no lo contiene, indica que no es válido.
```

### Step 5 — Update close-flow response contract

Append to `prompts/nodes/crear_lead_cerrar/response_contract.txt`:
```
- si el teléfono tiene menos de 6 dígitos o el email no parece válido, recházalo inmediatamente, explica el problema y pide el dato de nuevo antes de continuar.
```

**Open question:** Should we tighten the Zod extraction schema to `z.string().min(6).nullable()` for phone? **No.** Keep extraction lenient so the bot can ask again gracefully. Runtime validation is the correct layer for user-facing rejection.

**Verification:**
1. Start a close flow.
2. Send `carolina, cavilamalaga@gmail.com, 967`.
3. Verify the bot **immediately** replies rejecting the phone and asking for a complete number, **before** any confirmation or finish_plan attempt.

---

## 3.2 Image 13 — Partial contact update should overwrite without re-asking for confirmation

**Problem:** After providing a bad phone, the user sends a corrected phone (`954779071`) in a standalone message. The bot replies: "Todavía no se pudo enviar: el sistema sigue teniendo registrado el teléfono anterior." It then asks the user to resubmit the phone **plus** a confirmation sentence.

**Root cause hypothesis:** The extractor sees a standalone number like "954779071" and does **not** recognize it as a `contactPhone` update. The extractor prompt says "null si no se menciona en este turno". A standalone number may not be classified as a contact field.

**Files to change:**
- `prompts/extractors/field_definitions.txt`
- `src/runtime/agent-service.ts`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`

**Changes:**

### Step 1 — Teach extractor to recognize standalone phone corrections

Update `prompts/extractors/field_definitions.txt`:
```
- contactPhone: número de teléfono del usuario. Si el usuario envía solo un número de teléfono en un turno donde ya estamos pidiendo contacto, trátalo como contactPhone aunque no haya nombre ni email.
- contactName: nombre completo. Si el usuario no lo menciona pero sí actualiza otro dato de contacto, mantén el nombre anterior.
- contactEmail: email. Si el usuario no lo menciona pero sí actualiza otro dato de contacto, mantén el email anterior.
```

### Step 2 — Add deterministic phone fallback in runtime

In `src/runtime/agent-service.ts`, add:
```ts
private inferContactPhoneFromMessage(text: string): string | null {
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

Update `applyExtraction` (around line 844):
```ts
contact_phone: guardedExtraction.contactPhone
  ?? this.inferContactPhoneFromMessage(userMessage)
  ?? plan.contact_phone,
```

This ensures standalone Peruvian phone numbers are captured even when the extractor misses them.

### Step 3 — Update close-flow prompt to accept partial updates

Append to `prompts/nodes/crear_lead_cerrar/response_contract.txt`:
```
- si el usuario envía solo un dato de contacto para corregirlo (por ejemplo, solo el teléfono), acepta la corrección sin pedir nombre y email de nuevo;
```

**Open question:** Do we need similar fallback for email? A standalone email is easier for the extractor to recognize (contains `@`). We can add it if needed, but phone is the reported pain point.

**Verification:**
1. Start a close flow.
2. Provide invalid phone `967`.
3. Bot rejects it immediately (Batch 3.1).
4. Send standalone correction: `954779071`.
5. Verify the bot accepts the corrected phone, keeps the previously provided name/email, and proceeds to confirmation without asking for name/email again.

---

## Files changed in this batch

- `src/runtime/agent-service.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
