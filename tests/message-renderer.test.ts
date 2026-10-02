import { describe, expect, it } from 'vitest';

import { WebChatMessageRenderer, WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import {
  multiNeedRecommendationMessageSchema,
  type StructuredMessage,
} from '../src/runtime/structured-message';
import type { ProviderSummary } from '../src/core/provider';

const renderer = new WhatsAppMessageRenderer();

function createProvider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: 1,
    title: 'La Botanería',
    slug: 'la-botaneria',
    category: 'Catering',
    location: 'Lima, Perú',
    priceLevel: 'mid',
    rating: '4.5',
    reason: 'coincide con el plan',
    detailUrl: 'https://sinenvolturas.com/proveedores/la-botaneria',
    websiteUrl: null,
    minPrice: null,
    maxPrice: null,
    promoBadge: null,
    promoSummary: null,
    descriptionSnippet: 'Carta variada de comida y bebidas.',
    serviceHighlights: ['servicio de barra'],
    termsHighlights: [],
    ...overrides,
  };
}

describe('WhatsAppMessageRenderer', () => {
  describe('structured schemas', () => {
    it('validates multi-need recommendation payloads', () => {
      const parsed = multiNeedRecommendationMessageSchema.parse({
        type: 'multi_need_recommendation',
        intro_es: 'Encontré opciones para comparar.',
        needs: [
          {
            category: 'Catering',
            summary_es: 'Para catering.',
            providers: [
              {
                provider_id: 1,
                rationale_es: 'Encaja por estilo.',
                caveat_es: null,
              },
            ],
          },
        ],
        next_step_es: 'Podemos revisar frente por frente.',
      });

      expect(parsed.needs).toHaveLength(1);

      const multi = multiNeedRecommendationMessageSchema.parse({
        type: 'multi_need_recommendation',
        intro_es: 'Encontré opciones para comparar.',
        needs: [
          {
            category: 'Catering',
            summary_es: 'Para catering.',
            providers: [
              { provider_id: 1, match_label_es: 'sushi', rationale_es: 'Primera.', caveat_es: null },
              { provider_id: 2, match_label_es: 'torta', rationale_es: 'Segunda.', caveat_es: null },
            ],
          },
        ],
        next_step_es: 'Podemos revisar frente por frente.',
      });

      expect(multi.needs[0]?.providers).toHaveLength(2);

      expect(() =>
        multiNeedRecommendationMessageSchema.parse({
          type: 'multi_need_recommendation',
          intro_es: 'Encontré opciones para comparar.',
          needs: [],
          next_step_es: 'Podemos revisar frente por frente.',
        }),
      ).toThrow();
      expect(() =>
        multiNeedRecommendationMessageSchema.parse({
          type: 'multi_need_recommendation',
          intro_es: 'Encontré opciones para comparar.',
          needs: [
            {
              category: 'Catering',
              summary_es: 'Para catering.',
              providers: [
                {
                  provider_id: '1',
                  rationale_es: 'Encaja por estilo.',
                  caveat_es: null,
                },
              ],
            },
          ],
          next_step_es: 'Podemos revisar frente por frente.',
        }),
      ).toThrow();
    });

  });

  describe('welcome messages', () => {
    it('renders a brief greeting with optional scope and open question', () => {
      const full: StructuredMessage = {
        type: 'welcome',
        greeting_es: '¡Hola! Soy el asistente de Sin Envolturas.',
        scope_es:
          'Puedo ayudarte con tu evento o responder una consulta sobre Sin Envolturas.',
        ask_es: '¿Qué necesitas hoy?',
      };

      expect(renderer.render({ message: full, providerResults: [] })).toBe(
        '¡Hola! Soy el asistente de Sin Envolturas.\n\nPuedo ayudarte con tu evento o responder una consulta sobre Sin Envolturas.\n\n¿Qué necesitas hoy?',
      );

      const scopeless: StructuredMessage = {
        type: 'welcome',
        greeting_es: '¡Hola!',
        ask_es: '¿En qué te ayudo?',
      };

      expect(renderer.render({ message: scopeless, providerResults: [] })).toBe(
        '¡Hola!\n\n¿En qué te ayudo?',
      );
    });
  });

  describe('recommendation messages', () => {
    it('renders recommendation provider cards with deterministic formatting', () => {
      const card = renderer.render({
        message: {
          type: 'recommendation',
          intro_es: 'Encontré estas opciones para ti.',
          providers: [
            { provider_id: 1, rationale_es: 'Buena relación calidad-precio.', caveat_es: null },
          ],
        },
        providerResults: [createProvider()],
      });

      expect(card).toContain('1. La Botanería');
      expect(card).toContain('Buena relación calidad-precio.');
      expect(card).toContain('Ubicación: Lima, Perú.');
      expect(card).toContain('Precio: $$.');
      expect(card).toContain('Ficha: https://sinenvolturas.com/proveedores/la-botaneria');
      expect(card).not.toContain('Elige un proveedor');
      const fichaLine = card.split('\n').find((line) => line.includes('Ficha:'));
      expect(fichaLine?.trim()).toBe('Ficha: https://sinenvolturas.com/proveedores/la-botaneria');

      const caveat = renderer.render({
        message: {
          type: 'recommendation',
          intro_es: 'Opciones:',
          providers: [
            {
              provider_id: 1,
              rationale_es: 'Excelente servicio.',
              caveat_es: 'No incluye decoración.',
            },
          ],
        },
        providerResults: [createProvider()],
      });
      expect(caveat).toContain('Nota: No incluye decoración.');

      const promo = renderer.render({
        message: {
          type: 'recommendation',
          intro_es: 'Opciones:',
          providers: [
            { provider_id: 1, rationale_es: 'Con promo.', caveat_es: null },
          ],
        },
        providerResults: [createProvider({ promoBadge: '15% off' })],
      });
      expect(promo).toContain('Promo: 15% off.');

      const missing = renderer.render({
        message: {
          type: 'recommendation',
          intro_es: 'Opciones:',
          providers: [
            { provider_id: 999, rationale_es: 'No existe.', caveat_es: null },
          ],
        },
        providerResults: [],
      });
      expect(missing).toBe('Opciones:');

      const unlocated = renderer.render({
        message: {
          type: 'recommendation',
          intro_es: 'Opciones:',
          providers: [
            { provider_id: 1, rationale_es: 'Sin ubicación.', caveat_es: null },
          ],
        },
        providerResults: [createProvider({ location: null })],
      });
      expect(unlocated).toContain('Ubicación: Ubicación no especificada.');
    });
  });

  describe('multi_need_recommendation messages', () => {
    it('renders grouped needs and provider cards deterministically', () => {
      const providers = [
        createProvider({ id: 1, title: 'La Botanería', category: 'Catering' }),
        createProvider({
          id: 2,
          title: 'Foto Clara',
          category: 'Fotografía y video',
          detailUrl: 'https://sinenvolturas.com/proveedores/foto-clara',
        }),
      ];
      const message: StructuredMessage = {
        type: 'multi_need_recommendation',
        intro_es: 'Busqué proveedores que encajan con tu plan.',
        needs: [
          {
            category: 'Catering',
            summary_es: 'Opciones para comida.',
            providers: [
              {
                provider_id: 1,
                match_label_es: 'sushi',
                rationale_es: 'Encaja por propuesta gastronómica.',
                caveat_es: null,
              },
            ],
          },
          {
            category: 'Fotografía y video',
            summary_es: 'Opciones para foto.',
            providers: [
              {
                provider_id: 2,
                rationale_es: 'Encaja por estilo natural.',
                caveat_es: 'Confirmar cobertura de fiesta',
              },
            ],
          },
        ],
        next_step_es: 'Podemos revisar frente por frente.',
      };

      const result = renderer.render({ message, providerResults: providers });

      expect(result).toContain('Busqué proveedores que encajan con tu plan.');
      expect(result).toContain(
        'Servicio de comida\nOpciones para comida.\n1. La Botanería - sushi (Lima, Perú · $$)',
      );
      expect(result).toContain(
        'Fotografía y video\nOpciones para foto.\n1. Foto Clara (Lima, Perú · $$)',
      );
      expect(result).toContain('Limitación: Confirmar cobertura de fiesta.');
      expect(result).toContain('Podemos revisar frente por frente.');
      expect(result).not.toContain('Ubicación:');
      expect(result).not.toContain('Precio:');
    });

    it('uses WebChat channel formatting without WhatsApp ficha labels', () => {
      const webRenderer = new WebChatMessageRenderer();
      const message: StructuredMessage = {
        type: 'multi_need_recommendation',
        intro_es: 'Encontré opciones para comparar.',
        needs: [
          {
            category: 'Catering',
            summary_es: 'Para catering.',
            providers: [
              {
                provider_id: 1,
                rationale_es: 'Tiene una propuesta alineada.',
                caveat_es: null,
              },
            ],
          },
        ],
        next_step_es: 'Revisemos el primer frente.',
      };

      const result = webRenderer.render({
        message,
        providerResults: [createProvider()],
      });

      expect(result).toContain('1. La Botanería (Lima, Perú · $$)');
      expect(result).toContain('https://sinenvolturas.com/proveedores/la-botaneria');
      expect(result).not.toContain('Ficha:');
    });

    it('omits missing or miscategorized providers inside grouped needs', () => {
      const missing: StructuredMessage = {
        type: 'multi_need_recommendation',
        intro_es: 'Encontré opciones para comparar.',
        needs: [
          {
            category: 'Catering',
            summary_es: 'Para catering.',
            providers: [
              {
                provider_id: 999,
                rationale_es: 'No debe renderizarse.',
                caveat_es: null,
              },
            ],
          },
        ],
        next_step_es: 'Revisemos el primer frente.',
      };

      expect(renderer.render({ message: missing, providerResults: [] })).toBe(
        'Encontré opciones para comparar.\n\nRevisemos el primer frente.',
      );

      const mismatched: StructuredMessage = {
        type: 'multi_need_recommendation',
        intro_es: 'Encontré opciones para comparar.',
        needs: [
          {
            category: 'Locales',
            summary_es: 'Para el local.',
            providers: [
              {
                provider_id: 1,
                rationale_es: 'No corresponde a esta categoría.',
                caveat_es: null,
              },
            ],
          },
        ],
        next_step_es: 'Revisemos el primer frente.',
      };

      const result = renderer.render({
        message: mismatched,
        providerResults: [createProvider({ category: 'Catering' })],
      });

      expect(result).toBe('Encontré opciones para comparar.\n\nRevisemos el primer frente.');
      expect(result).not.toContain('No corresponde a esta categoría.');
    });
  });

  describe('generic messages', () => {
    it('renders paragraphs without generated actions', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Primera parte del mensaje.', 'Segunda parte.'],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Primera parte del mensaje.');
      expect(result).toContain('Segunda parte.');
      expect(result).not.toContain('Ajustar criterios');
    });
  });

  describe('no Markdown output', () => {
    it('never outputs Markdown markers', () => {
      const card = renderer.render({
        message: {
          type: 'recommendation',
          intro_es: 'Opciones:',
          providers: [
            { provider_id: 1, rationale_es: 'Razón.', caveat_es: null },
          ],
        },
        providerResults: [createProvider()],
      });

      expect(card).not.toContain('**');

      const generic = renderer.render({
        message: {
          type: 'generic',
          paragraphs_es: ['Texto de ejemplo.'],
        },
        providerResults: [],
      });

      expect(generic).not.toContain('`');
    });
  });
});
