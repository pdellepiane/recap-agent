import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInformationAuthGuidance,
  type ExtractedInformationRequest,
  type PurchaseInformation,
} from '../src/core/information';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import {
  type AgentConversationMessage,
  type AgentConversationGateway,
  type AgentGatewayResult,
  type AgentMessageLogInput,
  type AgentPhonePurchaseLookupResult,
  type AgentPurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type {
  KnowledgeRetrievalGateway,
  KnowledgeRetrievalResult,
} from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  ProviderGateway,
  UserEventLookupResult,
} from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
};

describe('AgentService first-class information flow', () => {
  it('routes mailbox reports, deferrals and clarifications from empty information state without lookups or restarts', async () => {
    const runtime = new InformationRuntime([
      { ...extraction([]), supportAct: { kind: 'report_issue', topic: 'mailbox_capacity', detail: 'mailbox_full' } },
      { ...extraction([]), supportAct: { kind: 'defer_submission', topic: 'unknown', detail: 'unknown' } },
      { ...extraction([]), supportAct: { kind: 'provide_detail', topic: 'mailbox_capacity', detail: 'mailbox_full' } },
    ]);
    const knowledge = new FakeKnowledgeGateway();
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge, purchaseGateway: gateway, providerGateway: providerGateway() });
    const texts = ['Tengo un problema de capacidad en mi gmail registrado', 'Lo voy a enviar luego', 'Esta lkeno'];
    const summaries: string[] = [];
    for (const [index, text] of texts.entries()) {
      const response = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'mailbox-report',
        contactPhone: '+51900000302', messageId: `mailbox-${index}`, receivedAt: new Date().toISOString(), text });
      expect(response.plan.current_node).toBe('resolver_consultas_informativas');
      // L1: support acknowledgments are model-composed from scoped evidence,
      // one reply-model call per turn through the minimal support bundle.
      expect(runtime.composeRequests).toHaveLength(index + 1);
      expect(response.trace.prompt_bundle_id).not.toBe('deterministic:support_continuity_acknowledgment');
      expect(response.trace.prompt_file_paths).toContain(
        'nodes/resolver_consultas_informativas/support_continuity.txt',
      );
      expect(response.outbound.text).toBe('Respuesta informativa.');
      expect(response.outbound.delivery.action).toBe('send');
      summaries.push(response.plan.conversation_summary);
    }
    expect(summaries).toEqual([
      'La persona informó que el buzón de su correo registrado está lleno; la consulta de soporte sigue abierta.',
      'La persona informó que el buzón de su correo registrado está lleno; la consulta de soporte sigue abierta.',
      'La persona informó que el buzón de su correo registrado está lleno; la consulta de soporte sigue abierta.',
    ]);
    expect(knowledge.calls).toBe(0);
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(0);
    expect(runtime.extractRequests).toHaveLength(3);
  });

  it('keeps a recent support topic for an ambiguous no-domain follow-up', async () => {
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(
      createEmptyPlan({
        planId: 'mailbox-support-anchor',
        channel: 'whatsapp',
        externalUserId: 'mailbox-support-anchor-user',
      }),
      {
        current_node: 'resolver_consultas_informativas',
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: null,
        },
      },
    );
    await planStore.save({ plan: seed, reason: 'fixture' });

    const runtime = new InformationRuntime([{
      ...extraction([]),
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: '¿Confirmas que el buzón del correo registrado está lleno?',
        interpretations: ['el buzón del correo registrado está lleno', 'el estado de una compra'],
      },
    }]);
    const knowledge = new FakeKnowledgeGateway();
    const gateway = new FakePurchaseGateway();
    gateway.recentMessages = [
      conversationMessage({
        id: 1,
        direction: 'inbound',
        body: 'Tengo un problema de capacidad en mi gmail registrado',
      }),
      conversationMessage({
        id: 2,
        direction: 'outbound',
        body: 'Entiendo: el buzón de tu correo registrado está lleno.',
      }),
    ];
    const service = createService({
      runtime,
      knowledgeGateway: knowledge,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'mailbox-support-anchor-user',
      contactPhone: '+51900000302',
      text: 'Esta lkeno',
      messageId: 'mailbox-support-anchor-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(response.outbound.text).toBe(
      '¿Confirmas que el buzón del correo registrado está lleno?',
    );
    expect(runtime.composeRequests).toHaveLength(0);
    expect(knowledge.calls).toBe(0);
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(0);
  });

  it('uses contextual clarification for an empty extraction after recent support history', async () => {
    const runtime = new InformationRuntime([extraction([])]);
    const knowledge = new FakeKnowledgeGateway();
    const gateway = new FakePurchaseGateway();
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'mailbox-empty-continuation-plan',
        channel: 'whatsapp',
        externalUserId: 'mailbox-empty-continuation',
      }), {
        current_node: 'resolver_consultas_informativas',
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [],
          selection_candidates: [],
          last_completed_request: null,
        },
      }),
    });
    gateway.recentMessages = [
      conversationMessage({
        id: 1,
        direction: 'outbound',
        body: '¿Qué dato deseas precisar sobre el buzón de tu correo registrado?',
      }),
    ];
    const service = createService({
      runtime,
      knowledgeGateway: knowledge,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'mailbox-empty-continuation',
      contactPhone: '+51900000302',
      text: 'mmm',
      messageId: 'mailbox-empty-continuation-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(response.trace.route_kind).toBe('contextual_clarification');
    expect(response.outbound.text).toContain('continuar');
    expect(response.outbound.text).not.toMatch(/^(?:Hola|¡Hola)/u);
    expect(runtime.composeRequests).toHaveLength(0);
    expect(knowledge.calls).toBe(0);
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(0);
  });

  it('composes an empty-history continuation from the compact canonical support summary', async () => {
    const runtime = new InformationRuntime([extraction([])]);
    const gateway = new FakePurchaseGateway();
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'canonical-support-summary-plan',
        channel: 'whatsapp',
        externalUserId: 'canonical-support-summary-user',
      }), {
        current_node: 'resolver_consultas_informativas',
        conversation_summary: 'La persona informó que el buzón de su correo registrado está lleno; la consulta de soporte sigue abierta.',
      }),
    });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'canonical-support-summary-user',
      contactPhone: '+51900000302',
      text: 'Esta lkeno',
      messageId: 'canonical-support-summary-1',
      receivedAt: new Date().toISOString(),
    });

    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.plan.conversation_summary).toContain('buzón');
    expect(runtime.composeRequests[0]?.errorMessage).toContain('resumen canónico');
    expect(response.trace.route_kind).toBe('contextual_clarification');
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(0);
  });

  it('acknowledges a deferral without executing or deleting an unresolved purchase selection', async () => {
    const store = new InMemoryPlanStore();
    const request = { kind: 'purchase' as const, resource: 'orders' as const, query: 'Consulta sobre mi regalo',
      orderId: null, aspects: ['payment_status' as const], sensitiveFields: [], authAction: 'none' as const, requestId: 'pending' };
    await store.save({ reason: 'fixture', plan: mergePlan(createEmptyPlan({ planId: 'deferred', channel: 'whatsapp', externalUserId: 'deferred' }), {
      current_node: 'resolver_consultas_informativas', information_state: {
        resume_node: 'entrevista', pending_requests: [request], selection_candidates: [], last_completed_request: null,
      },
    }) });
    const runtime = new InformationRuntime([{ ...extraction([]), supportAct: { kind: 'defer_submission', topic: 'payment_proof', detail: 'submission_deferred' } }]);
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: new FakeKnowledgeGateway(), purchaseGateway: gateway, providerGateway: providerGateway(), planStore: store });
    const response = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'deferred', contactPhone: '+51900000302',
      text: 'Lo envío luego', messageId: 'defer', receivedAt: new Date().toISOString() });
    expect(response.plan.information_state.pending_requests).toEqual([request]);
    expect(gateway.guestOrdersCalls + gateway.authByPhoneCalls).toBe(0);
  });

  it('clarifies a rejected purchase extraction without welcoming, looking up data, or starting OTP', async () => {
    const runtime = new InformationRuntime([{
      ...extraction([]),
      normalizationIssues: [{
        requestKind: 'purchase',
        field: 'resource',
        reason: 'missing_resource',
      }],
    }]);
    const gateway = new FakePurchaseGateway();
    const knowledge = new FakeKnowledgeGateway();
    const service = createService({
      runtime,
      knowledgeGateway: knowledge,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'rejected-purchase-extraction',
      contactPhone: '+51900000302',
      text: 'Necesito ayuda con esa compra.',
      messageId: 'rejected-purchase-extraction-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.errorMessage).toContain(
      'una sola pregunta breve',
    );
    expect(runtime.composeRequests[0]?.currentNode).toBe(
      'resolver_consultas_informativas',
    );
    expect(knowledge.calls).toBe(0);
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls).toBe(0);
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(response.plan.user_auth.status).toBe('none');
    expect(response.trace.extraction_summary.information_normalization_rejected_count).toBe(1);
  });

  it('retrieves verified FAQ evidence for a typed policy question instead of answering from model memory', async () => {
    const runtime = new InformationRuntime([{
      ...extraction([]),
      supportAct: {
        kind: 'ask_policy',
        topic: 'purchase_status',
        detail: 'status_pending',
      },
    }]);
    const gateway = new FakePurchaseGateway();
    const knowledge = new FakeKnowledgeGateway();
    const service = createService({
      runtime,
      knowledgeGateway: knowledge,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'typed-policy-question',
      contactPhone: '+51900000302',
      text: '¿Cuál es el plazo general de validación?',
      messageId: 'typed-policy-question-1',
      receivedAt: new Date().toISOString(),
    });

    expect(knowledge.calls).toBe(1);
    expect(knowledge.lastQuery).toBe('¿Cuál es el plazo general de validación?');
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.informationResults).toEqual([
      expect.objectContaining({ kind: 'faq', status: 'completed' }),
    ]);
  });

  it('never treats a numeric external conversation id as a trusted escalation phone', async () => {
    const runtime = new InformationRuntime([
      extraction([], 'solicitar_humano'),
    ]);
    const gateway = new FakePurchaseGateway();
    const takeover = vi.spyOn(gateway, 'requestHumanTakeover');
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: '51987654321',
      text: 'Necesito hablar con una persona.',
      messageId: 'untrusted-external-id-1',
      receivedAt: new Date().toISOString(),
    });

    expect(takeover).not.toHaveBeenCalled();
  });
  const hostRequest = (hostWithdrawal: 'individual_status' | 'policy_only' = 'individual_status'): ExtractedInformationRequest => ({
    kind: 'faq', query: 'Retiro de fondos del evento aún no recibido', hostWithdrawal,
    eventHint: 'Diana y Fernando',
  });
  const hostKnowledge = () => {
    const gateway = new FakeKnowledgeGateway();
    const search = vi.spyOn(gateway, 'search').mockResolvedValue({ status: 'success', evidence: [{
      fileId: 'host-policy', filename: 'atc-template-new-solicitud-de-fondos.md', score: 0.9,
      text: 'template_status: "Vigente"\nLas solicitudes se procesan en hasta 72 horas hábiles.\nComisión USD5. Retiro recibido mañana. Cuenta privada.',
    }] });
    return { gateway, search };
  };

  it('answers host withdrawal policy and hands off once, retaining the full pending topic without buyer/RSVP/OTP work', async () => {
    const runtime = new InformationRuntime([
      { ...extraction([]), conversationSummary: 'La usuaria es la novia, no compradora.' },
      extraction([hostRequest()], 'solicitar_humano'),
    ]);
    const knowledge = hostKnowledge();
    const gateway = new FakePurchaseGateway();
    const takeover = vi.spyOn(gateway, 'requestHumanTakeover').mockResolvedValue({ status: 'success', message: null });
    const provider = providerGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge.gateway,
      purchaseGateway: gateway, providerGateway: provider });
    const inbound = { channel: 'whatsapp', externalUserId: 'host-diana', contactPhone: '+51999999999', receivedAt: new Date().toISOString() };
    await service.handleTurn({ ...inbound, messageId: 'role', text: 'Hola, no hice ningún regalo. Yo soy la novia.' });
    const answer = await service.handleTurn({ ...inbound, messageId: 'withdrawal', text: 'Hice un retiro de dinero de mi evento y aún no lo recibo.' });
    expect(knowledge.search).toHaveBeenCalledTimes(1);
    expect(knowledge.search).toHaveBeenCalledWith(expect.stringContaining('fondos al anfitrión'), { rewriteQuery: false });
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(answer.plan.human_escalation.status).toBe('requested');
    expect(answer.plan.information_state.pending_requests).toMatchObject([hostRequest()]);
    expect(JSON.stringify(answer.outbound)).toContain('72 horas hábiles');
    expect(JSON.stringify(answer.outbound)).toContain('No tengo disponible el estado de tu retiro');
    expect(JSON.stringify(answer.outbound)).not.toMatch(/USD5|mañana|Cuenta privada/u);
    const followup = await service.handleTurn({ ...inbound, messageId: 'event', text: 'Evento: Diana y Fernando' });
    expect(followup.trace.prompt_bundle_id).toBe('deterministic:human_escalation_soft_pause');
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(runtime.extractRequests).toHaveLength(2);
    expect(runtime.composeRequests).toHaveLength(1); // Initial role response only; no policy reply-model call.
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.guestEventCalls + gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls + provider.verifyCodeCalls + provider.eventLookupCalls).toBe(0);
  });

  it('answers general host policy without requesting human help or exposing irrelevant context to a reply model', async () => {
    const runtime = new InformationRuntime([extraction([hostRequest('policy_only')])]);
    const knowledge = hostKnowledge();
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge.gateway, purchaseGateway: gateway, providerGateway: providerGateway() });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'general-host-policy',
      text: '¿Cuánto demora un retiro de fondos?', messageId: 'policy', receivedAt: new Date().toISOString() });
    expect(gateway.takeoverCalls).toBe(0);
    expect(result.plan.information_state.pending_requests).toEqual([]);
    expect(runtime.composeRequests).toEqual([]);
    expect(JSON.stringify(result.outbound)).toContain('72 horas hábiles');
  });

  it('retains pending support and does not enter RSVP for a bare event reference after failed handoff', async () => {
    const store = new InMemoryPlanStore();
    await store.save({ reason: 'fixture', plan: mergePlan(createEmptyPlan({ planId: 'pending-host', channel: 'whatsapp', externalUserId: 'pending-host' }), {
      current_node: 'resolver_consultas_informativas', information_state: {
        resume_node: null, pending_requests: [{ ...hostRequest(), requestId: 'host' }],
        selection_candidates: [], last_completed_request: null,
      },
    }) });
    const runtime = new InformationRuntime([{ ...extraction([]), rsvpEventReference: 'Diana y Fernando' }]);
    const gateway = new FakePurchaseGateway();
    vi.spyOn(gateway, 'requestHumanTakeover').mockResolvedValue({ status: 'failed', retryable: true, error: 'unavailable' });
    const service = createService({ runtime, knowledgeGateway: hostKnowledge().gateway, purchaseGateway: gateway, providerGateway: providerGateway(), planStore: store });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'pending-host', contactPhone: '+51999999999',
      text: 'Evento: Diana y Fernando', messageId: 'event', receivedAt: new Date().toISOString() });
    expect(result.plan.current_node).toBe('resolver_consultas_informativas');
    expect(result.plan.human_escalation.status).toBe('none');
    expect(result.plan.information_state.pending_requests).toHaveLength(1);
    expect(JSON.stringify(result.outbound)).toContain('No pude registrar');
    expect(gateway.guestEventCalls + gateway.guestOrdersCalls).toBe(0);
  });

  it('does not invent a processing window if FAQ retrieval fails, but still attempts individual-status support', async () => {
    const runtime = new InformationRuntime([extraction([hostRequest()])]);
    const knowledge = hostKnowledge();
    knowledge.search.mockResolvedValue({ status: 'failed', reason: 'request_failed', retryable: true, error: 'offline' });
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge.gateway, purchaseGateway: gateway, providerGateway: providerGateway() });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'no-policy', contactPhone: '+51999999999',
      text: 'No recibí mi retiro', messageId: 'missing', receivedAt: new Date().toISOString() });
    expect(JSON.stringify(result.outbound)).not.toContain('72');
    expect(JSON.stringify(result.outbound)).toContain('No pude verificar');
    expect(gateway.takeoverCalls).toBe(1);
    expect(runtime.composeRequests).toEqual([]);
  });

  it('does not act on an ambiguous host-withdrawal extraction', async () => {
    const runtime = new InformationRuntime([{ ...extraction([hostRequest()]), ambiguity: {
      status: 'ambiguous', clarificationQuestion: '¿Te refieres a retirar fondos de tu evento o a un regalo?',
      interpretations: ['Retiro de fondos', 'Regalo comprado'],
    } }]);
    const knowledge = hostKnowledge();
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge.gateway, purchaseGateway: gateway, providerGateway: providerGateway() });
    await service.handleTurn({ channel: 'whatsapp', externalUserId: 'ambiguous-host',
      text: 'Quiero ver lo que retiré', messageId: 'ambiguous', receivedAt: new Date().toISOString() });
    expect(gateway.takeoverCalls).toBe(0);
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(runtime.composeRequests).toHaveLength(1);
  });

  it("does not replace the channel user's name with a third-party guest name", async () => {
    const planStore = new InMemoryPlanStore();
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'identity-guard',
        channel: 'whatsapp',
        externalUserId: 'identity-guard-user',
      }),
      {
        contact_name: 'Claudia',
        current_node: 'resolver_consultas_informativas',
      },
    );
    await planStore.save({ plan, reason: 'fixture' });
    const runtime = new InformationRuntime([
      {
        ...extraction([]),
        contactName: 'Roger Abanto',
      },
    ]);
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'identity-guard-user',
      text: 'El nombre es Roger Abanto',
      messageId: 'identity-guard-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.contact_name).toBe('Claudia');
  });

  it('keeps structured support details in the information flow without renaming the user', async () => {
    const planStore = new InMemoryPlanStore();
    const runtime = new InformationRuntime([
      extraction([{ kind: 'faq', query: 'Problema de tarjeta de un invitado.' }]),
      {
        ...extraction([]),
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          personReference: 'Roger Abanto',
          eventReference: null,
        },
      },
      {
        ...extraction([]),
        supportAct: {
          kind: 'provide_detail',
          topic: 'unknown',
          detail: 'unknown',
          personReference: null,
          eventReference: 'Baby Shower Catalina',
        },
      },
    ]);
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
      planStore,
    });
    const base = {
      channel: 'whatsapp',
      externalUserId: 'support-detail-user',
      contactPhone: '+51985101461',
      receivedAt: new Date().toISOString(),
    } as const;

    const supportQuestion = await service.handleTurn({
      ...base,
      text: '¿Hay problemas con tarjetas de crédito?',
      messageId: 'support-detail-1',
    });
    expect(supportQuestion.plan.information_state.last_completed_request).toEqual({
      kind: 'faq',
      query: 'Problema de tarjeta de un invitado.',
    });
    const namedGuest = await service.handleTurn({
      ...base,
      text: 'El nombre es Roger Abanto',
      messageId: 'support-detail-2',
    });
    const namedEvent = await service.handleTurn({
      ...base,
      text: 'Y el evento es Baby Shower Catalina',
      messageId: 'support-detail-3',
    });

    expect(namedGuest.plan.current_node).toBe('resolver_consultas_informativas');
    expect(namedGuest.plan.contact_name).toBeNull();
    // L1: the service projects the structured detail as evidence; the model
    // writes the reply. The stub model text is delivered verbatim.
    expect(namedGuest.outbound.text).toBe('Respuesta informativa.');
    expect(namedGuest.outbound.delivery.action).toBe('send');
    expect(runtime.composeRequests.at(-2)?.extraction.supportAct).toMatchObject({
      kind: 'provide_detail',
      personReference: 'Roger Abanto',
    });
    expect(namedEvent.plan.current_node).toBe('resolver_consultas_informativas');
    expect(namedEvent.plan.contact_name).toBeNull();
    expect(namedEvent.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests.at(-1)?.extraction.supportAct).toMatchObject({
      kind: 'provide_detail',
      eventReference: 'Baby Shower Catalina',
    });
    expect(runtime.composeRequests.at(-1)?.errorMessage).toBeNull();
  });

  it('resumes a completed purchase information thread for a contextual correction', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)]),
      extraction([]),
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'contextual-correction-user',
      contactPhone: '+51999999999',
      text: 'Quiero revisar el estado de mi regalo',
      messageId: 'contextual-correction-1',
      receivedAt: new Date().toISOString(),
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'contextual-correction-user',
      contactPhone: '+51999999999',
      text: 'Pero hoy es 30 de agosto, no 31',
      messageId: 'contextual-correction-2',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(runtime.composeRequests.at(-1)?.currentNode).toBe(
      'resolver_consultas_informativas',
    );
    expect(runtime.composeRequests.at(-1)?.informationResults?.[0]).toMatchObject({
      kind: 'purchase',
      status: 'completed',
    });
  });

  it('answers FAQ evidence while preserving a purchase request blocked on email', async () => {
    const runtime = new InformationRuntime([
      extraction([
        { kind: 'faq', query: '¿Cómo funciona la lista de regalos?' },
        purchaseRequest(null),
      ]),
    ]);
    const knowledgeGateway = new FakeKnowledgeGateway();
    const purchaseGateway = new FakePurchaseGateway();
    const service = createService({
      runtime,
      knowledgeGateway,
      purchaseGateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'whatsapp:51999999999',
      text: '¿Cómo funciona la lista y cuál es el estado de mi regalo?',
      messageId: 'mixed-info-1',
      receivedAt: new Date().toISOString(),
    });

    const results = runtime.composeRequests.at(-1)?.informationResults ?? [];
    expect(results).toEqual([
      expect.objectContaining({ kind: 'faq', status: 'completed' }),
      expect.objectContaining({
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
      }),
    ]);
    const purchaseBlock = results.find(
      (result) => result.kind === 'purchase' && result.status === 'needs_input',
    );
    expect(
      purchaseBlock?.status === 'needs_input' ? purchaseBlock.guidance : null,
    ).toEqual(createInformationAuthGuidance('email_required', null));
    expect(response.plan.information_state.pending_requests).toHaveLength(1);
    expect(response.plan.information_state.pending_requests[0]?.kind).toBe(
      'purchase',
    );
    expect(knowledgeGateway.calls).toBe(1);
    expect(purchaseGateway.ordersCalls + purchaseGateway.giftCalls).toBe(0);
  });

  it('treats a typed purchase request as clear when optional lookup details were marked ambiguous', async () => {
    const recordedExtraction = extraction([
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'Estado del pedido propio del usuario.',
        orderId: null,
        aspects: ['summary', 'payment_status', 'shipping'],
        sensitiveFields: [],
        authAction: 'none',
      },
    ]);
    recordedExtraction.ambiguity = {
      status: 'ambiguous',
      clarificationQuestion:
        '¿Quieres consultar un pedido específico o todos tus pedidos?',
      interpretations: [
        'un pedido específico',
        'todos tus pedidos',
      ],
    };
    const runtime = new InformationRuntime([recordedExtraction]);
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'recorded-order-loop',
      text: 'Quiero saber el estado de un pedido',
      messageId: 'recorded-order-loop-1',
      receivedAt: new Date().toISOString(),
    });

    const results = runtime.composeRequests.at(-1)?.informationResults ?? [];
    const purchaseBlock = results.find(
      (result) => result.kind === 'purchase' && result.status === 'needs_input',
    );
    expect(purchaseBlock).toEqual(
      expect.objectContaining({
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
      }),
    );
    expect(
      purchaseBlock?.status === 'needs_input' ? purchaseBlock.guidance : null,
    ).toEqual(createInformationAuthGuidance('email_required', null));
    expect(response.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        resource: 'orders',
        orderId: null,
      }),
    ]);
    expect(response.trace.extraction_summary.ambiguity_status).toBe('clear');
    expect(runtime.composeRequests.at(-1)?.errorMessage).toBeNull();
  });

  it('asks briefly for account verification when the user already supplied an order number', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest('ORD-000880')]),
    ]);
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'specific-order-without-email',
      text: 'Revisa mi pedido ORD-000880.',
      messageId: 'specific-order-without-email-1',
      receivedAt: new Date().toISOString(),
    });

    const authBlock = runtime.composeRequests
      .at(-1)
      ?.informationResults?.find(
        (result) => result.kind === 'purchase' && result.status === 'needs_input',
      );
    expect(
      authBlock?.status === 'needs_input' ? authBlock.guidance : null,
    ).toEqual(createInformationAuthGuidance('email_required', null));
  });

  it('reads a protected purchase with the trusted WhatsApp number without authentication', async () => {
    const runtime = new InformationRuntime([extraction([purchaseRequest(null)])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'external-id-must-not-authenticate',
      text: 'Quiero revisar mi regalo.',
      messageId: 'phone-first-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(0);
    expect(response.plan.user_auth).toMatchObject({
      status: 'none',
      token: null,
      auth_method: null,
    });
    expect(response.trace.tools_called).toContain(
      'lookup_guest_orders_by_phone',
    );
    expect(response.trace.tools_called).not.toContain('auth_by_phone');
    expect(runtime.composeRequests.at(-1)?.informationResults?.[0]).toMatchObject({
      status: 'completed',
      accessMethod: 'trusted_phone_purchase',
    });
  });

  it.skip('looks up one canonical order for a confirmation document, hands off once, and suppresses repeats', async () => {
    const runtime = new InformationRuntime([
      {
        ...extraction([]),
        requestedOperation: 'confirmation_document.send',
      },
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    const takeover = vi
      .spyOn(gateway, 'requestHumanTakeover')
      .mockResolvedValue({ status: 'success', message: null });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const inbound = {
      channel: 'whatsapp',
      externalUserId: 'document-request-user',
      contactPhone: '+51973296571',
      text: 'Necesito la constancia de mi compra.',
      messageId: 'document-request-1',
      receivedAt: new Date().toISOString(),
    };
    const response = await service.handleTurn(inbound);

    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(0);
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.trace.information_execution_summary).toEqual([
      expect.objectContaining({
        status: 'completed',
        accessMethod: 'trusted_phone_purchase',
        resource: 'orders',
      }),
    ]);
    expect(runtime.composeRequests).toHaveLength(1);

    const repeated = await service.handleTurn({
      ...inbound,
      messageId: 'document-request-2',
      text: 'También necesito el comprobante.',
    });
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(runtime.extractRequests).toHaveLength(1);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(repeated.outbound.text).toBeNull();
  });

  it.skip('adds the canonical document-status lookup even when an unrelated request is already pending', async () => {
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'document-with-pending-faq',
        channel: 'whatsapp',
        externalUserId: 'document-with-pending-faq',
      }), {
        current_node: 'resolver_consultas_informativas',
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [{
            kind: 'faq',
            query: 'Consulta general anterior.',
            requestId: 'pending-faq',
          }],
          selection_candidates: [],
          last_completed_request: null,
        },
      }),
    });
    const runtime = new InformationRuntime([{
      ...extraction([]),
      requestedOperation: 'confirmation_document.send',
    }]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    vi.spyOn(gateway, 'requestHumanTakeover')
      .mockResolvedValue({ status: 'success', message: null });
    const knowledge = new FakeKnowledgeGateway();
    const service = createService({
      runtime,
      knowledgeGateway: knowledge,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
      planStore: store,
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'document-with-pending-faq',
      contactPhone: '+51973296571',
      text: 'Ahora necesito la constancia de mi compra.',
      messageId: 'document-with-pending-faq-1',
      receivedAt: new Date().toISOString(),
    });

    expect(gateway.guestOrdersCalls).toBe(1);
    expect(runtime.composeRequests[0]?.extraction.informationRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'purchase',
          resource: 'orders',
          aspects: ['payment_status'],
        }),
      ]),
    );
  });

  it('adds only canonical pending status to an unsupported proof-validation reply', async () => {
    const request = purchaseRequest(null);
    request.resource = 'orders';
    request.amount = 13.76;
    const runtime = new InformationRuntime([{
      ...extraction([request]),
      requestedOperation: 'payment_proof.verify',
    }]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{
        ...purchase('ORD-000880'),
        paymentStatus: 'pending',
        grandTotal: 227.76,
        paymentMethod: 'Yape_o_Plin',
        eventName: 'Alejandra',
        currency: null,
        paymentValidationExpectation: {
          maxBusinessHours: 72,
          appliesTo: 'indexed_validation_methods',
        },
      }],
    };
    vi.spyOn(gateway, 'requestHumanTakeover')
      .mockResolvedValue({ status: 'success', message: null });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'proof-validation-safe-read',
      contactPhone: '+51973296571',
      text: 'Ya envié los 13.76 que faltaban, tengo el voucher.',
      messageId: 'proof-validation-safe-read-1',
      receivedAt: new Date().toISOString(),
      media: [{
        kind: 'image',
        providerMediaId: 'fixture-image',
        mimeType: 'image/jpeg',
        sha256: null,
        fileName: null,
      }],
    });

    expect(response.outbound.text).toContain('indicas haber enviado 13.76');
    expect(response.outbound.text).toContain('El pedido de Alejandra sigue pendiente');
    expect(response.outbound.text).toContain('hasta 72 horas hábiles');
    // Stale 2026-09-08: live run eval-2026-09-08T15-19-11-093Z-af842b71 scored
    // the handoff wording 0.15 on live_behavior.pending_balance_validation_luis
    // turn 1. The hard rubric demands staying on the pending order with image
    // and window grounding and no handoff, so the voucher continuation owns it.
    expect(response.outbound.text).toContain('no permite confirmar');
    expect(response.outbound.text).not.toMatch(/apoyo humano/i);
    expect(response.outbound.text).not.toMatch(/S\/|PEN|soles|not_eligible/u);
    expect(response.trace.information_execution_summary).toEqual([
      expect.objectContaining({
        requestId: 'capability-status-read',
        status: 'completed',
        resource: 'orders',
      }),
    ]);
  });

  it('projects a trusted cart recovery path separately from general payment policy', async () => {
    const request = purchaseRequest(null);
    request.resource = 'orders';
    request.eventHint = 'Carlos y Adriana';
    request.aspects = ['payment_options'];
    const runtime = new InformationRuntime([extraction([request])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [],
      orderPartitions: { pending: [], completed: [] },
      carts: [{
        cartId: 'cart-sonia',
        status: 'abandoned',
        wasAbandoned: true,
        eventName: 'Carlos and Adriana',
        subtotal: 150,
        items: [],
      }],
    };
    gateway.recentMessages = [{
      id: 1,
      direction: 'outbound',
      source: 'admin_campaign',
      body: 'Retoma tu compra: https://sinenvolturas.com/cart/recover/recovery-id',
      status: 'sent',
      whatsappMessageId: null,
      sentAt: '2026-08-31T19:10:00-05:00',
      createdAt: null,
    }];
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'trusted-cart-recovery-user',
      text: '¿Puedo pagar este carrito por transferencia?',
      messageId: 'trusted-cart-recovery-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51965765765',
    });

    // Model-driven path: operational note carries typed fragments, reply model composes final reply
    expect(runtime.composeRequests.length).toBe(1);
    const compose = runtime.composeRequests[0] as unknown as { errorMessage: string | null; informationResults: unknown[] };
    expect(compose.errorMessage).toContain(
      'al revisar las compras y carritos asociados a tu numero de WhatsApp',
    );
    expect(compose.errorMessage).toContain(
      'carrito abandonado para Carlos and Adriana',
    );
    expect(compose.errorMessage).toContain(
      'ya enviado en esta conversacion',
    );
    expect(compose.errorMessage).toContain(
      'puede retomarlo desde el enlace de recuperacion ya enviado en esta conversacion',
    );
    expect(compose.errorMessage).not.toContain('recovery-id');
    expect(compose.errorMessage).toContain('no afirmes que se envio por correo');
    // operational note must not contain ungrounded 72h clause for cart
    expect(compose.errorMessage?.toLowerCase()).not.toContain('72 horas');
    expect((response.trace as unknown as { prompt_bundle_id: string }).prompt_bundle_id).not.toBe('deterministic:cart_only_abandoned');
    // outbound is model output (fake runtime returns generic), not deterministic full reply
    expect(response.outbound.text).not.toContain('https://');
    expect(response.trace.tools_called).toContain('lookup_guest_orders_by_phone');
  });

  it('rejects a wrong-account statement without automatic email OTP recovery and hands off once', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)], null, 'fallback@example.com', 'no'),
    ]);
    const gateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'phone-no-user',
      text: 'Ese número no corresponde a mi cuenta; mi correo es fallback@example.com',
      messageId: 'phone-no-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.plan.user_auth).toMatchObject({
      status: 'none',
      auth_method: null,
      awaiting_phone_confirmation: false,
    });
    expect(response.plan.user_auth.last_error).toBe('identity_rejected');
    expect(gateway.takeoverCalls).toBe(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(response.trace.tools_called).toContain('log_agent_conversation_message');
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.outbound.text).toContain('ya solicité apoyo humano');
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('does not disclose trusted-phone guest data after the person rejects that phone association', async () => {
    const pendingQuestion: ExtractedInformationRequest = {
      kind: 'associated_event',
      query: '¿La restricción de vestir de blanco aplica a todas las personas?',
      eventHint: 'Boda Laura & Marcos',
      // Exercise the runtime invariant even if extraction attaches both
      // structured signals to a phone-association rejection.
      authAction: 'decline_authentication',
    };
    const runtime = new InformationRuntime([
      extraction([pendingQuestion], null, null, 'no'),
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestEventsResult = {
      status: 'success',
      events: [{
        eventId: 88,
        name: 'Boda Laura & Marcos',
        slug: 'boda-laura-marcos',
        url: null,
        datetime: '15/09/2026 18:00',
        type: 'wedding',
        typeDetail: null,
        stage: 'published',
        city: 'Lima',
        country: 'Perú',
        currency: 'PEN',
      }],
    };
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'rejected-phone-event-plan',
          channel: 'whatsapp',
          externalUserId: 'rejected-phone-event-user',
        }),
        {
          current_node: 'resolver_consultas_informativas',
          user_auth: {
            status: 'authenticated',
            email: 'prior@example.com',
            token: 'prior-token',
            token_expires_at: '2026-12-01T00:00:00.000Z',
            auth_method: 'phone',
          },
          information_state: {
            resume_node: 'entrevista',
            pending_requests: [{ ...pendingQuestion, requestId: 'information-1' }],
            selection_candidates: [],
          },
        },
      ),
      reason: 'test-seed',
    });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'rejected-phone-event-user',
      text: 'Esa no es mi cuenta ni el número que tengo registrado.',
      messageId: 'rejected-phone-event-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestEventCalls).toBe(0);
    expect(gateway.eventDetailCalls).toBe(0);
    expect(response.trace.tools_called).not.toContain('lookup_guest_events_by_phone');
    expect(response.plan.user_auth.status).toBe('none');
    expect(response.plan.user_auth.last_error).toBe('identity_rejected');
    expect(gateway.takeoverCalls).toBe(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(response.trace.tools_called).toContain('log_agent_conversation_message');
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.outbound.text).toContain('ya solicité apoyo humano');
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('recovers a persisted retired confirmation turn with the phone-scoped purchase read', async () => {
    const runtime = new InformationRuntime([
      extraction([], null, null, 'unclear'),
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'retired-confirmation-plan',
          channel: 'whatsapp',
          externalUserId: 'retired-confirmation-user',
        }),
        {
          current_node: 'resolver_consultas_informativas',
          user_auth: { awaiting_phone_confirmation: true },
          information_state: {
            resume_node: 'entrevista',
            pending_requests: [
              { ...purchaseRequest(null), requestId: 'information-1' },
            ],
            selection_candidates: [],
          },
        },
      ),
      reason: 'test-seed',
    });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'retired-confirmation-user',
      text: 'Este',
      messageId: 'retired-confirmation-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(0);
    expect(response.plan.user_auth).toMatchObject({
      status: 'none',
      auth_method: null,
      awaiting_phone_confirmation: false,
    });
    const recoveryExtraction = runtime.composeRequests.at(-1)?.extraction;
    expect(recoveryExtraction).toMatchObject({
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
    });
    expect(recoveryExtraction?.conversationSummary).toContain(
      'Estado del regalo comprado.',
    );
    expect(recoveryExtraction?.informationRequests[0]?.query).toBe(
      'Estado del regalo comprado.',
    );
  });

  it.each(['not_found', 'empty'] as const)('hands off a phone-scoped %s once without OTP or reply-model guessing', async (outcome) => {
    const runtime = new InformationRuntime([extraction([purchaseRequest(null)])]);
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    if (outcome === 'empty') {
      gateway.guestOrdersResult = {
        status: 'success', resource: 'orders', purchases: [],
        orderPartitions: { completed: [], pending: [] }, carts: [],
      };
    }
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'phone-not-found-user',
      text: 'Quiero saber de mi compra',
      messageId: 'phone-not-found-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.plan.user_auth.status).toBe('none');
    expect(runtime.composeRequests).toHaveLength(0);
    expect(gateway.takeoverCalls).toBe(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.information_state.pending_requests[0]?.query).toBe('Estado del regalo comprado.');
    expect(response.trace.tools_called).toContain('lookup_guest_orders_by_phone');
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.trace.information_execution_summary).toEqual([
      expect.objectContaining({ status: 'failed', accessMethod: 'trusted_phone_purchase', resource: 'orders' }),
    ]);
    expect(response.outbound.text).toContain('ya solicité apoyo humano');
    expect(response.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    const repeated = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'phone-not-found-user',
      contactPhone: '+51973296571', text: 'No tengo cuenta',
      messageId: 'phone-not-found-2', receivedAt: new Date().toISOString(),
    });
    expect(gateway.takeoverCalls).toBe(1);
    expect(repeated.plan.human_escalation.status).toBe('requested');
  });

  it.each(['not_found', 'empty'] as const)('hands off a phone guest-event %s with the support details preserved', async (outcome) => {
    const query = 'Consulta sobre el invitado Roger Abanto del evento Baby Shower Catalina.';
    const runtime = new InformationRuntime([extraction([{
      kind: 'associated_event', query, eventHint: 'Baby Shower Catalina',
    }])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestEventsResult = outcome === 'empty'
      ? { status: 'success', events: [] }
      : { status: 'not_found' };
    const provider = providerGateway();
    const response = await createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: provider,
    }).handleTurn({
      channel: 'whatsapp', externalUserId: 'missing-event-support',
      text: 'El invitado es Roger Abanto y el evento es Baby Shower Catalina.',
      contactPhone: '+51985101461', messageId: 'missing-event-1',
      receivedAt: new Date().toISOString(),
    });
    expect(gateway.guestEventCalls).toBe(1);
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls + provider.verifyCodeCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(0);
    expect(gateway.takeoverCalls).toBe(1);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.information_state.pending_requests[0]?.query).toBe(query);
    expect(response.outbound.text).toContain('ya solicité apoyo humano');
    expect(response.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(response.trace.tools_called).toContain('lookup_guest_events_by_phone');
    expect(response.trace.information_execution_summary).toEqual([
      expect.objectContaining({ status: 'failed', accessMethod: 'trusted_phone_guest' }),
    ]);
  });

  it('keeps usable phone purchase context when another requested lookup has no event match', async () => {
    const runtime = new InformationRuntime([extraction([
      purchaseRequest(null),
      { kind: 'associated_event', query: 'Consulta de mi invitación.', eventHint: null },
    ])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [purchase('ORD-000880')] };
    const response = await createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: providerGateway(),
    }).handleTurn({
      channel: 'whatsapp', externalUserId: 'mixed-missing-event',
      text: '¿Cómo va mi compra y mi invitación?', contactPhone: '+51985101461',
      messageId: 'mixed-missing-1', receivedAt: new Date().toISOString(),
    });
    expect(gateway.takeoverCalls).toBe(0);
    expect(response.plan.human_escalation.status).toBe('none');
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.informationResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'purchase', status: 'completed' }),
      expect.objectContaining({ kind: 'associated_event', status: 'failed', failureKind: 'not_found' }),
    ]));
  });

  it('uses the trusted phone guest record before OTP when the phone has no account', async () => {
    const eventQuestion = extraction([{
      kind: 'associated_event',
      query: '¿Dónde y a qué hora es la recepción?',
      eventHint: null,
    }]);
    eventQuestion.rsvpEventReference = 'Boda Laura & Marcos';
    const runtime = new InformationRuntime([eventQuestion]);
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    gateway.guestEventsResult = {
      status: 'success',
      events: [{
        eventId: 88,
        name: 'Boda Laura & Marcos',
        slug: 'boda-laura-marcos',
        url: null,
        datetime: '15/09/2026 18:00',
        type: 'wedding',
        typeDetail: null,
        stage: 'published',
        city: 'Lima',
        country: 'Perú',
        currency: 'PEN',
      }],
    };
    gateway.eventDetailResult = {
      status: 'success',
      event: {
        ...gateway.guestEventsResult.events[0],
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [{
          label: 'Recepción',
          description: null,
          datetime: '15/09/2026 19:00',
          withTime: true,
          locationDescription: 'Salón principal',
          locationReference: null,
          locationUrl: null,
          locationCoords: null,
          position: 1,
        }],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
      },
    };
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'accountless-guest-user',
      text: '¿Dónde y a qué hora es la recepción?',
      messageId: 'accountless-guest-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestEventCalls).toBe(1);
    expect(gateway.eventDetailCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(provider.eventLookupCalls).toBe(0);
    expect(response.plan.user_auth.status).toBe('none');
    expect(response.plan.information_state.pending_requests).toEqual([]);
    expect(response.trace.tools_called).toEqual(expect.arrayContaining([
      'lookup_guest_events_by_phone',
      'get_guest_event_detail',
    ]));
    expect(response.trace.tools_called).not.toContain('request_user_login_code');
    expect(runtime.composeRequests.at(-1)?.informationResults?.[0]).toMatchObject({
      status: 'completed',
      kind: 'associated_event',
      accessMethod: 'trusted_phone_guest',
      result: {
        events: [{ detail: { moments: [{ label: 'Recepción' }] } }],
      },
    });
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain(
      'no pidas correo ni código',
    );
  });

  it('answers invited-event data before requesting email for a separate protected query', async () => {
    const runtime = new InformationRuntime([extraction([
      {
        kind: 'associated_event',
        query: '¿Dónde es la recepción?',
        eventHint: null,
      },
      purchaseRequest(null),
    ])]);
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    gateway.guestEventsResult = {
      status: 'success',
      events: [{
        eventId: 88,
        name: 'Boda Laura & Marcos',
        slug: 'boda-laura-marcos',
        url: null,
        datetime: '15/09/2026 18:00',
        type: 'wedding',
        typeDetail: null,
        stage: 'published',
        city: 'Lima',
        country: 'Perú',
        currency: 'PEN',
      }],
    };
    gateway.eventDetailResult = {
      status: 'success',
      event: {
        ...gateway.guestEventsResult.events[0],
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [{
          label: 'Recepción',
          description: null,
          datetime: '15/09/2026 19:00',
          withTime: true,
          locationDescription: 'Salón principal',
          locationReference: null,
          locationUrl: null,
          locationCoords: null,
          position: 1,
        }],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
        attendance: null,
        purchases: [purchase('ORD-000880')],
      },
    };
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'mixed-accountless-guest-user',
      text: '¿Dónde es la recepción y cuál es el estado de mi compra?',
      messageId: 'mixed-accountless-guest-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestEventCalls).toBe(1);
    expect(gateway.eventDetailCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.trace.tools_called).toEqual(expect.arrayContaining([
      'lookup_guest_events_by_phone',
      'get_guest_event_detail',
    ]));
    expect(runtime.composeRequests.at(-1)?.informationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'associated_event',
          status: 'completed',
          accessMethod: 'trusted_phone_guest',
        }),
        expect.objectContaining({
          kind: 'purchase',
          status: 'completed',
          accessMethod: 'trusted_phone_event_purchase',
        }),
      ]),
    );
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain(
      'no pidas correo ni código',
    );
  });

  it('hands off without asking for email when phone-scoped gift detail fails', async () => {
    const detailRequest = purchaseRequest(null);
    detailRequest.aspects = ['dedication'];
    const runtime = new InformationRuntime([extraction([detailRequest])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestGiftResult = {
      status: 'retryable_failure',
      resource: 'gift_purchases',
      retryable: true,
      error: 'Gift purchase endpoint returned HTTP 500',
    };
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'phone-auth-failure-user',
      text: 'Quiero revisar mi compra',
      messageId: 'phone-auth-failure-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(provider.requestCodeCalls).toBe(0);
    expect(gateway.takeoverCalls).toBe(1);
    expect(runtime.composeRequests).toHaveLength(0);
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestGiftCalls).toBe(1);
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.trace.tools_called).not.toContain('auth_by_phone');
  });

  it('uses email OTP immediately when the trusted phone is absent', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)], null, 'fallback@example.com'),
    ]);
    const gateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'terminal-user',
      text: 'fallback@example.com',
      messageId: 'terminal-email-1',
      receivedAt: new Date().toISOString(),
      contactPhone: null,
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(1);
    expect(response.plan.user_auth.status).toBe('code_requested');
  });

  it('does not clobber an in-flight OTP when a phone confirmation field is present', async () => {
    const runtime = new InformationRuntime([
      extraction([], null, null, 'yes'),
    ]);
    const gateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const planStore = new InMemoryPlanStore();
    const seeded = mergePlan(
      createEmptyPlan({
        planId: 'code-requested-phone-guard',
        channel: 'whatsapp',
        externalUserId: 'code-requested-phone-guard',
      }),
      {
        contact_email: 'pending@example.com',
        user_auth: {
          status: 'code_requested',
          email: 'pending@example.com',
          token: null,
          token_expires_at: null,
          last_error: null,
          requested_at: '2026-08-07T00:00:00.000Z',
          failed_code_attempts: 1,
        },
        information_state: {
          resume_node: 'deteccion_intencion',
          pending_requests: [
            {
              requestId: 'information-1',
              kind: 'purchase',
              resource: 'gift_purchases',
              query: 'Estado de mi compra.',
              orderId: null,
              aspects: ['summary'],
              sensitiveFields: [],
              authAction: 'provide_otp',
            },
          ],
          selection_candidates: [],
        },
      },
    );
    await planStore.save({ plan: seeded, reason: 'test-seed' });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'code-requested-phone-guard',
      text: 'Todavía no escribo el código.',
      messageId: 'code-requested-phone-guard-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.plan.user_auth).toMatchObject({
      status: 'code_requested',
      email: 'pending@example.com',
      requested_at: '2026-08-07T00:00:00.000Z',
      failed_code_attempts: 1,
    });
    expect(response.plan.information_state.pending_requests).toHaveLength(1);
  });

  it('keeps email-authenticated state when updating the current trusted phone succeeds or conflicts', async () => {
    const makeService = async (updatePhoneResult: FakePurchaseGateway['updatePhoneResult']) => {
      const runtime = new InformationRuntime([extraction([], null, null)]);
      const gateway = new FakePurchaseGateway();
      gateway.updatePhoneResult = updatePhoneResult;
      const provider = providerGateway();
      const planStore = new InMemoryPlanStore();
      const seeded = mergePlan(
        createEmptyPlan({
          planId: `otp-update-${updatePhoneResult.status}`,
          channel: 'whatsapp',
          externalUserId: `otp-update-${updatePhoneResult.status}`,
        }),
        {
          contact_phone: '51911111111',
          contact_phone_extension: '+51',
          contact_phone_number: '911111111',
          contact_email: 'otp@example.com',
          user_auth: {
            status: 'code_requested',
            email: 'otp@example.com',
            token: null,
            token_expires_at: null,
            last_error: null,
            requested_at: '2026-08-07T00:00:00.000Z',
            failed_code_attempts: 0,
          },
          information_state: {
            resume_node: 'deteccion_intencion',
            pending_requests: [{ ...purchaseRequest(null), requestId: 'information-1' }],
            selection_candidates: [],
          },
        },
      );
      await planStore.save({ plan: seeded, reason: 'test-seed' });
      return {
        service: createService({
          runtime,
          knowledgeGateway: new FakeKnowledgeGateway(),
          purchaseGateway: gateway,
          providerGateway: provider,
          planStore,
        }),
        gateway,
      };
    };

    const success = await makeService({ status: 'success' });
    await success.service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'otp-update-success',
      text: '123456',
      messageId: 'otp-update-success-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });
    expect(success.gateway.updatePhoneCalls).toBe(1);
    expect(success.gateway.lastUpdatePhoneInput).toEqual({
      token: 'shared-jwt',
      phone_extension: '+51',
      phone_number: '973296571',
    });

    const conflict = await makeService({ status: 'phone_linked_to_other_account' });
    const conflictResponse = await conflict.service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'otp-update-phone_linked_to_other_account',
      text: '123456',
      messageId: 'otp-update-conflict-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });
    expect(conflict.gateway.updatePhoneCalls).toBe(1);
    expect(conflictResponse.plan.user_auth).toMatchObject({
      status: 'authenticated',
      token: 'shared-jwt',
      auth_method: 'email',
    });

    const failure = await makeService({
      status: 'failed',
      error: 'temporary phone update failure',
      retryable: true,
    });
    const failureResponse = await failure.service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'otp-update-failed',
      text: '123456',
      messageId: 'otp-update-failure-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });
    expect(failure.gateway.updatePhoneCalls).toBe(1);
    expect(failureResponse.plan.user_auth.status).toBe('authenticated');
  });

  it('falls back to email without a phone API call when the inbound phone is unusable', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)], null, 'fallback@example.com'),
    ]);
    const gateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: '51911111111',
      text: 'fallback@example.com',
      messageId: 'unusable-phone-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+5197329657',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.updatePhoneCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(1);
    expect(response.plan.user_auth.status).toBe('code_requested');
  });

  it('does not call authentication for an ordinary message', async () => {
    const runtime = new InformationRuntime([extraction([])]);
    const gateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'ordinary-message-user',
      text: 'Gracias, todo bien.',
      messageId: 'ordinary-message-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
  });

  it('uses one OTP to resume associated-event and purchase requests together', async () => {
    const runtime = new InformationRuntime([
      extraction(
        [
          {
            kind: 'associated_event',
            query: '¿A qué hora es mi evento?',
            eventHint: null,
          },
          purchaseRequest('ORD-000880'),
        ],
        null,
        'leonardocandio22@gmail.com',
      ),
      extraction([]),
    ]);
    const purchaseGateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway,
      providerGateway: provider,
    });

    const first = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'whatsapp:51999999999',
      text: 'Mi correo es leonardocandio22@gmail.com. Revisa mi evento y la orden ORD-000880.',
      messageId: 'shared-auth-1',
      receivedAt: new Date().toISOString(),
    });
    expect(first.plan.user_auth.status).toBe('code_requested');
    expect(provider.requestCodeCalls).toBe(1);
    expect(first.plan.information_state.pending_requests).toHaveLength(2);
    const otpBlock = runtime.composeRequests
      .at(-1)
      ?.informationResults?.find(
        (result) =>
          result.kind === 'purchase' && result.status === 'needs_input',
      );
    expect(
      otpBlock?.status === 'needs_input' ? otpBlock.guidance : null,
    ).toEqual(
      createInformationAuthGuidance(
        'otp_sent',
        'leonardocandio22@gmail.com',
      ),
    );

    const second = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'whatsapp:51999999999',
      text: '123456',
      messageId: 'shared-auth-2',
      receivedAt: new Date().toISOString(),
    });

    expect(provider.verifyCodeCalls).toBe(1);
    expect(provider.eventLookupCalls).toBe(1);
    expect(purchaseGateway.giftCalls).toBe(1);
    expect(purchaseGateway.lastToken).toBe('shared-jwt');
    expect(second.plan.user_auth.status).toBe('authenticated');
    expect(second.plan.information_state.pending_requests).toEqual([]);
    expect(
      runtime.composeRequests
        .at(-1)
        ?.informationResults?.filter((result) => result.status === 'completed'),
    ).toHaveLength(2);
  });

  it('hands off on the first missing-code report without resending', async () => {
    const missingCodeRequest = purchaseRequest(null);
    missingCodeRequest.authAction = 'report_otp_not_received';
    const runtime = new InformationRuntime([
      extraction(
        [purchaseRequest(null)],
        null,
        'sandra.lopez.aguilar@gmail.com',
      ),
      extraction([missingCodeRequest]),
      extraction([missingCodeRequest]),
    ]);
    const provider = providerGateway();
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing-code-user',
      text: 'sandra.lopez.aguilar@gmail.com',
      messageId: 'missing-code-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });
    const missingCodeResponse = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing-code-user',
      text: 'No ha llegado nada',
      messageId: 'missing-code-2',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(provider.requestCodeCalls).toBe(1);
    expect(missingCodeResponse.plan.current_node).toBe('solicitar_agente_humano');
    expect(missingCodeResponse.plan.human_escalation.status).toBe('requested');
    expect(missingCodeResponse.trace.tools_called).toContain('request_human_takeover');
    expect(missingCodeResponse.plan.user_auth).toMatchObject({
      status: 'code_requested',
      otp_send_attempts: 1,
    });
    expect(missingCodeResponse.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({ kind: 'purchase' }),
    ]);

    const handoff = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'missing-code-user',
      text: 'Sigue sin llegar',
      messageId: 'missing-code-3',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(provider.requestCodeCalls).toBe(1);
    expect(provider.verifyCodeCalls).toBe(0);
    expect(handoff.plan.human_escalation.status).toBe('requested');
    expect(handoff.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({ kind: 'purchase' }),
    ]);
  });

  it('resolves an accountless purchase by trusted phone without asking for email', async () => {
    const accountlessRequest = purchaseRequest(null);
    accountlessRequest.authAction = 'accountless_user';
    accountlessRequest.query = 'La persona dice que no creó una cuenta.';
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)]),
      extraction([accountlessRequest]),
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'accountless-purchase-user',
      text: 'Quiero revisar el regalo que pagué',
      messageId: 'accountless-purchase-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'accountless-purchase-user',
      text: 'Pagué sin registrarme',
      messageId: 'accountless-purchase-2',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(provider.requestCodeCalls).toBe(0);
    expect(gateway.takeoverCalls).toBe(0);
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestOrdersCalls).toBe(2);
    expect(gateway.guestGiftCalls).toBe(0);
    expect(response.plan.human_escalation.status).toBe('none');
    expect(response.plan.information_state.pending_requests).toEqual([]);
    expect(response.outbound.text).not.toContain('correo');
    expect(response.outbound.text).not.toContain('código');
    expect(runtime.composeRequests.at(-1)?.informationResults?.[0]).toMatchObject({
      kind: 'purchase',
      status: 'completed',
      accessMethod: 'trusted_phone_purchase',
    });
  });

  it('retrieves the indexed validation policy exactly once for a pending-payment window question', async () => {
    const request = purchaseRequest(null);
    request.resource = 'orders';
    request.query = '¿Cuánto tarda en validarse mi pago en proceso?';
    request.aspects = ['payment_status', 'validation_window'];
    const runtime = new InformationRuntime([extraction([request])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{
        ...purchase('ORD-PENDING-72H'),
        partition: 'pending_orders',
        paymentStatus: 'pending',
        paymentMethod: 'PayPal',
        currency: null,
      }],
      orderPartitions: {
        pending: [{
          ...purchase('ORD-PENDING-72H'),
          partition: 'pending_orders',
          paymentStatus: 'pending',
          paymentMethod: 'PayPal',
          currency: null,
        }],
        completed: [],
      },
      carts: [],
    };
    const knowledgeGateway = new FakeKnowledgeGateway();
    const service = createService({
      runtime,
      knowledgeGateway,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const firstResponse = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'pending-validation-user',
      text: '¿Cuánto tarda en validarse mi pago en proceso?',
      messageId: 'pending-validation-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.guestOrdersCalls).toBe(1);
    expect(knowledgeGateway.calls).toBe(1);
    expect(knowledgeGateway.lastQuery).toBe(
      'Plazo de validación de pagos en proceso por método de pago',
    );
    expect(firstResponse.plan.information_state.last_completed_request).toMatchObject({
      kind: 'purchase',
      resource: 'orders',
      aspects: ['payment_status', 'validation_window'],
    });
    expect(runtime.composeRequests[0]?.informationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'faq', status: 'completed' }),
        expect.objectContaining({
          kind: 'purchase',
          status: 'completed',
          purchases: [expect.objectContaining({
            currency: null,
            amountDisclosure: {
              total: null,
              paid: null,
              currency: null,
              currencySymbol: null,
              // Pending purchases keep the recorded method so the reply can
              // ground the indexed validation-window message; approved
              // summaries omit it (accountless summary gate).
              paymentMethod: 'PayPal',
              presentation: 'recorded_method_no_currency',
            },
            paymentValidationExpectation: {
              maxBusinessHours: 72,
              appliesTo: 'indexed_validation_methods',
            },
          })],
        }),
      ]),
    );
  });

  it('replays the primary purchase after a derived policy lookup on an ambiguous correction', async () => {
    const request = purchaseRequest(null);
    request.resource = 'orders';
    request.query = 'Estado del pago para Claudia y Luis Felipe.';
    request.eventHint = 'Claudia y Luis Felipe';
    request.aspects = ['payment_status', 'validation_window'];
    const ambiguousCorrection = extraction([{ ...request }]);
    ambiguousCorrection.ambiguity = {
      status: 'ambiguous',
      clarificationQuestion: '¿Te refieres al pago o a un evento?',
      interpretations: ['Corrección de moneda del pago', 'Presupuesto del evento'],
    };
    const runtime = new InformationRuntime([
      extraction([request]),
      ambiguousCorrection,
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-CONTINUITY')],
      orderPartitions: {
        pending: [{
          ...purchase('ORD-CONTINUITY'),
          partition: 'pending_orders',
          paymentStatus: 'pending',
          paymentMethod: 'Transferencia',
          eventName: 'Claudia and Luis Felipe',
        }],
        completed: [],
      },
      carts: [],
    };
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });
    const base = {
      channel: 'whatsapp',
      externalUserId: 'purchase-policy-continuity-user',
      contactPhone: '+51957212085',
      receivedAt: new Date().toISOString(),
    } as const;

    await service.handleTurn({
      ...base,
      text: '¿Cuándo se valida el pago para Claudia y Luis Felipe?',
      messageId: 'purchase-policy-continuity-1',
    });
    const correction = await service.handleTurn({
      ...base,
      text: 'El monto es en dólares, no en soles.',
      messageId: 'purchase-policy-continuity-2',
    });

    expect(gateway.guestOrdersCalls).toBe(2);
    expect(correction.trace.extraction_summary.ambiguity_status).toBe('clear');
    expect(runtime.composeRequests[1]?.informationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'purchase',
          status: 'completed',
        }),
      ]),
    );
    expect(correction.plan.information_state.last_completed_request).toMatchObject({
      kind: 'purchase',
      eventHint: 'Claudia y Luis Felipe',
    });
  });

  it('honors an explicit verification refusal and clears the protected request without another prompt', async () => {
    const declinedRequest = purchaseRequest(null);
    declinedRequest.authAction = 'decline_authentication';
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)]),
      // A model may also emit phoneConfirmation=no for broad refusal wording.
      // Without an active phone-association decision, the explicit typed
      // authentication refusal remains authoritative.
      extraction([declinedRequest], null, null, 'no'),
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'declined-auth-user',
      text: 'Quiero revisar mi compra',
      messageId: 'declined-auth-1',
      receivedAt: new Date().toISOString(),
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'declined-auth-user',
      text: 'No doy mis datos personales y no quiero continuar',
      messageId: 'declined-auth-2',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.takeoverCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.plan.information_state.pending_requests).toEqual([]);
    expect(response.plan.user_auth).toMatchObject({
      status: 'none',
      email: null,
      token: null,
      token_expires_at: null,
      auth_method: null,
      awaiting_phone_confirmation: false,
    });
    expect(response.trace.tools_called).not.toContain('request_user_login_code');
    expect(response.trace.tools_called).not.toContain('verify_user_login_code');
    expect(response.outbound.text).toContain('No volveré a pedirte el correo ni un código');
  });

  it('closes only protected work when authentication is declined and preserves an unrelated FAQ', async () => {
    const protectedRequest = { ...purchaseRequest(null), requestId: 'purchase-1' };
    const unrelatedFaq = {
      kind: 'faq' as const,
      query: '¿Cuánto demora la validación general?',
      requestId: 'faq-1',
    };
    const declinedRequest = { ...protectedRequest, authAction: 'decline_authentication' as const };
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'declined-auth-preserve-faq',
        channel: 'whatsapp',
        externalUserId: 'declined-auth-preserve-faq',
      }), {
        current_node: 'resolver_consultas_informativas',
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [protectedRequest, unrelatedFaq],
          selection_candidates: [],
        },
        user_auth: {
          status: 'code_requested',
          email: 'prior@example.com',
          token: null,
          token_expires_at: null,
          auth_method: null,
          awaiting_phone_confirmation: false,
        },
      }),
    });
    const runtime = new InformationRuntime([extraction([declinedRequest])]);
    const gateway = new FakePurchaseGateway();
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: provider,
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'declined-auth-preserve-faq',
      text: 'No quiero continuar con la verificación.',
      messageId: 'declined-auth-preserve-faq-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.information_state.pending_requests).toEqual([unrelatedFaq]);
    expect(response.plan.user_auth.status).toBe('none');
    expect(response.outbound.text).toContain('Sin autenticación no puedo continuar');
    expect(response.outbound.text).not.toContain('correo registrado');
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls).toBe(0);
  });

  it('hands off on a missing-code report for a protected associated-event request', async () => {
    const runtime = new InformationRuntime([
      extraction([{
        kind: 'associated_event',
        query: '¿La restricción de vestir de blanco aplica a mujeres y varones?',
        eventHint: 'Karem y Alfredo',
        authAction: 'report_otp_not_received',
      }]),
    ]);
    const store = new InMemoryPlanStore();
    await store.save({
      reason: 'seed-associated-event-otp',
      plan: mergePlan(createEmptyPlan({
        planId: 'associated-event-otp-plan',
        channel: 'whatsapp',
        externalUserId: 'associated-event-otp-user',
      }), {
        current_node: 'resolver_consultas_informativas',
        contact_email: 'person@example.com',
        user_auth: {
          status: 'code_requested',
          email: 'person@example.com',
          token: null,
          token_expires_at: null,
          last_error: null,
          requested_at: '2026-08-20T15:00:00.000Z',
          failed_code_attempts: 0,
          otp_send_attempts: 1,
          otp_non_delivery_reports: 0,
          awaiting_phone_confirmation: false,
          auth_method: null,
        },
        information_state: {
          resume_node: 'entrevista',
          pending_requests: [{
            requestId: 'information-1',
            kind: 'associated_event',
            query: '¿La restricción de vestir de blanco aplica a mujeres y varones?',
            eventHint: 'Karem y Alfredo',
          }],
          selection_candidates: [],
        },
      }),
    });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
      planStore: store,
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'associated-event-otp-user',
      text: 'No me ha llegado',
      messageId: 'associated-event-otp-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.trace.tools_called).toContain('request_human_takeover');
    expect(response.plan.user_auth).toMatchObject({
      status: 'code_requested',
      otp_send_attempts: 1,
    });
    expect(response.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({
        kind: 'associated_event',
        query: '¿La restricción de vestir de blanco aplica a mujeres y varones?',
      }),
    ]);
  });

  it('stops the repeated OTP loop from the reported gift-deposit interaction', async () => {
    const purchase = purchaseRequest(null);
    purchase.query =
      'Confirmar si el depósito del regalo llegó a los novios y revisar el estado del pago.';
    purchase.aspects = ['payment_status', 'payment_details'];
    const codeAttempt = purchaseRequest(null);
    codeAttempt.query = purchase.query;
    codeAttempt.aspects = purchase.aspects;
    codeAttempt.authAction = 'provide_otp';
    const runtime = new InformationRuntime([
      extraction([codeAttempt]),
      extraction([codeAttempt]),
      extraction([]),
    ]);
    const provider = providerGateway({
      verificationResult: {
        status: 'invalid_code',
        error: 'Invalid or expired code',
      },
    });
    const purchaseGateway = new FakePurchaseGateway();
    purchaseGateway.authByPhoneResult = { status: 'user_not_found' };
    // Reconstruct the already-started verification stage, as in the live twin.
    // A fresh phone miss now hands off before this stage instead of starting OTP.
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'reported-otp-already-requested',
      plan: mergePlan(createEmptyPlan({
        planId: 'reported-otp-plan', channel: 'terminal_whatsapp', externalUserId: 'whatsapp:+51948920202',
      }), {
        current_node: 'resolver_consultas_informativas',
        contact_email: 'regression@example.invalid',
        user_auth: { status: 'code_requested', email: 'regression@example.invalid', requested_at: new Date().toISOString() },
        information_state: { resume_node: 'deteccion_intencion', pending_requests: [{ ...purchase, requestId: 'information-1' }], selection_candidates: [] },
      }),
    });
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway,
      providerGateway: provider,
      planStore,
    });
    const turn = async (text: string, index: number) =>
      service.handleTurn({
        channel: 'terminal_whatsapp',
        externalUserId: 'whatsapp:+51948920202',
        text,
        messageId: `reported-otp-loop-${index}`,
        receivedAt: new Date().toISOString(),
        contactPhone: '+51948920202',
      });

    const firstFailure = await turn('753994', 3);
    const secondFailure = await turn('753994', 4);
    const followUp = await turn('Ese es el código que me llegó', 5);

    // One-shot policy: the first rejected code verifies once, terminates
    // recovery, and hands off. Later codes never verify again.
    expect(provider.verifyCodeCalls).toBe(1);
    expect(firstFailure.plan.user_auth.failed_code_attempts).toBe(1);
    expect(firstFailure.plan.current_node).toBe('solicitar_agente_humano');
    expect(firstFailure.plan.human_escalation.status).toBe('requested');
    expect(firstFailure.trace.tools_called).toContain('request_human_takeover');
    expect(secondFailure.plan.user_auth.failed_code_attempts).toBe(1);
    expect(secondFailure.plan.human_escalation.status).toBe('requested');
    expect(secondFailure.trace.tools_called).not.toContain('request_human_takeover');
    expect(secondFailure.trace.tools_called).not.toContain('verify_user_login_code');
    expect(secondFailure.trace.tools_called).not.toContain('request_user_login_code');
    expect(followUp.plan.user_auth.failed_code_attempts).toBe(1);
    expect(followUp.outbound.text).toBeNull();
    expect(followUp.plan.human_escalation.status).toBe('requested');
    expect(followUp.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        resource: 'gift_purchases',
        query: purchase.query,
      }),
    ]);

    // Terminal handoffs are deterministic: no reply-model composition runs.
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('uses a newly provided email instead of the previously stored address', async () => {
    const changedEmailRequest = purchaseRequest(null);
    changedEmailRequest.authAction = 'change_email';
    const runtime = new InformationRuntime([
      extraction(
        [purchaseRequest(null)],
        null,
        'old@example.com',
      ),
      extraction(
        [changedEmailRequest],
        null,
        'correct@example.com',
      ),
    ]);
    const provider = providerGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: provider,
    });

    await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'change-email-user',
      text: 'old@example.com',
      messageId: 'change-email-1',
      receivedAt: new Date().toISOString(),
    });
    const changed = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'change-email-user',
      text: 'Me registré con correct@example.com',
      messageId: 'change-email-2',
      receivedAt: new Date().toISOString(),
    });

    // Package C one-shot policy: an email-change request on a challenged
    // episode ends recovery instead of sending a second code.
    expect(provider.requestCodeCalls).toBe(1);
    expect(changed.plan.auth_recovery.terminalReason).toBe('email_change_requested');
    expect(changed.plan.current_node).toBe('solicitar_agente_humano');
    expect(changed.trace.tools_called).not.toContain('request_user_login_code');
  });

  it('persists information requests and executes neither side when a turn also asks for an exclusive action', async () => {
    const runtime = new InformationRuntime([
      extraction(
        [{ kind: 'faq', query: '¿Cuánto cobra Sin Envolturas?' }],
        'buscar_proveedores',
      ),
    ]);
    const knowledgeGateway = new FakeKnowledgeGateway();
    const purchaseGateway = new FakePurchaseGateway();
    purchaseGateway.recentMessages = [
      conversationMessage({
        id: 1,
        direction: 'outbound',
        body: 'Este es un recordatorio del evento de Ana y Luis.',
        source: 'admin_campaign',
        sentAt: '2026-07-31T14:00:00.000Z',
      }),
      conversationMessage({
        id: 2,
        direction: 'inbound',
        body: 'Busca fotógrafos y dime cuánto cobra Sin Envolturas.',
        source: 'whatsapp',
        whatsappMessageId: 'conflict-1',
        sentAt: '2026-07-31T14:01:00.000Z',
      }),
    ];
    const service = createService({
      runtime,
      knowledgeGateway,
      purchaseGateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'user-conflict',
      text: 'Busca fotógrafos y dime cuánto cobra Sin Envolturas.',
      messageId: 'conflict-1',
      receivedAt: '2026-07-31T14:01:00.000Z',
      contactPhone: '+51999999999',
    });

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(response.plan.information_state.pending_requests).toHaveLength(1);
    expect(knowledgeGateway.calls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.informationResults).toEqual([]);
    expect(runtime.composeRequests.at(-1)?.errorMessage).toContain(
      'confirmar cuál quiere resolver primero',
    );
    expect(purchaseGateway.recentMessageCalls).toBe(1);
    expect(runtime.extractRequests.at(-1)?.messageContext).toEqual(
      expect.objectContaining({
        historyStatus: 'available',
        retrievedMessageCount: 2,
        excludedCurrentMessageCount: 1,
        recentMessages: [
          expect.objectContaining({
            body: 'Este es un recordatorio del evento de Ana y Luis.',
          }),
        ],
      }),
    );
    expect(runtime.composeRequests.at(-1)?.messageContext).toEqual(
      runtime.extractRequests.at(-1)?.messageContext,
    );
    expect(runtime.composeRequests.at(-1)?.extraction).toEqual(
      expect.objectContaining({
        actionIntent: 'buscar_proveedores',
        informationRequests: [
          expect.objectContaining({
            kind: 'faq',
            query: '¿Cuánto cobra Sin Envolturas?',
          }),
        ],
      }),
    );
  });

  it('persists compact candidates when recent purchases require a selection', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)]),
    ]);
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'selection-plan',
          channel: 'terminal_whatsapp',
          externalUserId: 'buyer@example.com',
        }),
        {
          contact_email: 'buyer@example.com',
          user_auth: {
            status: 'authenticated',
            email: 'buyer@example.com',
            token: 'existing-jwt',
            token_expires_at: new Date(
              Date.now() + 60 * 60 * 1000,
            ).toISOString(),
            last_error: null,
            requested_at: new Date().toISOString(),
            failed_code_attempts: 0,
          },
        },
      ),
      reason: 'seed-auth',
    });
    const purchaseGateway = new FakePurchaseGateway();
    purchaseGateway.giftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [purchase('ORD-1'), purchase('ORD-2')],
    };
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway,
      providerGateway: providerGateway(),
      planStore,
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'buyer@example.com',
      text: 'Quiero revisar el estado de mi regalo.',
      messageId: 'selection-1',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.information_state.pending_requests).toHaveLength(1);
    expect(response.plan.information_state.selection_candidates).toEqual([
      {
        requestId: 'information-1',
        resource: 'gift_purchases',
        orders: [
          expect.objectContaining({ orderId: 'ORD-1' }),
          expect.objectContaining({ orderId: 'ORD-2' }),
        ],
      },
    ]);
    expect(response.plan.information_state.selection_candidates[0]).not.toHaveProperty(
      'payment',
    );
  });
});

