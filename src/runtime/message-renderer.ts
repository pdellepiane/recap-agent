import type { ProviderSummary } from '../core/provider';
import { formatPriceLevel } from '../core/price-level';
import type {
  ProviderNeedRecommendation,
  ProviderRecommendation,
  StructuredMessage,
} from './structured-message';

export interface MessageRenderer {
  render(input: {
    message: StructuredMessage;
    providerResults: ProviderSummary[];
  }): string;
}

type ProviderCardStyle = {
  bullet: '-' | '•';
  terminalPunctuation: boolean;
  detailLabel: boolean;
};

abstract class BaseProviderMessageRenderer implements MessageRenderer {
  protected abstract readonly style: ProviderCardStyle;

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
      case 'multi_need_recommendation':
        return this.renderMultiNeedRecommendation(message, providerResults);
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
        .map((field) => this.renderBullet(this.capitalize(field)))
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

    const providerMap = this.buildProviderMap(providerResults);
    const cards = (message.providers ?? [])
      .map((rec, index) => this.renderProviderCard(rec, providerMap, index))
      .filter((card): card is string => card !== null);

    if (cards.length > 0) {
      parts.push(cards.join('\n\n'));
    }

    return parts.join('\n\n');
  }

  private renderMultiNeedRecommendation(
    message: StructuredMessage,
    providerResults: ProviderSummary[],
  ): string {
    const parts: string[] = [];
    const providerMap = this.buildProviderMap(providerResults);

    if (message.intro_es) {
      parts.push(message.intro_es);
    }

    const needSections = (message.needs ?? [])
      .map((need) => this.renderNeedSection(need, providerMap))
      .filter((section): section is string => section !== null);

    if (needSections.length > 0) {
      parts.push(needSections.join('\n\n'));
    }

    if (message.next_step_es) {
      parts.push(message.next_step_es);
    }

    return parts.join('\n\n');
  }

  private renderNeedSection(
    need: ProviderNeedRecommendation,
    providerMap: Map<number, ProviderSummary>,
  ): string | null {
    const cards = need.providers
      .map((rec, index) => this.renderCompactProviderRow(rec, providerMap, index))
      .filter((card): card is string => card !== null);

    if (cards.length === 0) {
      return null;
    }

    return [
      need.category,
      need.summary_es,
      cards.join('\n'),
    ].filter(Boolean).join('\n');
  }

  private renderCompactProviderRow(
    rec: ProviderRecommendation,
    providerMap: Map<number, ProviderSummary>,
    index: number,
  ): string | null {
    const provider = providerMap.get(rec.provider_id);
    if (!provider) {
      return null;
    }

    const details: string[] = [];
    if (provider.location) {
      details.push(provider.location);
    }
    const priceLevel = provider.priceLevel ?? null;
    if (priceLevel) {
      const formattedPrice = formatPriceLevel(priceLevel);
      if (formattedPrice) {
        details.push(formattedPrice);
      }
    }
    if (provider.promoBadge || provider.promoSummary) {
      details.push(`promo: ${provider.promoBadge ?? provider.promoSummary}`);
    }

    const lines = [
      `${index + 1}. ${provider.title}${details.length > 0 ? ` (${details.join(' · ')})` : ''}`,
      `   ${rec.rationale_es}`,
    ];

    if (rec.caveat_es) {
      lines.push(`   ${this.formatLine('Limitación', rec.caveat_es)}`);
    }

    if (provider.detailUrl) {
      lines.push(
        this.style.detailLabel
          ? `   Ficha: ${provider.detailUrl}`
          : `   ${provider.detailUrl}`,
      );
    }

    return lines.join('\n');
  }

  private renderProviderCard(
    rec: ProviderRecommendation,
    providerMap: Map<number, ProviderSummary>,
    index: number,
  ): string | null {
    const provider = providerMap.get(rec.provider_id);
    if (!provider) {
      return null;
    }

    const lines: string[] = [`${index + 1}. ${provider.title}`];

    if (rec.rationale_es) {
      lines.push(`   ${rec.rationale_es}`);
    }

    const location = provider.location ?? 'Ubicación no especificada';
    lines.push(`   ${this.formatLine('Ubicación', location)}`);

    if (provider.priceLevel) {
      lines.push(`   ${this.formatLine('Precio', formatPriceLevel(provider.priceLevel))}`);
    }

    if (provider.promoBadge || provider.promoSummary) {
      const promo = provider.promoBadge ?? provider.promoSummary;
      lines.push(`   ${this.formatLine('Promo', promo)}`);
    }

    if (rec.caveat_es) {
      lines.push(`   ${this.formatLine('Nota', rec.caveat_es)}`);
    }

    if (provider.detailUrl) {
      lines.push('');
      lines.push(
        this.style.detailLabel
          ? `   Ficha: ${provider.detailUrl}`
          : `   ${provider.detailUrl}`,
      );
    }

    return lines.join('\n');
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
      parts.push(this.formatSentence(`Envíame tu ${labels}`));
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
        parts.push(this.renderBullet(this.capitalize(name)));
      });
    }

    const unselected = message.unselected_needs_es ?? [];
    if (unselected.length > 0) {
      parts.push('Se dejarán sin proveedor:');
      unselected.forEach((name) => {
        parts.push(this.renderBullet(this.capitalize(name)));
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
    return (message.paragraphs_es ?? []).join('\n\n');
  }

  private buildProviderMap(providerResults: ProviderSummary[]): Map<number, ProviderSummary> {
    return new Map(providerResults.map((provider) => [provider.id, provider]));
  }

  private formatLine(label: string, value: string | null | undefined): string {
    return this.formatSentence(`${label}: ${value ?? ''}`);
  }

  private formatSentence(value: string): string {
    if (!this.style.terminalPunctuation || value.endsWith('.') || value.endsWith('?')) {
      return value;
    }
    return `${value}.`;
  }

  private renderBullet(value: string): string {
    return `${this.style.bullet} ${this.formatSentence(value)}`;
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

export class WhatsAppMessageRenderer extends BaseProviderMessageRenderer {
  protected readonly style: ProviderCardStyle = {
    bullet: '-',
    terminalPunctuation: true,
    detailLabel: true,
  };
}

export class WebChatMessageRenderer extends BaseProviderMessageRenderer {
  protected readonly style: ProviderCardStyle = {
    bullet: '•',
    terminalPunctuation: false,
    detailLabel: false,
  };
}
