import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('confirmation prompt economy', () => {
  it('removes conflicting generic confirmation instructions without growing prompts', () => {
    const questions = readFileSync('prompts/shared/question_strategy.txt', 'utf8');
    const close = readFileSync('prompts/nodes/crear_lead_cerrar/system.txt', 'utf8');
    expect(Buffer.byteLength(questions)).toBeLessThan(1278);
    expect(Buffer.byteLength(close)).toBeLessThan(2723);
    expect(questions).not.toContain('vuelve a pedir una sola cosa por turno');
    expect(close).not.toContain('eso equivale a confirmación para despachar');
    expect(close).toContain('nunca cerrar el plan sin que el usuario haya confirmado explícitamente');
  });
});
