import { describe, expect, it } from 'vitest';

import { projectSafeTrace } from '../src/runtime/artifact-redaction';

// Retention + purge note: eval artifacts under .eval-runs/ carry only
// projectSafeTrace summaries; perf store TTL via retentionDays purges raw
// traces. Promotion auth gate (channel bearer key) untouched; S03 excluded
// (no S03 tool in allowlist). Byte growth recorded in size test below.
const CANARIES = {
  phone: '+51973296571',
  email: 'person@example.com',
  token: 'eyJhbGciOiJIUzI1NiJ9.leak-canary.signature',
  otp: '847261',
  apiKey: 'sk-live-canary-key',
  queue: 'queue-12345',
  ticket: 'ticket-ABC-999',
  sla: 'sla-breach-72h',
  synthetic: 'synth-abcdef0123456789-full-id',
  stack: 'Error: boom\n    at Object.<anonymous> (/app/index.js:10:5)',
};

function traceWith(tool: string, input: unknown, output: unknown) {
  return {
    trace_id: 'trace-vis',
    plan_id: 'plan-vis',
    tool_inputs: [{ tool, input: JSON.stringify(input) }],
    tool_outputs: [{ tool, output: JSON.stringify(output) }],
  };
}

function safeFor(tool: string, input: unknown, output: unknown) {
  const safe = projectSafeTrace(traceWith(tool, input, output)) as Record<string, unknown>;
  const inputs = safe.tool_inputs as Array<Record<string, unknown>>;
  const outputs = safe.tool_outputs as Array<Record<string, unknown>>;
  return { input: String(inputs[0]?.input), output: String(outputs[0]?.output) };
}

function expectNoLeak(text: string) {
  for (const v of Object.values(CANARIES)) expect(text).not.toContain(v);
  expect(text).not.toContain(CANARIES.email.split('@')[0]);
}

describe('TRACE-AGENT-VIS bounded tool summaries', () => {
  it('leak gate: no banned value survives any newly visible summary', () => {
    const tools: Array<[string, unknown, unknown]> = [
      ['search_providers_by_keyword', { keyword: CANARIES.phone, page: 1 }, { providers: [{ id: 1, title: CANARIES.email }], status: 'ok' }],
      ['create_quote_request', { provider_id: 7, user_id: 9, name: 'Ana', email: CANARIES.email, phone: CANARIES.phone, phone_extension: '+51', event_date: '2026-10-18', guests_range: '10-20', description: CANARIES.stack }, { id: CANARIES.synthetic, status: 'simulated', stack: CANARIES.stack }],
      ['get_provider_detail', { provider_id: 3 }, { id: 3, phone: CANARIES.phone, email: CANARIES.email, raw: { token: CANARIES.token } }],
      ['guest_rsvp', { action: 'confirm', guest_id: 5, trusted_phone_present: true }, { status: 'responded', action: 'confirm', guestId: 5, queue: CANARIES.queue, ticket: CANARIES.ticket }],
      ['lookup_rsvp_invitations', { trusted_phone_present: true }, { status: 'ok', invitations: [{ event_id: 1, otp: CANARIES.otp }] }],
    ];
    for (const [tool, input, output] of tools) {
      const { input: si, output: so } = safeFor(tool, input, output);
      expectNoLeak(si);
      expectNoLeak(so);
    }
  });

  it('structured summaries per tool, no raw payloads', () => {
    let r = safeFor('search_providers_by_keyword', { keyword: 'catering lima', page: 2 }, { providers: [{ id: 11 }, { id: 22 }], total: 2 });
    expect(r.input).toContain('page');
    expect(r.input).not.toContain('catering lima');
    expect(r.output).toContain('11');

    r = safeFor('get_provider_detail', { provider_id: 42 }, { id: 42, title: 'Salon Real' });
    expect(r.input).toContain('42');
    expect(r.output).toContain('42');
    expect(r.output).not.toContain('Salon Real');

    r = safeFor('create_quote_request', { provider_id: 7, user_id: 9, name: 'Ana', email: 'a@b.com', phone: '+51999', phone_extension: '+51', event_date: '2026-10-18', guests_range: '10-20', description: 'hola mundo' }, { id: 'synth-abcdef0123456789', status: 'simulated', providerId: 7, eventDate: '2026-10-18' });
    expect(r.input).toContain('2026-10-18');
    expect(r.input).not.toContain('a@b.com');
    expect(r.input).not.toContain('Ana');
    expect(r.output).not.toContain('synth-abcdef0123456789');
    expect(r.output).toContain('simulated');

    r = safeFor('finish_plan', { event_date: '2026-10-18' }, { status: 'success', eventDate: '2026-10-18', contacted_providers: [{ providerId: 1, category: 'Catering', success: true }] });
    expect(r.input).toContain('2026-10-18');
    expect(r.output).toContain('success');

    r = safeFor('guest_rsvp', { action: 'confirm', guest_id: 5, trusted_phone_present: true }, { status: 'responded', action: 'confirm', guestId: 5 });
    expect(r.output).toContain('responded');

    r = safeFor('lookup_rsvp_invitations', { trusted_phone_present: true }, { status: 'authoritative_invitation', invitations: [{ event_id: 1 }] });
    expect(r.output).toContain('authoritative_invitation');

    // Unknown tools stay omitted (deny by default, S03 excluded).
    r = safeFor('s03_upstream_proposal', { q: 'x' }, { r: 1 });
    expect(r.input).toBe('[omitted]');
    expect(r.output).toBe('[omitted]');
  });

  it('byte growth bounded per entry', () => {
    const base = JSON.stringify(projectSafeTrace({ trace_id: 't', plan_id: 'p' })).length;
    const expanded = JSON.stringify(
      projectSafeTrace({
        trace_id: 't',
        plan_id: 'p',
        tool_inputs: [{ tool: 'search_providers_by_keyword', input: JSON.stringify({ keyword: 'x'.repeat(500), page: 1 }) }],
        tool_outputs: [{ tool: 'search_providers_by_keyword', output: JSON.stringify({ providers: Array.from({ length: 50 }, (_, i) => ({ id: i, title: 't'.repeat(200) })) }) }],
      }),
    ).length;
    const growth = expanded - base;
    // Recorded: must stay under 2KB for one tool pair (structured summary only).
    expect(growth).toBeLessThan(2048);
  });
});
