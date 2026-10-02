import { describe, expect, it } from 'vitest';

import type { ComposeReplyResult } from '../src/runtime/contracts';
import type { StructuredMessage } from '../src/runtime/structured-message';
import type { ProviderSummary } from '../src/core/provider';
import { WebChatMessageRenderer, WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { buildExpectedDeliveredText, buildReferenceRender, ReferenceRenderError } from '../src/audit/expected-render';
import { hashPrivateOutput } from '../src/audit/output-origin';
import {
  applyDocumentedTransportTransforms,
  assertModelOrigin,
  buildModelOriginReceipt,
  canonicalModelContent,
  deliveredContainsModelSpans,
  hashCanonicalModelContent,
  modelProviderIdsOf,
  modelSpansOf,
  snapshotProviderFields,
  ModelOriginViolationError,
} from '../src/runtime/model-composition';

const WELCOME_SPANS = {
  greeting_es: 'Hola, soy el faro verde de prueba.',
  scope_es: 'Te ayudo con tu evento y el ancla azul.',
  ask_es: '¿Qué necesitas hoy?',
};

const RECOMMENDATION_SPANS = {
  intro_es: 'Encontré el puente amarillo de siete tablones.',
  match_label_es: 'La mejor coincidencia para tu fecha.',
  rationale_es: 'Coincide con tu presupuesto y fecha.',
  caveat_es: 'Requiere reserva anticipada.',
};

function replyWith(message: StructuredMessage): ComposeReplyResult {
  return { text: '', structuredMessage: message };
}

function providerResult(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: 7,
    title: 'Casa Faro',
    slug: null,
    category: 'Locales',
    location: 'Lima',
    priceLevel: 'mid',
    rating: '4.8',
    reason: 'Motivo mecánico.',
    detailUrl: null,
    websiteUrl: null,
    minPrice: null,
    maxPrice: null,
    promoBadge: null,
    promoSummary: null,
    descriptionSnippet: null,
    serviceHighlights: [],
    termsHighlights: [],
    providerNotes: [],
    eventTypes: [],
    description: null,
    fitScore: null,
    fitWarnings: [],
    fitTags: [],
    retrievalScore: 0.9,
    retrievalSource: 'hybrid',
    ...overrides,
  };
}

function recommendationMessage(): StructuredMessage {
  return {
    type: 'recommendation',
    intro_es: RECOMMENDATION_SPANS.intro_es,
    providers: [{
      provider_id: 7,
      match_label_es: null,
      rationale_es: RECOMMENDATION_SPANS.rationale_es,
      caveat_es: RECOMMENDATION_SPANS.caveat_es,
    }],
  };
}

function labeledRecommendationMessage(): StructuredMessage {
  return {
    type: 'recommendation',
    intro_es: RECOMMENDATION_SPANS.intro_es,
    providers: [{
      provider_id: 7,
      match_label_es: RECOMMENDATION_SPANS.match_label_es,
      rationale_es: RECOMMENDATION_SPANS.rationale_es,
      caveat_es: RECOMMENDATION_SPANS.caveat_es,
    }],
  };
}

