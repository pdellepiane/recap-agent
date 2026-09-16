import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import type {
  InformationExecutionSummary,
  InformationTaskResult,
  PurchaseInformation,
} from '../src/core/information';
import type {
  ComposeReplyRequest,
  ExtractionResult,
  ExtractRequest,
} from '../src/runtime/contracts';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import { instructionModuleRegistry } from '../src/runtime/prompt-manifest';
import {
  assembleCustomerContext,
  projectCustomerContext,
  type CustomerExecution,
  type CustomerContextProjection,
} from '../src/runtime/customer-context';

const NOW = '2026-09-16T12:00:00.000Z';

function testRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {
      async searchProviders(): Promise<never> {
        throw new Error('construction must not call the provider gateway');
      },
    } as never,
  });
}

function supportPlan(overrides: Record<string, unknown> = {}): PersistedPlan {
  return mergePlan(
    createEmptyPlan({ planId: 'actual-plan', channel: 'whatsapp', externalUserId: 'actual-user' }),
    { current_node: 'resolver_consultas_informativas', ...overrides },
  ) as PersistedPlan;
}

function baseExtraction(overrides: Record<string, unknown> = {}): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: null,
    reportedEventRole: null,
    informationRequests: [],
    supportAct: null,
    humanHelpIntent: null,
    normalizationIssues: [],
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: 'plan_state',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: null,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
      candidateOperations: [],
      questionKey: null,
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
    conversationSummary: '',
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
    imageReference: null,
    ...overrides,
  } as unknown as ExtractionResult;
}

function extractRequest(
  userMessage: string,
  plan: PersistedPlan,
): ExtractRequest {
  return {
    userMessage,
    plan,
    messageContext: localTurnMessageContext('not_configured'),
  };
}

function replyRequest(
  plan: PersistedPlan,
  overrides: Record<string, unknown> = {},
): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: '¿Cuál es la dirección del evento?',
    messageContext: localTurnMessageContext('not_configured'),
    plan,
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'trace-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  } as unknown as ComposeReplyRequest;
}

function purchase(orderId: string): PurchaseInformation {
  return {
    orderId,
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 227.76,
    paymentMethod: 'transfer',
    eventName: 'Claudia and Luis Felipe',
    eventDate: null,
    eventUrl: null,
    createdAt: null,
    items: [],
    customerTransactionNumber: 'COD12345',
  };
}

function purchaseResult(requestId: string, purchases: PurchaseInformation[]): InformationTaskResult {
  return {
    requestId,
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    lookupResource: 'orders',
    purchases,
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    carts: [],
  };
}

function purchaseSummary(requestId: string): InformationExecutionSummary {
  return {
    requestId,
    kind: 'purchase',
    status: 'completed',
    source: 'agent_api',
    outcomeCode: 'completed_with_results',
    retryable: null,
    queryHash: 'q',
    evidence: [],
    resultCount: 1,
    durationMs: 120,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    paginationExhausted: null,
    historyLimit: null,
  };
}

function moment(label: string, locationDescription: string | null, locationReference: string | null) {
  return {
    label,
    description: null,
    datetime: null,
    withTime: false,
    locationDescription,
    locationReference,
    locationUrl: null,
    locationCoords: null,
    position: 0,
  };
}

function guestEvent(eventId: number) {
  return {
    relation: 'guest' as const,
    guestId: 42,
    eventId,
    slug: 'slug',
    url: null,
    name: 'Julisabeth y Andrés',
    place: 'Lima',
    type: null,
    datetime: null,
    stage: null,
    isVisible: null,
    isPublic: null,
    currency: null,
    country: null,
    guestStatus: { hasResponded: false, willAttend: null, hasCouple: null, responseDate: null },
    hostType: null,
    hostPermission: null,
    hostStatus: null,
    celebratedType: null,
    amountCollected: null,
    amountTransferred: null,
    transactionsCount: null,
    invitedGuestCount: null,
    confirmedGuestCount: null,
    orders: [],
    detail: {
      withTime: false,
      timezone: null,
      celebrateds: [],
      moments: [moment('Recepción y Fiesta', 'Hacienda Recoveco', 'Avenida Manuel Valle en Lima')],
      dresscode: null,
      commonAsked: [],
      contactInfo: [],
    },
  };
}

