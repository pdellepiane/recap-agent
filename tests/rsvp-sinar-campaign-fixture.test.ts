import { describe, expect, it } from 'vitest';

import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';

describe('Sinar-style campaign decline fixture', () => {
  it('starts with one pending invitation and yields a matching declined fresh read after one write', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-sinar-campaign-decline');
    const phone = { phone_extension: '+51', phone_number: '900000689' };

    const candidates = await gateway.getGuestEventsByPhone(phone);
    expect(candidates).toMatchObject({
      status: 'success',
      events: [{ eventId: 3441301, name: 'Paula & Fernando' }],
    });
    const before = await gateway.getEventDetail({ eventId: 3441301, trustedPhone: phone });
    expect(before).toMatchObject({
      status: 'success',
      event: { attendance: { guestId: 3441302, hasResponded: false, willAttend: null } },
    });

    const write = await gateway.guestRsvp({
      ...phone,
      guest_id: 3441302,
      action: 'declining',
    });
    expect(write).toMatchObject({
      status: 'responded',
      guestId: 3441302,
      eventId: 3441301,
      willAttend: false,
    });
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(1);

    const after = await gateway.getEventDetail({ eventId: 3441301, trustedPhone: phone });
    expect(after).toMatchObject({
      status: 'success',
      event: { attendance: { guestId: 3441302, hasResponded: true, willAttend: false } },
    });
  });
});
