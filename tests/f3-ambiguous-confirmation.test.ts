import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { buildRuntimeCapabilityManifest, type RuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import type { PurchaseInformation } from '../src/core/information';

const MODEL_REPLY = 'Respuesta escrita por el modelo para esta aclaración.';

function planningExtraction(
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    supportAct: null,
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: 0.9,
    ambiguity: { status: 'ambiguous', clarificationQuestion: null, interpretations: [] },
    eventType: 'boda',
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: 'Fotografía y video',
    location: 'Lima',
    budgetSignal: null,
    guestRange: '51-100',
    preferences: ['estilo natural'],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: 'Shortlist de fotografia.',
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
  } as unknown as ExtractionResult;
}

function seedPlanningPlan(planId: string) {
  return mergePlan(
    createEmptyPlan({ planId, channel: 'whatsapp', externalUserId: 'u-f3d' }),
    {
      current_node: 'recomendar',
      event_type: 'boda',
      location: 'Lima',
      guest_range: '51-100',
      active_need_category: 'Fotografía y video',
      vendor_category: 'Fotografía y video',
      provider_needs: [
        {
          category: 'Fotografía y video',
          status: 'shortlisted',
          preferences: ['estilo natural'],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [90, 91],
          recommended_providers: [
            {
              id: 90,
              title: 'Carlos Schult',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: null,
              reason: 'primera opción presentada',
              serviceHighlights: [],
              termsHighlights: [],
            },
            {
              id: 91,
              title: 'Fotografía Alternativa',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: null,
              reason: 'segunda opción presentada',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
          selected_provider_ids: [],
          selected_provider_hints: [],
        },
      ],
      selected_provider_ids: [],
    },
  );
}

async function runPlanningTurn(extraction: ExtractionResult, text = 'Sí confirmo.', manifest?: RuntimeCapabilityManifest) {
  const store = new InMemoryPlanStore();
  await store.save({ plan: seedPlanningPlan('p-f3d'), reason: 'seed' });
  const composeRequests: ComposeReplyRequest[] = [];
  const gateway = {
    async logMessage(input: unknown) {
      void input;
      return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success', messages: [] };
    },
    async requestHumanTakeover() {
      return { status: 'success', message: 'Requested.' };
    },
    async authByPhone() {
      return { status: 'failed', error: 'Unused.', retryable: false };
    },
    async updatePhone() {
      return { status: 'success' };
    },
    async getGuestEventsByPhone() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
    async getEventDetail() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
  } as unknown as AgentConversationGateway;
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return extraction;
      },
      async composeReply(request: ComposeReplyRequest) {
        composeRequests.push(request);
        return {
          text: MODEL_REPLY,
          structuredMessage: {
            type: 'generic',
            paragraphs_es: [MODEL_REPLY],
          },
        };
      },
    } as unknown as AgentRuntime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    ...(manifest ? { capabilityManifest: manifest } : {}),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'u-f3d',
    text,
    messageId: 'm-f3d-1',
    receivedAt: '2026-09-04T15:01:00.000Z',
  });
  return { ...response, composeRequests };
}