describe('structured-output origin spans', () => {
  it('traces model spans in render order and refuses receipts for empty content', () => {
    const spans = modelSpansOf({ type: 'welcome', ...WELCOME_SPANS });
    expect(spans).toEqual([
      WELCOME_SPANS.greeting_es,
      WELCOME_SPANS.scope_es,
      WELCOME_SPANS.ask_es,
    ]);
    const receipt = buildModelOriginReceipt(replyWith({ type: 'welcome', ...WELCOME_SPANS }), 'bundle-w');
    expect(receipt?.modelParagraphs).toEqual(spans);
    expect(modelSpansOf(recommendationMessage())).toEqual([
      RECOMMENDATION_SPANS.intro_es,
      RECOMMENDATION_SPANS.rationale_es,
      RECOMMENDATION_SPANS.caveat_es,
    ]);
    expect(modelSpansOf(labeledRecommendationMessage())).toEqual([
      RECOMMENDATION_SPANS.intro_es,
      RECOMMENDATION_SPANS.match_label_es,
      RECOMMENDATION_SPANS.rationale_es,
      RECOMMENDATION_SPANS.caveat_es,
    ]);
    const multi = modelSpansOf({
      type: 'multi_need_recommendation',
      intro_es: 'Intro multi.',
      needs: [{
        category: 'Locales',
        summary_es: 'Resumen del frente.',
        providers: [{
          provider_id: 9,
          match_label_es: 'Etiqueta del frente.',
          rationale_es: 'Ideal por ubicación.',
          caveat_es: null,
        }],
      }],
      next_step_es: 'Dime cuál prefieres.',
    });
    expect(multi).toEqual([
      'Intro multi.',
      'Resumen del frente.',
      'Etiqueta del frente.',
      'Ideal por ubicación.',
      'Dime cuál prefieres.',
    ]);
    expect(modelSpansOf({ type: 'welcome' })).toBeNull();
    expect(modelSpansOf(undefined)).toBeNull();
    expect(buildModelOriginReceipt(replyWith({ type: 'welcome' }), 'bundle-w')).toBeNull();
    expect(buildModelOriginReceipt({ text: 'legado' }, 'bundle-x')).toBeNull();
  });

  it('snapshots raw model output plus authorized provider fields with distinct hashes', () => {
    const message = recommendationMessage();
    const providers = [providerResult()];
    const receipt = buildModelOriginReceipt(replyWith(message), 'bundle-r', providers);
    expect(receipt?.modelMessage).toEqual(message);
    expect(receipt?.modelMessage).not.toBe(message);
    expect(receipt?.providerFields).toEqual(snapshotProviderFields(providers));
    const canonical = canonicalModelContent(message);
    expect(canonical).not.toBeNull();
    expect(receipt?.modelContentSha256).toBe(hashCanonicalModelContent(canonical as string));
    expect(modelProviderIdsOf(message)).toEqual([7]);
  });

  it('accepts mechanically rendered delivery that preserves model spans', () => {
    const welcome: StructuredMessage = { type: 'welcome', ...WELCOME_SPANS };
    const welcomeReply = replyWith(welcome);
    const welcomeOrigin = buildModelOriginReceipt(welcomeReply, 'bundle-w');
    const welcomeDelivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({ message: welcome, providerResults: [] }),
    );
    expect(deliveredContainsModelSpans({ spans: welcomeOrigin?.modelParagraphs ?? [], deliveredText: welcomeDelivered })).toBe(true);
    expect(() => assertModelOrigin({ origin: welcomeOrigin, reply: welcomeReply, deliveredText: welcomeDelivered })).not.toThrow();

    for (const message of [recommendationMessage(), labeledRecommendationMessage()]) {
      const providers = [providerResult()];
      const reply = replyWith(message);
      const origin = buildModelOriginReceipt(reply, 'bundle-r', providers);
      const delivered = applyDocumentedTransportTransforms(
        new WhatsAppMessageRenderer().render({ message, providerResults: providers }),
      );
      expect(delivered).toContain(RECOMMENDATION_SPANS.intro_es);
      expect(() => assertModelOrigin({
        origin,
        reply,
        deliveredText: delivered,
        providerResults: providers,
      })).not.toThrow();
    }

    const multi: StructuredMessage = {
      type: 'multi_need_recommendation',
      intro_es: 'Intro multi.',
      needs: [{
        category: 'Locales',
        summary_es: 'Resumen del frente.',
        providers: [{
          provider_id: 9,
          match_label_es: null,
          rationale_es: 'Ideal por ubicación.',
          caveat_es: null,
        }],
      }],
      next_step_es: 'Dime cuál prefieres.',
    };
    const multiProviders = [providerResult({ id: 9, title: 'Salón Norte' })];
    const multiReply = replyWith(multi);
    const multiOrigin = buildModelOriginReceipt(multiReply, 'bundle-m', multiProviders);
    const multiDelivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({ message: multi, providerResults: multiProviders }),
    );
    expect(() => assertModelOrigin({
      origin: multiOrigin,
      reply: multiReply,
      deliveredText: multiDelivered,
      providerResults: multiProviders,
    })).not.toThrow();
  });

  it('fails when post-generation code tampers with spans, text, labels, or provider ids', () => {
    const welcomeReply = replyWith({ type: 'welcome', ...WELCOME_SPANS });
    const welcomeOrigin = buildModelOriginReceipt(welcomeReply, 'bundle-w');
    const dropped = `${WELCOME_SPANS.greeting_es}\n\n${WELCOME_SPANS.ask_es}`;
    expect(() => assertModelOrigin({ origin: welcomeOrigin, reply: welcomeReply, deliveredText: dropped })).toThrow(
      ModelOriginViolationError,
    );
    const replaced = {
      ...welcomeReply,
      structuredMessage: {
        type: 'welcome' as const,
        greeting_es: 'Texto fijo de respaldo.',
        scope_es: WELCOME_SPANS.scope_es,
        ask_es: WELCOME_SPANS.ask_es,
      },
    };
    expect(() => assertModelOrigin({
      origin: welcomeOrigin,
      reply: replaced,
      deliveredText: 'Texto fijo de respaldo.',
    })).toThrow(ModelOriginViolationError);

    const message = recommendationMessage();
    const providers = [providerResult()];
    const reply = replyWith(message);
    const origin = buildModelOriginReceipt(reply, 'bundle-r', providers);
    const pristine = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({ message, providerResults: providers }),
    );
    const injected = `${pristine}\n\nOferta especial: llama ahora mismo.`;
    expect(deliveredContainsModelSpans({
      spans: origin?.modelParagraphs ?? [],
      deliveredText: injected,
    })).toBe(true);
    expect(() => assertModelOrigin({
      origin,
      reply,
      deliveredText: injected,
      providerResults: providers,
    })).toThrow(ModelOriginViolationError);

    const labeledOrigin = buildModelOriginReceipt(replyWith(labeledRecommendationMessage()), 'bundle-r', providers);
    const mutated = replyWith({
      type: 'recommendation',
      intro_es: RECOMMENDATION_SPANS.intro_es,
      providers: [{
        provider_id: 7,
        match_label_es: 'Etiqueta reescrita por codigo.',
        rationale_es: RECOMMENDATION_SPANS.rationale_es,
        caveat_es: RECOMMENDATION_SPANS.caveat_es,
      }],
    });
    const mutatedDelivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({
        message: mutated.structuredMessage as StructuredMessage,
        providerResults: providers,
      }),
    );
    expect(() => assertModelOrigin({
      origin: labeledOrigin,
      reply: mutated,
      deliveredText: mutatedDelivered,
      providerResults: providers,
    })).toThrow(ModelOriginViolationError);

    const swapped = replyWith({
      type: 'recommendation',
      intro_es: RECOMMENDATION_SPANS.intro_es,
      providers: [{
        provider_id: 77,
        match_label_es: RECOMMENDATION_SPANS.match_label_es,
        rationale_es: RECOMMENDATION_SPANS.rationale_es,
        caveat_es: RECOMMENDATION_SPANS.caveat_es,
      }],
    });
    const swappedProviders = [providerResult({ id: 77, title: 'Otro local' })];
    const swappedDelivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({
        message: swapped.structuredMessage as StructuredMessage,
        providerResults: swappedProviders,
      }),
    );
    expect(() => assertModelOrigin({
      origin,
      reply: swapped,
      deliveredText: swappedDelivered,
      providerResults: swappedProviders,
    })).toThrow(ModelOriginViolationError);
    expect(() => assertModelOrigin({
      origin,
      reply,
      deliveredText: applyDocumentedTransportTransforms(
        new WhatsAppMessageRenderer().render({ message, providerResults: providers }),
      ),
      providerResults: [],
    })).toThrow(ModelOriginViolationError);
  });

  it('fails closed on unknown or stale transformation versions and tampered receipts', () => {
    const message = recommendationMessage();
    const providers = [providerResult()];
    const reply = replyWith(message);
    const origin = buildModelOriginReceipt(reply, 'bundle-r', providers);
    const delivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({ message, providerResults: providers }),
    );
    expect(origin?.transformationVersion).toBe('transport-v2');
    for (const transformationVersion of ['transport-v9', 'transport-v1'] as const) {
      expect(() => assertModelOrigin({
        origin: origin === null ? origin : { ...origin, transformationVersion: transformationVersion as never },
        reply,
        deliveredText: delivered,
        providerResults: providers,
      })).toThrow(ModelOriginViolationError);
    }
    expect(() => assertModelOrigin({
      origin: origin === null ? origin : {
        ...origin,
        modelMessage: {
          type: 'recommendation' as const,
          intro_es: 'Texto reescrito en el recibo.',
          providers: [],
        },
      },
      reply,
      deliveredText: delivered,
      providerResults: providers,
    })).toThrow(ModelOriginViolationError);
  });

  it('fails when the model references a provider with no snapshot or delivers blank output', () => {
    const message = recommendationMessage();
    const reply = replyWith(message);
    const origin = buildModelOriginReceipt(reply, 'bundle-r', []);
    const delivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({ message, providerResults: [providerResult()] }),
    );
    expect(() => buildReferenceRender({ message, providerFields: [], channel: 'whatsapp' })).toThrow(
      ReferenceRenderError,
    );
    expect(() => assertModelOrigin({ origin, reply, deliveredText: delivered, providerResults: [providerResult()] })).toThrow(
      ModelOriginViolationError,
    );
    const generic: StructuredMessage = { type: 'generic', paragraphs_es: ['Texto real del modelo.'] };
    const genericReply = replyWith(generic);
    const genericOrigin = buildModelOriginReceipt(genericReply, 'bundle-x', []);
    expect(() => assertModelOrigin({ origin: genericOrigin, reply: genericReply, deliveredText: '' })).toThrow(
      ModelOriginViolationError,
    );
  });

  it('keeps model-content and expected-render hashes distinct', () => {
    const message = recommendationMessage();
    const providers = [providerResult()];
    const reply = replyWith(message);
    const origin = buildModelOriginReceipt(reply, 'bundle-r', providers);
    const expected = buildExpectedDeliveredText({
      message,
      providerFields: origin?.providerFields ?? [],
      channel: 'whatsapp',
    });
    expect(origin?.modelContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashPrivateOutput(expected)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashPrivateOutput(expected)).not.toBe(origin?.modelContentSha256);
  });

});

