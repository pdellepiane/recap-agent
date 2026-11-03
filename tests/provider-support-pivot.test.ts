import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan, type PlanSnapshot } from '../src/core/plan';
import { AgentService } from '../src/runtime/agent-service';
import type { ExtractionResult } from '../src/runtime/contracts';

const service = Object.create(AgentService.prototype) as {
  hasInformationWork: (plan: PlanSnapshot, extraction: ExtractionResult) => boolean;
};
const plan = mergePlan(createEmptyPlan({ planId: 'pivot', channel: 'whatsapp', externalUserId: 'synthetic' }), {
  current_node: 'resolver_consultas_informativas',
  information_state: {
    resume_node: 'entrevista',
    pending_requests: [{ requestId: 'pending', kind: 'purchase', resource: 'orders', query: 'Compra anterior', orderId: null, authAction: 'none' }],
    selection_candidates: [],
  },
});
const search = {
  actionIntent: 'buscar_proveedores', requestedOperation: 'provider.search',
  informationRequests: [], supportAct: null, ambiguity: { status: 'clear' },
} as unknown as ExtractionResult;

describe('provider search pivot from outstanding support', () => {
  it('allows a clear search and preserves the pending request', () => {
    expect(service.hasInformationWork(plan, search)).toBe(false);
    expect(plan.information_state.pending_requests).toHaveLength(1);
  });
  it('keeps explicit support work and ambiguous pivots in the information lane', () => {
    expect(service.hasInformationWork(plan, { ...search, informationRequests: [{ kind: 'faq', query: 'Consulta' }] })).toBe(true);
    expect(service.hasInformationWork(plan, { ...search, ambiguity: { status: 'ambiguous', clarificationQuestion: '¿Cuál?' } })).toBe(true);
  });
});

import path from 'node:path';
import { vi } from 'vitest';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

describe('conditional provider detail extraction', () => {
  it('runs a planning projection only after a clear typed search pivot', async () => {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key', replyModel: 'gpt-test', extractorModel: 'gpt-test',
      replyProviderLimit: 4, presentationProviderLimit: 5, providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve('prompts')), providerGateway: {} as never,
    });
    const runner = (runtime as unknown as { runner: { run: (...args: unknown[]) => Promise<unknown> } }).runner;
    const mock = vi.spyOn(runner, 'run')
      .mockResolvedValueOnce({ finalOutput: { actionIntent: 'buscar_proveedores', requestedOperation: 'provider.search', informationRequests: [] }, lastResponseId: 'first', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } })
      .mockResolvedValueOnce({ finalOutput: { actionIntent: 'buscar_proveedores', requestedOperation: 'provider.search', informationRequests: [], vendorCategory: 'Catering', activeNeedCategory: 'Catering', location: 'Lima' }, lastResponseId: 'second', usage: { input_tokens: 120, output_tokens: 15, total_tokens: 135 } });
    const result = await runtime.extract({ userMessage: 'Busco catering en Lima.', plan, messageContext: localTurnMessageContext('not_configured') });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.extraction.vendorCategory).toBe('Catering');
    expect(result.extraction.location).toBe('Lima');
    expect(result.tokenUsage?.total_tokens).toBe(245);
    expect(result.openAiCall?.attemptCount).toBe(2);
    const firstAgent = mock.mock.calls[0]?.[0] as { instructions: string };
    const secondAgent = mock.mock.calls[1]?.[0] as { instructions: string };
    expect(firstAgent.instructions).not.toContain('Extracción del plan de evento');
    expect(secondAgent.instructions).toContain('Extracción del plan de evento');
    expect(result.openAiCall?.requestMetrics.instructionBytes).toBe(
      Buffer.byteLength(firstAgent.instructions, 'utf8') + Buffer.byteLength(secondAgent.instructions, 'utf8'),
    );
    expect(result.openAiCall?.requestMetrics.inputBytes).toBe(
      Buffer.byteLength(String(mock.mock.calls[0]?.[1]), 'utf8') + Buffer.byteLength(String(mock.mock.calls[1]?.[1]), 'utf8'),
    );
  });

  it('does not issue a planning call for a normal support answer', async () => {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key', replyModel: 'gpt-test', extractorModel: 'gpt-test',
      replyProviderLimit: 4, presentationProviderLimit: 5, providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve('prompts')), providerGateway: {} as never,
    });
    const runner = (runtime as unknown as { runner: { run: (...args: unknown[]) => Promise<unknown> } }).runner;
    const mock = vi.spyOn(runner, 'run').mockResolvedValue({ finalOutput: { actionIntent: null, requestedOperation: null, informationRequests: [] }, lastResponseId: 'support' });
    await runtime.extract({ userMessage: 'Gracias.', plan, messageContext: localTurnMessageContext('not_configured') });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
