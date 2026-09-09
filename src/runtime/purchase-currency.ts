/**
 * Shared normalization for authoritative purchase currency fields.
 *
 * The backend delivers `currency_code` (for example `PEN`) and
 * `currency_symbol` (for example `S/`) on order, gift-purchase and cart
 * rows. The legacy `currency` field may still arrive alongside them.
 * This helper applies the contract rules in one place so every gateway
 * maps the four purchase endpoints identically:
 * - `currency_code` normalizes to the canonical uppercase code.
 * - `currency_symbol` is display metadata only, never a code substitute.
 * - When the new code conflicts with the legacy field, the conflict is
 *   retained as evidence and no confident currency claim is produced.
 * - Currency is never inferred from phones, user claims or symbols.
 */
export type PurchaseCurrencyWire = {
  currency?: string | null | undefined;
  currency_code?: string | null | undefined;
  currency_symbol?: string | null | undefined;
};

export type NormalizedPurchaseCurrency = {
  currency: string | null;
  currencySymbol: string | null;
  currencyConflict: boolean;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePurchaseCurrency(
  wire: PurchaseCurrencyWire,
): NormalizedPurchaseCurrency {
  const rawCode = trimmedOrNull(wire.currency_code);
  const code = rawCode ? rawCode.toUpperCase() : null;
  const legacy = trimmedOrNull(wire.currency);
  const symbol = trimmedOrNull(wire.currency_symbol);
  if (code && legacy && code !== legacy.toUpperCase()) {
    return { currency: null, currencySymbol: symbol, currencyConflict: true };
  }
  return { currency: code ?? legacy, currencySymbol: symbol, currencyConflict: false };
}
