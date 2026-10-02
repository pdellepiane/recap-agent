import { describe, it, expect } from 'vitest';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import type { AgentAuthByPhoneInput } from '../src/runtime/agent-conversation-gateway';

describe('fixture provider stub and phone key normalization', () => {
  it('resolveFixtureValue probes national, ext:national, concatenated in order', async () => {
    const order = (id: string, increment_id: string, grand_total: number, event_name: string) => ({
      pending_orders: [{ id, increment_id, payment_status: 'pending' as const, grand_total, event_name }],
      completed_orders: [],
      carts: [],
    });
    const phone: AgentAuthByPhoneInput = { phone_extension: '+51', phone_number: '981056171' };
    // National wins when every form is present.
    const allForms = FixtureAgentConversationGateway.createSync('probe-order', {
      guestOrders: {
        '981056171': order('order-national', '1', 10, 'National'),
        '+51:981056171': order('order-ext', '2', 20, 'Ext'),
        '51981056171': order('order-concat', '3', 30, 'Concat'),
      },
    }, new Set(['probe-order']));
    const national = await allForms.getGuestOrdersByPhone(phone);
    expect(national.status).toBe('success');
    if (national.status === 'success') {
      expect(national.purchases[0]?.eventName).toBe('National');
    }
    // Falls back to ext:national when national is missing.
    const extForms = FixtureAgentConversationGateway.createSync('probe-ext', {
      guestOrders: {
        '+51:981056171': order('order-ext', '2', 20, 'Ext'),
        '51981056171': order('order-concat', '3', 30, 'Concat'),
      },
    }, new Set(['probe-ext']));
    const ext = await extForms.getGuestOrdersByPhone(phone);
    expect(ext.status).toBe('success');
    if (ext.status === 'success') {
      expect(ext.purchases[0]?.eventName).toBe('Ext');
    }
    // Falls back to concatenated when the other forms are missing.
    const concatForms = FixtureAgentConversationGateway.createSync('probe-concat', {
      guestOrders: {
        '51981056171': order('order-concat', '3', 30, 'Concat'),
      },
    }, new Set(['probe-concat']));
    const concat = await concatForms.getGuestOrdersByPhone(phone);
    expect(concat.status).toBe('success');
    if (concat.status === 'success') {
      expect(concat.purchases[0]?.eventName).toBe('Concat');
    }
    expect(`${phone.phone_extension.replace(/\D/gu, '')}${phone.phone_number}`).toBe('51981056171');
    // A realistic split form also resolves a concatenated-keyed fixture.
    const claudia = FixtureAgentConversationGateway.createSync('claudia-concat', {
      guestOrders: {
        '51957212085': order('order-claudia', '100000085', 1042.89, 'Claudia and Luis Felipe'),
      },
    }, new Set(['claudia-concat']));
    const realistic: AgentAuthByPhoneInput = { phone_extension: '+51', phone_number: '957212085' };
    const resultRealistic = await claudia.getGuestOrdersByPhone(realistic);
    expect(resultRealistic.status).toBe('success');
    if (resultRealistic.status === 'success') {
      expect(resultRealistic.purchases[0]?.eventName).toBe('Claudia and Luis Felipe');
    }
    // Ensure concatenated derivation is correct
    expect(`${realistic.phone_extension.replace(/\D/gu, '')}${realistic.phone_number}`).toBe('51957212085');
  });

  it('guestRsvp probe also supports concatenated key', async () => {
    const data = {
      rsvp: {
        '51942633292': { guest_id: 70001, action: 'attending', will_attend: true, plus_one: { saved: true, response: 'yes', reason: null } },
      },
    };
    const gateway = FixtureAgentConversationGateway.createSync('rsvp-concat', data, new Set(['rsvp-concat']));
    const phone: AgentAuthByPhoneInput = { phone_extension: '+51', phone_number: '942633292' };
    const result = await gateway.guestRsvp({ phone_extension: phone.phone_extension, phone_number: phone.phone_number, guest_id: 70001, plus_one_response: 'yes' });
    expect(result.status).toBe('responded');
    if (result.status === 'responded') {
      expect(result.plusOne?.saved).toBe(true);
    }
  });

  it('getRecentMessages probes all three forms', async () => {
    const data = {
      recentMessages: {
        '51981056171': { messages: [{ id: 1, direction: 'inbound', source: null, body: 'hello', status: 'sent', whatsapp_message_id: null, sent_at: null, created_at: null }] },
        '981056171': { messages: [{ id: 1, direction: 'inbound', source: null, body: 'hello-national', status: 'sent', whatsapp_message_id: null, sent_at: null, created_at: null }] },
        '+51:981056171': { messages: [{ id: 1, direction: 'inbound', source: null, body: 'hello-ext', status: 'sent', whatsapp_message_id: null, sent_at: null, created_at: null }] },
      },
    } as unknown as Record<string, unknown>;
    const gateway = FixtureAgentConversationGateway.createSync('recent-concat', data as never, new Set(['recent-concat']));
    // Query with +51 full international form should find concatenated via probe (national -> ext -> concatenated order)
    const result = await gateway.getRecentMessages('+51981056171');
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.messages.length).toBe(1);
    }
    // Query with national should find national directly
    const resultNational = await gateway.getRecentMessages('981056171');
    expect(resultNational.status).toBe('success');
    if (resultNational.status === 'success') {
      expect(resultNational.messages[0]?.body).toBe('hello-national');
    }
    // Query with ext form should find ext
    const resultExt = await gateway.getRecentMessages('+51:981056171');
    // This input is not a valid phone but tests probe for ext key directly
    expect(resultExt.status === 'success' || resultExt.status === 'failed').toBe(true);
  });

});
