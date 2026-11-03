import { normalizeToPriceLevel } from '../core/price-level';

export type ProviderEvidence = {
  id: number;
  detailUrl?: string | null;
  priceLevel?: string | null;
  location?: string | null;
  minPrice?: string | null;
};
export type BoundedFieldResult = 'matched' | 'different' | 'unassessable' | 'not_detected';
export type ProviderCardCheck = {
  ordinal: number;
  url: string | null;
  linkEvidence: 'matched' | 'unassessable';
  providerId: number | null;
  priceLevel: BoundedFieldResult;
  minimumPrice: BoundedFieldResult;
  location: BoundedFieldResult;
};
const providerUrl = /https:\/\/(?:www\.)?sinenvolturas\.com\/proveedores\/[\p{L}\p{N}%_-]+/gu;
function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('es').replace(/\s+/gu, ' ').trim().replace(/[.,;:]+$/u, '');
}
function exactUnique(values: readonly string[]): string | null {
  return values.length > 0 && new Set(values.map(normalized)).size === 1 ? values[0] : null;
}
function parseAmount(value: string): number | null {
  const clean = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/u.test(clean)) return null;
  const parsed = Number(clean.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}
/** Parse only numbered cards with one public provider URL. No prose entailment is inferred. */
export function inspectProviderCards(text: string, providers: readonly ProviderEvidence[]): ProviderCardCheck[] {
  const headings = [...text.matchAll(/(?:^|\n)[ \t]*(\d+)\.[ \t]+([^\n]+)/gu)];
  return headings.map((heading, index) => {
    const start = heading.index ?? 0;
    const end = index + 1 < headings.length ? headings[index + 1].index : text.length;
    const block = text.slice(start, end);
    const urls = [...block.matchAll(providerUrl)].map(m => m[0]);
    const url = urls.length === 1 ? urls[0] : null;
    const matches = url ? providers.filter(p => p.detailUrl === url) : [];
    const provider = matches.length === 1 ? matches[0] : null;
    const explicitPrices = [...block.matchAll(/(?:^|\n)[ \t]*Precio:[ \t]*(\${1,4})(?=[.\s\n]|$)/giu)].map(m => m[1]);
    const headerPrices = [...heading[2].matchAll(/·[ \t]*(\${1,4})(?=[ \t]*[·)])/gu)].map(m => m[1]);
    const priceValues = [...explicitPrices, ...headerPrices];
    const price = exactUnique(priceValues);
    let priceLevel: BoundedFieldResult = 'not_detected';
    if (priceValues.length > 0) {
      const evidence = normalizeToPriceLevel(provider?.priceLevel);
      priceLevel = price && evidence ? normalizeToPriceLevel(price) === evidence ? 'matched' : 'different' : 'unassessable';
    }
    // Only the explicit positive 'precio mínimo ... S/ amount' form is
    // assessed, and only the number is compared: trace currency is unknown.
    const minimumValues = [...block.matchAll(/precio[ \t]+m[ií]nimo(?:[ \t]+(?:publicado|indicado))?[ \t]+(?:de|es)[ \t]+S\/[ \t]*([\d,.]+)/giu)]
      .filter(match => !/\b(?:no|sin)\b/iu.test(block.slice(Math.max(0, (match.index ?? 0) - 30), match.index)))
      .map(match => match[1].replace(/[.,]$/u, ''));
    const minimum = exactUnique(minimumValues);
    let minimumPrice: BoundedFieldResult = 'not_detected';
    if (minimumValues.length > 0) {
      const given = minimum ? parseAmount(minimum) : null;
      const source = provider?.minPrice ? parseAmount(provider.minPrice) : null;
      minimumPrice = given !== null && source !== null ? given === source ? 'matched' : 'different' : 'unassessable';
    }
    const explicitLocations = [...block.matchAll(/(?:^|\n)[ \t]*Ubicaci[oó]n:[ \t]*([^\n]+)/giu)].map(m => m[1]);
    const headerLocation = heading[2].match(/\(([^()·\n]+)[ \t]*·/u)?.[1];
    const locationValues = [...explicitLocations, ...(headerLocation ? [headerLocation] : [])];
    const location = exactUnique(locationValues);
    let locationResult: BoundedFieldResult = 'not_detected';
    if (locationValues.length > 0) locationResult = location && provider?.location
      ? normalized(location) === normalized(provider.location) ? 'matched' : 'different'
      : 'unassessable';
    return { ordinal: Number(heading[1]), url, providerId: provider?.id ?? null,
      linkEvidence: provider ? 'matched' : 'unassessable', priceLevel, minimumPrice, location: locationResult };
  });
}
/** Only a unique numbered card bound to one trace provider is assessable. */
export function checkDisplayedSelection(cards: readonly ProviderCardCheck[], selectedIds: readonly number[] | null, ordinal: number): 'matched' | 'different' | 'not_selected' | 'unassessable' {
  const first = cards.filter(c => c.ordinal === ordinal);
  if (first.length !== 1 || first[0].providerId === null || selectedIds === null || selectedIds.length > 1) return 'unassessable';
  if (selectedIds.length === 0) return 'not_selected';
  return selectedIds[0] === first[0].providerId ? 'matched' : 'different';
}

export function checkFirstSelection(cards: readonly ProviderCardCheck[], selectedIds: readonly number[] | null): 'matched' | 'different' | 'not_selected' | 'unassessable' {
  return checkDisplayedSelection(cards, selectedIds, 1);
}
