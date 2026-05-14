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
