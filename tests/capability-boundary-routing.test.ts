import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { NoopAgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

class ScriptedRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(private readonly extraction: ExtractionResult) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return this.extraction;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: `reply:${request.currentNode}` };
  }
}

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: null,
    informationRequests: [],
    intentConfidence: 0.98,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
    },
    eventType: null,
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: null,
    location: null,
    budgetSignal: null,
    guestRange: null,
    preferences: [],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: 'Consulta de prueba.',
    selectedProviderHints: [],
    selectedProviderReferences: [],
    closeAction: null,
    pauseRequested: false,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
    ...overrides,
  };
}

function service(runtime: AgentRuntime): AgentService {
  return new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {} as ProviderGateway,
    agentConversationGateway: new NoopAgentConversationGateway('not_configured'),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    capabilityManifest: buildRuntimeCapabilityManifest({
      configured: true,
      environment: 'production',
      allowCustomerWrites: true,
      featureFlags: { providerPlanning: true },
    }),
  });
}

function inbound(text: string) {
  return {
    channel: 'whatsapp' as const,
    externalUserId: 'capability-boundary-routing',
    text,
    messageId: `message-${text}`,
    receivedAt: '2026-09-04T00:00:00.000Z',
  };
}

describe('capability boundary routing', () => {
  it('keeps a typed planning request when an unrelated unsupported operation is secondary', async () => {
    const runtime = new ScriptedRuntime(extraction({
      actionIntent: 'elicitar_necesidades',
      requestedOperation: 'confirmation_document.send',
      eventType: 'boda',
      vendorCategory: 'Locales',
      activeNeedCategory: 'Locales',
      vendorCategories: ['Locales'],
      location: 'Lima',
      guestRange: '51-100',
    }));

    const response = await service(runtime).handleTurn(inbound('Quiero planificar mi boda en Lima'));

    expect(response.trace.next_node).not.toBe('solicitar_agente_humano');
    expect(response.trace.route_kind).not.toBe('contextual_clarification');
    expect(response.trace.intent).toBe('elicitar_necesidades');
    expect(runtime.composeRequests.at(-1)?.currentNode).not.toBe('resolver_consultas_informativas');
  });

  it('keeps an explicit document request on the capability boundary', async () => {
    const runtime = new ScriptedRuntime(extraction({
      requestedOperation: 'confirmation_document.send',
    }));

    const response = await service(runtime).handleTurn(inbound('Necesito que me envíen la constancia'));

    expect(response.trace.prompt_bundle_id).toBe('deterministic:unsupported_operation');
    expect(response.outbound.text).toContain('constancia');
    expect(response.outbound.text).not.toContain('No puedo realizar esa gestión');
    expect(runtime.composeRequests).toHaveLength(0);
  });
});
