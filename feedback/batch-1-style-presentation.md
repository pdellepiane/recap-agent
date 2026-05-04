# Batch 1 — Stylistic & Presentation Fixes

> **Images:** 1, 2, 6  
> **Risk:** Zero. Prompt-only changes.  
> **Goal:** Fix formatting, Markdown leaks, and terminology in model responses.

---

## 1.1 Image 1 — Welcome-message bullet formatting

**Problem:** Bullets start with lowercase, end with commas, no final period.  
**Current behavior:** The welcome message in `contacto_inicial` outputs list items like:
```
- qué tipo de evento es,
- en qué ubicación será,
- qué proveedor quieres resolver primero,
```

**Files to change:**
- `prompts/shared/response_formatting.txt` *(new file)*
- `src/runtime/prompt-manifest.ts`
- `prompts/nodes/contacto_inicial/response_contract.txt`

**Changes:**

Create `prompts/shared/response_formatting.txt`:
```
Reglas de formato para todas las respuestas:
- Cuando uses viñetas o listas numeradas, la primera letra de cada ítem debe ser mayúscula.
- No uses coma al final de un ítem de lista; cada ítem debe terminar con punto final.
- Cuando escribas una pregunta dentro de una lista, la pregunta también debe terminar con punto (no con signo de interrogación seguido de coma).
```

Add it to the shared prompt manifest in `src/runtime/prompt-manifest.ts`:
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

Update `prompts/nodes/contacto_inicial/response_contract.txt`, append to the end:
```
- seguir las reglas de formato de viñetas (mayúscula inicial, punto final, sin coma al cierre).
```

**Verification:** Start a fresh conversation in the terminal client. The welcome bullets must start with capital letters, end with periods, and have no trailing commas.

---

## 1.2 Image 2 — Remove raw Markdown asterisks, replace "refinar"

**Problem:** Raw `**` Markdown syntax is visible in WhatsApp/webchat because the channel does not render it. The word "refinar" is confusing to users.  
**Affected prompts:** `recomendar`, `refinar_criterios`, `common_anti_patterns`, `output_style`.

**Files to change:**
- `prompts/shared/output_style.txt`
- `prompts/shared/common_anti_patterns.txt`
- `prompts/nodes/recomendar/response_contract.txt`
- `prompts/nodes/refinar_criterios/system.txt`

**Changes:**

Append to `prompts/shared/output_style.txt`:
```
- No uses sintaxis Markdown (asteriscos dobles **, guiones bajos _, backticks `) en las respuestas; el canal de WhatsApp no las renderiza como negrita o cursiva.
- Para destacar títulos de proveedores, escríbelos en mayúsculas iniciales o entre comillas; no uses asteriscos.
```

Append to `prompts/shared/common_anti_patterns.txt`:
```
- no uses la palabra "refinar"; usa "afinar" o "ajustar" en su lugar.
```

In `prompts/nodes/recomendar/response_contract.txt`, replace:
```
- cerrar con una siguiente acción acotada: elegir uno, refinar esta necesidad o pasar a otra necesidad del evento.
```
With:
```
- cerrar con una siguiente acción acotada: elegir uno, ajustar esta necesidad o pasar a otra necesidad del evento.
```

In `prompts/nodes/refinar_criterios/system.txt`, replace the title in line 1:
```
Objetivo del nodo:
- ajustar criterios de la necesidad activa sin reiniciar la entrevista ni perder lo ya aprendido del plan del evento.
```

**Verification:** Trigger a recommendation turn. Verify no `**` characters appear in the terminal output. Verify the model says "ajustar" instead of "refinar".

---

## 1.3 Image 6 — Ficha link placement

**Problem:** "Ficha: https://…" is inline with the provider description, breaking readability.  
**Current instruction:** The prompt only says "incluir el enlace a la ficha… cuando esté disponible", with no placement rule.

**Files to change:**
- `prompts/nodes/recomendar/response_contract.txt`

**Changes:**

Update line 5 in `prompts/nodes/recomendar/response_contract.txt`:
```
- incluir el enlace a la ficha de Sin Envolturas de cada proveedor cuando esté disponible; coloca la palabra "Ficha:" y el enlace en una línea aparte, al final de la tarjeta del proveedor;
```

**Open question:** The actual recommendation text is composed by the LLM from the prompt context, not from `summarizeRecommendedProviders`. The prompt instruction is therefore the correct fix point. No runtime code changes are needed.

**Verification:** Check that model-generated recommendations place "Ficha:" on its own line after the provider description.

---

## Files changed in this batch

- `prompts/shared/output_style.txt`
- `prompts/shared/common_anti_patterns.txt`
- `prompts/shared/response_formatting.txt` *(new)*
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/recomendar/response_contract.txt`
- `prompts/nodes/refinar_criterios/system.txt`
- `src/runtime/prompt-manifest.ts`
