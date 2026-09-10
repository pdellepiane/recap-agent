import { describe, expect, it } from 'vitest';

import { applyCloseSubmissionToText } from '../src/runtime/close-submission-summary';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';

describe('lean-conversation close footer appears once on confirmation, never on final sent turn', () => {
  it('confirmation question keeps the future-tense footer once', () => {
    const renderer = new WhatsAppMessageRenderer();
    const text = renderer.render({
      message: {
        type: 'close_confirmation',
        summary_es: 'Ya tengo tu nombre, correo electronico y telefono. Confirma el envio?',
        selected_providers_es: ['Fotografia y video: Carlos Schult'],
        unselected_needs_es: [],
      },
      providerResults: [],
    });
    expect(text.match(/Se enviar[áa]n solicitudes para/giu)).toHaveLength(1);
  });

  it('structured final sent state renders no future-tense footer', () => {
    const renderer = new WhatsAppMessageRenderer();
    const text = renderer.render({
      message: {
        type: 'close_confirmation',
        summary_es: 'La solicitud de cotización fue enviada a Carlos Schult para tu evento del 18 de octubre de 2026. Los proveedores se pondrán en contacto contigo.',
        selected_providers_es: [],
        unselected_needs_es: [],
      },
      providerResults: [],
    });
    expect(text).toContain('fue enviada');
    expect(text).not.toMatch(/Se enviar[áa]n solicitudes para/iu);
  });

  it('final sent summary strips the legacy future-tense footer to past tense once', () => {
    const text = applyCloseSubmissionToText(
      'Ya tengo tus datos. ¿Confirmas que envíe la solicitud de cotización a Carlos Schult?\n\nSe enviarán solicitudes para:\n\n- Fotografía y video: Carlos Schult.',
      'La solicitud de cotización fue enviada a Carlos Schult para tu evento del 18 de octubre de 2026. Los proveedores se pondrán en contacto contigo.',
    );
    expect(text).toContain('fue enviada');
    expect(text.match(/fue enviada|fueron enviadas/giu)).toHaveLength(1);
    expect(text).not.toMatch(/Se enviar[áa]n solicitudes para/iu);
  });
});