describe('F3d bare confirmation over a multi-option shortlist', () => {
  it('asks which provider or action is confirmed instead of assuming it', async () => {
    const result = await runPlanningTurn(planningExtraction());
    expect(result.outbound.text).toBe(MODEL_REPLY);
    expect(result.composeRequests[0]?.currentNode).toBe('aclarar_pedir_faltante');
    expect(result.composeRequests[0]?.extraction.ambiguity?.status).toBe('ambiguous');
    const alternatives = result.composeRequests[0]?.extraction.ambiguity?.interpretations ?? [];
    expect(alternatives).toEqual([
      'provider:shortlisted:Fotografía y video',
      'provider:shortlisted:Fotografía y video',
    ]);
    expect(alternatives.join(' ')).not.toContain('Carlos Schult');
    expect(alternatives.join(' ')).not.toContain('Fotografía Alternativa');
  });

  it('keeps asking when the confirmation intent has no grounded reference', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'confirmar_proveedor',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      }),
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
    expect(result.composeRequests[0]?.currentNode).toBe('aclarar_pedir_faltante');
  });

  it('does not ask when the user names a shortlisted provider', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'confirmar_proveedor',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        selectedProviderHints: ['Carlos Schult'],
      }),
      'Sí, confirmo a Carlos Schult.',
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
    expect(result.composeRequests[0]?.extraction.selectedProviderHints).toContain('Carlos Schult');
  });

  it('asks on a bare confirmation even when the extractor marks it clear', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: null,
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        eventType: null,
        activeNeedCategory: null,
        location: null,
        guestRange: null,
        preferences: [],
      }),
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
    expect(result.composeRequests[0]?.currentNode).toBe('aclarar_pedir_faltante');
  });

  it('asks on a hollow browse intent over the shortlist', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'ver_opciones',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        eventType: null,
        activeNeedCategory: null,
        location: null,
        guestRange: null,
        preferences: [],
      }),
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
    expect(result.composeRequests[0]?.currentNode).toBe('aclarar_pedir_faltante');
  });

  it('does not ask on a browse intent carrying a refinement', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'ver_opciones',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        preferences: ['estilo documental'],
      }),
      'Quiero ver opciones con estilo documental.',
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
  });

  it('does not ask on a modify intent carrying selection operations', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'modificar_plan_proveedores',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        eventType: null,
        activeNeedCategory: null,
        location: null,
        guestRange: null,
        preferences: [],
        providerPlanOperations: [
          {
            type: 'select_provider',
            category: 'Fotografía y video',
            preferences: [],
            hardConstraints: [],
            queryIntent: null,
            rerunSearch: false,
            provider: {
              providerId: 90,
              providerTitle: null,
              category: 'Fotografía y video',
              hint: null,
            },
            removeProvider: null,
            addProvider: null,
          },
        ],
      }),
      'Agrega a Carlos Schult y sigamos.',
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
  });

  it('asks on a bare confirmation even when the extractor attaches capability candidates', async () => {
    const manifest = buildRuntimeCapabilityManifest({ disabledOperations: ['provider.quote.write'] });
    const result = await runPlanningTurn(
      planningExtraction({
        ambiguity: {
          status: 'ambiguous',
          clarificationQuestion: '¿Qué deseas confirmar?',
          interpretations: ['Confirmar un proveedor de fotografía', 'Confirmar un dato o acción pendiente'],
          candidateOperations: ['provider.quote.write', 'provider.search'],
        },
      }),
      'Sí confirmo.',
      manifest,
    );
    const text = result.outbound.text ?? '';
    expect(text).toBe(MODEL_REPLY);
    expect(result.composeRequests[0]?.extraction.ambiguity?.candidateOperations).toEqual([
      'provider.quote.write',
      'provider.search',
    ]);
  });
});

function carinaExtraction(
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return planningExtraction({
    actionIntent: null,
    informationRequests: [
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'Necesito una conformidad de pago.',
        orderId: null,
        authAction: 'none',
      },
    ],
    ambiguity: {
      status: 'ambiguous',
      clarificationQuestion: '¿Necesitas el estado del pago o enviar la constancia?',
      interpretations: ['Consultar estado del pago', 'Enviar constancia de pago'],
      candidateOperations: ['purchase.orders.read', 'confirmation_document.send'],
      questionKey: 'status_or_document',
    },
    eventType: null,
    activeNeedCategory: null,
    location: null,
    guestRange: null,
    preferences: [],
    ...overrides,
  } as unknown as Partial<ExtractionResult>);
}

function seedInformationPlan(planId: string) {
  return mergePlan(
    createEmptyPlan({ planId, channel: 'whatsapp', externalUserId: 'u-carina' }),
    {
      current_node: 'resolver_consultas_informativas',
      contact_phone: '51987654321',
      contact_phone_extension: '+51',
      contact_phone_number: '987654321',
    },
  );
}

function carinaPurchase(): PurchaseInformation {
  return {
    orderId: 'ORD-CARINA-1',
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 3173.81,
    paymentMethod: 'Transferencia',
    eventName: 'Baby Shower Catalina',
    eventDate: '2026-10-04',
    eventUrl: null,
    createdAt: '2026-09-01',
    items: [],
    paymentValidationExpectation: { maxBusinessHours: 72, appliesTo: 'indexed_validation_methods' },
  };
}