function venueExecution(requestId: string, eventId: number): CustomerExecution {
  return {
    results: [
      {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        result: {
          lookup: { email: null, phone: '+51900000000' },
          user: null,
          events: [guestEvent(eventId)],
          counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
        },
        accessMethod: 'trusted_phone_guest',
      } as unknown as InformationTaskResult,
    ],
    summaries: [
      {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'q',
        evidence: [],
        resultCount: 1,
        durationMs: 90,
        accessMethod: 'trusted_phone_guest',
        eventDetailCount: 1,
      } as InformationExecutionSummary,
    ],
  };
}

function venueRequest(eventId: number): {
  customerContext: CustomerContextProjection;
  informationResults: InformationTaskResult[];
} {
  const snapshot = assembleCustomerContext({
    execution: venueExecution('req-venue', eventId),
    identity: null,
    currentContext: null,
    nowIso: NOW,
  });
  const customerContext = projectCustomerContext(snapshot, { focus: 'general', relevantEventIds: [eventId] });
  const informationResults = [...venueExecution('req-venue', eventId).results];
  return { customerContext, informationResults };
}

describe('actual extraction request owns its instructions', () => {
  it('loads only established support modules and keeps the delta rule', async () => {
    const runtime = testRuntime();
    const spec = await runtime.buildExtractionRequestSpec(
      extractRequest('Gracias', supportPlan()),
    );
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('shared_invariants');
    expect(ids).toContain('extraction_cross_domain');
    expect(ids).toContain('extraction_information');
    expect(ids).not.toContain('extraction_planning');
    // Selected modules are exactly the files loaded and sent.
    const expectedFiles = ids.flatMap((id) => [...instructionModuleRegistry[id].files]);
    expect([...spec.filePaths].sort()).toEqual([...expectedFiles].sort());
    for (const file of expectedFiles) {
      expect(spec.instructions).toContain(`## ${file}`);
    }
    expect(spec.instructions).not.toContain('extractors/planning.txt');
    // Pure thanks still travels with the empty-delta rule, never planning menus.
    expect(spec.input).toContain('delta vacio');
    expect(spec.input).not.toContain('Categorías sugeridas');
    expect(spec.manifest.tools).toEqual([]);
    expect(spec.manifest.promptIdentity).toBe(ids.join('+'));
  });

  it('keeps compact cross-domain recognition on transient owners', async () => {
    const runtime = testRuntime();
    const plan = mergePlan(
      createEmptyPlan({ planId: 'actual-new', channel: 'whatsapp', externalUserId: 'actual-new' }),
      { current_node: 'contacto_inicial' },
    ) as PersistedPlan;
    const spec = await runtime.buildExtractionRequestSpec(extractRequest('Hola', plan));
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('extraction_planning');
    expect(spec.instructions).toContain('extractors/planning.txt');
  });

  it('loads image-linkage guidance only while stored refs exist', async () => {
    const runtime = testRuntime();
    const plain = await runtime.buildExtractionRequestSpec(
      extractRequest('Hola', supportPlan()),
    );
    expect(plain.filePaths).not.toContain('extractors/image_reference.txt');
    const withImage = await runtime.buildExtractionRequestSpec(
      extractRequest(
        'Hola',
        supportPlan({
          image_attachments: [
            { kind: 'url', url: 'https://example.com/media/receipt-a.png', messageId: 'm1', receivedAt: NOW },
          ],
        }),
      ),
    );
    expect(withImage.filePaths).toContain('extractors/image_reference.txt');
  });

  it('retains campaign history and the pending request for gratitude with a decision', async () => {
    const runtime = testRuntime();
    const plan = supportPlan({
      owner_pending_question: '¿Confirmas tu asistencia?',
    });
    const request: ExtractRequest = {
      userMessage: 'Gracias, confirmo asistencia',
      plan,
      messageContext: {
        ...localTurnMessageContext('not_configured'),
        recentMessages: [
          {
            id: 1,
            direction: 'outbound',
            source: 'admin_campaign',
            body: 'Te invitamos a la celebración',
            status: 'sent',
            whatsappMessageId: null,
            sentAt: '2026-09-15T19:10:00-05:00',
            createdAt: null,
          },
        ],
      },
    };
    const spec = await runtime.buildExtractionRequestSpec(request);
    expect(spec.input).toContain('Historial reciente para el extractor');
    expect(spec.input).toContain('Te invitamos a la celebración');
    expect(spec.input).toContain('¿Confirmas tu asistencia?');
    expect(spec.input).toContain('Plan base (JSON compacto)');
  });
});