class InformationRuntime implements AgentRuntime {
  public readonly extractRequests: ExtractRequest[] = [];
  public readonly composeRequests: ComposeReplyRequest[] = [];
  private extractionIndex = 0;

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractRequests.push(request);
    const next =
      this.extractions[this.extractionIndex] ??
      this.extractions[this.extractions.length - 1];
    this.extractionIndex += 1;
    if (!next) {
      throw new Error('Missing extraction fixture.');
    }
    return next;
  }

  async composeReply(
    request: ComposeReplyRequest,
  ): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta informativa.' };
  }
}

class FakeKnowledgeGateway implements KnowledgeRetrievalGateway {
  public calls = 0;
  public lastQuery: string | null = null;

  async search(query: string): Promise<KnowledgeRetrievalResult> {
    this.calls += 1;
    this.lastQuery = query;
    return {
      status: 'success',
      evidence: [
        {
          fileId: 'faq-1',
          filename: 'faq.md',
          score: 0.9,
          text: 'La lista de regalos es opcional.',
        },
      ],
    };
  }
}

class FakePurchaseGateway implements AgentConversationGateway {
  public ordersCalls = 0;
  public giftCalls = 0;
  public guestOrdersCalls = 0;
  public guestGiftCalls = 0;
  public authByPhoneCalls = 0;
  public updatePhoneCalls = 0;
  public lastAuthByPhoneInput: {
    phone_extension: string;
    phone_number: string;
  } | null = null;
  public authByPhoneResult: Awaited<ReturnType<AgentConversationGateway['authByPhone']>> = {
    status: 'failed',
    error: 'phone auth not configured in fixture',
    retryable: false,
  };
  public updatePhoneResult: Awaited<ReturnType<AgentConversationGateway['updatePhone']>> = {
    status: 'success',
  };
  public lastToken: string | null = null;
  public lastUpdatePhoneInput: {
    token: string;
    phone_extension: string;
    phone_number: string;
  } | null = null;
  public recentMessageCalls = 0;
  public takeoverCalls = 0;
  public takeoverResult: AgentGatewayResult = { status: 'success', message: 'fixture_handoff' };
  public recentMessages: AgentConversationMessage[] | null = null;
  public giftResult: AgentPurchaseLookupResult = {
    status: 'success',
    resource: 'gift_purchases',
    purchases: [purchase('ORD-000880')],
  };
  public guestOrdersResult: AgentPhonePurchaseLookupResult = {
    status: 'not_found',
    resource: 'orders',
    orderId: null,
  };
  public guestGiftResult: AgentPhonePurchaseLookupResult = {
    status: 'not_found',
    resource: 'gift_purchases',
    orderId: null,
  };
  public guestEventCalls = 0;
  public eventDetailCalls = 0;
  public guestEventsResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getGuestEventsByPhone']>>
  > = { status: 'not_found' };
  public eventDetailResult: Awaited<
    ReturnType<NonNullable<AgentConversationGateway['getEventDetail']>>
  > = { status: 'not_found' };

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async getRecentMessages(): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    this.recentMessageCalls += 1;
    if (this.recentMessages) {
      return { status: 'success', messages: this.recentMessages };
    }
    return { status: 'skipped', reason: 'disabled', message: 'disabled' };
  }

  async requestHumanTakeover(): Promise<AgentGatewayResult> {
    this.takeoverCalls += 1;
    return this.takeoverResult;
  }

  async getOrders(args: {
    token: string;
  }): Promise<AgentPurchaseLookupResult> {
    this.ordersCalls += 1;
    this.lastToken = args.token;
    return {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
  }

  async getGiftPurchases(args: {
    token: string;
  }): Promise<AgentPurchaseLookupResult> {
    this.giftCalls += 1;
    this.lastToken = args.token;
    return this.giftResult;
  }

  async getGuestOrdersByPhone(): Promise<AgentPhonePurchaseLookupResult> {
    this.guestOrdersCalls += 1;
    return this.guestOrdersResult;
  }

  async getGuestGiftPurchasesByPhone(): Promise<AgentPhonePurchaseLookupResult> {
    this.guestGiftCalls += 1;
    return this.guestGiftResult;
  }

  async authByPhone(args: {
    phone_extension: string;
    phone_number: string;
  }): Promise<Awaited<ReturnType<AgentConversationGateway['authByPhone']>>> {
    this.authByPhoneCalls += 1;
    this.lastAuthByPhoneInput = args;
    return this.authByPhoneResult;
  }

  async getGuestEventsByPhone(): Promise<typeof this.guestEventsResult> {
    this.guestEventCalls += 1;
    return this.guestEventsResult;
  }

  async getEventDetail(): Promise<typeof this.eventDetailResult> {
    this.eventDetailCalls += 1;
    return this.eventDetailResult;
  }

  async updatePhone(args: {
    token: string;
    phone_extension: string;
    phone_number: string;
  }): Promise<Awaited<ReturnType<AgentConversationGateway['updatePhone']>>> {
    this.lastUpdatePhoneInput = args;
    this.updatePhoneCalls += 1;
    return this.updatePhoneResult;
  }
}

