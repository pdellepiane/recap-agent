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

function quoteWriteBlockedManifest() {
  return buildRuntimeCapabilityManifest({
    configured: true,
    environment: 'production',
    allowCustomerWrites: true,
    featureFlags: { providerPlanning: true, providerQuoteRequests: false },
  });
}

describe('token defer close yield: close intent with unsupported quote op reaches the model', () => {
  it('yields a confirm_close turn with selected photo and deferred catering to model compose, without finish_plan', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({ planId: 'defer-close-turn2', channel: 'whatsapp', externalUserId: 'defer-close-user' }),
      {
        current_node: 'seguir_refinando_guardar_plan',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video' as never,
        vendor_category: 'Fotografía y video' as never,
        provider_needs: [
          {
            category: 'Fotografía y video' as never,
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [90],
            recommended_providers: [
              { id: 90, title: 'Carlos Schult', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'opción foto', serviceHighlights: [], termsHighlights: [] },
            ] as never,
            sub_query_results: [],
            selected_provider_ids: [90],
            selected_provider_hints: ['Carlos Schult'],
          },
          {
            category: 'Catering' as never,
            status: 'deferred',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [109],
            recommended_providers: [
              { id: 109, title: 'EDO Sushi Bar', category: 'Catering', location: 'Lima', priceLevel: 'high', reason: 'opción catering', serviceHighlights: [], termsHighlights: [] },
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
      actionIntent: 'cerrar',
      requestedOperation: 'provider.quote.write',
      closeAction: { type: 'confirm_close', category: null, reason: null },
    }));
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as ProviderGateway,
      agentConversationGateway: new NoopAgentConversationGateway('not_configured'),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      capabilityManifest: quoteWriteBlockedManifest(),
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'defer-close-user',
      text: 'ahora cerremos el plan',
      messageId: 'defer-close-turn2',
      receivedAt: new Date().toISOString(),
    });

    expect(response.trace.prompt_bundle_id).not.toBe('deterministic:unsupported_operation');
    expect(runtime.composeRequests.length).toBeGreaterThan(0);
    expect(response.outbound.text).toBe(`reply:${response.trace.next_node}`);
    expect(response.trace.tools_called).not.toContain('finish_plan');
    // R5: the close continuation projects only the eligible selection.
    // Deferred Catering (and its EDO card) never substitutes for Photography.
    expect(runtime.composeRequests).toHaveLength(1);
    const composed = runtime.composeRequests[0];
    expect(composed?.providerResults.map((entry) => entry.id)).toEqual([90]);
    expect(composed?.providerResults.some((entry) => entry.category === 'Catering')).toBe(false);
    const photo = response.plan.provider_needs.find((need) => need.category === 'Fotografía y video');
    expect(photo?.selected_provider_ids).toEqual([90]);
    const catering = response.plan.provider_needs.find((need) => need.category === 'Catering');
    expect(catering?.status).toBe('deferred');
  });
});