describe('actual reply request owns its instructions', () => {
  it('sends exactly the selected module files as instructions', async () => {
    const runtime = testRuntime();
    const { customerContext, informationResults } = venueRequest(702201);
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults }),
    );
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('reply_venue_facts');
    expect(ids).toContain('reply_support_continuity');
    expect(ids).not.toContain('reply_planning_owner');
    const expectedFiles = ids.flatMap((id) => [...instructionModuleRegistry[id].files]);
    expect([...spec.filePaths].sort()).toEqual([...expectedFiles].sort());
    for (const file of expectedFiles) {
      expect(spec.instructions).toContain(`## ${file}`);
    }
    expect(spec.instructions).not.toContain('shared/domain_scope.txt');
    expect(spec.instructions).not.toContain('extractors/planning.txt');
    expect(spec.manifest.promptIdentity).toBe(ids.join('+'));
  });

  it('keeps unrelated planning state out of support guidance and tools', async () => {
    const runtime = testRuntime();
    const plan = supportPlan({
      event_type: 'boda',
      provider_needs: [
        {
          category: 'Catering',
          status: 'shortlisted',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          selected_provider_ids: [],
          selected_provider_hints: [],
          recommended_providers: [],
          recommended_provider_ids: [],
        },
      ],
    });
    const { customerContext, informationResults } = venueRequest(702201);
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(plan, { customerContext, informationResults, searchReady: true }),
    );
    expect(spec.modules.map((module) => module.id)).not.toContain('reply_planning_owner');
    expect(spec.scopedTools).toEqual([]);
    expect(spec.manifest.tools).toEqual([]);
    expect(spec.input).not.toContain('Categorías sugeridas');
    expect(spec.input).not.toContain('Capacidades habilitadas');
  });

  it('retains venue and payment facts in the canonical evidence', async () => {
    const runtime = testRuntime();
    const { customerContext } = venueRequest(702201);
    const purchaseRecord = purchase('ord-1');
    const purchaseSnapshot = assembleCustomerContext({
      execution: {
        results: [purchaseResult('req-1', [purchaseRecord])],
        summaries: [purchaseSummary('req-1')],
      },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const purchaseContext = projectCustomerContext(purchaseSnapshot, {
      focus: 'payment',
      relevantOrderIds: ['ord-1'],
    });
    const merged = {
      ...customerContext,
      detailedPurchases: purchaseContext.detailedPurchases,
      candidates: [...customerContext.candidates, ...purchaseContext.candidates],
    };
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext: merged,
        informationResults: [
          ...[...venueExecution('req-venue', 702201).results],
          purchaseResult('req-1', [purchaseRecord]),
        ],
        extraction: baseExtraction({
          informationRequests: [
            { kind: 'purchase', resource: 'orders', query: 'estado de mi pago', aspects: ['summary', 'payment_status'] },
          ],
        }),
      }),
    );
    expect(spec.input).toContain('Hacienda Recoveco');
    expect(spec.input).toContain('227.76');
    // Unknown paid amount never becomes zero in the sent evidence.
    expect(spec.input).not.toMatch(/"remaining":\s*227\.76/);
  });

  it('retains both sides of a mixed faq plus purchase turn', async () => {
    const runtime = testRuntime();
    const faqResult = {
      requestId: 'req-faq',
      kind: 'faq',
      status: 'completed',
      evidence: [{ filename: 'politica-devoluciones.md', text: 'Devolución disponible dentro de 7 días.' }],
    } as unknown as InformationTaskResult;
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        informationResults: [purchaseResult('req-1', [purchase('ord-1')]), faqResult],
      }),
    );
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('reply_purchase_facts');
    expect(ids).toContain('reply_faq_policy');
    expect(ids).toContain('reply_support_continuity');
    expect(spec.input).toContain('Devolución disponible dentro de 7 días');
  });

  it('binds handoff claims to the actual outcome without changing module identity', async () => {
    const runtime = testRuntime();
    const plan = supportPlan();
    const requested = await runtime.buildReplyRequestSpec(
      replyRequest(plan, { handoffOutcome: 'handoff_requested' }),
    );
    const failed = await runtime.buildReplyRequestSpec(
      replyRequest(plan, { handoffOutcome: 'handoff_failed' }),
    );
    expect(requested.modules.map((module) => module.id)).toEqual(
      failed.modules.map((module) => module.id),
    );
    expect(requested.modules.map((module) => module.id)).toContain('reply_handoff_outcome');
    expect(failed.input).toContain('handoff_failed');
    expect(failed.input).not.toContain('handoff_requested');
  });

  it('keeps a single canonical copy without unauthorized transaction ids', async () => {
    const runtime = testRuntime();
    const purchaseRecord = purchase('ord-1');
    const snapshot = assembleCustomerContext({
      execution: {
        results: [purchaseResult('req-1', [purchaseRecord])],
        summaries: [purchaseSummary('req-1')],
      },
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, { focus: 'payment', relevantOrderIds: ['ord-1'] });
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: [purchaseResult('req-1', [purchaseRecord])],
      }),
    );
    expect(spec.input).toContain('profile_ref');
    expect(spec.input).not.toContain('COD12345');
  });

  it('builds both specs without model or gateway calls', async () => {
    const runtime = testRuntime();
    const plan = supportPlan();
    const { customerContext, informationResults } = venueRequest(702201);
    const extractionSpec = await runtime.buildExtractionRequestSpec(extractRequest('Hola', plan));
    expect(Array.isArray(extractionSpec.modules)).toBe(true);
    expect(Array.isArray(extractionSpec.manifest.modules)).toBe(true);
    const replySpec = await runtime.buildReplyRequestSpec(
      replyRequest(plan, { customerContext, informationResults }),
    );
    expect(Array.isArray(replySpec.modules)).toBe(true);
    expect(Array.isArray(replySpec.scopedTools)).toBe(true);
  });

  it('preserves module identity across event-id changes', async () => {
    const runtime = testRuntime();
    const first = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), venueRequest(702201)),
    );
    const second = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), venueRequest(903314)),
    );
    expect(first.modules.map((module) => module.id)).toEqual(
      second.modules.map((module) => module.id),
    );
    expect(first.manifest.promptIdentity).toBe(second.manifest.promptIdentity);
    expect(first.input).not.toBe(second.input);
  });

  it('keeps venue instructions stable when otp state changes', async () => {
    const runtime = testRuntime();
    const { customerContext, informationResults } = venueRequest(702201);
    const plain = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults }),
    );
    const otpPlan = supportPlan({
      user_auth: { auth_method: 'phone', status: 'code_requested' },
    });
    const withOtp = await runtime.buildReplyRequestSpec(
      replyRequest(otpPlan, { customerContext, informationResults }),
    );
    expect(withOtp.modules.map((module) => module.id)).toEqual(
      plain.modules.map((module) => module.id),
    );
    expect(withOtp.manifest.promptIdentity).toBe(plain.manifest.promptIdentity);
  });
});

