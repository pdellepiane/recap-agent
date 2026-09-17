import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  AgentConversationGateway,
  AgentEventDetailResult,
  AgentGuestEventsResult,
  AgentPhonePurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
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

function rsvpProfileExecution(requestId: string, eventId: number): CustomerExecution {
  return {
    results: [
      {
        requestId,
        kind: 'associated_event',
        status: 'completed',
        result: {
          lookup: { email: null, phone: '+51900000000' },
          user: null,
          events: [{
            relation: 'guest',
            guestId: 41,
            eventId,
            slug: 'matrimonio-ana-luis',
            url: null,
            name: 'Matrimonio de Ana y Luis',
            place: null,
            type: null,
            datetime: '2026-09-12',
            stage: null,
            isVisible: null,
            isPublic: null,
            currency: null,
            country: null,
            guestStatus: { hasResponded: true, willAttend: null, hasCouple: null, responseDate: null },
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
          }],
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
        eventDetailCount: 0,
      } as InformationExecutionSummary,
    ],
  };
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

  it('keeps a role correction out of planning modules, tools and categories', async () => {
    // A3: identifying as host/guest updates reportedEventRole without
    // inventing planning work. A role-only turn loads no planning module,
    // offers no provider tools, and carries no category appendix.
    const runtime = testRuntime();
    const spec = await runtime.buildExtractionRequestSpec(
      extractRequest('Soy la anfitriona del evento, no la invitada', supportPlan()),
    );
    const ids = spec.modules.map((module) => module.id);
    expect(ids).not.toContain('extraction_planning');
    expect(spec.instructions).not.toContain('extractors/planning.txt');
    expect(spec.input).not.toContain('Categorías sugeridas');
    expect(spec.manifest.tools).toEqual([]);
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

  it('retains the completed-RSVP outcome note alongside typed image evidence', async () => {
    // Mixed RSVP+image turns carry the completed action as typed invitation
    // evidence plus its outcome details in the note. The note-suppression
    // for typed image outcomes must not drop the RSVP outcome: the string
    // is never the only carrier, but its details live nowhere else.
    const runtime = testRuntime();
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        rsvpPhoneEvidence: {
          state: 'resolved_single',
          coverage: 'complete',
          resolution: 'authoritative_invitation',
          event: {
            event_name: 'Matrimonio de Ana y Luis',
            event_date: '2026-09-12',
            invitation_record: 'available',
            rsvp_state: 'attending',
          },
        },
        rsvpWorkCompleted: true,
        errorMessage: JSON.stringify({
          outcome: 'responded',
          verification_status: 'verified',
          requested_attendance_change_verified: true,
        }),
        imageEvidence: { status: 'available', reason: null, captionPresent: false },
      }),
    );
    const ids = spec.modules.map((module) => module.id);
    expect(ids).toContain('reply_rsvp_facts');
    expect(ids).toContain('reply_image_context');
    expect(spec.input).toContain('Matrimonio de Ana y Luis');
    expect(spec.input).toContain('verification_status');
    expect(spec.input).toContain('requested_attendance_change_verified');
  });

  it('keeps RSVP facts and profile invitations as separate evidence without ID-based merge', async () => {
    // RSVP evidence carries no event/guest IDs, so a name/date match cannot
    // prove the RSVP fact and the profile invitation are the same record.
    // Both travel unchanged: the full RSVP event facts stay visible and the
    // profile slot keeps its own attendance instead of absorbing the fresh
    // state. The completed verification receipt rides typed evidence.
    const runtime = testRuntime();
    const execution = rsvpProfileExecution('req-rsvp-profile', 205);
    const snapshot = assembleCustomerContext({
      execution,
      identity: { customerRef: '+51900000001', scope: 'trusted_phone', source: 'agent_api' },
      currentContext: null,
      nowIso: NOW,
    });
    const customerContext = projectCustomerContext(snapshot, { focus: 'general', relevantEventIds: [205] });
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: [...execution.results],
        rsvpPhoneEvidence: {
          state: 'resolved_single',
          coverage: 'complete',
          resolution: 'authoritative_invitation',
          event: {
            event_name: 'Matrimonio de Ana y Luis',
            event_date: '2026-09-12',
            invitation_record: 'available',
            rsvp_state: 'attending',
          },
        },
        rsvpWorkCompleted: true,
        errorMessage: JSON.stringify({ outcome: 'responded', verification_status: 'verified' }),
      }),
    );
    expect(spec.input).toContain('Matrimonio de Ana y Luis');
    expect(spec.input).toContain('"rsvp_state": "attending"');
    expect(spec.input).not.toContain('"rsvpState": "attending"');
    expect(spec.input).toContain('verification_status');
  });

  it('carries completed RSVP verification facts on auth-gated mixed turns', async () => {
    // Exact mixed-turn regression: an RSVP write completed and an
    // auth-gated information turn follows (every result needs input, so the
    // reply is authentication-only and the free-form operational note is
    // dropped). The verification facts must still serialize into the actual
    // model input as typed evidence, not just the ComposeReplyRequest.
    const runtime = testRuntime();
    const needsInput = {
      requestId: 'req-auth',
      kind: 'purchase',
      status: 'needs_input',
      nextInput: 'email',
      guidance: {
        reason: 'email_required',
        email: null,
        requirements: ['explain_account_information_access'],
      },
    } as unknown as InformationTaskResult;
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        informationResults: [needsInput],
        rsvpPhoneEvidence: {
          state: 'resolved_single',
          coverage: 'complete',
          resolution: 'authoritative_invitation',
          event: {
            event_name: 'Matrimonio de Ana y Luis',
            event_date: '2026-09-12',
            invitation_record: 'available',
            rsvp_state: 'attending',
          },
        },
        rsvpWorkCompleted: true,
        errorMessage: JSON.stringify({
          outcome: 'mutation_result',
          requested_action: 'attending',
          requested_plus_one_response: null,
          verification: {
            verification_status: 'verified',
            gateway_status: 'responded',
            requested: { guest_id: 41, event_id: 205, action: 'attending', plus_one_response: null },
            observed: { guest_id: 41, event_id: 205, attendance: 'attending', source: 'fresh_read' },
            requested_attendance_change_verified: true,
            effect_applied: true,
            replayed: false,
            fresh_read: true,
          },
          next_action: 'communicate_confirmed_state',
        }),
      }),
    );
    expect(spec.input).not.toContain('Nota operativa');
    expect(spec.input).toContain('rsvp_completed_effect');
    expect(spec.input).toContain('"verification_status": "verified"');
    expect(spec.input).toContain('"requested_attendance_change_verified": true');
    expect(spec.input).toContain('"effect_applied": true');
  });

  it('forwards skipped host-withdrawal handoff status and reason as reply evidence', async () => {
    // A never-attempted handoff travels as typed skipped evidence
    // preserving the reason family (missing-phone vs unavailable
    // capability), never as prose. The serialized model input must
    // distinguish unavailable-capability from missing-phone from typed
    // evidence, survive note suppression (errorMessage null) and carry
    // no operational prose. Success/failed/unknown twins are unchanged.
    const runtime = testRuntime();
    const policyResult = {
      requestId: 'req-host-withdrawal',
      kind: 'faq',
      status: 'completed',
      evidence: [{ filename: 'politica-de-retiros.md', text: 'Plazo general de procesamiento: hasta 72 horas hábiles.' }],
      hostWithdrawalPolicy: { maxBusinessHours: 72 },
    } as unknown as InformationTaskResult;
    const withdrawalRequest = (overrides: Record<string, unknown>) => replyRequest(supportPlan(), {
      informationResults: [policyResult],
      extraction: baseExtraction({
        actionIntent: 'solicitar_humano',
        informationRequests: [{
          kind: 'faq',
          query: 'Hice un retiro y aún no lo recibo.',
          hostWithdrawal: 'individual_status',
          eventHint: 'Diana y Fernando',
        }],
      }),
      errorMessage: null,
      ...overrides,
    });
    const missingPhone = await runtime.buildReplyRequestSpec(
      withdrawalRequest({ handoffOutcome: 'handoff_skipped_missing_phone' }),
    );
    expect(missingPhone.input).toContain('handoff_skipped_missing_phone');
    expect(missingPhone.input).not.toContain('soft-pause');
    const unconfigured = await runtime.buildReplyRequestSpec(
      withdrawalRequest({ handoffOutcome: 'handoff_skipped_unavailable' }),
    );
    expect(unconfigured.input).toContain('handoff_skipped_unavailable');
    expect(unconfigured.input).not.toContain('handoff_skipped_missing_phone');
    expect(unconfigured.input).not.toContain('soft-pause');
    // Requested/failed/unknown outcomes keep their existing values.
    const requested = await runtime.buildReplyRequestSpec(
      withdrawalRequest({ handoffOutcome: 'handoff_requested' }),
    );
    expect(requested.input).toContain('handoff_requested');
    const failed = await runtime.buildReplyRequestSpec(
      withdrawalRequest({ handoffOutcome: 'handoff_failed' }),
    );
    expect(failed.input).toContain('handoff_failed');
    const unknown = await runtime.buildReplyRequestSpec(
      withdrawalRequest({ handoffOutcome: 'handoff_unknown' }),
    );
    expect(unknown.input).toContain('handoff_unknown');
  });

  it('retains cross-event RSVP facts instead of hiding them behind a bare reference', async () => {
    // The profile knows only Julisabeth y Andrés while the completed RSVP
    // resolved Matrimonio de Ana y Luis: no slot establishes the merge, so
    // the full RSVP evidence travels and the known facts stay visible in
    // the actual composed payload.
    const runtime = testRuntime();
    const { customerContext, informationResults } = venueRequest(702201);
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults,
        rsvpPhoneEvidence: {
          state: 'resolved_single',
          coverage: 'complete',
          resolution: 'authoritative_invitation',
          event: {
            event_name: 'Matrimonio de Ana y Luis',
            event_date: '2026-09-12',
            invitation_record: 'available',
            rsvp_state: 'attending',
          },
        },
        rsvpWorkCompleted: true,
        errorMessage: JSON.stringify({ outcome: 'responded', verification_status: 'verified' }),
      }),
    );
    expect(spec.input).toContain('profile_ref');
    expect(spec.input).toContain('Julisabeth y Andrés');
    expect(spec.input).toContain('Matrimonio de Ana y Luis');
    expect(spec.input).toContain('verification_status');
  });

  it('projects the purchase-only guest root (events plus orders A+B) into serialized model input', async () => {
    // Purchase-only turn proof through the production path: mocked
    // gateways, real orchestrator execution, real profile assembly, real
    // reply serialization. Guest-event root (event 81 with venue plus
    // attendance; event 82 detail fails as the optional failure) plus
    // hydration order A plus purchase-root orders A+B merge by stable
    // order ID. The serialized model input must carry event
    // identity/venue/attendance, A and B canonically one each, partial
    // coverage with ready facts usable despite the failure, shared reads
    // once, no writes/extra auth, no unauthorized source, and no
    // name/date merge across distinct events/guests.
    const calls = { guestEvents: 0, eventDetail: 0, guestOrders: 0, guestGift: 0, takeover: 0 };
    const hydratedA: PurchaseInformation = {
      orderId: 'ORD-000880',
      eventId: 81,
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: 300,
      paymentMethod: 'Transferencia',
      eventName: 'Boda Ana y Luis',
      eventDate: '2026-09-20',
      eventUrl: null,
      createdAt: '2026-07-10',
      items: [],
    };
    const sparseA: PurchaseInformation = {
      orderId: 'ORD-000880',
      eventId: 81,
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: null,
      paymentMethod: null,
      eventName: null,
      eventDate: null,
      eventUrl: null,
      createdAt: null,
      items: [],
    };
    const orderB: PurchaseInformation = {
      orderId: 'ORD-000881',
      eventId: 82,
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: 150,
      paymentMethod: 'Yape',
      eventName: 'Boda María y José',
      eventDate: '2026-09-21',
      eventUrl: null,
      createdAt: '2026-07-11',
      items: [],
    };
    const gateway = {
      async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> {
        calls.guestEvents += 1;
        return {
          status: 'success',
          events: [
            { eventId: 81, name: 'Boda Ana y Luis', slug: 'event-81', url: null, datetime: '2026-09-20T18:00:00', type: 'wedding', typeDetail: null, stage: 'published', city: 'Lima', country: 'Perú', currency: 'PEN' },
            { eventId: 82, name: 'Boda María y José', slug: 'event-82', url: null, datetime: '2026-09-21T19:00:00', type: 'wedding', typeDetail: null, stage: 'published', city: 'Arequipa', country: 'Perú', currency: 'PEN' },
          ],
        };
      },
      async getEventDetail(input: { eventId: number; phone?: unknown }): Promise<AgentEventDetailResult> {
        calls.eventDetail += 1;
        if (input.eventId === 81) {
          return {
            status: 'success',
            event: {
              eventId: 81, name: 'Boda Ana y Luis', slug: 'event-81', url: null,
              datetime: '2026-09-20T18:00:00', type: 'wedding', typeDetail: null, stage: 'published',
              city: 'Lima', country: 'Perú', currency: 'PEN', withTime: true, timezone: null,
              celebrateds: [], moments: [], dresscode: null, commonAsked: [], contactInfo: [],
              attendance: { guestId: 501, name: 'Ana', hasResponded: true, willAttend: true, responseDate: '2026-09-01' },
              purchases: [hydratedA],
            },
          } as unknown as AgentEventDetailResult;
        }
        return { status: 'failed', error: 'detail temporarily unavailable', retryable: true } as AgentEventDetailResult;
      },
      async getGuestOrdersByPhone(): Promise<AgentPhonePurchaseLookupResult> {
        calls.guestOrders += 1;
        return { status: 'success', resource: 'orders', purchases: [sparseA, orderB] };
      },
      async getGuestGiftPurchasesByPhone(): Promise<AgentPhonePurchaseLookupResult> {
        calls.guestGift += 1;
        throw new Error('gift-detail endpoint must not be read for a summary question');
      },
      async requestHumanTakeover(): Promise<never> {
        calls.takeover += 1;
        throw new Error('no writes on a purchase-only read turn');
      },
    } as unknown as AgentConversationGateway;
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { throw new Error('unused'); } },
      providerGateway: {} as never,
      agentGateway: gateway,
    });
    const execution = await orchestrator.execute({
      requests: [{
        requestId: 'purchase-only-proof',
        kind: 'purchase',
        resource: 'orders',
        query: '¿Cuál es el estado de mi compra?',
        orderId: null,
        aspects: ['summary'],
        sensitiveFields: [],
        authAction: 'none',
      }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '987654321' },
    });
    // Shared reads once; unauthorized gift source never called; no writes.
    expect(calls.guestEvents).toBe(1);
    expect(calls.eventDetail).toBe(2);
    expect(calls.guestOrders).toBe(1);
    expect(calls.guestGift).toBe(0);
    expect(calls.takeover).toBe(0);
    const result = execution.results[0];
    expect(result?.status).toBe('completed');

    const snapshot = assembleCustomerContext({
      execution: { results: execution.results, summaries: execution.summaries },
      identity: { customerRef: '+51987654321', scope: 'trusted_phone', source: 'channel_contact_phone', fetchedAt: NOW },
      currentContext: { relevantEventIds: [], relevantOrderIds: [], pendingQuestion: null, unresolvedCandidateOrderIds: [], unresolvedCandidateEventIds: [] },
      nowIso: NOW,
    });
    // Ready facts usable despite the failed optional detail: both
    // sections ready, purchases partial (never complete).
    expect(snapshot.purchasesCarts.status).toBe('ready');
    expect(snapshot.invitationsEvents.status).toBe('ready');
    expect(snapshot.purchasesCarts.completeness).toBe('partial');
    // A and B survive canonically, one representation each.
    const detailedIds = snapshot.purchasesCarts.detailedPurchases.map((purchase) => purchase.orderId).sort();
    expect(detailedIds).toEqual(['ORD-000880', 'ORD-000881']);
    const mergedA = snapshot.purchasesCarts.detailedPurchases.find((purchase) => purchase.orderId === 'ORD-000880');
    expect(mergedA?.eventName).toBe('Boda Ana y Luis');
    // Distinct events/guests never merged by name/date: two slots.
    const slots = snapshot.invitationsEvents.invitations;
    expect(slots.map((invitation) => invitation.eventId).sort()).toEqual([81, 82]);
    expect(new Set(slots.map((invitation) => invitation.eventName)).size).toBe(2);

    const runtime = testRuntime();
    const customerContext = projectCustomerContext(snapshot, { focus: 'general' });
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { customerContext, informationResults: execution.results }),
    );
    // Model input carries event identity/venue/attendance plus both orders.
    expect(spec.input).toContain('Boda Ana y Luis');
    expect(spec.input).toContain('Lima');
    expect(spec.input).toContain('attending');
    expect(spec.input).toContain('ORD-000880');
    expect(spec.input).toContain('ORD-000881');
    // Partial coverage stays visible; the failed optional source never
    // erased the ready facts above.
    expect(spec.input).toContain('partial');
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

