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
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
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
    // Packet B: current-turn names are required in the acknowledgment; only
    // prior-turn names stay unrepeated.
    expect(continuity).toContain('no repitas nombres de turnos anteriores que este mensaje no trae');
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
  /** Shared store for multi-turn threads; when provided the seed save is skipped. */
  store?: InMemoryPlanStore;
  messageId?: string;
  /** Lease-wait fact for this invocation; threaded as typed reply evidence. */
  turnWait?: { waitMs: number; attempts: number };
  /** Shared OTP counters; when provided the gateway stub records sends/verifies. */
  otp?: { requested: number; verified: number };
}) {
  const store = options.store ?? new InMemoryPlanStore();
  if (!options.store) {
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
  }
  const otp = options.otp ?? { requested: 0, verified: 0 };
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
      async requestUserLoginCode() {
        otp.requested += 1;
        return { status: 'sent' as const };
      },
      async verifyUserLoginCode() {
        otp.verified += 1;
        return {
          status: 'authenticated' as const,
          token: 'otp-jwt',
          tokenExpiresAt: '2027-01-01T00:00:00.000Z',
        };
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
    messageId: options.messageId ?? `m-${options.externalUserId}`,
    receivedAt: '2026-09-04T15:01:00.000Z',
    ...(options.contactPhone ? { contactPhone: options.contactPhone } : {}),
    ...(options.turnWait ? { turnWait: options.turnWait } : {}),
  });
  return { result, execute, composeRequests, takeover, store, otp };
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