function createService(args: {
  runtime: AgentRuntime;
  knowledgeGateway: KnowledgeRetrievalGateway;
  purchaseGateway: AgentConversationGateway;
  providerGateway: ReturnType<typeof providerGateway>;
  planStore?: InMemoryPlanStore;
}): AgentService {
  const provider = args.providerGateway.gateway;
  return new AgentService({
    planStore: args.planStore ?? new InMemoryPlanStore(),
    runtime: args.runtime,
    providerGateway: provider,
    promptLoader,
    renderers,
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: args.knowledgeGateway,
      providerGateway: provider,
      agentGateway: args.purchaseGateway,
    }),
    agentConversationGateway: args.purchaseGateway,
  });
}

function conversationMessage(
  overrides: Partial<AgentConversationMessage> &
    Pick<AgentConversationMessage, 'id' | 'direction' | 'body'>,
): AgentConversationMessage {
  return {
    id: overrides.id,
    direction: overrides.direction,
    source: overrides.source ?? null,
    body: overrides.body,
    status: overrides.status ?? 'delivered',
    whatsappMessageId: overrides.whatsappMessageId ?? null,
    sentAt: overrides.sentAt ?? null,
    createdAt: overrides.createdAt ?? null,
  };
}

function extraction(
  informationRequests: ExtractedInformationRequest[],
  actionIntent: ExtractionResult['actionIntent'] = null,
  contactEmail: string | null = null,
  phoneConfirmation: ExtractionResult['phoneConfirmation'] = null,
): ExtractionResult {
  return {
    actionIntent,
    informationRequests,
    phoneConfirmation,
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
    conversationSummary: 'Consulta informativa.',
    selectedProviderHints: [],
    pauseRequested: false,
    contactName: null,
    contactEmail,
    contactPhone: null,
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
  };
}

