import { describe, expect, it } from 'vitest';

import { parseCaseIds } from '../src/evals/live-behavior-cli';

describe('live-behavior-cli parseCaseIds', () => {
  it('returns undefined when no --case flag is present', () => {
    expect(parseCaseIds([])).toBeUndefined();
    expect(parseCaseIds(['--other', 'foo'])).toBeUndefined();
  });

  it('parses single --case <id>', () => {
    expect(parseCaseIds(['--case', 'live_behavior.rsvp_cristian_phone_enriched_confirmation'])).toEqual([
      'live_behavior.rsvp_cristian_phone_enriched_confirmation',
    ]);
  });

  it('parses repeatable --case <id> flags', () => {
    expect(parseCaseIds(['--case', 'a', '--case', 'b', '--case', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('parses --case=<id> form', () => {
    expect(parseCaseIds(['--case=a', '--case=b'])).toEqual(['a', 'b']);
  });

  it('supports mixed spaced and equals forms', () => {
    expect(parseCaseIds(['--case', 'a', '--case=b', '--case', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('ignores incomplete trailing --case with no value', () => {
    expect(parseCaseIds(['--case'])).toBeUndefined();
  });

  it('ignores --case followed by another flag', () => {
    expect(parseCaseIds(['--case', '--case', 'foo'])).toEqual(['foo']);
  });
});
