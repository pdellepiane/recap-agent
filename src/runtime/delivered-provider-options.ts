/** Provider identities attached to a previously displayed, numbered list. */
export type DeliveredProviderOption = { ordinal: number; providerId: number };
export type ProviderWithDetailUrl = { id: number; detailUrl?: string | null };

/**
 * Validate provider links in numbered response sections against known candidates.
 * Returns no evidence if a section is ambiguous, a number repeats, or a URL
 * cannot be tied uniquely to a candidate. Callers must independently establish
 * that the supplied body is the actual delivered outbound message.
 */
export function deliveredProviderOptions(
  body: string,
  providers: readonly ProviderWithDetailUrl[],
): DeliveredProviderOption[] | null {
  const headings = [...body.matchAll(/(?:^|\n)[ \t]*(\d+)\.[ \t]+([^\n]+)/gu)];
  if (!headings.length) return null;
  const options: DeliveredProviderOption[] = [];
  for (const [index, heading] of headings.entries()) {
    const block = body.slice(heading.index, headings[index + 1]?.index ?? body.length);
    const urls = [...block.matchAll(/https:\/\/(?:www\.)?sinenvolturas\.com\/proveedores\/[\p{L}\p{N}%_-]+/gu)].map((match) => match[0]);
    if (urls.length !== 1) return null;
    const matches = providers.filter((provider) => provider.detailUrl === urls[0]);
    if (matches.length !== 1) return null;
    const ordinal = Number(heading[1]);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || options.some((item) => item.ordinal === ordinal || item.providerId === matches[0].id)) return null;
    options.push({ ordinal, providerId: matches[0].id });
  }
  return options;
}

/** Use only the latest outbound message with a transport-confirmed status. */
export function resolveDeliveredProviderId(
  messages: readonly { direction: 'inbound' | 'outbound'; status: string; body: string }[],
  providers: readonly ProviderWithDetailUrl[],
  ordinal: number,
): number | null {
  const outbound = [...messages].reverse().find((message) => message.direction === 'outbound');
  if (!outbound || !['sent', 'delivered', 'read'].includes(outbound.status)) return null;
  return deliveredProviderOptions(outbound.body, providers)?.find((option) => option.ordinal === ordinal)?.providerId ?? null;
}