function purchaseRequest(
  orderId: string | null,
): Extract<ExtractedInformationRequest, { kind: 'purchase' }> {
  return {
    kind: 'purchase',
    resource: 'gift_purchases',
    query: 'Estado del regalo comprado.',
    orderId,
    aspects: ['summary', 'payment_status', 'shipping'],
    sensitiveFields: [],
    authAction: 'none',
  };
}

function purchase(orderId: string): PurchaseInformation {
  return {
    orderId,
    paymentStatus: 'approved',
    shippingStatus: 'enroute',
    grandTotal: 250,
    paymentMethod: 'Visa',
    eventName: 'Boda',
    eventDate: '2026-09-15',
    eventUrl: null,
    createdAt: '2026-07-10',
    items: [],
  };
}

function providerGateway(options?: {
  verificationResult?: {
    status: 'invalid_code';
    error: string;
  };
}): {
  gateway: ProviderGateway;
  requestCodeCalls: number;
  verifyCodeCalls: number;
  eventLookupCalls: number;
} {
  const state = {
    requestCodeCalls: 0,
    verifyCodeCalls: 0,
    eventLookupCalls: 0,
  };
  const gateway = {
    async requestUserLoginCode() {
      state.requestCodeCalls += 1;
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      state.verifyCodeCalls += 1;
      if (options?.verificationResult) {
        return options.verificationResult;
      }
      return {
        status: 'authenticated' as const,
        token: 'shared-jwt',
        tokenExpiresAt: new Date(
          Date.now() + 60 * 60 * 1000,
        ).toISOString(),
      };
    },
    async lookupAuthenticatedUserEvents(): Promise<UserEventLookupResult> {
      state.eventLookupCalls += 1;
      return {
        lookup: {
          email: 'leonardocandio22@gmail.com',
          phone: null,
        },
        user: {
          id: 22,
          fullName: 'Leonardo',
          email: 'leonardocandio22@gmail.com',
          fullPhone: null,
        },
        events: [],
        counts: {
          ownerEvents: 0,
          guestEvents: 0,
          hostEvents: 0,
          celebratedEvents: 0,
          recentOrders: 0,
        },
      };
    },
  } as unknown as ProviderGateway;
  return {
    gateway,
    get requestCodeCalls() {
      return state.requestCodeCalls;
    },
    get verifyCodeCalls() {
      return state.verifyCodeCalls;
    },
    get eventLookupCalls() {
      return state.eventLookupCalls;
    },
  };
}


