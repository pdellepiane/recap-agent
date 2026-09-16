import { describe, expect, it } from 'vitest';

import {
  closeActionSchema,
  repairVoidCloseAction,
} from '../src/runtime/close-flow-schemas';

describe('shared close-flow schema repair (token_seeded_close_flow 500)', () => {
  it('reproduces the live 500 cause: clarify without reason fails schema validation', () => {
    const parsed = closeActionSchema.safeParse({ type: 'clarify', category: null, reason: null });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected the void clarify to fail validation.');
    expect(parsed.error.issues[0]?.path).toEqual(['reason']);
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
});
