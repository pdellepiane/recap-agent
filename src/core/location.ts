const countryAliases: Array<{ key: string; aliases: string[] }> = [
  { key: 'peru', aliases: ['peru', 'lima'] },
  { key: 'mexico', aliases: ['mexico', 'queretaro', 'tulum'] },
];

export function locationKey(value: string | null | undefined): string {
  return value
    ? value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

export function locationCountryKey(location: string | null | undefined): string | null {
  const normalized = locationKey(location);
  if (!normalized) return null;

  for (const country of countryAliases) {
    if (country.aliases.some((alias) => normalized.includes(alias))) {
      return country.key;
    }
  }

  return null;
}

export function normalizeLocationCountry(location: string | null | undefined): string | null {
  return locationCountryKey(location);
}

export type LocationCompatibility = 'exact' | 'compatible' | 'unknown' | 'mismatch';

const regionAliases: Array<{ key: string; aliases: string[] }> = [
  {
    key: 'lima',
    aliases: [
      'lima',
      'miraflores',
      'surco',
      'santiago de surco',
      'san isidro',
      'san borja',
      'barranco',
      'lurin',
      'cieneguilla',
      'la molina',
      'chorrillos',
    ],
  },
  { key: 'ica', aliases: ['ica', 'provincia de ica'] },
  { key: 'tulum', aliases: ['tulum'] },
  { key: 'queretaro', aliases: ['queretaro'] },
];

export function classifyLocationCompatibility(
  requestedLocation: string | null | undefined,
  providerLocation: string | null | undefined,
): LocationCompatibility {
  const requested = locationKey(requestedLocation);
  const provided = locationKey(providerLocation);
  if (!requested || !provided) {
    return 'unknown';
  }
  if (requested === provided || requested.includes(provided) || provided.includes(requested)) {
    return 'exact';
  }

  const requestedCountry = locationCountryKey(requested);
  const providedCountry = locationCountryKey(provided);
  if (requestedCountry && providedCountry && requestedCountry !== providedCountry) {
    return 'mismatch';
  }

  const requestedRegion = locationRegionKey(requested);
  const providedRegion = locationRegionKey(provided);
  if (requestedRegion && providedRegion) {
    return requestedRegion === providedRegion ? 'compatible' : 'mismatch';
  }

  return 'unknown';
}

function locationRegionKey(location: string): string | null {
  for (const region of regionAliases) {
    if (region.aliases.some((alias) => location.includes(alias))) {
      return region.key;
    }
  }
  return null;
}
