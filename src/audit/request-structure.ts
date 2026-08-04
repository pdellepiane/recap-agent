export function findDuplicateStructuredSubtrees(value: unknown): string[] {
  const fingerprints = new Map<string, number>();
  visit(value, fingerprints);
  return [...fingerprints.entries()]
    .filter(([, count]) => count > 1)
    .map(([fingerprint]) => fingerprint);
}

function visit(value: unknown, fingerprints: Map<string, number>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => visit(entry, fingerprints));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const keys = Object.keys(value);
  if (keys.length >= 3) {
    const fingerprint = stableStringify(value);
    fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);
  }
  Object.values(value).forEach((entry) => visit(entry, fingerprints));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
