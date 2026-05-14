import type { ProviderSummary } from '../core/provider';
import { formatPriceLevel } from '../core/price-level';
import type { StructuredMessage } from './structured-message';

export interface MessageRenderer {
  render(input: {
    message: StructuredMessage;
    providerResults: ProviderSummary[];
  }): string;
}

export class WhatsAppMessageRenderer implements MessageRenderer {
  render(input: {
    message: StructuredMessage;
    providerResults: ProviderSummary[];
  }): string {
    const { message, providerResults } = input;

    switch (message.type) {
      case 'welcome':
        return this.renderWelcome(message);
      case 'recommendation':
        return this.renderRecommendation(message, providerResults);
      case 'contact_request':
        return this.renderContactRequest(message);
      case 'close_confirmation':
        return this.renderCloseConfirmation(message);
      case 'close_result':
        return this.renderCloseResult(message);
      case 'generic':
        return this.renderGeneric(message);
    }
  }

  private renderWelcome(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.greeting_es) {
      parts.push(message.greeting_es);
    }

    if (message.ask_es) {
      parts.push(message.ask_es);
    }

    const fields = message.requested_fields_es ?? [];
    if (fields.length > 0) {
      const bullets = fields
        .map((field) => `- ${this.capitalize(field)}.`)
        .join('\n');
      parts.push(bullets);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private renderRecommendation(
    message: StructuredMessage,
    providerResults: ProviderSummary[],
  ): string {
    const parts: string[] = [];

    if (message.intro_es) {
      parts.push(message.intro_es);
    }

    const providerMap = new Map(
      providerResults.map((provider) => [provider.id, provider]),
    );

    const recommendations = message.providers ?? [];
    const cards = recommendations
      .map((rec, index) => {
        const provider = providerMap.get(rec.provider_id);
        if (!provider) {
          return null;
        }

        const lines: string[] = [`${index + 1}. ${provider.title}`];

        if (rec.rationale_es) {
          lines.push(`   ${rec.rationale_es}`);
        }

        const location = provider.location ?? 'Ubicación no especificada';
        lines.push(`   Ubicación: ${location}.`);

        if (provider.priceLevel) {
          lines.push(`   Precio: ${formatPriceLevel(provider.priceLevel)}.`);
        }

        if (provider.promoBadge || provider.promoSummary) {
          const promo = provider.promoBadge ?? provider.promoSummary;
          lines.push(`   Promo: ${promo}.`);
        }

        if (rec.caveat_es) {
          lines.push(`   Nota: ${rec.caveat_es}.`);
        }

        if (provider.detailUrl) {
          lines.push('');
          lines.push(`   Ficha: ${provider.detailUrl}`);
        }

        return lines.join('\n');
      })
      .filter((card): card is string => card !== null);

    if (cards.length > 0) {
      parts.push(cards.join('\n\n'));
    }

    return parts.join('\n\n');
  }

  private renderContactRequest(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.intro_es) {
      parts.push(message.intro_es);
    }

    const fields = message.requested_fields_es ?? [];
    if (fields.length > 0) {
      const labels = fields
        .map((field) => this.contactFieldLabel(field))
        .join(', ');
      parts.push(`Envíame tu ${labels}.`);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private renderCloseConfirmation(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.summary_es) {
      parts.push(message.summary_es);
    }

    const selected = message.selected_providers_es ?? [];
    if (selected.length > 0) {
      parts.push('Se enviarán solicitudes para:');
      selected.forEach((name) => {
        parts.push(`- ${this.capitalize(name)}.`);
      });
    }

    const unselected = message.unselected_needs_es ?? [];
    if (unselected.length > 0) {
      parts.push('Se dejarán sin proveedor:');
      unselected.forEach((name) => {
        parts.push(`- ${this.capitalize(name)}.`);
      });
    }

    return parts.join('\n\n');
  }

  private renderCloseResult(message: StructuredMessage): string {
    return [message.success_es, message.contact_explanation_es]
      .filter(Boolean)
      .join('\n\n');
  }

  private renderGeneric(message: StructuredMessage): string {
    const parts: string[] = message.paragraphs_es ?? [];

    return parts.join('\n\n');
  }

  private contactFieldLabel(field: string): string {
    switch (field) {
      case 'full_name':
        return 'nombre completo';
      case 'email':
        return 'email';
      case 'phone':
        return 'teléfono';
      default:
        return field;
    }
  }

  private capitalize(value: string): string {
    if (value.length === 0) {
      return value;
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

export class WebChatMessageRenderer implements MessageRenderer {
  render(input: {
    message: StructuredMessage;
    providerResults: ProviderSummary[];
  }): string {
    const { message, providerResults } = input;

    switch (message.type) {
      case 'welcome':
        return this.renderWelcome(message);
      case 'recommendation':
        return this.renderRecommendation(message, providerResults);
      case 'contact_request':
        return this.renderContactRequest(message);
      case 'close_confirmation':
        return this.renderCloseConfirmation(message);
      case 'close_result':
        return this.renderCloseResult(message);
      case 'generic':
        return this.renderGeneric(message);
    }
  }

  private renderWelcome(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.greeting_es) {
      parts.push(message.greeting_es);
    }

    if (message.ask_es) {
      parts.push(message.ask_es);
    }

    const fields = message.requested_fields_es ?? [];
    if (fields.length > 0) {
      const bullets = fields
        .map((field) => `• ${this.capitalize(field)}`)
        .join('\n');
      parts.push(bullets);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private renderRecommendation(
    message: StructuredMessage,
    providerResults: ProviderSummary[],
  ): string {
    const parts: string[] = [];

    if (message.intro_es) {
      parts.push(message.intro_es);
    }

    const providerMap = new Map(
      providerResults.map((provider) => [provider.id, provider]),
    );

    const recommendations = message.providers ?? [];
    const cards = recommendations
      .map((rec, index) => {
        const provider = providerMap.get(rec.provider_id);
        if (!provider) {
          return null;
        }

        const lines: string[] = [`${index + 1}. ${provider.title}`];

        if (rec.rationale_es) {
          lines.push(`   ${rec.rationale_es}`);
        }

        const location = provider.location ?? 'Ubicación no especificada';
        lines.push(`   Ubicación: ${location}`);

        if (provider.priceLevel) {
          lines.push(`   Precio: ${formatPriceLevel(provider.priceLevel)}`);
        }

        if (provider.promoBadge || provider.promoSummary) {
          const promo = provider.promoBadge ?? provider.promoSummary;
          lines.push(`   Promo: ${promo}`);
        }

        if (rec.caveat_es) {
          lines.push(`   Nota: ${rec.caveat_es}`);
        }

        if (provider.detailUrl) {
          lines.push(`   ${provider.detailUrl}`);
        }

        return lines.join('\n');
      })
      .filter((card): card is string => card !== null);

    if (cards.length > 0) {
      parts.push(cards.join('\n\n'));
    }

    return parts.join('\n\n');
  }

  private renderContactRequest(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.intro_es) {
      parts.push(message.intro_es);
    }

    const fields = message.requested_fields_es ?? [];
    if (fields.length > 0) {
      const labels = fields
        .map((field) => this.contactFieldLabel(field))
        .join(', ');
      parts.push(`Envíame tu ${labels}`);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private renderCloseConfirmation(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.summary_es) {
      parts.push(message.summary_es);
    }

    const selected = message.selected_providers_es ?? [];
    if (selected.length > 0) {
      parts.push('Se enviarán solicitudes para:');
      selected.forEach((name) => {
        parts.push(`• ${this.capitalize(name)}`);
      });
    }

    const unselected = message.unselected_needs_es ?? [];
    if (unselected.length > 0) {
      parts.push('Se dejarán sin proveedor:');
      unselected.forEach((name) => {
        parts.push(`• ${this.capitalize(name)}`);
      });
    }

    return parts.join('\n\n');
  }

  private renderCloseResult(message: StructuredMessage): string {
    return [message.success_es, message.contact_explanation_es]
      .filter(Boolean)
      .join('\n\n');
  }

  private renderGeneric(message: StructuredMessage): string {
    const parts: string[] = message.paragraphs_es ?? [];

    return parts.join('\n\n');
  }

  private contactFieldLabel(field: string): string {
    switch (field) {
      case 'full_name':
        return 'nombre completo';
      case 'email':
        return 'email';
      case 'phone':
        return 'teléfono';
      default:
        return field;
    }
  }

  private capitalize(value: string): string {
    if (value.length === 0) {
      return value;
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
