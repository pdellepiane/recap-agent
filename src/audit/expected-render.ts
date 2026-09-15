import { normalizeToProviderCategory } from '../core/provider-category';
import { formatPriceLevel } from '../core/price-level';
import type { AuthorizedProviderRenderField } from '../runtime/contracts';
import type {
  ProviderNeedRecommendation,
  ProviderRecommendation,
  StructuredMessage,
} from '../runtime/structured-message';

/**
 * Independent reference serializer for output-origin verification (S4).
 *
 * Intentionally duplicates the narrow channel formatting specification from
 * the delivery renderer so drift fails visibly in tests. This is not a second
 * conversation writer: it projects only immutable model fields plus
 * snapshotted authorized mechanical provider fields (identity, link, scalar
 * display data). Freeform provider promotional sentences are never exempt
 * mechanical text; model-written prose lives in the model message. No
 * arbitrary rendered-string field is admissible. This module never imports or
 * calls the delivery renderer, never copies delivered text into expected
 * text, and never bypasses card checks.
 */
export class ReferenceRenderError extends Error {
  constructor(reason: string) {
    super(`reference-render: ${reason}`);
    this.name = 'ReferenceRenderError';
  }
}

type ReferenceStyle = {
  terminalPunctuation: boolean;
  detailLabel: boolean;
};

/**
 * Narrow channel formatting contract, duplicated from the delivery renderer
 * on purpose. whatsapp and terminal_whatsapp share the WhatsApp style;
 * webchat uses the WebChat style; unknown channels fall back to WhatsApp.
 */
function resolveReferenceStyle(channel?: string | null): ReferenceStyle {
  if (channel === 'webchat') {
    return { terminalPunctuation: false, detailLabel: false };
  }
  return { terminalPunctuation: true, detailLabel: true };
}

function formatSentence(value: string, style: ReferenceStyle): string {
  if (!style.terminalPunctuation || value.endsWith('.') || value.endsWith('?')) {
    return value;
  }
  return `${value}.`;
}

function formatLine(label: string, value: string | null | undefined, style: ReferenceStyle): string {
  return formatSentence(`${label}: ${value ?? ''}`, style);
}

