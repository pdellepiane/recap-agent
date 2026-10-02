import { describe, expect, it } from 'vitest';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';

describe('B fixture-aligned oracles', () => {
  it('empty-array adapter twin returns success with empty collections', async () => {
    const gateway = await FixtureAgentConversationGateway.create('support-continuity');
    const result = await gateway.getGuestOrdersByPhone({ phone_extension: '51', phone_number: '985101461' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.purchases).toEqual([]);
    }
  });
});