it('keeps an accountless purchase read even when extraction also emits phone rejection without phone authentication', async () => {
  const request = { ...purchaseRequest(null), resource: 'orders' as const, authAction: 'accountless_user' as const };
  const runtime = new InformationRuntime([extraction([request], null, null, 'no')]);
  const gateway = new FakePurchaseGateway();
  gateway.guestOrdersResult = { status: 'success', resource: 'orders', purchases: [purchase('order-fixture')] };
  const service = createService({ runtime, knowledgeGateway: new FakeKnowledgeGateway(),
    purchaseGateway: gateway, providerGateway: providerGateway() });
  const response = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'accountless-conflict',
    text: 'No tengo cuenta. Quiero consultar mi regalo.', contactPhone: '+51900000990',
    messageId: 'accountless-conflict-1', receivedAt: new Date().toISOString() });
  expect(gateway.takeoverCalls).toBe(0);
  expect(gateway.guestOrdersCalls).toBe(1);
  expect(response.trace.tools_called).not.toContain('auth_by_phone');
});

it('W1-07 routes a fresh-session typed phone rejection to human handoff without OTP or greeting', async () => {
  const runtime = new InformationRuntime([
    extraction([], null, 'fallback@example.com', 'no'),
  ]);
  const gateway = new FakePurchaseGateway();
  const provider = providerGateway();
  const service = createService({
    runtime,
    knowledgeGateway: new FakeKnowledgeGateway(),
    purchaseGateway: gateway,
    providerGateway: provider,
  });

  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'wrong-account-fresh-user',
    text: 'Ese número no corresponde a mi cuenta; mi correo es fallback@example.com',
    messageId: 'wrong-account-fresh-1',
    receivedAt: new Date().toISOString(),
    contactPhone: '+51987654321',
  });

  expect(response.plan.current_node).toBe('solicitar_agente_humano');
  expect(response.plan.current_node).not.toBe('entrevista');
  expect(response.plan.human_escalation.status).toBe('requested');
  expect(response.plan.human_help_receipt).toMatchObject({
    outcome: 'handoff_requested',
    requested: true,
  });
  expect(gateway.takeoverCalls).toBe(1);
  expect(gateway.authByPhoneCalls).toBe(0);
  expect(provider.requestCodeCalls).toBe(0);
  expect(provider.verifyCodeCalls).toBe(0);
  expect(response.trace.tools_called).toContain('request_human_takeover');
  expect(response.trace.tools_called).not.toContain('lookup_guest_orders_by_phone');
  expect(response.trace.tools_called).not.toContain('request_user_login_code');
  expect(response.outbound.text ?? '').toContain('ya solicité apoyo humano');
  expect(response.outbound.text ?? '').not.toContain('Hola, soy el asistente');
  expect((response.outbound.text ?? '').toLowerCase()).not.toContain('otp');
  expect((response.outbound.text ?? '').toLowerCase()).not.toContain('código');
  expect(runtime.composeRequests).toHaveLength(0);
});