describe('packet C deferred closure: resolved records never reopen as selection', () => {
  function seedSelectedPlusDeferred() {
    return mergePlan(
      createEmptyPlan({ planId: 'defer-close-guard', channel: 'whatsapp', externalUserId: 'defer-close-guard-user' }),
      {
        current_node: 'seguir_refinando_guardar_plan',
        event_type: 'boda',
        location: 'Lima',
        guest_range: '51-100',
        active_need_category: 'Fotografía y video' as never,
        vendor_category: 'Fotografía y video' as never,
        provider_needs: [
          {
            category: 'Fotografía y video' as never,
            status: 'selected',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [90],
            recommended_providers: [
              { id: 90, title: 'Carlos Schult', category: 'Fotografía y video', location: 'Lima', priceLevel: null, reason: 'opción foto', serviceHighlights: [], termsHighlights: [] },
            ] as never,
            sub_query_results: [],
            selected_provider_ids: [90],
            selected_provider_hints: ['Carlos Schult'],
          },
          {
            category: 'Catering' as never,
            status: 'deferred',
            preferences: [],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [109],
            recommended_providers: [
              { id: 109, title: 'EDO Sushi Bar', category: 'Catering', location: 'Lima', priceLevel: 'high', reason: 'opción catering', serviceHighlights: [], termsHighlights: [] },
            ] as never,
            sub_query_results: [],
            selected_provider_ids: [],
            selected_provider_hints: [],
          },
        ],
      } as never,
    );
  }

  function guardService(planStore: InMemoryPlanStore, extraction: ExtractionResult) {
    const runtime = new ScriptedRuntime(extraction);
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as ProviderGateway,
      agentConversationGateway: new NoopAgentConversationGateway('not_configured'),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      capabilityManifest: quoteWriteBlockedManifest(),
    });
    return { service, runtime };
  }

  it('retomar_plan with selected photo and deferred catering never becomes provider_selection_ambiguous', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: seedSelectedPlusDeferred(), reason: 'seed' });
    const { service, runtime } = guardService(planStore, baseExtraction({ actionIntent: 'retomar_plan' }));
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'defer-close-guard-user',
      text: 'quiero retomar mi plan',
      messageId: 'defer-close-guard-1',
      receivedAt: new Date().toISOString(),
    });
    expect(response.trace.next_node).not.toBe('aclarar_pedir_faltante');
    expect(response.trace.turn_decision?.stopReason ?? null).not.toBe('provider_selection_ambiguous');
    const composed = runtime.composeRequests[0]?.extraction;
    expect(composed?.ambiguity?.status).toBe('clear');
    expect((composed?.ambiguity?.interpretations ?? []).join(' ')).not.toContain('provider:shortlisted');
    expect(response.plan.provider_needs.find((need) => need.category === 'Fotografía y video')?.selected_provider_ids).toEqual([90]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.status).toBe('deferred');
  });

  it('a bare ambiguous turn with selected photo and deferred catering injects no shortlist alternatives', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: seedSelectedPlusDeferred(), reason: 'seed' });
    const { service, runtime } = guardService(planStore, baseExtraction({
      actionIntent: null,
      ambiguity: { status: 'ambiguous', clarificationQuestion: null, interpretations: ['algo sin resolver'] },
    }));
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'defer-close-guard-user',
      text: 'mmm, no sé',
      messageId: 'defer-close-guard-2',
      receivedAt: new Date().toISOString(),
    });
    expect(response.trace.turn_decision?.stopReason ?? null).not.toBe('provider_selection_ambiguous');
    const interpretations = runtime.composeRequests[0]?.extraction.ambiguity?.interpretations ?? [];
    expect(interpretations.join(' ')).not.toContain('provider:shortlisted');
    expect(response.plan.provider_needs.find((need) => need.category === 'Fotografía y video')?.selected_provider_ids).toEqual([90]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.status).toBe('deferred');
  });

  it('ahora cerremos el plan with a conflicting pause mark continues the close flow', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: seedSelectedPlusDeferred(), reason: 'seed' });
    // Live token_seeded_selection_defer_close shape: the extractor emits an
    // explicit close together with a conflicting pause mark. The close must
    // win; the pause mark dissolves and persisted state is only inspected,
    // never recited as a forced provider list.
    const { service, runtime } = guardService(planStore, baseExtraction({
      actionIntent: 'cerrar',
      pauseRequested: true,
      requestedOperation: 'provider.quote.write',
      closeAction: { type: 'confirm_close', category: null, reason: null },
    }));
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'defer-close-guard-user',
      text: 'ahora cerremos el plan',
      messageId: 'defer-close-pause-conflict',
      receivedAt: new Date().toISOString(),
    });
    expect(response.trace.next_node).toBe('crear_lead_cerrar');
    expect(response.trace.next_node).not.toBe('guardar_cerrar_temporalmente');
    expect(runtime.composeRequests).toHaveLength(1);
    const composed = runtime.composeRequests[0];
    expect(composed?.providerResults.map((entry) => entry.id)).toEqual([90]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Fotografía y video')?.selected_provider_ids).toEqual([90]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.status).toBe('deferred');
  });

  it('a pause mark without close intent enters no explicit pause state', async () => {
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: seedSelectedPlusDeferred(), reason: 'seed' });
    // No explicit pause state exists: pausing is the user not writing. A
    // pause mark dissolves and the turn continues normal handling instead
    // of entering guardar_cerrar_temporalmente.
    const { service, runtime } = guardService(planStore, baseExtraction({
      actionIntent: 'pausar',
      pauseRequested: true,
    }));
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'defer-close-guard-user',
      text: 'guardo el avance por ahora',
      messageId: 'defer-close-pause-only',
      receivedAt: new Date().toISOString(),
    });
    expect(response.trace.next_node).not.toBe('guardar_cerrar_temporalmente');
    expect(response.outbound.delivery.action).toBe('send');
    expect(runtime.composeRequests.length).toBeGreaterThan(0);
    expect(response.plan.provider_needs.find((need) => need.category === 'Fotografía y video')?.selected_provider_ids).toEqual([90]);
    expect(response.plan.provider_needs.find((need) => need.category === 'Catering')?.status).toBe('deferred');
  });
});