describe('actual support continuity and extraction detail', () => {
  function testRuntimeLocal(): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {
        async searchProviders(): Promise<never> {
          throw new Error('construction must not call the provider gateway');
        },
      } as never,
    });
  }

  function supportPlanLocal(overrides: Record<string, unknown> = {}): PersistedPlan {
    return mergePlan(
      createEmptyPlan({ planId: 'actual-plan', channel: 'whatsapp', externalUserId: 'actual-user' }),
      { current_node: 'resolver_consultas_informativas', ...overrides },
    ) as PersistedPlan;
  }

  it('composes continuity on ack turns from the pending support request', async () => {
    const runtime = testRuntimeLocal();
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlanLocal(), {
        extraction: baseExtraction({
          supportAct: {
            kind: 'provide_detail',
            topic: 'unknown',
            detail: 'unknown',
            personReference: null,
            eventReference: null,
          },
        }),
      }),
    );
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('reply_support_continuity');
    expect(spec.instructions).toContain('## nodes/resolver_consultas_informativas/support_continuity.txt');
  });

  it('keeps contact capture on established support extraction', async () => {
    const runtime = testRuntimeLocal();
    const spec = await runtime.buildExtractionRequestSpec(
      extractRequest('Gracias', supportPlanLocal()),
    );
    expect(spec.filePaths).toContain('extractors/contact.txt');
    expect(spec.filePaths).not.toContain('extractors/planning.txt');
    expect(spec.filePaths).not.toContain('extractors/provider_management.txt');
    expect(spec.filePaths).not.toContain('extractors/close_pause.txt');
  });

  it('gates provider detail on planning progress for transient extraction', async () => {
    const runtime = testRuntimeLocal();
    const fresh = mergePlan(
      createEmptyPlan({ planId: 'actual-new', channel: 'whatsapp', externalUserId: 'actual-new' }),
      { current_node: 'contacto_inicial' },
    ) as PersistedPlan;
    const compact = await runtime.buildExtractionRequestSpec(extractRequest('Hola', fresh));
    expect(compact.filePaths).toContain('extractors/planning.txt');
    expect(compact.filePaths).not.toContain('extractors/provider_management.txt');
    expect(compact.filePaths).not.toContain('extractors/contact.txt');
    expect(compact.filePaths).not.toContain('extractors/close_pause.txt');
    const progressed = mergePlan(fresh, {
      provider_needs: [
        {
          category: 'Catering',
          status: 'shortlisted',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          selected_provider_ids: [],
          selected_provider_hints: [],
          recommended_providers: [],
          recommended_provider_ids: [],
        },
      ],
    }) as PersistedPlan;
    const detailed = await runtime.buildExtractionRequestSpec(extractRequest('Hola', progressed));
    expect(detailed.filePaths).toContain('extractors/provider_management.txt');
    expect(detailed.filePaths).toContain('extractors/contact.txt');
    expect(detailed.filePaths).toContain('extractors/close_pause.txt');
  });
});

