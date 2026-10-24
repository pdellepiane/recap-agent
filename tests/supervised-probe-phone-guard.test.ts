import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function probe(userId: string, contactPhone = userId): string {
  try {
    execFileSync(process.execPath, ['scripts/supervised-probe.mjs', '--scenario',
      'purchase-approved-event-date', '--user-id', userId, '--contact-phone', contactPhone,
      '--text', 'Consulta de prueba'], { encoding: 'utf8', stdio: 'pipe' });
    throw new Error('Expected preflight rejection');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'stderr' in error) return String(error.stderr);
    throw error;
  }
}

describe('supervised probe phone guard', () => {
  it('rejects unseeded fixture phones before any AWS operation', () => {
    expect(probe('51900000407')).toContain('Phone is not seeded');
  });
  it('rejects mismatched contacts and real customer identifiers before AWS access', () => {
    expect(probe('51900000406', '+51900000407')).toContain('must match');
    expect(probe('51955704040')).toContain('must be a synthetic');
  });
});