async function runInformationTurn(extraction: ExtractionResult, text: string) {
  const store = new InMemoryPlanStore();
  await store.save({ plan: seedInformationPlan('p-carina'), reason: 'seed' });
  const composeRequests: ComposeReplyRequest[] = [];
  const gateway = {
    async logMessage(input: unknown) {
      void input;
      return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success', messages: [] };
    },
    async requestHumanTakeover() {
      return { status: 'success', message: 'Requested.' };
    },
    async authByPhone() {
      return { status: 'failed', error: 'Unused.', retryable: false };
    },
    async updatePhone() {
      return { status: 'success' };
    },
    async getGuestEventsByPhone() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
    async getGuestOrdersByPhone() {
      return {
        status: 'success',
        resource: 'orders',
        purchases: [carinaPurchase()],
      };
    },
    async getEventDetail() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
  } as unknown as AgentConversationGateway;
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return extraction;
      },
      async composeReply(request: ComposeReplyRequest) {
        composeRequests.push(request);
        return {
          text: MODEL_REPLY,
          structuredMessage: {
            type: 'generic',
            paragraphs_es: [MODEL_REPLY],
          },
        };
      },
    } as unknown as AgentRuntime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'u-carina',
    text,
    messageId: 'm-carina-1',
    receivedAt: '2026-09-04T15:01:00.000Z',
  });
  return { ...response, composeRequests, service };
}

/** L3 safeguard detector: raw model ambiguity must survive normalization. */
function detectsAmbiguityClearing(
  raw: ExtractionResult,
  normalized: ExtractionResult,
): boolean {
  return raw.ambiguity?.status === 'ambiguous' &&
    normalized.ambiguity?.status !== 'ambiguous';
}

/** L3 mutant mirroring the removed blanket ambiguous-to-clear override. */
function clearAmbiguityMutant(extraction: ExtractionResult): ExtractionResult {
  return {
    ...extraction,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
      candidateOperations: [],
      questionKey: null,
    },
  };
}

describe('L3 Carina status-or-document ambiguity', () => {
  it('keeps a purchase-shaped Carina conflict ambiguous through the production normalizer', async () => {
    const raw = carinaExtraction();
    const service = (await runInformationTurn(raw, 'Necesito una conformidad de pago.')).service;
    const normalized = (
      service as unknown as {
        normalizeInformationExtractionAmbiguity: (
          extraction: ExtractionResult,
        ) => ExtractionResult;
      }
    ).normalizeInformationExtractionAmbiguity(raw);

    expect(normalized.ambiguity?.status).toBe('ambiguous');
    expect(normalized.ambiguity?.interpretations).toEqual([
      'Consultar estado del pago',
      'Enviar constancia de pago',
    ]);
    expect(normalized.ambiguity?.candidateOperations).toEqual([
      'purchase.orders.read',
      'confirmation_document.send',
    ]);
    expect(normalized.ambiguity?.questionKey).toBe('status_or_document');
    expect(detectsAmbiguityClearing(raw, normalized)).toBe(false);
  });

  it('serves a purchase-shaped Carina conflict through the information flow, not capability clarification', async () => {
    const result = await runInformationTurn(
      carinaExtraction(),
      'Necesito una conformidad de pago.',
    );

    expect(result.outbound.text).toBe(MODEL_REPLY);
    // The available purchase read serves the fact: mixed-availability
    // ambiguity never preempts the information flow with a question.
    expect(result.trace.capability_decision ?? null).toBeNull();
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    const purchaseLookup = result.trace.information_execution_summary.find(
      (entry) => entry.kind === 'purchase',
    );
    expect(purchaseLookup?.outcomeCode).toBe('completed_with_results');
    expect(purchaseLookup?.resultCount).toBe(1);
    expect(purchaseLookup?.resource).toBe('orders');
    // The model receives customer records from the canonical profile, not a
    // second purchase-fact copy in execution evidence.
    expect(result.composeRequests[0]?.customerContext?.purchases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grandTotal: 3173.81, eventName: 'Baby Shower Catalina' }),
      ]),
    );
    // Extraction ambiguity still survives normalization on the composed turn.
    expect(result.composeRequests[0]?.extraction.ambiguity?.status).toBe('ambiguous');
    expect(
      result.composeRequests[0]?.extraction.ambiguity?.interpretations,
    ).toEqual(['Consultar estado del pago', 'Enviar constancia de pago']);
  });

  it('negative control l3-mutant-clear-ambiguity: clearing is detected', async () => {
    const raw = carinaExtraction();
    const mutated = clearAmbiguityMutant(raw);

    expect(mutated.ambiguity?.status).toBe('clear');
    expect(detectsAmbiguityClearing(raw, mutated)).toBe(true);
  });
});
