import { describe, expect, it } from 'vitest';

import { projectSafeTrace } from '../src/runtime/artifact-redaction';
import { buildFinishPlanSummary, buildProviderQuoteReceipts } from '../src/runtime/finish-plan-debug';

describe('F4 trace unredact', () => {
  it('projects the finish_plan allowlist and omits everything else', () => {
    const trace = {
      trace_id: 't1',
      plan_id: 'p1',
      tool_inputs: [{ tool: 'finish_plan', input: JSON.stringify({ event_date: '2026-10-18', name: 'Carolina' }) }],
      tool_outputs: [{
        tool: 'finish_plan',
        output: JSON.stringify({
          status: 'partial',
          eventDate: '2026-10-18',
          contacted_providers: [
            { providerId: 101, category: 'Catering', success: true },
            { providerId: 202, category: 'Musica', success: false, error: 'Fixture quote request requires an explicitly captured event date.' },
          ],
          effects: [{ providerId: 101, receiptId: 'secret-id', eventDate: '2026-10-18' }],
          planUpdate: { contact_email: 'a@b.com' },
        }),
      }],
      finish_plan_summary: { status: 'partial', eventDate: '2026-10-18', confirmedCount: 1, pendingProviderIds: [202], errorKind: 'failed' },
      provider_quote_receipts: [{ providerId: 101, eventDate: '2026-10-18', resultStatus: 'confirmed', attempt: 1 }],
    };
    const safe = projectSafeTrace(trace) as Record<string, unknown>;
    const inputs = safe.tool_inputs as Array<Record<string, unknown>>;
    const outputs = safe.tool_outputs as Array<Record<string, unknown>>;
    expect(inputs[0]?.tool).toBe('finish_plan');
    expect(String(inputs[0]?.input)).toContain('2026-10-18');
    expect(String(inputs[0]?.input)).not.toContain('Carolina');
    expect(String(outputs[0]?.output)).toContain('2026-10-18');
    expect(String(outputs[0]?.output)).toContain('101');
    expect(String(outputs[0]?.output)).not.toContain('secret-id');
    expect(String(outputs[0]?.output)).not.toContain('a@b.com');
    expect(String(outputs[0]?.output)).not.toContain('explicitly captured');
    expect(safe.finish_plan_summary).toBeDefined();
    expect(safe.provider_quote_receipts).toBeDefined();
    // Non-finish_plan payloads stay omitted.
    const other = projectSafeTrace({
      tool_inputs: [{ tool: 'search_providers', input: '{"q":"x"}' }],
      tool_outputs: [{ tool: 'search_providers', output: '{"providers":[]}' }],
    }) as Record<string, unknown>;
    expect((other.tool_inputs as Array<Record<string, unknown>>)[0]?.input).toBe('[omitted]');
    expect((other.tool_outputs as Array<Record<string, unknown>>)[0]?.output).toBe('[omitted]');
  });

  it('builds S12 summaries with date and per-provider flags', () => {
    const toolUsage = {
      considered: ['finish_plan'],
      called: ['finish_plan'],
      inputs: [{ tool: 'finish_plan', input: JSON.stringify({ event_date: '2026-10-18' }) }],
      outputs: [{
        tool: 'finish_plan',
        output: JSON.stringify({
          status: 'success',
          eventDate: '2026-10-18',
          contacted_providers: [
            { providerId: 101, category: 'Catering', success: true },
            { providerId: 202, category: 'Musica', success: true },
          ],
          effects: [
            { providerId: 101, category: 'Catering', status: 'confirmed', eventDate: '2026-10-18', receiptId: 'r1', error: null, attemptCount: 1 },
            { providerId: 202, category: 'Musica', status: 'confirmed', eventDate: '2026-10-18', receiptId: 'r2', error: null, attemptCount: 1 },
          ],
        }),
      }],
    };
    const summary = buildFinishPlanSummary(toolUsage);
    expect(summary?.eventDate).toBe('2026-10-18');
    expect(summary?.confirmedCount).toBe(2);
    expect(summary?.pendingProviderIds).toEqual([]);
    const receipts = buildProviderQuoteReceipts(toolUsage);
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toMatchObject({ providerId: 101, eventDate: '2026-10-18', resultStatus: 'confirmed', attempt: 1 });
  });
});