describe('actual reply request venue parity across two distinct records', () => {
  function secondGuestEvent(eventId: number) {
    return {
      ...guestEvent(eventId),
      name: 'María y José',
      place: 'Arequipa',
      country: 'Perú',
      detail: {
        withTime: false,
        timezone: null,
        celebrateds: [],
        moments: [
          moment('Ceremonia', 'Parroquia San Francisco', 'Calle Santa Catalina 100'),
          moment('Recepción', 'Casa Andina', 'Avenida Lima 200'),
        ],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
      },
    };
  }

  it('keeps reception name, street and city for two distinct events without mixing them', async () => {
    const runtime = testRuntime();
    const first = venueExecution('req-venue-1', 702201);
    const secondResults = (first.results[0] as unknown as {
      result: { events: unknown[] };
    }).result;
    const execution: CustomerExecution = {
      results: [
        {
          ...first.results[0],
          result: { ...secondResults, events: [...secondResults.events, secondGuestEvent(903314)] },
        } as unknown as InformationTaskResult,
      ],
      summaries: first.summaries,
    };
    const snapshot = assembleCustomerContext({
      execution,
      identity: null,
      currentContext: null,
      nowIso: NOW,
    });
    expect(snapshot.invitationsEvents.invitations).toHaveLength(2);
    const customerContext = projectCustomerContext(snapshot, {
      focus: 'general',
      relevantEventIds: [702201, 903314],
    });
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        customerContext,
        informationResults: [...execution.results],
      }),
    );
    expect(spec.input).toContain('Julisabeth y Andrés');
    expect(spec.input).toContain('Hacienda Recoveco');
    expect(spec.input).toContain('María y José');
    expect(spec.input).toContain('Casa Andina');
    expect(spec.input).toContain('Arequipa');
    expect(spec.input).toContain('Parroquia San Francisco');
  });
});

