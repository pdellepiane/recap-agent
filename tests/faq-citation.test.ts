import { describe, expect, it } from 'vitest';

import type { ComposeReplyResult } from '../src/runtime/contracts';
import type { StructuredMessage } from '../src/runtime/structured-message';
import { WebChatMessageRenderer, WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { buildExpectedDeliveredText } from '../src/audit/expected-render';
import {
  applyDocumentedTransportTransforms,
  assertModelOrigin,
  buildModelOriginReceipt,
  ModelOriginViolationError,
  resolveFaqCitationUrl,
} from '../src/runtime/model-composition';
import type { InformationTaskResult } from '../src/core/information';

const CITATION = 'https://sinenvolturas.tawk.help/article/cuanto-cuesta';

function faqResult(citationUrl?: string | null): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'faq',
    status: 'completed',
    evidence: [],
    ...(citationUrl === undefined ? {} : { citationUrl }),
  };
}

function genericMessage(paragraphs: string[]): StructuredMessage {
  return { type: 'generic', paragraphs_es: paragraphs };
}

function replyWith(message: StructuredMessage): ComposeReplyResult {
  return { text: '', structuredMessage: message };
}

describe('resolveFaqCitationUrl', () => {
  it('resolves the first completed FAQ citation and null otherwise', () => {
    const results: InformationTaskResult[] = [
      faqResult(null),
      faqResult(CITATION),
    ];
    expect(resolveFaqCitationUrl(results)).toBe(CITATION);
    expect(resolveFaqCitationUrl([faqResult(null)])).toBeNull();
    expect(resolveFaqCitationUrl([faqResult('')])).toBeNull();
    expect(resolveFaqCitationUrl(undefined)).toBeNull();
    expect(
      resolveFaqCitationUrl([
        {
          requestId: 'information-9',
          kind: 'faq',
          status: 'failed',
          retryable: false,
          failureKind: 'not_found',
          message: 'sin resultados',
        } as InformationTaskResult,
      ]),
    ).toBeNull();
  });
});

describe('citation footer rendering', () => {
  const channels = [new WhatsAppMessageRenderer(), new WebChatMessageRenderer()];

  it.each([0, 1])('appends the footer on generic replies (renderer %d)', (index) => {
    const renderer = channels[index];
    const text = renderer.render({
      message: genericMessage(['La comisión depende del medio de pago.']),
      providerResults: [],
      citationUrl: CITATION,
    });
    expect(text).toBe(
      `La comisión depende del medio de pago.\n\nFuente: ${CITATION}`,
    );
  });

  it('omits the footer when the model cited the URL or no citation exists', () => {
    const renderer = new WhatsAppMessageRenderer();
    const cited = renderer.render({
      message: genericMessage([`Revisa ${CITATION} para más detalles.`]),
      providerResults: [],
      citationUrl: CITATION,
    });
    expect(cited).toBe(`Revisa ${CITATION} para más detalles.`);
    const uncited = renderer.render({
      message: genericMessage(['Respuesta sin fuente.']),
      providerResults: [],
    });
    expect(uncited).toBe('Respuesta sin fuente.');
  });

  it('ignores citations on non-generic messages', () => {
    const renderer = new WhatsAppMessageRenderer();
    const text = renderer.render({
      message: { type: 'welcome', greeting_es: 'Hola.', scope_es: 'Ayudo.', ask_es: '¿Qué necesitas?' },
      providerResults: [],
      citationUrl: CITATION,
    });
    expect(text).not.toContain('Fuente:');
  });

  it.each([0, 1])('delivery and reference renders agree exactly (renderer %d)', (index) => {
    const renderer = channels[index];
    const channel = index === 0 ? 'whatsapp' : 'webchat';
    const cases: Array<{ paragraphs: string[]; citationUrl?: string | null }> = [
      { paragraphs: ['La comisión depende del medio de pago.'], citationUrl: CITATION },
      { paragraphs: [`Revisa ${CITATION} para más detalles.`], citationUrl: CITATION },
      { paragraphs: ['Respuesta sin fuente.'] },
      { paragraphs: ['Respuesta sin fuente.'], citationUrl: null },
    ];
    for (const entry of cases) {
      const message = genericMessage(entry.paragraphs);
      const delivered = applyDocumentedTransportTransforms(renderer.render({
        message,
        providerResults: [],
        citationUrl: entry.citationUrl,
      }));
      const expected = buildExpectedDeliveredText({
        message,
        providerFields: [],
        channel,
        citationUrl: entry.citationUrl,
      });
      expect(delivered).toBe(expected);
    }
  });
});

describe('citation origin verification', () => {
  it('verifies the cited delivery and fails closed when the footer is missing', () => {
    const message = genericMessage(['La comisión depende del medio de pago.']);
    const reply = replyWith(message);
    const origin = buildModelOriginReceipt(reply, 'bundle-faq', [], CITATION);
    expect(origin?.citationUrl).toBe(CITATION);
    const delivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({
        message,
        providerResults: [],
        citationUrl: origin?.citationUrl,
      }),
    );
    expect(() =>
      assertModelOrigin({ origin, reply, deliveredText: delivered, channel: 'whatsapp' }),
    ).not.toThrow();
    expect(() =>
      assertModelOrigin({
        origin,
        reply,
        deliveredText: 'La comisión depende del medio de pago.',
        channel: 'whatsapp',
      }),
    ).toThrow(ModelOriginViolationError);
  });
});
