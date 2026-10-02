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
    externalUserId: 'spanish-only-multi-need',
    text,
    messageId: `message-${text.length}`,
    receivedAt: '2026-09-04T00:00:00.000Z',
  };
}

describe('spanish-only mixed-request retention', () => {
  it('retains planning with a secondary capability question and stays byte-identical without one', async () => {
    const planning: Partial<ExtractionResult> = {
      actionIntent: 'elicitar_necesidades',
      eventType: 'baby_shower',
      vendorCategory: 'Catering',
      vendorCategories: ['Catering'],
      location: 'Miraflores',
    };
    const runtime = new ScriptedRuntime(extraction({
      ...planning,
      requestedOperation: 'confirmation_document.send',
    }));

    const response = await service(runtime).handleTurn(
      inbound('Necesito catering para un baby shower en Miraflores. Please send the RSVP link by email.'),
    );

    const last = runtime.composeRequests.at(-1);
    // Planning still served on the planning owner, not swallowed by the boundary.
    expect(last?.currentNode).not.toBe('resolver_consultas_informativas');
    // Secondary capability question projected as available evidence, never dropped.
    expect(last?.capabilityDecision).toMatchObject({
      status: 'unsupported',
      operation: 'confirmation_document.send',
    });
    // Unresolved work preserved through the owner transfer packet.
    expect(response.plan.owner_pending_task).toBe('capability:confirmation_document.send');
    // One owner serves both needs; no forced new agent or escalation.
    expect(response.plan.owner).toBe('planning');
    expect(response.plan.human_escalation.status).toBe('none');

    // Without a secondary capability operation the turn carries no
    // capability packet at all.
    const plainRuntime = new ScriptedRuntime(extraction({
      ...planning,
      requestedOperation: null,
    }));

    const plainResponse = await service(plainRuntime).handleTurn(
      inbound('Necesito catering para un baby shower en Miraflores.'),
    );

    const plainLast = plainRuntime.composeRequests.at(-1);
    expect(plainLast?.capabilityDecision).toBeUndefined();
    expect(plainResponse.plan.owner_pending_task).toBeNull();
    expect(plainResponse.plan.owner).toBe('planning');
  });
});
