import { describe, expect, it } from 'vitest';

import { channelRequestSchema } from '../src/lambda/request-contract';
import {
  FixtureAgentConversationGateway,
  buildFixturePhoneLookupKeys,
} from '../src/runtime/eval-fixture-gateway';
import { splitInternationalPhone } from '../src/runtime/phone';

describe('foreign-number (+961) campaign decline twin', () => {
  it('accepts the Lebanese sender at the Lambda contract instead of a pre-validation 400', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Lamentablemente, no podré asistir. Ya le envié un mensaje a Paula.',
      user_id: 'whatsapp:96170197268',
      channel: 'whatsapp',
      contact_phone: '+96170197268',
      message_id: 'wamid.synthetic-foreign-decline',
      client_mode: 'channel',
    });
    expect(result.success).toBe(true);
    expect(splitInternationalPhone('+96170197268')).toEqual({
      phone_extension: '+961',
      phone_number: '70197268',
    });
  });

  it('derives the +961 lookup keys without a legacy-country heuristic', () => {
    const keys = buildFixturePhoneLookupKeys('+96170197268');
    expect(keys).toContain('70197268');
    expect(keys).toContain('+961:70197268');
    expect(keys).toContain('96170197268');
  });

  it('starts with one pending invitation and yields a matching declined fresh read after one write', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-foreign-number-decline');
    const phone = { phone_extension: '+961', phone_number: '70197268' };

    const candidates = await gateway.getGuestEventsByPhone(phone);
    expect(candidates).toMatchObject({
      status: 'success',
      events: [{ eventId: 9613001, name: 'Paula & Fernando' }],
    });
    const before = await gateway.getEventDetail({ eventId: 9613001, trustedPhone: phone });
    expect(before).toMatchObject({
      status: 'success',
      event: { attendance: { guestId: 9613002, hasResponded: false, willAttend: null } },
    });

    const write = await gateway.guestRsvp({
      ...phone,
      guest_id: 9613002,
      action: 'declining',
    });
    expect(write).toMatchObject({
      status: 'responded',
      guestId: 9613002,
      eventId: 9613001,
      willAttend: false,
    });
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(1);

    const after = await gateway.getEventDetail({ eventId: 9613001, trustedPhone: phone });
    expect(after).toMatchObject({
      status: 'success',
      event: { attendance: { guestId: 9613002, hasResponded: true, willAttend: false } },
    });
  });

  it('returns a typed unknown for an unregistered foreign identity instead of throwing', async () => {
    const gateway = await FixtureAgentConversationGateway.create('rsvp-foreign-number-decline');
    const result = await gateway.getGuestEventsByPhone({
      phone_extension: '+961',
      phone_number: '00000000',
    });
    expect(result.status).toBe('not_found');
  });
});