describe('actual reply request auth, image, approval and faq-empty gating', () => {
  it('keeps terminal-auth prose out of venue reads and loads it on auth-terminal turns', async () => {
    const runtime = testRuntime();
    const { customerContext, informationResults } = venueRequest(702201);
    const plain = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults }),
    );
    expect(plain.modules.map((module) => module.id)).not.toContain('reply_auth_limitation');
    expect(plain.instructions).not.toContain('authentication_outcome.status');
    expect(plain.instructions).not.toContain('no volverás a pedir correo ni código');
    expect(plain.instructions).not.toContain('búsqueda acotada con el número');
    const authed = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults,
        authenticationOutcome: {
          status: 'terminal',
          reason: 'otp_failed',
          protectedRequestsClosed: false,
          publicInformationRequestsRemaining: 1,
          handoffOutcome: 'handoff_requested',
        },
      }),
    );
    expect(authed.modules.map((module) => module.id)).toContain('reply_auth_limitation');
    expect(authed.instructions).toContain('authentication_outcome.status');
    expect(authed.instructions).toContain('la consulta protegida sigue pendiente');
  });

  it('loads image limits only when image context is present', async () => {
    const runtime = testRuntime();
    const { customerContext, informationResults } = venueRequest(702201);
    const plain = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults }),
    );
    expect(plain.modules.map((module) => module.id)).not.toContain('reply_image_context');
    expect(plain.instructions).not.toContain('Nunca pidas reenviar la imagen');
    expect(plain.instructions).not.toContain('no inicies una descripción no solicitada');
    expect(plain.instructions).not.toContain('Nunca muestres enlaces de imágenes');
    const withImage = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults,
        imageEvidence: { status: 'available', reason: null, captionPresent: false },
      }),
    );
    expect(withImage.modules.map((module) => module.id)).toContain('reply_image_context');
    expect(withImage.instructions).toContain('Nunca pidas reenviar la imagen');
    expect(withImage.instructions).toContain('no inicies una descripción no solicitada');
    expect(withImage.instructions).toContain('Nunca muestres enlaces de imágenes');
  });

  it('loads the receipt boundary only on purchase validation turns', async () => {
    const runtime = testRuntime();
    const summaryOnly = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        informationResults: [purchaseResult('req-1', [purchase('ord-1')])],
        extraction: baseExtraction({
          informationRequests: [
            { kind: 'purchase', resource: 'orders', query: 'resumen', aspects: ['summary'] },
          ],
        }),
      }),
    );
    expect(summaryOnly.modules.map((module) => module.id)).not.toContain('reply_approval_boundary');
    expect(summaryOnly.instructions).not.toContain('no acredita un pago');
    const approval = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        informationResults: [purchaseResult('req-1', [purchase('ord-1')])],
        extraction: baseExtraction({
          informationRequests: [
            { kind: 'purchase', resource: 'orders', query: 'estado de mi pago', aspects: ['summary', 'payment_status'] },
          ],
        }),
      }),
    );
    expect(approval.modules.map((module) => module.id)).toContain('reply_approval_boundary');
    expect(approval.instructions).toContain('no acredita un pago');
    expect(approval.instructions).toContain('no prueba aprobación del equipo');
  });

  it('states the faq-empty limitation only when knowledge returned empty', async () => {
    const runtime = testRuntime();
    const emptyResult = {
      requestId: 'req-faq',
      kind: 'faq',
      status: 'completed',
      evidence: [],
    } as unknown as InformationTaskResult;
    const empty = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [emptyResult] }),
    );
    expect(empty.input).toContain('no tienes esa información específica');
    const answeredResult = {
      requestId: 'req-faq',
      kind: 'faq',
      status: 'completed',
      evidence: [{ filename: 'politica-devoluciones.md', text: 'Devolución disponible dentro de 7 días.' }],
    } as unknown as InformationTaskResult;
    const answered = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [answeredResult] }),
    );
    expect(answered.input).not.toContain('no tienes esa información específica');
    const { informationResults } = venueRequest(702201);
    const venue = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults }),
    );
    expect(venue.input).not.toContain('no tienes esa información específica');
  });

  it('names exactly the exposed scoped tools in the tool-guidance line', async () => {
    const runtime = testRuntime();
    const interview = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { currentNode: 'entrevista' }),
    );
    expect(interview.scopedTools).toEqual(['list_categories', 'get_category_by_slug', 'list_locations']);
    expect(interview.input).toContain(
      'Herramientas autorizadas en este nodo: list_categories, get_category_by_slug, list_locations',
    );
    const handoff = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        currentNode: 'solicitar_agente_humano',
        handoffOutcome: 'handoff_requested',
      }),
    );
    expect(handoff.scopedTools).toEqual([]);
    expect(handoff.input).toContain('Herramientas autorizadas en este nodo: ninguna');
  });
});
