import { describe, expect, it } from 'vitest';

import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';

describe('close delivery does not append runtime prose', () => {
  it('preserves model paragraphs without a future-tense footer or confirmation', () => {
    const text = new WhatsAppMessageRenderer().render({
      message: {
        type: 'generic',
        paragraphs_es: ['El resultado confirmado corresponde al 18 de octubre de 2026.'],
      },
      providerResults: [],
    });
    expect(text).toBe('El resultado confirmado corresponde al 18 de octubre de 2026.');
    expect(text).not.toMatch(/Se enviar[áa]n solicitudes para/iu);
    expect(text).not.toContain('¿Confirmas');
  });
});