describe('effective production request settings via actual serialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function quotaFetchMock() {
    return vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify({
        error: {
          message: 'You exceeded your current quota.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }));
  }

  function gpt5Runtime(): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
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

  function quotaBody(fetchMock: ReturnType<typeof quotaFetchMock>): Record<string, unknown> {
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    return JSON.parse(
      typeof body === 'string' ? body : '{}',
    ) as Record<string, unknown>;
  }

  it('sends low reasoning on the serialized extraction request with a stable cache key', async () => {
    const fetchMock = quotaFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = gpt5Runtime();
    const plan = supportPlan();
    await expect(runtime.extract({
      userMessage: '¿Dónde es el evento?',
      plan,
      messageContext: localTurnMessageContext('not_configured'),
    })).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = quotaBody(fetchMock);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect((body.text as { verbosity?: string } | undefined)?.verbosity).toBe('low');
    // Stable shared prefix: the cache key names only the sent bundle, never
    // timestamps, customer identifiers or dynamic task text.
    const spec = await runtime.buildExtractionRequestSpec(
      extractRequest('¿Dónde es el evento?', plan),
    );
    expect(body.prompt_cache_key).toBe(`extractor:${spec.bundleId}`);
  });

  it('sends low reasoning on the serialized reply request with a stable node-scoped cache key', async () => {
    const fetchMock = quotaFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = gpt5Runtime();
    const plan = supportPlan();
    const { customerContext, informationResults } = venueRequest(702201);
    const request = replyRequest(plan, { customerContext, informationResults });
    await expect(runtime.composeReply(request)).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = quotaBody(fetchMock);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect((body.text as { verbosity?: string } | undefined)?.verbosity).toBe('low');
    const spec = await runtime.buildReplyRequestSpec(request);
    expect(body.prompt_cache_key).toBe(`reply:resolver_consultas_informativas:${spec.bundleId}`);
  });

  it('keeps the pending venue question visible to the extractor without dynamic identity', async () => {
    const runtime = testRuntime();
    const plan = supportPlan({ owner_pending_question: '¿Dónde es el evento?' });
    const spec = await runtime.buildExtractionRequestSpec(
      extractRequest('Y el evento es Boda Ana y Luis', plan),
    );
    expect(spec.input).toContain('¿Dónde es el evento?');
    expect(spec.instructions).not.toContain('actual-user');
  });
});

describe('action outcomes stay distinct in serialized reply input', () => {
  function rsvpReplyRequest(verificationJson: unknown): ComposeReplyRequest {
    return replyRequest(supportPlan(), {
      rsvpPhoneEvidence: {
        state: 'resolved_single',
        coverage: 'complete',
        resolution: 'authoritative_invitation',
        event: {
          event_name: 'Matrimonio de Ana y Luis',
          event_date: '2026-09-12',
          invitation_record: 'available',
          rsvp_state: 'attending',
        },
      },
      rsvpWorkCompleted: true,
      errorMessage: JSON.stringify(verificationJson),
    });
  }

  it('keeps verified success, failure and unknown RSVP outcomes distinct', async () => {
    const runtime = testRuntime();
    const success = await runtime.buildReplyRequestSpec(rsvpReplyRequest({
      outcome: 'responded',
      verification_status: 'verified',
      requested_attendance_change_verified: true,
      effect_applied: true,
      gateway_status: 'responded',
    }));
    expect(success.input).toContain('"verification_status": "verified"');
    expect(success.input).toContain('"requested_attendance_change_verified": true');

    const failed = await runtime.buildReplyRequestSpec(rsvpReplyRequest({
      outcome: 'mutation_result',
      verification: {
        verification_status: 'failed',
        gateway_status: 'failed',
        requested_attendance_change_verified: false,
        effect_applied: false,
      },
    }));
    expect(failed.input).toContain('"verification_status": "failed"');
    expect(failed.input).toContain('"requested_attendance_change_verified": false');
    expect(failed.input).not.toContain('"requested_attendance_change_verified": true');

    const unknown = await runtime.buildReplyRequestSpec(rsvpReplyRequest({
      outcome: 'mutation_result',
      verification: {
        verification_status: 'unknown',
        gateway_status: 'unknown',
        requested_attendance_change_verified: false,
      },
    }));
    expect(unknown.input).toContain('"verification_status": "unknown"');
    expect(unknown.input).not.toContain('"verification_status": "failed"');
    expect(unknown.input).not.toContain('"requested_attendance_change_verified": true');
  });

  it('projects no success claim from an unverified attempt alone', async () => {
    const runtime = testRuntime();
    const attempt = await runtime.buildReplyRequestSpec(rsvpReplyRequest({
      outcome: 'attempted',
      requested_action: 'attending',
    }));
    expect(attempt.input).not.toContain('rsvp_completed_effect');
    expect(attempt.input).not.toContain('"requested_attendance_change_verified": true');
  });

  it('keeps missing authorization distinct from completed and failed reads', async () => {
    const runtime = testRuntime();
    const needsInput = {
      requestId: 'req-auth',
      kind: 'purchase',
      status: 'needs_input',
      nextInput: 'email',
      guidance: {
        reason: 'email_required',
        email: null,
        requirements: ['explain_account_information_access'],
      },
    } as unknown as InformationTaskResult;
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [needsInput] }),
    );
    expect(spec.input).toContain('needs_input');
    expect(spec.input).toContain('email');
    expect(spec.input).not.toContain('"verification_status": "verified"');
  });

  it('serializes failed lookups as honest limitations without fabricated venue', async () => {
    const runtime = testRuntime();
    const failedLookup = {
      requestId: 'req-venue',
      kind: 'associated_event',
      status: 'failed',
      failureKind: 'not_found',
      accessMethod: 'trusted_phone_guest',
      retryable: false,
    } as unknown as InformationTaskResult;
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [failedLookup] }),
    );
    // The failed outcome travels as typed evidence for an honest limitation.
    expect(spec.input).toContain('not_found');
    // No venue facts exist, so none may be narrated into the reply input.
    expect(spec.input).not.toContain('Hacienda Recoveco');
    expect(spec.input).not.toContain('Avenida Manuel Valle');
  });
});