describe('pending credential resume and card topic preservation', () => {
  const cardQuery = 'Un amigo no puede usar su tarjeta de crédito para comprar un regalo. ¿Hay problemas con tarjetas?';

  function pendingEventQuestion(): PendingInformationRequest {
    return {
      requestId: 'information-1',
      kind: 'associated_event',
      query: '¿A qué hora empieza el evento?',
      eventHint: null,
    };
  }

  it('resumes a pending event question when the turn supplies the registered email', async () => {
    const { result, execute, composeRequests, otp } = await runSupportTurn({
      externalUserId: 'u-otp-email-resume',
      text: 'Mi correo registrado es otp-resume@example.invalid.',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [pendingEventQuestion()],
          selection_candidates: [],
        },
      },
      extraction: supportExtraction({
        contactEmail: 'otp-resume@example.invalid',
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: null,
          personReference: null,
        },
      }),
    });

    // The supplied email satisfies the required next input: the existing
    // login-code path runs exactly once instead of the ack shortcut.
    expect(otp.requested).toBe(1);
    expect(otp.verified).toBe(0);
    expect(result.plan.user_auth.status).toBe('code_requested');
    expect(result.plan.user_auth.email).toBe('otp-resume@example.invalid');
    expect(execute).toHaveBeenCalledTimes(1);
    const executedRequests = (execute.mock.calls[0]?.[0] as { requests: PendingInformationRequest[] }).requests;
    expect(executedRequests.map((request) => request.requestId)).toEqual(['information-1']);
    expect(result.trace.tools_called).toContain('request_user_login_code');
    expect(composeRequests).toHaveLength(1);
  });

  it('routes a supplied one-time code to verification on the pending protected request', async () => {
    const { result, execute, otp } = await runSupportTurn({
      externalUserId: 'u-otp-code-verify',
      text: 'Mi código es 482913',
      seed: {
        contact_email: 'otp-verify@example.invalid',
        user_auth: {
          status: 'code_requested',
          email: 'otp-verify@example.invalid',
          token: null,
          token_expires_at: null,
          last_error: null,
          requested_at: '2026-09-04T15:00:00.000Z',
          failed_code_attempts: 0,
          otp_send_attempts: 1,
          otp_non_delivery_reports: 0,
          auth_method: null,
          awaiting_phone_confirmation: false,
        },
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [pendingEventQuestion()],
          selection_candidates: [],
        },
      },
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: null,
          personReference: null,
        },
      }),
    });

    // The code in the inbound text reaches the existing verification path;
    // no second code is requested.
    expect(otp.verified).toBe(1);
    expect(otp.requested).toBe(0);
    expect(result.plan.user_auth.status).toBe('authenticated');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.trace.tools_called).toContain('verify_user_login_code');
    expect(result.trace.tools_called).not.toContain('request_user_login_code');
  });

  it('keeps a declined protected request terminal when credential text arrives later', async () => {
    const otp = { requested: 0, verified: 0 };
    const declined = await runSupportTurn({
      externalUserId: 'u-otp-refused',
      text: 'No quiero dar mi correo',
      messageId: 'm-u-otp-refused-1',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [pendingEventQuestion()],
          selection_candidates: [],
        },
      },
      extraction: supportExtraction({
        informationRequests: [{
          kind: 'associated_event',
          query: '¿A qué hora empieza el evento?',
          authAction: 'decline_authentication',
        }],
      }),
      otp,
    });

    expect(otp.requested).toBe(0);
    expect(otp.verified).toBe(0);
    expect(
      declined.result.plan.information_state.pending_requests.some(
        (request) => request.kind === 'purchase' || request.kind === 'associated_event',
      ),
    ).toBe(false);
    expect(declined.result.plan.auth_recovery.terminalReason).toBe('auth_refused');

    // A later email on the refused thread never reopens the OTP episode.
    const late = await runSupportTurn({
      externalUserId: 'u-otp-refused',
      text: 'Mi correo es late@example.invalid',
      messageId: 'm-u-otp-refused-2',
      seed: {},
      extraction: supportExtraction({
        contactEmail: 'late@example.invalid',
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: null,
          personReference: null,
        },
      }),
      store: declined.store,
      otp,
    });

    expect(otp.requested).toBe(0);
    expect(otp.verified).toBe(0);
    expect(late.result.plan.auth_recovery.terminalReason).toBe('auth_refused');
  });

  it('keeps the card topic across two metadata turns without new reads', async () => {
    const first = await runSupportTurn({
      externalUserId: 'u-card-topic',
      text: 'El nombre del invitado afectado es Roger Abanto.',
      messageId: 'm-u-card-topic-1',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: { kind: 'faq', query: cardQuery },
        },
      },
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: null,
          personReference: 'Roger Abanto',
        },
      }),
    });

    // Guest metadata stays on the acknowledgment branch: no invented
    // lookup, no authorization inferred, and the card problem is carried
    // into the reply input instead of being re-asked.
    expect(first.execute).not.toHaveBeenCalled();
    expect(first.takeover).not.toHaveBeenCalled();
    expect(first.composeRequests).toHaveLength(1);
    expect(first.composeRequests[0]?.plan.conversation_summary).toContain('tarjeta');
    expect(first.result.plan.user_auth.status).toBe('none');
    expect(first.result.outbound.delivery.action).toBe('send');

    const second = await runSupportTurn({
      externalUserId: 'u-card-topic',
      text: 'Y el evento es Baby Shower Catalina.',
      messageId: 'm-u-card-topic-2',
      seed: {},
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: 'Baby Shower Catalina',
          personReference: null,
        },
      }),
      store: first.store,
    });

    // Event metadata also stays lightweight and the card problem survives
    // the second turn instead of being erased or re-asked.
    expect(second.execute).not.toHaveBeenCalled();
    expect(second.takeover).not.toHaveBeenCalled();
    expect(second.composeRequests).toHaveLength(1);
    expect(second.composeRequests[0]?.extraction.supportAct).toMatchObject({
      kind: 'provide_detail',
      eventReference: 'Baby Shower Catalina',
    });
    expect(second.composeRequests[0]?.plan.conversation_summary).toContain('tarjeta');
    expect(second.result.plan.user_auth.status).toBe('none');
    expect(second.result.outbound.delivery.action).toBe('send');
  });

  it('answers the card question from serialized KB evidence with a single execution', async () => {
    const cardEvidence = 'Si la tarjeta es rechazada al comprar un regalo, el banco emisor debe autorizar la compra en línea.';
    const { result, execute, composeRequests } = await runSupportTurn({
      externalUserId: 'u-card-answer',
      text: cardQuery,
      seed: {},
      extraction: supportExtraction({
        informationRequests: [{
          kind: 'faq',
          query: cardQuery,
        }],
      }),
      orchestratorResults: [{
        requestId: 'information-1',
        kind: 'faq',
        status: 'completed',
        evidence: [{
          fileId: 'kb-card-payments',
          filename: 'pagos.md',
          score: 0.92,
          text: cardEvidence,
        }],
      }],
      orchestratorSummaries: [{
        requestId: 'information-1',
        kind: 'faq',
        status: 'completed',
        source: 'knowledge',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'card',
        evidence: [],
        resultCount: 1,
        durationMs: 60,
      }],
    });

    // One execution only: no extra search calls, no re-projection, and the
    // card-rejection facts reach the reply input verbatim.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(composeRequests).toHaveLength(1);
    expect(JSON.stringify(composeRequests[0]?.informationResults ?? [])).toContain(cardEvidence);
    expect(result.plan.information_state.last_completed_request).toMatchObject({ kind: 'faq' });
  });

  it('answers the card question from a multi-article evidence set without new reads', async () => {
    // Retrieval returns gift-obligation, payment-method and card-rejection
    // articles together; every excerpt reaches the reply request in one
    // execution with no invented operational troubleshooting.
    const paymentMethods = 'Medios de pago aceptados: Yape, Plin y transferencia bancaria.';
    const cardRejection = 'Si la tarjeta es rechazada, el banco emisor debe autorizar la compra en linea.';
    const { execute, composeRequests } = await runSupportTurn({
      externalUserId: 'u-card-multi-evidence',
      text: cardQuery,
      seed: {},
      extraction: supportExtraction({
        informationRequests: [{
          kind: 'faq',
          query: cardQuery,
        }],
      }),
      orchestratorResults: [{
        requestId: 'information-1',
        kind: 'faq',
        status: 'completed',
        evidence: [
          {
            fileId: 'kb-gift',
            filename: 'obligacion-regalo.md',
            score: 0.95,
            text: 'Obsequio de lista: los novios agradecen cualquier muestra de carino.',
          },
          {
            fileId: 'kb-pay',
            filename: 'medios-pago.md',
            score: 0.91,
            text: paymentMethods,
          },
          {
            fileId: 'kb-card',
            filename: 'tarjeta-rechazada.md',
            score: 0.88,
            text: cardRejection,
          },
        ],
      }],
      orchestratorSummaries: [{
        requestId: 'information-1',
        kind: 'faq',
        status: 'completed',
        source: 'knowledge',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'card',
        evidence: [],
        resultCount: 3,
        durationMs: 60,
      }],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(composeRequests).toHaveLength(1);
    const serialized = JSON.stringify(composeRequests[0]?.informationResults ?? []);
    expect(serialized).toContain(paymentMethods);
    expect(serialized).toContain(cardRejection);
    expect(composeRequests[0]?.errorMessage).toBeNull();
  });

  it('keeps an unanswered diagnostic question across supplied details without re-asking', async () => {
    // The open card question rides the existing pending-question
    // projection while supplied name/event details are incorporated: no
    // repeated lookup, no repeated question, and the topic survives.
    const openQuestion = 'Que mensaje muestra la tarjeta rechazada';
    const first = await runSupportTurn({
      externalUserId: 'u-card-pending-question',
      text: 'El nombre del invitado afectado es Roger Abanto.',
      messageId: 'm-u-card-pending-1',
      seed: {
        owner_pending_question: openQuestion,
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: { kind: 'faq', query: cardQuery },
        },
      },
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: null,
          personReference: 'Roger Abanto',
        },
      }),
    });

    expect(first.execute).not.toHaveBeenCalled();
    expect(first.takeover).not.toHaveBeenCalled();
    expect(first.composeRequests).toHaveLength(1);
    expect(first.composeRequests[0]?.pendingQuestionRef).toBe(openQuestion);
    expect(first.composeRequests[0]?.errorMessage).toBeNull();
    expect(first.composeRequests[0]?.plan.conversation_summary).toContain('tarjeta');
    expect(first.result.outbound.delivery.action).toBe('send');

    const second = await runSupportTurn({
      externalUserId: 'u-card-pending-question',
      text: 'Y el evento es Baby Shower Catalina.',
      messageId: 'm-u-card-pending-2',
      seed: {},
      extraction: supportExtraction({
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          eventReference: 'Baby Shower Catalina',
          personReference: null,
        },
      }),
      store: first.store,
    });

    // The second detail also stays lightweight: the open question is
    // still context, never a fresh interrogation without progress.
    expect(second.execute).not.toHaveBeenCalled();
    expect(second.takeover).not.toHaveBeenCalled();
    expect(second.composeRequests).toHaveLength(1);
    expect(second.composeRequests[0]?.pendingQuestionRef).toBe(openQuestion);
    expect(second.composeRequests[0]?.errorMessage).toBeNull();
    expect(second.composeRequests[0]?.extraction.supportAct).toMatchObject({
      kind: 'provide_detail',
      eventReference: 'Baby Shower Catalina',
    });
    expect(second.composeRequests[0]?.plan.conversation_summary).toContain('tarjeta');
    expect(second.result.outbound.delivery.action).toBe('send');
  });

  it('keeps a bare role correction on a completed thread free of invented work', async () => {
    const { result, execute, takeover, otp } = await runSupportTurn({
      externalUserId: 'u-bare-role-completed',
      text: 'Soy la anfitriona, no la invitada',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: { kind: 'faq', query: cardQuery },
        },
      },
      extraction: supportExtraction({ reportedEventRole: 'host' }),
    });

    // No lookup is invented from the correction alone and no authorization
    // is inferred from the role statement.
    expect(execute).not.toHaveBeenCalled();
    expect(takeover).not.toHaveBeenCalled();
    expect(otp.requested).toBe(0);
    expect(otp.verified).toBe(0);
    expect(result.plan.user_auth.status).toBe('none');
    expect(result.plan.information_state.pending_requests).toEqual([]);
    expect(result.plan.information_state.last_completed_request).toMatchObject({ kind: 'faq' });
  });
});

