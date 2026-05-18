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
    it('accepts valid multi-need recommendation payloads', () => {
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
    });

    it('rejects empty multi-need recommendation needs', () => {
      expect(() =>
        multiNeedRecommendationMessageSchema.parse({
          type: 'multi_need_recommendation',
          intro_es: 'Encontré opciones para comparar.',
          needs: [],
          next_step_es: 'Podemos revisar frente por frente.',
        }),
      ).toThrow();
    });

    it('rejects malformed grouped provider references', () => {
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

    it('rejects more than one provider per need in kickstart messages', () => {
      expect(() =>
        multiNeedRecommendationMessageSchema.parse({
          type: 'multi_need_recommendation',
          intro_es: 'Encontré opciones para comparar.',
          needs: [
            {
              category: 'Catering',
              summary_es: 'Para catering.',
              providers: [
                { provider_id: 1, rationale_es: 'Primera.', caveat_es: null },
                { provider_id: 2, rationale_es: 'Segunda.', caveat_es: null },
              ],
            },
          ],
          next_step_es: 'Podemos revisar frente por frente.',
        }),
      ).toThrow();
    });
  });

  describe('welcome messages', () => {
    it('renders greeting, ask, and bulleted fields with capitals and periods', () => {
      const message: StructuredMessage = {
        type: 'welcome',
        greeting_es: '¡Hola! Soy tu asistente.',
        ask_es: '¿Qué tipo de evento quieres planificar?',
        requested_fields_es: [
          'tipo de evento',
          'ubicación',
          'invitados aproximados',
        ],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toBe(
        '¡Hola! Soy tu asistente.\n\n¿Qué tipo de evento quieres planificar?\n\n- Tipo de evento.\n- Ubicación.\n- Invitados aproximados.',
      );
    });

    it('renders greeting and ask without fields', () => {
      const message: StructuredMessage = {
        type: 'welcome',
        greeting_es: '¡Hola!',
        ask_es: '¿En qué te ayudo?',
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toBe('¡Hola!\n\n¿En qué te ayudo?');
    });
  });

  describe('recommendation messages', () => {
    it('renders provider cards with deterministic formatting', () => {
      const provider = createProvider();
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Encontré estas opciones para ti.',
        providers: [
          { provider_id: 1, rationale_es: 'Buena relación calidad-precio.', caveat_es: null },
        ],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).toContain('1. La Botanería');
      expect(result).toContain('Buena relación calidad-precio.');
      expect(result).toContain('Ubicación: Lima, Perú.');
      expect(result).toContain('Precio: $$.');
      expect(result).toContain('Ficha: https://sinenvolturas.com/proveedores/la-botaneria');
      expect(result).not.toContain('Elige un proveedor');
    });

    it('places Ficha link on its own line', () => {
      const provider = createProvider();
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          { provider_id: 1, rationale_es: 'Opción destacada.', caveat_es: null },
        ],
      };

      const result = renderer.render({ message, providerResults: [provider] });
      const lines = result.split('\n');
      const fichaLine = lines.find((line) => line.includes('Ficha:'));

      expect(fichaLine).toBeDefined();
      expect(fichaLine?.trim()).toBe('Ficha: https://sinenvolturas.com/proveedores/la-botaneria');
    });

    it('renders caveat when present', () => {
      const provider = createProvider();
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          {
            provider_id: 1,
            rationale_es: 'Excelente servicio.',
            caveat_es: 'No incluye decoración.',
          },
        ],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).toContain('Nota: No incluye decoración.');
    });

    it('renders promo when present', () => {
      const provider = createProvider({ promoBadge: '15% off' });
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          { provider_id: 1, rationale_es: 'Con promo.', caveat_es: null },
        ],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).toContain('Promo: 15% off.');
    });

    it('skips providers not found in results', () => {
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          { provider_id: 999, rationale_es: 'No existe.', caveat_es: null },
        ],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toBe('Opciones:');
    });

    it('uses fallback location when provider has no location', () => {
      const provider = createProvider({ location: null });
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          { provider_id: 1, rationale_es: 'Sin ubicación.', caveat_es: null },
        ],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).toContain('Ubicación: Ubicación no especificada.');
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
        'Catering\nOpciones para comida.\n1. La Botanería (Lima, Perú · $$)',
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

    it('skips missing provider IDs inside grouped needs', () => {
      const message: StructuredMessage = {
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

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toBe('Encontré opciones para comparar.\n\nRevisemos el primer frente.');
    });
  });

  describe('contact_request messages', () => {
    it('renders contact request with field labels', () => {
      const message: StructuredMessage = {
        type: 'contact_request',
        intro_es: 'Para continuar, necesito tus datos.',
        requested_fields_es: ['full_name', 'email', 'phone'],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Para continuar, necesito tus datos.');
      expect(result).toContain('Envíame tu nombre completo, email, teléfono.');
    });
  });

  describe('close_confirmation messages', () => {
    it('renders selected and unselected lists', () => {
      const message: StructuredMessage = {
        type: 'close_confirmation',
        summary_es: 'Resumen del cierre:',
        selected_providers_es: ['fotografía: Foto Uno'],
        unselected_needs_es: ['organización'],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Resumen del cierre:');
      expect(result).toContain('Se enviarán solicitudes para:');
      expect(result).toContain('- Fotografía: Foto Uno.');
      expect(result).toContain('Se dejarán sin proveedor:');
      expect(result).toContain('- Organización.');
      expect(result).not.toContain('Confirmar');
    });
  });

  describe('close_result messages', () => {
    it('renders success and contact explanation', () => {
      const message: StructuredMessage = {
        type: 'close_result',
        success_es: '¡Listo! Las solicitudes fueron enviadas.',
        contact_explanation_es: 'Los proveedores te contactarán en 24-48 horas.',
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('¡Listo! Las solicitudes fueron enviadas.');
      expect(result).toContain('Los proveedores te contactarán en 24-48 horas.');
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
    it('never outputs raw asterisks', () => {
      const provider = createProvider();
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          { provider_id: 1, rationale_es: 'Razón.', caveat_es: null },
        ],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).not.toContain('**');
    });

    it('never outputs underscores or backticks', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Texto de ejemplo.'],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).not.toContain('`');
    });
  });
});
