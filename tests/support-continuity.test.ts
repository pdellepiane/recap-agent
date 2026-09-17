import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { createEmptyPlan, normalizeRawPlan, mergePlan } from '../src/core/plan';
import type { PendingInformationRequest } from '../src/core/information';
import {
  deriveConversationContinuity,
  type ConversationHistoryStatus,
} from '../src/runtime/turn-message-context';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

describe('derived conversation continuity', () => {
  it('derives purchase support from persisted information state and history', () => {
    const plan = mergePlan(createEmptyPlan({
      planId: 'carina', channel: 'whatsapp', externalUserId: 'carina',
    }), {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [{
          requestId: 'purchase-1', kind: 'purchase', query: 'estado de mi compra',
          resource: 'orders', orderId: null, aspects: ['payment_status'],
          sensitiveFields: [], authAction: 'none',
        }],
        selection_candidates: [],
      },
    });
    const continuity = deriveConversationContinuity({
      plan,
      recentMessages: [],
      historyStatus: 'empty' satisfies ConversationHistoryStatus,
    });
    expect(continuity.lane).toBe('purchase_support');
    expect(continuity.welcomeAllowed).toBe(false);
  });

  it('keeps Maria mailbox continuity without a persisted anchor', () => {
    const plan = mergePlan(createEmptyPlan({
      planId: 'maria', channel: 'whatsapp', externalUserId: 'maria',
    }), { current_node: 'resolver_consultas_informativas' });
    const continuity = deriveConversationContinuity({
      plan,
      recentMessages: [{
        id: 1, direction: 'inbound', source: null, body: 'Mi correo está lleno',
        status: 'sent', sentAt: null, createdAt: null,
      }],
      historyStatus: 'available',
    });
    expect(continuity.hasPriorContext).toBe(true);
    expect(continuity.welcomeAllowed).toBe(false);
  });

  it('strips legacy support anchors at the plan boundary', () => {
    const normalized = normalizeRawPlan({
      information_state: { support_anchor: { topic: 'mailbox_capacity' } },
    }) as { information_state: Record<string, unknown> };
    expect(normalized.information_state.support_anchor).toBeUndefined();
  });
});

describe('support continuity prompt invariants', () => {
  const promptsDir = path.resolve(process.cwd(), 'prompts');

  it('carries the single shared actionable-answer directive without a duplicate rule', () => {
    const shared = fs.readFileSync(path.join(promptsDir, 'shared/base_system.txt'), 'utf8');
    const directive = 'Resuelve lo que puedas de la solicitud con los datos y las herramientas autorizadas antes de responder; entrega la información o el resultado, no solo la intención de ayudar. Si falta algo imprescindible o la acción no está disponible, explica el límite y pide solo el dato necesario. Atribuye cambios o gestiones únicamente a resultados confirmados.';
    expect(shared).toContain(directive);
    expect(shared).not.toContain('Lo pendiente no es realizado');
    // One invariant, not an appended duplicate: the directive text occurs once.
    expect(shared.split(directive).length - 1).toBe(1);
  });

  it('removes the mandatory open-query recital while keeping reported identity distinct', () => {
    const continuity = fs.readFileSync(
      path.join(promptsDir, 'nodes/resolver_consultas_informativas/support_continuity.txt'),
      'utf8',
    );
    expect(continuity).not.toContain('support_query_open');
    expect(continuity).not.toMatch(/misma consulta se mantiene/u);
    // Reported names stay verbatim when needed, without forced repetition,
    // and reported identity stays distinct from verified identity (the
    // module already limits acknowledgment to evidence without asserting
    // verifications that do not exist).
    expect(continuity).toContain('reported_guest_name');
    expect(continuity).toContain('reported_event_name');
    expect(continuity).toContain('no repitas nombres que la respuesta no necesite');
    expect(continuity).toContain('sin afirmar verificaciones que no existen');
  });

  it('keeps pending-question reference guidance in the information extractor', () => {
    // No extractor edit was needed: literal person/event reference capture
    // plus event-name continuation already guide pending-question follow-ups.
    const extractor = fs.readFileSync(
      path.join(promptsDir, 'extractors/information.txt'),
      'utf8',
    );
    expect(extractor).toContain('personReference');
    expect(extractor).toContain('eventReference');
    expect(extractor).toContain('Conserva literalmente el nombre del evento citado');
  });
});

