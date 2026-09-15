import type { ProviderSummary } from '../core/provider';
import { normalizeToProviderCategory } from '../core/provider-category';
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
      case 'generic':
        return this.renderGeneric(message);
    }
  }

  private renderWelcome(message: StructuredMessage): string {
    const parts: string[] = [];

    if (message.greeting_es) {
      parts.push(message.greeting_es);
    }

    if (message.scope_es) {
      parts.push(message.scope_es);
    }

    if (message.ask_es) {
      parts.push(message.ask_es);
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
      .filter((rec) => {
        const provider = providerMap.get(rec.provider_id);
        return (
          provider !== undefined &&
          normalizeToProviderCategory(provider.category) === need.category
        );
      })
      .map((rec, index) => this.renderCompactProviderRow(rec, providerMap, index))
      .filter((card): card is string => card !== null);

    if (cards.length === 0) {
      return null;
    }

    return [
      this.displayProviderCategory(need.category),
      need.summary_es,
      cards.join('\n'),
    ].filter(Boolean).join('\n');
  }

  private displayProviderCategory(
    category: ProviderNeedRecommendation['category'],
  ): string {
    switch (category) {
      case 'Catering':
        return 'Servicio de comida';
      case 'Wedding planners':
        return 'Organización de bodas';
      case 'Hogar y deco':
        return 'Hogar y decoración';
      default:
        return category;
    }
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
    if (provider.promoBadge) {
      details.push(`promo: ${provider.promoBadge}`);
    }

    const matchLabel = rec.match_label_es?.trim();
    const title = matchLabel ? `${provider.title} - ${matchLabel}` : provider.title;
    const lines = [
      `${index + 1}. ${title}${details.length > 0 ? ` (${details.join(' · ')})` : ''}`,
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

    if (provider.promoBadge) {
      lines.push(`   ${this.formatLine('Promo', provider.promoBadge)}`);
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