function displayProviderCategory(category: ProviderNeedRecommendation['category']): string {
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

/** Declared transport transforms, duplicated narrowly for independence. */
function applyReferenceTransportTransforms(value: string): string {
  return value
    .replace(/\bfilecite\s+turn\d+\s+file\s+\d+\b/giu, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}

function renderWelcome(message: StructuredMessage): string {
  const parts: string[] = [];
  if (message.greeting_es) parts.push(message.greeting_es);
  if (message.scope_es) parts.push(message.scope_es);
  if (message.ask_es) parts.push(message.ask_es);
  return parts.filter(Boolean).join('\n\n');
}

function renderGeneric(message: StructuredMessage): string {
  return (message.paragraphs_es ?? []).join('\n\n');
}

function renderProviderCard(
  rec: ProviderRecommendation,
  provider: AuthorizedProviderRenderField,
  index: number,
  style: ReferenceStyle,
): string {
  const lines: string[] = [`${index + 1}. ${provider.title}`];
  if (rec.rationale_es) {
    lines.push(`   ${rec.rationale_es}`);
  }
  const location = provider.location ?? 'Ubicación no especificada';
  lines.push(`   ${formatLine('Ubicación', location, style)}`);
  if (provider.priceLevel) {
    lines.push(`   ${formatLine('Precio', formatPriceLevel(provider.priceLevel as 'low' | 'mid' | 'high' | 'very_high'), style)}`);
  }
  if (provider.promoBadge) {
    lines.push(`   ${formatLine('Promo', provider.promoBadge, style)}`);
  }
  if (rec.caveat_es) {
    lines.push(`   ${formatLine('Nota', rec.caveat_es, style)}`);
  }
  if (provider.detailUrl) {
    lines.push('');
    lines.push(
      style.detailLabel ? `   Ficha: ${provider.detailUrl}` : `   ${provider.detailUrl}`,
    );
  }
  return lines.join('\n');
}

function renderCompactProviderRow(
  rec: ProviderRecommendation,
  provider: AuthorizedProviderRenderField,
  index: number,
  style: ReferenceStyle,
): string {
  const details: string[] = [];
  if (provider.location) details.push(provider.location);
  const priceLevel = provider.priceLevel ?? null;
  if (priceLevel) {
    const formatted = formatPriceLevel(priceLevel as 'low' | 'mid' | 'high' | 'very_high');
    if (formatted) details.push(formatted);
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
    lines.push(`   ${formatLine('Limitación', rec.caveat_es, style)}`);
  }
  if (provider.detailUrl) {
    lines.push(style.detailLabel ? `   Ficha: ${provider.detailUrl}` : `   ${provider.detailUrl}`);
  }
  return lines.join('\n');
}

function renderRecommendation(
  message: StructuredMessage,
  providerMap: Map<number, AuthorizedProviderRenderField>,
  style: ReferenceStyle,
): string {
  const parts: string[] = [];
  if (message.intro_es) parts.push(message.intro_es);
  const cards = (message.providers ?? [])
    .map((rec, index) => {
      const provider = providerMap.get(rec.provider_id);
      if (!provider) return null;
      return renderProviderCard(rec, provider, index, style);
    })
    .filter((card): card is string => card !== null);
  if (cards.length > 0) parts.push(cards.join('\n\n'));
  return parts.join('\n\n');
}

function renderNeedSection(
  need: ProviderNeedRecommendation,
  providerMap: Map<number, AuthorizedProviderRenderField>,
  style: ReferenceStyle,
): string | null {
  const cards = need.providers
    .filter((rec) => {
      const provider = providerMap.get(rec.provider_id);
      return (
        provider !== undefined &&
        normalizeToProviderCategory(provider.category) === need.category
      );
    })
    .map((rec, index) => {
      const provider = providerMap.get(rec.provider_id);
      if (!provider) return null;
      return renderCompactProviderRow(rec, provider, index, style);
    })
    .filter((card): card is string => card !== null);
  if (cards.length === 0) return null;
  return [displayProviderCategory(need.category), need.summary_es, cards.join('\n')]
    .filter(Boolean)
    .join('\n');
}

function renderMultiNeed(
  message: StructuredMessage,
  providerMap: Map<number, AuthorizedProviderRenderField>,
  style: ReferenceStyle,
): string {
  const parts: string[] = [];
  if (message.intro_es) parts.push(message.intro_es);
  const sections = (message.needs ?? [])
    .map((need) => renderNeedSection(need, providerMap, style))
    .filter((section): section is string => section !== null);
  if (sections.length > 0) parts.push(sections.join('\n\n'));
  if (message.next_step_es) parts.push(message.next_step_es);
  return parts.join('\n\n');
}

/**
 * Raw reference render from the immutable model snapshot plus snapshotted
 * authorized mechanical fields. Throws ReferenceRenderError when the model
 * references a provider id with no snapshot (missing snapshots fail closed).
 */
export function buildReferenceRender(args: {
  message: StructuredMessage;
  providerFields: readonly AuthorizedProviderRenderField[];
  channel?: string | null;
}): string {
  const style = resolveReferenceStyle(args.channel ?? null);
  const providerMap = new Map(args.providerFields.map((field) => [field.id, field]));
  if (args.message.type === 'generic') return renderGeneric(args.message);
  if (args.message.type === 'welcome') return renderWelcome(args.message);
  const referencedIds =
    args.message.type === 'recommendation'
      ? (args.message.providers ?? []).map((rec) => rec.provider_id)
      : (args.message.needs ?? []).flatMap((need) =>
          need.providers.map((rec) => rec.provider_id),
        );
  for (const id of referencedIds) {
    if (!providerMap.has(id)) {
      throw new ReferenceRenderError(`missing provider snapshot for id ${id}`);
    }
  }
  if (args.message.type === 'recommendation') {
    return renderRecommendation(args.message, providerMap, style);
  }
  return renderMultiNeed(args.message, providerMap, style);
}

/**
 * Expected delivered text: reference render plus documented transport
 * transforms. Never reads delivered text.
 */
export function buildExpectedDeliveredText(args: {
  message: StructuredMessage;
  providerFields: readonly AuthorizedProviderRenderField[];
  channel?: string | null;
}): string {
  return applyReferenceTransportTransforms(
    buildReferenceRender({
      message: args.message,
      providerFields: args.providerFields,
      channel: args.channel ?? null,
    }),
  );
}
