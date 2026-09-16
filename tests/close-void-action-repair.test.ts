import { describe, expect, it } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';

import { actionIntentValues } from '../src/core/plan';
import {
  closeActionSchema,
  closeActionWireSchema,
  repairVoidCloseAction,
  type CloseAction,
} from '../src/runtime/close-flow-schemas';
import { createDynamicExtractionSchema } from '../src/runtime/extraction-schemas';
import { assertOpenAiStructuredSchemaCompatible } from '../src/runtime/openai-structured-schema';

describe('shared close-flow schema repair (token_seeded_close_flow 500)', () => {
  it('reproduces the live 500 cause: clarify without reason fails schema validation', () => {
    const parsed = closeActionSchema.safeParse({ type: 'clarify', category: null, reason: null });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected the void clarify to fail validation.');
    expect(parsed.error.issues[0]?.path).toEqual(['reason']);
  });

  it('accepts incomplete wire fields before the strict domain boundary', () => {
    const wire = closeActionWireSchema.parse({ type: 'clarify', category: null, reason: null });
    expect(repairVoidCloseAction(wire)).toBeNull();
    expect(closeActionSchema.safeParse(wire).success).toBe(false);
  });

  it('normalizes a void clarify to null instead of poisoning output validation', () => {
    expect(repairVoidCloseAction({ type: 'clarify', category: null, reason: null })).toBeNull();
    expect(repairVoidCloseAction(undefined)).toBeNull();
  });

  it('normalizes defer_need without category to null', () => {
    expect(repairVoidCloseAction({ type: 'defer_need', category: null, reason: null })).toBeNull();
  });

  it('passes fully specified actions through untouched', () => {
    const clarify = { type: 'clarify' as const, category: null, reason: 'Falta el teléfono de contacto.' };
    expect(repairVoidCloseAction(clarify)).toBe(clarify);
    const proceed = { type: 'proceed_confirmed' as const, category: null, reason: null };
    expect(repairVoidCloseAction(proceed)).toBe(proceed);
  });

  it('proves the installed SDK parser accepts the void wire shape before normalization', () => {
    const schema = createDynamicExtractionSchema({
      allowedActionIntents: actionIntentValues,
      capabilities: {
        information: false,
        rsvp: false,
        providerPlanning: false,
        providerOperations: false,
        providerSelection: false,
        providerInspection: false,
        contact: false,
        close: true,
        pause: false,
      },
    });
    // The exact boundary the runtime hands to the Agents SDK.
    assertOpenAiStructuredSchemaCompatible(schema, 'plan_extractor');
    const format = zodTextFormat(schema, 'plan_extractor');
    expect(format.type).toBe('json_schema');
    // The closeAction field installed at that boundary accepts a void
    // clarify, so an incomplete non-effect crosses the SDK parser instead
    // of aborting the turn before post-SDK normalization runs.
    const shape = schema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean; data?: unknown } }>;
    const closeField = shape['closeAction'];
    expect(closeField).toBeDefined();
    const wire = closeField.safeParse({ type: 'clarify', category: null, reason: null });
    expect(wire.success).toBe(true);
    if (!wire.success) throw new Error('Expected the SDK wire schema to accept a void clarify.');
    const wireCloseAction = wire.data as CloseAction | null;
    expect(closeActionSchema.safeParse(wireCloseAction).success).toBe(false);
    expect(repairVoidCloseAction(wireCloseAction)).toBeNull();
    // Malformed enums and types still fail at the same boundary.
    expect(closeField.safeParse({ type: 'invented', category: null, reason: null }).success).toBe(false);
  });
});