describe('exact-incident twin: rapid reconfirmation texts behind the lease', () => {
  const CONFIRMED_HEAD = 'Tu asistencia al evento de Michelle y Jorge del 10/10/2026 a las 20:15 quedó confirmada';
  const CONFIRMED_TAIL = 'GERARDO-1010';
  const FULL_CONFIRMATION = 'Buenas noches Gerardo. Tu asistencia al evento de Michelle y Jorge del 10/10/2026 a las 20:15 quedó confirmada. Te esperamos en la recepción desde las 19:45 con tu documento de identidad para el registro de ingreso. Si vienes con acompañante avísanos por este medio para anotarlo en la lista. Guarda este código de confirmación GERARDO-1010.';

  function specRuntime(): OpenAiAgentRuntime {
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
          throw new Error('serialization must not call the provider gateway');
        },
      } as never,
    });
  }

  function readWaitFollowupBlock(input: string): {
    waited: boolean;
    wait_ms: number;
    acquire_attempts: number;
    prior_reply: { message_id: string; recorded_at: string; summary: string; summary_truncated: boolean };
  } {
    const marker = '"wait_followup": {';
    const start = input.indexOf(marker);
    if (start === -1) throw new Error('wait_followup evidence missing from serialized input');
    const open = input.indexOf('{', start);
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = open; cursor < input.length; cursor += 1) {
      const ch = input[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(input.slice(open, cursor + 1)) as {
            waited: boolean;
            wait_ms: number;
            acquire_attempts: number;
            prior_reply: { message_id: string; recorded_at: string; summary: string; summary_truncated: boolean };
          };
        }
      }
    }
    throw new Error('wait_followup block not closed');
  }

  function detailExtraction(): ExtractionResult {
    return supportExtraction({
      supportAct: {
        kind: 'provide_detail',
        topic: 'unknown',
        detail: 'unknown',
        eventReference: 'Michelle y Jorge',
        personReference: 'Gerardo Cordova',
      },
    });
  }

  it('answers once fully, then short-by-reference on lock-waited follow-ups without repeating confirmation facts', async () => {
    const runtime = specRuntime();
    // Turn 1: fresh turn, no wait. The full confirmation is composed once.
    const first = await runSupportTurn({
      externalUserId: 'u-gerardo-cordova',
      text: 'Hola, soy Gerardo Cordova, ¿me confirmas mi asistencia al evento de Michelle y Jorge del 10/10/2026 a las 20:15?',
      messageId: 'm-gerardo-1',
      seed: {
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: { kind: 'faq', query: 'Confirmación de asistencia al evento de Michelle y Jorge' },
        },
      },
      extraction: detailExtraction(),
      composedText: FULL_CONFIRMATION,
    });
    expect(first.execute).not.toHaveBeenCalled();
    expect(first.composeRequests).toHaveLength(1);
    expect(first.composeRequests[0]?.messageContext.turnWait ?? null).toBeNull();
    expect(first.result.outbound.delivery.action).toBe('send');
    expect(first.result.outbound.text).toBe(FULL_CONFIRMATION);
    const firstSpec = await runtime.buildReplyRequestSpec(first.composeRequests[0]);
    expect(firstSpec.modules.map((module) => module.id)).not.toContain('reply_wait_followup');
    expect(firstSpec.input).not.toContain('"wait_followup"');
    // The full answer exists exactly once: the single delivered outbound text.
    expect(first.result.outbound.text).toContain(CONFIRMED_TAIL);

    // Turn 2: rapid follow-up that waited on the lease behind turn 1.
    const second = await runSupportTurn({
      externalUserId: 'u-gerardo-cordova',
      text: 'Me reconfirmas y me reenvías el enlace de la invitación',
      messageId: 'm-gerardo-2',
      seed: {},
      extraction: detailExtraction(),
      composedText: 'Gerardo, tu asistencia ya quedó confirmada para el 10/10/2026 a las 20:15; te reenvío el enlace de la invitación por este medio.',
      store: first.store,
      turnWait: { waitMs: 1500, attempts: 2 },
    });
    expect(second.execute).not.toHaveBeenCalled();
    expect(second.composeRequests).toHaveLength(1);
    expect(second.composeRequests[0]?.messageContext.turnWait).toEqual({ waitMs: 1500, attempts: 2 });
    // Continuity survives the wait: same lane, no invented work.
    expect(second.composeRequests[0]?.messageContext.continuity?.lane).toBe(
      first.composeRequests[0]?.messageContext.continuity?.lane,
    );
    // Delivery present: a waited turn is never silent.
    expect(second.result.outbound.delivery.action).toBe('send');
    expect(second.result.outbound.text?.length ?? 0).toBeGreaterThan(0);
    const secondSpec = await runtime.buildReplyRequestSpec(second.composeRequests[0]);
    expect(secondSpec.modules.map((module) => module.id)).toContain('reply_wait_followup');
    expect(secondSpec.instructions).toContain('## nodes/resolver_consultas_informativas/wait_followup.txt');
    expect(secondSpec.input).toContain('"wait_followup"');
    const secondEvidence = readWaitFollowupBlock(secondSpec.input);
    expect(secondEvidence.waited).toBe(true);
    expect(secondEvidence.wait_ms).toBe(1500);
    expect(secondEvidence.acquire_attempts).toBe(2);
    expect(secondEvidence.prior_reply.message_id).toBe('m-gerardo-1');
    // Short by reference: bounded summary only, never the repeated facts.
    expect(secondEvidence.prior_reply.summary).toContain(CONFIRMED_HEAD.slice(0, 60));
    expect(secondEvidence.prior_reply.summary).not.toContain(CONFIRMED_TAIL);
    expect(secondEvidence.prior_reply.summary.length).toBeLessThanOrEqual(280);
    // The composed evidence set adds no second copy of the confirmation facts.
    expect(secondSpec.input.split(CONFIRMED_TAIL).length - 1).toBe(1);

    // Turn 3: third rapid text, waited again behind the sent replies.
    const third = await runSupportTurn({
      externalUserId: 'u-gerardo-cordova',
      text: 'Ya le di clic al enlace, ¿quedó registrado mi acceso?',
      messageId: 'm-gerardo-3',
      seed: {},
      extraction: detailExtraction(),
      composedText: 'Sí Gerardo, tu clic quedó registrado y tu asistencia sigue confirmada.',
      store: second.store,
      turnWait: { waitMs: 2200, attempts: 3 },
    });
    expect(third.execute).not.toHaveBeenCalled();
    expect(third.composeRequests).toHaveLength(1);
    expect(third.composeRequests[0]?.messageContext.turnWait).toEqual({ waitMs: 2200, attempts: 3 });
    expect(third.result.outbound.delivery.action).toBe('send');
    expect(third.result.outbound.text?.length ?? 0).toBeGreaterThan(0);
    const thirdSpec = await runtime.buildReplyRequestSpec(third.composeRequests[0]);
    expect(thirdSpec.modules.map((module) => module.id)).toContain('reply_wait_followup');
    const thirdEvidence = readWaitFollowupBlock(thirdSpec.input);
    expect(thirdEvidence.waited).toBe(true);
    expect(thirdEvidence.wait_ms).toBe(2200);
    expect(thirdEvidence.acquire_attempts).toBe(3);
    expect(thirdEvidence.prior_reply.message_id).toBe('m-gerardo-2');
    expect(thirdEvidence.prior_reply.summary).toContain('quedó confirmada');
    expect(thirdEvidence.prior_reply.summary).not.toContain(CONFIRMED_TAIL);    // Turn 1 confirmation facts are fully absent here: history carries only
    // the latest record and the new evidence adds a bounded reference.
    expect(thirdSpec.input.split(CONFIRMED_TAIL).length - 1).toBe(0);
  });
});
