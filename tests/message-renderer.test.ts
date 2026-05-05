import { describe, expect, it } from 'vitest';

import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import type { StructuredMessage } from '../src/runtime/structured-message';
import type { ProviderSummary } from '../src/core/provider';

const renderer = new WhatsAppMessageRenderer();

function createProvider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: 1,
    title: 'La Botanería',
    slug: 'la-botaneria',
    category: 'Catering',
    location: 'Lima, Perú',
    priceLevel: '$$',
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
        actions: [],
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
        actions: [],
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
        actions: [{ type: 'select_provider', label_es: 'Elige un proveedor' }],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).toContain('1. La Botanería');
      expect(result).toContain('Buena relación calidad-precio.');
      expect(result).toContain('Ubicación: Lima, Perú.');
      expect(result).toContain('Precio: $$.');
      expect(result).toContain('Ficha: https://sinenvolturas.com/proveedores/la-botaneria');
      expect(result).toContain('Elige un proveedor');
    });

    it('places Ficha link on its own line', () => {
      const provider = createProvider();
      const message: StructuredMessage = {
        type: 'recommendation',
        intro_es: 'Opciones:',
        providers: [
          { provider_id: 1, rationale_es: 'Opción destacada.', caveat_es: null },
        ],
        actions: [],
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
        actions: [],
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
        actions: [],
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
        actions: [],
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
        actions: [],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).toContain('Ubicación: Ubicación no especificada.');
    });
  });

  describe('contact_request messages', () => {
    it('renders contact request with field labels', () => {
      const message: StructuredMessage = {
        type: 'contact_request',
        intro_es: 'Para continuar, necesito tus datos.',
        requested_fields_es: ['full_name', 'email', 'phone'],
        actions: [],
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
        actions: [{ type: 'confirm', label_es: 'Confirmar' }],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Resumen del cierre:');
      expect(result).toContain('Se enviarán solicitudes para:');
      expect(result).toContain('- Fotografía: Foto Uno.');
      expect(result).toContain('Se dejarán sin proveedor:');
      expect(result).toContain('- Organización.');
      expect(result).toContain('Confirmar');
    });
  });

  describe('close_result messages', () => {
    it('renders success and contact explanation', () => {
      const message: StructuredMessage = {
        type: 'close_result',
        success_es: '¡Listo! Las solicitudes fueron enviadas.',
        contact_explanation_es: 'Los proveedores te contactarán en 24-48 horas.',
        actions: [],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('¡Listo! Las solicitudes fueron enviadas.');
      expect(result).toContain('Los proveedores te contactarán en 24-48 horas.');
    });
  });

  describe('generic messages', () => {
    it('renders paragraphs and actions', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Primera parte del mensaje.', 'Segunda parte.'],
        actions: [
          { type: 'adjust_criteria', label_es: 'Ajustar criterios' },
          { type: 'switch_need', label_es: 'Pasar a otra necesidad' },
        ],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Primera parte del mensaje.');
      expect(result).toContain('Segunda parte.');
      expect(result).toContain('Ajustar criterios, Pasar a otra necesidad.');
    });

    it('renders single action without comma', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Mensaje.'],
        actions: [{ type: 'pause', label_es: 'Dejarlo por ahora' }],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Dejarlo por ahora');
      expect(result).not.toContain(',');
    });
  });

  describe('action label mapping', () => {
    it('uses canonical label when label_es matches canonical', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Mensaje.'],
        actions: [{ type: 'adjust_criteria', label_es: 'Ajustar criterios' }],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Ajustar criterios');
    });

    it('uses custom label when label_es differs from canonical', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Mensaje.'],
        actions: [{ type: 'adjust_criteria', label_es: 'Cambiar búsqueda' }],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).toContain('Cambiar búsqueda');
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
        actions: [],
      };

      const result = renderer.render({ message, providerResults: [provider] });

      expect(result).not.toContain('**');
    });

    it('never outputs underscores or backticks', () => {
      const message: StructuredMessage = {
        type: 'generic',
        paragraphs_es: ['Texto de ejemplo.'],
        actions: [],
      };

      const result = renderer.render({ message, providerResults: [] });

      expect(result).not.toContain('`');
    });
  });
});