describe('reference serializer drift (S4)', () => {
  const genericMessage: StructuredMessage = {
    type: 'generic',
    paragraphs_es: ['Primer párrafo del modelo.', 'Segundo párrafo del modelo.'],
  };
  const welcomeMessage: StructuredMessage = { type: 'welcome', ...WELCOME_SPANS };
  const recommendation = recommendationMessage();
  const multiNeed: StructuredMessage = {
    type: 'multi_need_recommendation',
    intro_es: 'Intro multi.',
    needs: [{
      category: 'Locales',
      summary_es: 'Resumen del frente.',
      providers: [{
        provider_id: 9,
        match_label_es: null,
        rationale_es: 'Ideal por ubicación.',
        caveat_es: null,
      }],
    }],
    next_step_es: 'Dime cuál prefieres.',
  };

  it.each([
    ['generic', 'whatsapp', genericMessage, []],
    ['welcome', 'whatsapp', welcomeMessage, []],
    ['recommendation', 'whatsapp', recommendation, [providerResult()]],
    ['multi_need', 'whatsapp', multiNeed, [providerResult({ id: 9, title: 'Salón Norte' })]],
    ['generic', 'webchat', genericMessage, []],
    ['welcome', 'webchat', welcomeMessage, []],
    ['recommendation', 'webchat', recommendation, [providerResult()]],
    ['multi_need', 'webchat', multiNeed, [providerResult({ id: 9, title: 'Salón Norte' })]],
  ])('matches the delivery renderer for %s on %s', (_label, channel, message, providers) => {
    const channelName = channel as 'whatsapp' | 'webchat';
    const snapshot = snapshotProviderFields(providers);
    const expected = buildExpectedDeliveredText({
      message,
      providerFields: snapshot,
      channel: channelName,
    });
    const renderer = channelName === 'whatsapp'
      ? new WhatsAppMessageRenderer()
      : new WebChatMessageRenderer();
    const delivered = applyDocumentedTransportTransforms(
      renderer.render({
        message,
        providerResults: providers,
      }),
    );
    expect(expected).toBe(delivered);
  });

  it('separates channel formatting so whatsapp and webchat drift fails visibly', () => {
    const message = labeledRecommendationMessage();
    const providers = [providerResult()];
    const snapshot = snapshotProviderFields(providers);
    const whatsappExpected = buildExpectedDeliveredText({
      message,
      providerFields: snapshot,
      channel: 'whatsapp',
    });
    const webchatExpected = buildExpectedDeliveredText({
      message,
      providerFields: snapshot,
      channel: 'webchat',
    });
    const whatsappDelivered = applyDocumentedTransportTransforms(
      new WhatsAppMessageRenderer().render({ message, providerResults: providers }),
    );
    const webchatDelivered = applyDocumentedTransportTransforms(
      new WebChatMessageRenderer().render({ message, providerResults: providers }),
    );
    expect(whatsappExpected).toBe(whatsappDelivered);
    expect(webchatExpected).toBe(webchatDelivered);
    expect(whatsappExpected).not.toBe(webchatExpected);
  });
});