it('W1-07 guides neutral reported-amount wording for a pending Yape/Plin purchase without currency', async () => {
  const request = purchaseRequest(null);
  request.resource = 'orders';
  request.query = 'Hice la compra para Suki Sofia pero no me llego confirmacion. Cual es el estado?';
  request.aspects = ['summary', 'payment_status'];
  const runtime = new InformationRuntime([extraction([request])]);
  const gateway = new FakePurchaseGateway();
  const pendingPurchase = {
    ...purchase('ORD-S01-PENDING'),
    partition: 'pending_orders' as const,
    paymentStatus: 'pending',
    paymentMethod: 'Yape_o_Plin',
    grandTotal: 149.90,
    currency: null,
    eventName: 'Suki Sofia',
  };
  gateway.guestOrdersResult = {
    status: 'success',
    resource: 'orders',
    purchases: [pendingPurchase],
    orderPartitions: { pending: [pendingPurchase], completed: [] },
    carts: [],
  };
  const service = createService({
    runtime,
    knowledgeGateway: new FakeKnowledgeGateway(),
    purchaseGateway: gateway,
    providerGateway: providerGateway(),
  });

  await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 's01-neutral-user',
    text: 'Hice la compra para Suki Sofia pero no me llego confirmacion. Cual es el estado?',
    messageId: 's01-neutral-1',
    receivedAt: new Date().toISOString(),
    contactPhone: '+51900027635',
  });

  expect(runtime.composeRequests).toHaveLength(1);
  const note = runtime.composeRequests[0]?.errorMessage ?? '';
  expect(note).toContain('monto [valor] mediante');
  expect(note).toContain('como dato disponible');
  expect(note).toContain('sin escribir');
});
