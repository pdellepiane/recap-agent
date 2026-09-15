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
import { createEmptyPlan, mergePlan } from '../src/core/plan';
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

function baseExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
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
    conversationSummary: 'Resumen de prueba.',
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

function serviceWith(
  runtime: AgentRuntime,
  planStore: InMemoryPlanStore,
  manifest: ReturnType<typeof buildRuntimeCapabilityManifest>,
): AgentService {
  return new AgentService({
    planStore,
    runtime,
    providerGateway: {} as ProviderGateway,
    agentConversationGateway: new NoopAgentConversationGateway('not_configured'),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    capabilityManifest: manifest,
  });
}

function quoteWriteBlockedManifest() {
  return buildRuntimeCapabilityManifest({
    configured: true,
    environment: 'production',
    allowCustomerWrites: true,
    featureFlags: { providerPlanning: true, providerQuoteRequests: false },
  });
}

function emailOtpBlockedManifest() {
  return buildRuntimeCapabilityManifest({
    configured: true,
    environment: 'production',
    allowCustomerWrites: true,
    featureFlags: { providerPlanning: true, providerQuoteRequests: true, emailOtp: false },
  });
}

describe('W1-10 catastrophic fix: Miraflores selection yield', () => {
  it('routes a location selection with an unsupported quote op to the model, not the deterministic fallback', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'w1-10-miraflores', channel: 'whatsapp', externalUserId: 'w1-10-user' }),
      {
        current_node: 'recomendar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Catering' as never,
        vendor_category: 'Catering' as never,
        provider_needs: [
          {
            category: 'Catering' as never,
            status: 'shortlisted',
            preferences: ['comida japonesa'],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [90, 109],
            recommended_providers: [
              { id: 90, title: 'Opción Esencial', category: 'Catering', location: 'Miraflores', priceLevel: 'low', reason: 'alternativa ubicada en Miraflores', serviceHighlights: [], termsHighlights: [] },
              { id: 109, title: 'EDO Sushi Bar', category: 'Catering', location: 'Barranco', priceLevel: 'high', reason: 'alternativa ubicada en Barranco', serviceHighlights: [], termsHighlights: [] },
            ] as never,
            sub_query_results: [],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const runtime = new ScriptedRuntime(baseExtraction({
      actionIntent: 'confirmar_proveedor',
      requestedOperation: 'provider.quote.write',
      selectedProviderHints: ['la opción de Miraflores', 'Opción Esencial'],
      selectedProviderReferences: [
        { providerId: 90, providerTitle: 'Opción Esencial', category: 'Catering' as never, hint: 'la opción de Miraflores' },
      ],
    }));
    const response = await serviceWith(runtime, planStore, quoteWriteBlockedManifest()).handleTurn({
      channel: 'whatsapp',
      externalUserId: 'w1-10-user',
      text: 'Quiero la opción que está en Miraflores.',
      messageId: 'w1-10-miraflores-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.trace.prompt_bundle_id).not.toBe('deterministic:unsupported_operation');
    expect(runtime.composeRequests.length).toBeGreaterThan(0);
    expect(response.outbound.text).toBe(`reply:${response.trace.next_node}`);
    const catering = response.plan.provider_needs.find((need) => need.category === 'Catering');
    expect(catering?.selected_provider_ids).toEqual([90]);
  });
});

describe('W1-10 catastrophic fix: close-contact email yield', () => {
  it('persists a close-flow email when the extractor also reports an unsupported email-otp operation', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'w1-10-close', channel: 'whatsapp', externalUserId: 'w1-10-close-user' }),
      {
        current_node: 'crear_lead_cerrar',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video' as never,
        vendor_category: 'Fotografía y video' as never,
        contact_name: 'Carolina',
        provider_needs: [
          {
            category: 'Fotografía y video' as never,
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [90],
            recommended_providers: [
              { id: 90, title: 'Carlos Schult', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'seleccionado', serviceHighlights: [], termsHighlights: [] },
            ] as never,
            sub_query_results: [],
            selected_provider_ids: [90],
            selected_provider_hints: ['Carlos Schult'],
          },
        ],
      } as never,
    );
    await planStore.save({ plan: seed, reason: 'seed' });
    const runtime = new ScriptedRuntime(baseExtraction({
      requestedOperation: 'auth.email_otp',
      contactEmail: 'carolina@example.com',
    }));
    const response = await serviceWith(runtime, planStore, emailOtpBlockedManifest()).handleTurn({
      channel: 'whatsapp',
      externalUserId: 'w1-10-close-user',
      text: 'mi correo es carolina@example.com',
      messageId: 'w1-10-close-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.trace.prompt_bundle_id).not.toBe('deterministic:unsupported_operation');
    expect(runtime.composeRequests.length).toBeGreaterThan(0);
    expect(response.plan.contact_email).toBe('carolina@example.com');
  });
});

describe('W1-10 catastrophic fix: close continuity evidence', () => {
  it('projects email already-provided and dispatch-ready facts only on the close node', async () => {
    const { closeContinuityFacts } = await import('../src/runtime/openai-agent-runtime');

    expect(closeContinuityFacts({ currentNode: 'recomendar', contactEmail: 'carolina@example.com', contactComplete: true, selectedProviderPresent: true, closeActionType: 'proceed_confirmed', lifecycleState: 'active', hasUserEventDate: true })).toEqual({});
    expect(closeContinuityFacts({ currentNode: 'crear_lead_cerrar', contactEmail: null, contactComplete: false, selectedProviderPresent: true, closeActionType: null, lifecycleState: 'active' })).toEqual({});
    expect(closeContinuityFacts({ currentNode: 'crear_lead_cerrar', contactEmail: 'carolina@example.com', contactComplete: false, selectedProviderPresent: true, closeActionType: null, lifecycleState: 'active' })).toEqual({ contact_email_already_provided: true });
    expect(closeContinuityFacts({ currentNode: 'crear_lead_cerrar', contactEmail: 'carolina@example.com', contactComplete: true, selectedProviderPresent: true, closeActionType: 'proceed_confirmed', lifecycleState: 'active', hasUserEventDate: true })).toEqual({ contact_email_already_provided: true, close_ready_to_dispatch: true });
    expect(closeContinuityFacts({ currentNode: 'crear_lead_cerrar', contactEmail: 'carolina@example.com', contactComplete: true, selectedProviderPresent: true, closeActionType: 'proceed_confirmed', lifecycleState: 'finished' })).toEqual({ contact_email_already_provided: true });
  });
});