function supportExtraction(overrides: Record<string, unknown> = {}): ExtractionResult {
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

function venueResult(requestId: string): Record<string, unknown> {
  return {
    requestId,
    kind: 'associated_event',
    status: 'completed',
    result: {
      lookup: { email: null, phone: '+51900000001' },
      user: null,
      events: [{
        relation: 'guest',
        guestId: 42,
        eventId: 702201,
        slug: 'boda-ana-luis',
        url: null,
        name: 'Boda Ana y Luis',
        place: 'Lima',
        datetime: '2026-09-20T18:00:00',
        detail: {
          withTime: true,
          timezone: null,
          celebrateds: [],
          moments: [{
            label: 'Recepción y Fiesta',
            description: null,
            datetime: '2026-09-20T18:00:00',
            withTime: true,
            locationDescription: 'Hacienda Recoveco',
            locationReference: 'Avenida Manuel Valle en Lima',
            locationUrl: null,
            locationCoords: null,
            position: 0,
          }],
          dresscode: null,
          commonAsked: [],
          contactInfo: [],
        },
      }],
      counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
    },
    accessMethod: 'trusted_phone_guest',
  };
}

function venueSummary(requestId: string): Record<string, unknown> {
  return {
    requestId,
    kind: 'associated_event',
    status: 'completed',
    source: 'agent_api',
    outcomeCode: 'completed_with_results',
    retryable: null,
    queryHash: 'venue',
    evidence: [],
    resultCount: 1,
    durationMs: 90,
    accessMethod: 'trusted_phone_guest',
    eventDetailCount: 1,
  };
}

async function runSupportTurn(options: {
  externalUserId: string;
  text: string;
  contactPhone?: string;
  seed: Record<string, unknown>;
  extraction: ExtractionResult;
  orchestratorResults?: Array<Record<string, unknown>>;
  orchestratorSummaries?: Array<Record<string, unknown>>;
  composedText?: string;
}) {
  const store = new InMemoryPlanStore();
  const seedPlan = createEmptyPlan({
    planId: `p-${options.externalUserId}`,
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
  });
  await store.save({
    plan: mergePlan(seedPlan, {
      current_node: 'resolver_consultas_informativas',
      ...options.seed,
    }),
    reason: 'seed',
  });
  const execute = vi.fn(async (input: { requests: unknown[] }) => ({
    results: options.orchestratorResults ?? [],
    summaries: options.orchestratorSummaries ?? [],
    echoedRequests: input.requests,
  }));
  const composeRequests: ComposeReplyRequest[] = [];
  const composedText = options.composedText ?? 'respuesta de soporte';
  const takeover = vi.fn(async () => ({ status: 'skipped', reason: 'not_configured', message: 'Disabled.' }));
  const gateway = {
    async logMessage(input: unknown) {
      void input;
      return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success', messages: [] };
    },
    async requestHumanTakeover() {
      return takeover();
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
        return options.extraction;
      },
      async composeReply(request: ComposeReplyRequest) {
        composeRequests.push(request);
        return {
          text: composedText,
          structuredMessage: {
            type: 'generic',
            paragraphs_es: [composedText],
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
    informationOrchestrator: { execute } as never,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  const result = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: options.externalUserId,
    text: options.text,
    messageId: `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    ...(options.contactPhone ? { contactPhone: options.contactPhone } : {}),
  });
  return { result, execute, composeRequests, takeover };
}

describe('pending support questions reach the information executor', () => {
  it('routes a pending venue question plus a later event reference to lookup, not the ack shortcut', async () => {
    const pending: PendingInformationRequest = {
      requestId: 'pending-venue',
      kind: 'associated_event',
      query: '¿Dónde es el evento?',
      eventHint: null,
    };
    const { result, execute, composeRequests } = await runSupportTurn({
      externalUserId: 'u-pending-venue',
      text: 'Y el evento es Boda Ana y Luis',
      contactPhone: '+51900000001',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [pending],
          selection_candidates: [],
        },
      },
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: 'Boda Ana y Luis',
          personReference: null,
        },
      }),
      orchestratorResults: [venueResult('pending-venue')],
      orchestratorSummaries: [venueSummary('pending-venue')],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const executedRequests = (execute.mock.calls[0]?.[0] as { requests: PendingInformationRequest[] }).requests;
    expect(executedRequests).toHaveLength(1);
    expect(executedRequests[0]?.kind).toBe('associated_event');
    // The new event reference scopes the pending question; the branch is
    // the information executor, never the acknowledgment shortcut.
    expect(executedRequests[0]?.eventHint).toBe('Boda Ana y Luis');
    expect(result.trace.information_execution_summary?.length ?? 0).toBeGreaterThan(0);
    // The serialized reply input receives the resolved venue facts.
    const replyInput = composeRequests[0]?.informationResults ?? [];
    expect(replyInput).toHaveLength(1);
    expect(JSON.stringify(replyInput[0])).toContain('Hacienda Recoveco');
  });

  it('answers a pending time question on a role correction without inventing ownership', async () => {
    const pending: PendingInformationRequest = {
      requestId: 'pending-time',
      kind: 'associated_event',
      query: '¿A qué hora es?',
      eventHint: 'Boda Ana y Luis',
    };
    const timeResult = {
      ...venueResult('pending-time'),
      result: {
        ...(venueResult('pending-time').result as Record<string, unknown>),
      },
    };
    const { execute, composeRequests, takeover } = await runSupportTurn({
      externalUserId: 'u-pending-time-role',
      text: 'Soy la anfitriona, no la invitada',
      contactPhone: '+51900000001',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [pending],
          selection_candidates: [],
        },
      },
      extraction: supportExtraction({ reportedEventRole: 'host' }),
      orchestratorResults: [timeResult],
      orchestratorSummaries: [venueSummary('pending-time')],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const executedRequests = (execute.mock.calls[0]?.[0] as { requests: PendingInformationRequest[] }).requests;
    expect(executedRequests).toHaveLength(1);
    // The established target is preserved; the role correction adds context
    // without rewriting the scoped event or authorizing any write.
    expect(executedRequests[0]?.eventHint).toBe('Boda Ana y Luis');
    expect(takeover).not.toHaveBeenCalled();
    const replyInput = composeRequests[0]?.informationResults ?? [];
    expect(replyInput).toHaveLength(1);
    expect(JSON.stringify(replyInput[0])).toContain('2026-09-20T18:00:00');
  });

  it('keeps a bare role correction lightweight with no forced lookup or event dump', async () => {
    const { execute, composeRequests, takeover } = await runSupportTurn({
      externalUserId: 'u-bare-role',
      text: 'Soy el anfitrión del evento',
      seed: {},
      extraction: supportExtraction({ reportedEventRole: 'host' }),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(takeover).not.toHaveBeenCalled();
    expect(composeRequests).toHaveLength(1);
    // No event-information dump rides a turn with no pending task.
    expect(composeRequests[0]?.informationResults ?? []).toEqual([]);
    expect(composeRequests[0]?.customerContext ?? null).toBeNull();
  });

  it('preserves context on an answered policy plus names without new lookup or recital', async () => {
    const { result, execute, composeRequests, takeover } = await runSupportTurn({
      externalUserId: 'u-answered-policy',
      text: 'El invitado es Roger Abanto y el evento es Baby Shower Catalina',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: {
            kind: 'faq',
            query: '¿Puedo llevar acompañante?',
          },
        },
      },
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: 'Baby Shower Catalina',
          personReference: 'Roger Abanto',
        },
      }),
    });

    // The answered policy is not re-fetched and no identity is substituted:
    // the turn stays on the acknowledgment branch with empty execution.
    expect(execute).not.toHaveBeenCalled();
    expect(takeover).not.toHaveBeenCalled();
    expect(result.trace.information_execution_summary ?? []).toEqual([]);
    expect(composeRequests).toHaveLength(1);
    const echoed = composeRequests[0]?.extraction.supportAct;
    expect(echoed).toMatchObject({
      kind: 'provide_detail',
      eventReference: 'Baby Shower Catalina',
      personReference: 'Roger Abanto',
    });
    expect(result.outbound.delivery.action).toBe('send');
  });

  it('runs pure thanks with no read work instead of restarting the resolved task', async () => {
    const { execute, takeover } = await runSupportTurn({
      externalUserId: 'u-thanks',
      text: 'Gracias',
      seed: {},
      extraction: supportExtraction(),
    });

    expect(takeover).not.toHaveBeenCalled();
    // Either suppressed before execution or executed with zero requests:
    // no information read is ever issued for context-free thanks.
    if (execute.mock.calls.length > 0) {
      for (const call of execute.mock.calls) {
        expect((call[0] as { requests: unknown[] }).requests).toEqual([]);
      }
    }
  });
});
