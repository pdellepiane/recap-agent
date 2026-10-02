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
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
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
import {
  deriveReplyCompilerContext,
  moduleFilesFor,
  selectReplyModules,
} from '../src/runtime/model-request-projector';

/**
 * Stub compiler identity: reports the exact registry modules the production
 * compiler selects for the received request. The bundle id is stub-labeled;
 * the module files are real.
 */
function stubCompilerPrompt(
  request: ComposeReplyRequest,
): NonNullable<ComposeReplyResult['compilerPrompt']> {
  const modules = selectReplyModules(deriveReplyCompilerContext(request));
  return {
    bundleId: `stub-compiler:${modules.map((module) => module.id).join('+')}`,
    filePaths: moduleFilesFor(modules),
  };
}

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
  it('verifies a word OTP once and keeps recall read-only after a failed purchase read and session expiry', async () => {
    const store = new InMemoryPlanStore();
    const request = { ...purchaseRequest(null), authAction: 'provide_otp' as const };
    await store.save({ reason: 'fixture', plan: mergePlan(createEmptyPlan({
      planId: 'otp-recall', channel: 'whatsapp', externalUserId: 'otp-recall',
    }), {
      current_node: 'resolver_consultas_informativas', contact_email: 'customer@example.com',
      user_auth: { status: 'code_requested', email: 'customer@example.com',
        requested_at: new Date().toISOString() },
      information_state: { resume_node: 'deteccion_intencion',
        pending_requests: [{ ...request, requestId: 'information-1' }], selection_candidates: [] },
    }) });
    const runtime = new InformationRuntime([extraction([request]), extraction([]), extraction([])]);
    const gateway = new FakePurchaseGateway();
    gateway.giftResult = { status: 'failed', resource: 'gift_purchases', failureKind: 'request_failed', error: 'Purchase source unavailable.', retryable: true };
    gateway.guestGiftResult = { status: 'failed', resource: 'gift_purchases', failureKind: 'request_failed', error: 'Purchase source unavailable.', retryable: true };
    gateway.guestOrdersResult = { status: 'failed', resource: 'orders', failureKind: 'request_failed', error: 'Purchase source unavailable.', retryable: true };
    const provider = providerGateway();
    const service = createService({ runtime, purchaseGateway: gateway,
      knowledgeGateway: new FakeKnowledgeGateway(), providerGateway: provider, planStore: store });
    const input = { channel: 'whatsapp' as const, externalUserId: 'otp-recall',
      contactPhone: '+51959307414', receivedAt: new Date().toISOString() };
    const verified = await service.handleTurn({ ...input, messageId: 'otp-recall-1',
      text: 'Uno cuatro siete cinco uno cinco' });
    expect(provider.verifyCodeCalls).toBe(1);
    expect(verified.plan.user_auth.status).toBe('authenticated');
    expect(verified.plan.information_state.pending_requests).toHaveLength(1);
    await store.save({ reason: 'fixture-expiry', plan: mergePlan(verified.plan, {
      user_auth: { token_expires_at: '2026-01-01T00:00:00.000Z' },
    }) });
    const callsBefore = gateway.ordersCalls + gateway.giftCalls;
    for (const [index, text] of ['Perdona, ¿me repites lo último que me dijiste?', 'Gracias, eso era todo.'].entries()) {
      const result = await service.handleTurn({ ...input, messageId: `otp-recall-${index + 2}`, text });
      expect(result.trace.tools_called).not.toContain('auth_by_phone');
      expect(result.trace.tools_called).not.toContain('request_human_takeover');
      expect(result.trace.tools_called).not.toContain('request_user_login_code');
      expect(result.trace.tools_called).not.toContain('verify_user_login_code');
      expect(result.plan.information_state.pending_requests).toHaveLength(1);
    }
    expect(gateway.ordersCalls + gateway.giftCalls).toBe(callsBefore);
    expect(provider.verifyCodeCalls).toBe(1);
    expect(gateway.takeoverCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(3);
  });

  it('routes mailbox reports, deferrals and clarifications from empty information state without lookups or restarts', async () => {
    const runtime = new InformationRuntime([
      { ...extraction([]), supportAct: { kind: 'report_issue',} },
      { ...extraction([]), supportAct: { kind: 'defer_submission',} },
      { ...extraction([]), supportAct: { kind: 'provide_detail',} },
    ]);
    const knowledge = new FakeKnowledgeGateway();
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge, purchaseGateway: gateway, providerGateway: providerGateway() });
    const texts = ['Tengo un problema de capacidad en mi gmail registrado', 'Lo voy a enviar luego', 'Esta lkeno'];
    for (const [index, text] of texts.entries()) {
      const response = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'mailbox-report',
        contactPhone: '+51900000302', messageId: `mailbox-${index}`, receivedAt: new Date().toISOString(), text });
      // L1: support acknowledgments are model-composed from scoped evidence,
      // one reply-model call per turn through the minimal support bundle.
      expect(runtime.composeRequests).toHaveLength(index + 1);
      expect(response.outbound.text).toBe('Respuesta informativa.');
      expect(response.outbound.delivery.action).toBe('send');
    }
    expect(knowledge.calls).toBe(0);
    expect(runtime.extractRequests).toHaveLength(3);
  });

  it('keeps ambiguous follow-ups on the recent support topic and executes prior_single-linked reads', async () => {
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
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.extraction.ambiguity?.status).toBe('ambiguous');
    expect(knowledge.calls).toBe(0);
    // All-root preparation reads the authorized phone profile before
    // extraction; ambiguity still withholds task reads (no FAQ lookup above).
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(2);

    const linkedStore = new InMemoryPlanStore();
    await linkedStore.save({
      reason: 'seed-prior-image',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'prior-single-image-plan',
          channel: 'whatsapp',
          externalUserId: 'prior-single-user',
        }),
        {
          current_node: 'resolver_consultas_informativas',
          image_attachments: [{
            kind: 'url',
            url: 'https://example.invalid/voucher.jpg',
            messageId: 'wamid.img1',
            receivedAt: new Date().toISOString(),
          }],
        },
      ),
    });
    const dedicationRequest = purchaseRequest(null);
    const base = extraction([dedicationRequest]);
    const linkedRuntime = new InformationRuntime([{
      ...base,
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Quieres el estado o que revise el comprobante?',
        interpretations: ['el estado de la compra', 'la revision del comprobante'],
      },
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.img1'] },
    }]);
    const linkedKnowledge = new FakeKnowledgeGateway();
    const linkedGateway = new FakePurchaseGateway();
    const linkedService = createService({
      runtime: linkedRuntime,
      knowledgeGateway: linkedKnowledge,
      purchaseGateway: linkedGateway,
      providerGateway: providerGateway(),
      planStore: linkedStore,
    });

    const linkedResponse = await linkedService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'prior-single-user',
      contactPhone: '+51973296571',
      text: 'Quiero que revises la dedicatoria de este comprobante',
      messageId: 'prior-single-1',
      receivedAt: new Date().toISOString(),
    });

    // The single linked image is the answerable target, so the ambiguous
    // turn executes (phone-scoped lookup attempted) instead of skipping to
    // a bare clarification. Genuine multi-candidate turns without such a
    // link still skip (covered above).
    expect(linkedResponse.plan.current_node).toBe('resolver_consultas_informativas');
    expect(linkedResponse.outbound.text).toBe('Respuesta informativa.');
    expect(linkedRuntime.composeRequests).toHaveLength(1);
    expect(linkedGateway.guestGiftCalls).toBe(1);
    expect(linkedRuntime.composeRequests[0]?.imageEvidence).toMatchObject({ status: 'available' });
  });

  it('routes empty extractions to contextual clarification from history or the canonical summary', async () => {
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
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(response.outbound.text).not.toMatch(/^(?:Hola|¡Hola)/u);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(knowledge.calls).toBe(0);
    // All-root preparation reads the authorized phone profile; the
    // clarification task itself performs no FAQ lookup (see knowledge.calls).
    expect(gateway.guestOrdersCalls + gateway.guestGiftCalls + gateway.authByPhoneCalls).toBe(2);

    const summaryRuntime = new InformationRuntime([extraction([])]);
    const summaryGateway = new FakePurchaseGateway();
    const summaryStore = new InMemoryPlanStore();
    await summaryStore.save({
      reason: 'fixture',
      plan: mergePlan(createEmptyPlan({
        planId: 'canonical-support-summary-plan',
        channel: 'whatsapp',
        externalUserId: 'canonical-support-summary-user',
      }), {
        current_node: 'resolver_consultas_informativas',
        conversation_summary: 'La persona informó que el buzón de su correo registrado está lleno.',
      }),
    });
    const summaryService = createService({
      runtime: summaryRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: summaryGateway,
      providerGateway: providerGateway(),
      planStore: summaryStore,
    });

    const summaryResponse = await summaryService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'canonical-support-summary-user',
      contactPhone: '+51900000302',
      text: 'Esta lkeno',
      messageId: 'canonical-support-summary-1',
      receivedAt: new Date().toISOString(),
    });

    expect(summaryRuntime.composeRequests).toHaveLength(1);
    expect(summaryRuntime.composeRequests[0]?.plan.conversation_summary).toContain('buzón');
    expect(summaryRuntime.composeRequests[0]?.errorMessage).toBeNull();
    expect(summaryResponse.trace.route_kind).toBe('contextual_clarification');
    // All-root preparation reads the authorized phone profile before the
    // clarification task, which itself performs no backend lookup.
    expect(summaryGateway.guestOrdersCalls + summaryGateway.guestGiftCalls + summaryGateway.authByPhoneCalls).toBe(2);
  });

  it('acknowledges a deferral without executing or deleting an unresolved purchase selection', async () => {
    const store = new InMemoryPlanStore();
    const request = { kind: 'purchase' as const, resource: 'orders' as const, query: 'Consulta sobre mi regalo',
      orderId: null, authAction: 'none' as const, requestId: 'pending' };
    await store.save({ reason: 'fixture', plan: mergePlan(createEmptyPlan({ planId: 'deferred', channel: 'whatsapp', externalUserId: 'deferred' }), {
      current_node: 'resolver_consultas_informativas', information_state: {
        resume_node: 'entrevista', pending_requests: [request], selection_candidates: [], last_completed_request: null,
      },
    }) });
    const runtime = new InformationRuntime([{ ...extraction([]), supportAct: { kind: 'defer_submission',} }]);
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: new FakeKnowledgeGateway(), purchaseGateway: gateway, providerGateway: providerGateway(), planStore: store });
    const response = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'deferred', contactPhone: '+51900000302',
      text: 'Lo envío luego', messageId: 'defer', receivedAt: new Date().toISOString() });
    expect(response.plan.information_state.pending_requests).toEqual([request]);
    // All-root preparation reads the phone orders profile; the deferred
    // selection itself is preserved without task execution (see above).
    expect(gateway.guestOrdersCalls + gateway.authByPhoneCalls).toBe(1);
  });

  it('reads the verified purchase record for a typed purchase-status question instead of answering from the KB', async () => {
    const runtime = new InformationRuntime([{
      ...extraction([]),
      supportAct: {
        kind: 'ask_policy',
      },
    }]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
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
      text: '¿Cuál es el estado de mi compra?',
      messageId: 'typed-policy-question-1',
      receivedAt: new Date().toISOString(),
    });

    expect(knowledge.calls).toBe(0);
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(1);
  });

  it('routes explicit human requests to handoff exactly once across identity and entry paths', async () => {
    const runtime = new InformationRuntime([
      extraction([], 'solicitar_humano'),
    ]);
    const gateway = new FakePurchaseGateway();
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'explicit-handoff-requested',
      text: 'Necesito hablar con una persona.',
      messageId: 'explicit-handoff-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.takeoverCalls).toBe(1);
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(response.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.currentNode).toBe('solicitar_agente_humano');
    expect(runtime.composeRequests[0]?.handoffOutcome).toBe('handoff_requested');
    expect(response.trace.prompt_bundle_id).not.toMatch(/^deterministic:/u);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe('Respuesta informativa.');

    const nophoneRuntime = new InformationRuntime([
      extraction([], 'solicitar_humano'),
    ]);
    const nophoneGateway = new FakePurchaseGateway();
    const nophoneTakeover = vi.spyOn(nophoneGateway, 'requestHumanTakeover');
    const nophoneService = createService({
      runtime: nophoneRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: nophoneGateway,
      providerGateway: providerGateway(),
    });

    const nophoneResponse = await nophoneService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'explicit-handoff-nophone',
      text: 'Necesito hablar con una persona.',
      messageId: 'explicit-handoff-nophone-1',
      receivedAt: new Date().toISOString(),
    });

    expect(nophoneTakeover).not.toHaveBeenCalled();
    expect(nophoneResponse.plan.current_node).toBe('solicitar_agente_humano');
    expect(nophoneResponse.plan.human_escalation.status).toBe('none');
    expect(nophoneRuntime.composeRequests).toHaveLength(1);
    expect(nophoneRuntime.composeRequests[0]?.handoffOutcome).not.toBe('handoff_requested');
    expect(nophoneResponse.outbound.delivery.action).toBe('send');
    expect(nophoneResponse.outbound.text).toBe('Respuesta informativa.');

    const numericRuntime = new InformationRuntime([
      extraction([], 'solicitar_humano'),
    ]);
    const numericGateway = new FakePurchaseGateway();
    const numericTakeover = vi.spyOn(numericGateway, 'requestHumanTakeover');
    const numericService = createService({
      runtime: numericRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: numericGateway,
      providerGateway: providerGateway(),
    });

    await numericService.handleTurn({
      channel: 'whatsapp',
      externalUserId: '51987654321',
      text: 'Necesito hablar con una persona.',
      messageId: 'untrusted-external-id-1',
      receivedAt: new Date().toISOString(),
    });

    expect(numericTakeover).not.toHaveBeenCalled();

    const missRuntime = new InformationRuntime([
      { ...extraction([purchaseRequest(null)]), actionIntent: 'solicitar_humano' },
    ]);
    const missGateway = new FakePurchaseGateway();
    const missService = createService({
      runtime: missRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: missGateway,
      providerGateway: providerGateway(),
    });
    const missResponse = await missService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'explicit-beside-miss',
      contactPhone: '+51973296571',
      text: 'No encuentro mi compra, necesito hablar con una persona.',
      messageId: 'explicit-beside-miss-1',
      receivedAt: new Date().toISOString(),
    });

    expect(missGateway.takeoverCalls).toBe(1);
    expect(missResponse.plan.human_escalation.status).toBe('requested');

    const offerStore = new InMemoryPlanStore();
    await offerStore.save({
      reason: 'seed-offered',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'laneb-offered',
          channel: 'whatsapp',
          externalUserId: 'laneb-offered-user',
        }),
        {
          current_node: 'resolver_consultas_informativas',
          conversation_health: {
            status: 'frustrated',
            reason: 'explicit_frustration',
            consecutive_non_progress_turns: 1,
            help_offer_status: 'offered',
            help_offered_at: '2026-09-21T12:00:00.000Z',
            last_assessed_at: '2026-09-21T12:00:00.000Z',
          },
        },
      ),
    });
    const offerRuntime = new InformationRuntime([{
      ...extraction([], 'solicitar_humano', null, null),
      humanHelpIntent: 'accept_offer',
    }]);
    const offerGateway = new FakePurchaseGateway();
    const offerService = createService({
      runtime: offerRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: offerGateway,
      providerGateway: providerGateway(),
      planStore: offerStore,
    });

    const offerResponse = await offerService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'laneb-offered-user',
      text: 'Sí, acepto la ayuda.',
      messageId: 'laneb-offered-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(offerGateway.takeoverCalls).toBe(1);
    expect(offerResponse.plan.human_escalation.status).toBe('requested');
    expect(offerRuntime.composeRequests.at(-1)?.handoffOutcome).toBe('handoff_requested');
  });

  const hostRequest = (hostWithdrawal: 'individual_status' | 'policy_only' = 'individual_status'): ExtractedInformationRequest => ({
    kind: 'faq', query: 'Retiro de fondos del evento aún no recibido', hostWithdrawal,
    eventHint: 'Diana y Fernando',
  });
  const hostKnowledge = () => {
    const gateway = new FakeKnowledgeGateway();
    const search = vi.spyOn(gateway, 'search').mockResolvedValue({ status: 'success', evidence: [{
      fileId: 'host-policy', filename: 'donde-va-el-dinero.md', score: 0.9,
      fullArticle: true, sourceUrl: 'https://sinenvolturas.tawk.help/article/donde-va-el-dinero',
      text: 'template_status: "Vigente"\nLas solicitudes se procesan en hasta 72 horas hábiles.\nComisión USD5. Retiro recibido mañana. Cuenta privada.',
    }] });
    return { gateway, search };
  };

  it('answers host withdrawal policy with handoff and general host policy without it', async () => {
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
    // L1 model composition: the sourced policy window travels as typed
    // evidence, never as joined canned prose; the stub model text is delivered.
    const withdrawalCompose = runtime.composeRequests.at(-1);
    expect(withdrawalCompose?.currentNode).toBe('solicitar_agente_humano');
    expect(withdrawalCompose?.handoffOutcome).toBe('handoff_requested');
    expect(withdrawalCompose?.informationResults?.[0]).toMatchObject({
      kind: 'faq',
      status: 'completed',
      hostWithdrawalPolicy: { maxBusinessHours: 72 },
    });
    const policyEvidence = JSON.stringify(withdrawalCompose?.informationResults?.[0]);
    expect(policyEvidence).toContain('72 horas hábiles');
    expect(policyEvidence).not.toMatch(/USD5|mañana|Cuenta privada/u);
    expect(answer.outbound.text).toBe('Respuesta informativa.');
    expect(answer.trace.prompt_bundle_id).not.toMatch(/^deterministic:/u);
    expect(answer.trace.prompt_file_paths).not.toContain(
      'nodes/resolver_consultas_informativas/host-withdrawal.json',
    );
    const followup = await service.handleTurn({ ...inbound, messageId: 'event', text: 'Evento: Diana y Fernando' });
    expect(followup.trace.prompt_bundle_id).toBe('deterministic:human_escalation_soft_pause');
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(runtime.extractRequests).toHaveLength(2);
    expect(runtime.composeRequests).toHaveLength(2); // Initial role response plus the model-composed withdrawal reply.
    // The authorized customer profile may prefetch its roots. The withdrawal
    // task itself must remain a FAQ with no buyer operation or account auth.
    expect(withdrawalCompose?.informationResults?.every((result) => result.kind === 'faq')).toBe(true);
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls + provider.verifyCodeCalls + provider.eventLookupCalls).toBe(0);

    const policyRuntime = new InformationRuntime([extraction([hostRequest('policy_only')])]);
    const policyKnowledge = hostKnowledge();
    const policyGateway = new FakePurchaseGateway();
    const policyService = createService({ runtime: policyRuntime, knowledgeGateway: policyKnowledge.gateway, purchaseGateway: policyGateway, providerGateway: providerGateway() });
    const policyResult = await policyService.handleTurn({ channel: 'whatsapp', externalUserId: 'general-host-policy',
      text: '¿Cuánto demora un retiro de fondos?', messageId: 'policy', receivedAt: new Date().toISOString() });
    expect(policyGateway.takeoverCalls).toBe(0);
    expect(policyResult.plan.information_state.pending_requests).toEqual([]);
    expect(policyRuntime.composeRequests).toHaveLength(1);
    const policyCompose = policyRuntime.composeRequests[0];
    expect(policyCompose?.handoffOutcome).toBeNull();
    expect(policyCompose?.informationResults?.[0]).toMatchObject({
      kind: 'faq',
      status: 'completed',
      hostWithdrawalPolicy: { maxBusinessHours: 72 },
    });
    expect(JSON.stringify(policyCompose?.informationResults?.[0])).not.toMatch(/USD5|mañana|Cuenta privada/u);
    expect(policyResult.outbound.text).toBe('Respuesta informativa.');
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
    expect(result.plan.human_escalation.status).toBe('none');
    // The failed handoff travels as typed outcome evidence for the model.
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.handoffOutcome).toBe('handoff_failed');
    expect(result.outbound.text).toBe('Respuesta informativa.');
  });

  it('never invents a host-withdrawal window and never acts on ambiguous withdrawal extractions', async () => {
    const runtime = new InformationRuntime([extraction([hostRequest()])]);
    const knowledge = hostKnowledge();
    knowledge.search.mockResolvedValue({ status: 'failed', reason: 'request_failed', retryable: true, error: 'offline' });
    const gateway = new FakePurchaseGateway();
    const service = createService({ runtime, knowledgeGateway: knowledge.gateway, purchaseGateway: gateway, providerGateway: providerGateway() });
    const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'no-policy', contactPhone: '+51999999999',
      text: 'No recibí mi retiro', messageId: 'missing', receivedAt: new Date().toISOString() });
    expect(JSON.stringify(result.outbound)).not.toContain('72');
    expect(gateway.takeoverCalls).toBe(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const compose = runtime.composeRequests[0];
    expect(compose?.informationResults?.[0]).toMatchObject({ kind: 'faq', status: 'failed' });
    expect(compose?.handoffOutcome).toBe('handoff_requested');
    expect(result.plan.information_state.pending_requests).toHaveLength(1);

    const ambiguousRuntime = new InformationRuntime([{ ...extraction([hostRequest()]), ambiguity: {
      status: 'ambiguous', clarificationQuestion: '¿Te refieres a retirar fondos de tu evento o a un regalo?',
      interpretations: ['Retiro de fondos', 'Regalo comprado'],
    } }]);
    const ambiguousKnowledge = hostKnowledge();
    const ambiguousGateway = new FakePurchaseGateway();
    const ambiguousService = createService({ runtime: ambiguousRuntime, knowledgeGateway: ambiguousKnowledge.gateway, purchaseGateway: ambiguousGateway, providerGateway: providerGateway() });
    await ambiguousService.handleTurn({ channel: 'whatsapp', externalUserId: 'ambiguous-host',
      text: 'Quiero ver lo que retiré', messageId: 'ambiguous', receivedAt: new Date().toISOString() });
    expect(ambiguousGateway.takeoverCalls).toBe(0);
    expect(ambiguousKnowledge.search).not.toHaveBeenCalled();
    expect(ambiguousRuntime.composeRequests).toHaveLength(1);
  });

  it('keeps guest names out of the channel user identity across support detail turns', async () => {
    const guardStore = new InMemoryPlanStore();
    const guardPlan = mergePlan(
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
    await guardStore.save({ plan: guardPlan, reason: 'fixture' });
    const guardRuntime = new InformationRuntime([
      {
        ...extraction([]),
        contactName: 'Roger Abanto',
      },
    ]);
    const guardService = createService({
      runtime: guardRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
      planStore: guardStore,
    });

    const guardResponse = await guardService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'identity-guard-user',
      text: 'El nombre es Roger Abanto',
      messageId: 'identity-guard-1',
      receivedAt: new Date().toISOString(),
    });

    expect(guardResponse.plan.contact_name).toBe('Claudia');

    const planStore = new InMemoryPlanStore();
    const runtime = new InformationRuntime([
      extraction([{ kind: 'faq', query: 'Problema de tarjeta de un invitado.' }]),
      {
        ...extraction([]),
        supportAct: {
          kind: 'provide_detail',
          personReference: 'Roger Abanto',
          eventReference: null,
        },
      },
      {
        ...extraction([]),
        supportAct: {
          kind: 'provide_detail',
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
    // P4 anchorless-replay removal: a correction turn with no current-turn
    // request must not replay the last completed purchase record. The reply
    // acknowledges without re-projecting completed evidence.
    expect(runtime.composeRequests.at(-1)?.informationResults ?? []).toEqual([]);
  });

  it('answers FAQ evidence while gating purchase reads behind email verification', async () => {
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

    const orderRuntime = new InformationRuntime([
      extraction([purchaseRequest('ORD-000880')]),
    ]);
    const orderService = createService({
      runtime: orderRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
    });

    await orderService.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'specific-order-without-email',
      text: 'Revisa mi pedido ORD-000880.',
      messageId: 'specific-order-without-email-1',
      receivedAt: new Date().toISOString(),
    });

    const orderAuthBlock = orderRuntime.composeRequests
      .at(-1)
      ?.informationResults?.find(
        (result) => result.kind === 'purchase' && result.status === 'needs_input',
      );
    expect(
      orderAuthBlock?.status === 'needs_input' ? orderAuthBlock.guidance : null,
    ).toEqual(createInformationAuthGuidance('email_required', null));
  });

  it('asks once or executes on ambiguous turns without stashing the clarification text', async () => {
    const bareExtraction = extraction([]);
    bareExtraction.ambiguity = {
      status: 'ambiguous',
      clarificationQuestion: '¿Te refieres al pago o a un evento?',
      interpretations: ['el pago', 'el evento'],
    };
    const bareRuntime = new InformationRuntime([bareExtraction]);
    const bareKnowledge = new FakeKnowledgeGateway();
    const bareGateway = new FakePurchaseGateway();
    const bareService = createService({
      runtime: bareRuntime,
      knowledgeGateway: bareKnowledge,
      purchaseGateway: bareGateway,
      providerGateway: providerGateway(),
    });

    const bareResponse = await bareService.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'bare-ambiguous-no-read',
      text: 'No entiendo bien',
      messageId: 'bare-ambiguous-no-read-1',
      receivedAt: new Date().toISOString(),
    });

    // Bare ambiguity with no purchase/event/faq read still asks exactly
    // once: one model composition carrying the ambiguity, zero lookups,
    // nothing persisted as pending, and the extractor clarification text
    // never stashed as the curated pending question.
    expect(bareRuntime.composeRequests).toHaveLength(1);
    expect(bareKnowledge.calls).toBe(0);
    expect(bareGateway.guestOrdersCalls + bareGateway.guestGiftCalls + bareGateway.guestEventCalls + bareGateway.authByPhoneCalls).toBe(0);
    expect(bareResponse.plan.information_state.pending_requests).toEqual([]);
    expect(bareResponse.plan.owner_pending_question).toBeNull();
    expect(bareResponse.trace.extraction_summary.ambiguity_status).toBe('ambiguous');
    expect(bareRuntime.composeRequests.at(-1)?.extraction.ambiguity?.status).toBe('ambiguous');
    expect(bareRuntime.composeRequests.at(-1)?.informationResults ?? []).toEqual([]);
    expect(bareResponse.outbound.text).toBe('Respuesta informativa.');

    const readExtraction = extraction([
      {
        kind: 'purchase',
        resource: 'orders',
        query: 'Estado del pedido propio del usuario.',
        orderId: null,
        authAction: 'none',
      },
    ]);
    readExtraction.ambiguity = {
      status: 'ambiguous',
      clarificationQuestion:
        '¿Quieres consultar un pedido específico o todos tus pedidos?',
      interpretations: [
        'un pedido específico',
        'todos tus pedidos',
      ],
    };
    const readRuntime = new InformationRuntime([readExtraction]);
    const readService = createService({
      runtime: readRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
    });

    const readResponse = await readService.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'recorded-order-loop',
      text: 'Quiero saber el estado de un pedido',
      messageId: 'recorded-order-loop-1',
      receivedAt: new Date().toISOString(),
    });

    const results = readRuntime.composeRequests.at(-1)?.informationResults ?? [];
    // Ambiguity no longer withholds authorized read-only requests: the
    // purchase read executes (email input still required without
    // authentication) and the model resolves from the executed result plus
    // the preserved ambiguity evidence instead of asking blind.
    expect(results).toEqual([
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
    expect(readResponse.plan.information_state.pending_requests).toHaveLength(1);
    expect(readResponse.plan.information_state.pending_requests[0]?.kind).toBe(
      'purchase',
    );
    expect(readResponse.trace.extraction_summary.ambiguity_status).toBe('ambiguous');
    const composed = readRuntime.composeRequests.at(-1)?.extraction;
    expect(composed?.ambiguity?.status).toBe('ambiguous');
    expect(composed?.ambiguity?.interpretations).toEqual([
      'un pedido específico',
      'todos tus pedidos',
    ]);
    expect(readResponse.outbound.text).toBe('Respuesta informativa.');
    expect(readRuntime.composeRequests.at(-1)?.errorMessage).toBeNull();
  });

  it('still withholds reads when an ambiguous turn also executes a typed action', async () => {
    const recordedExtraction = {
      ...extraction([purchaseRequest(null)]),
      rsvpAction: 'attending' as const,
    };
    recordedExtraction.ambiguity = {
      status: 'ambiguous',
      clarificationQuestion: '¿Quieres consultar tu compra o confirmar asistencia?',
      interpretations: ['consultar la compra', 'confirmar asistencia'],
    };
    const runtime = new InformationRuntime([recordedExtraction]);
    const knowledge = new FakeKnowledgeGateway();
    const gateway = new FakePurchaseGateway();
    const service = createService({
      runtime,
      knowledgeGateway: knowledge,
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    const response = await service.handleTurn({
      channel: 'terminal_whatsapp',
      externalUserId: 'ambiguous-action-conflict',
      text: 'Quiero ver mi compra y confirmar asistencia',
      messageId: 'ambiguous-action-conflict-1',
      receivedAt: new Date().toISOString(),
    });

    // Mutation authorization is unchanged: a typed executing action
    // conflicting with information work asks which to resolve first and
    // executes neither route.
    expect(knowledge.calls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.outbound.text).toBe('Respuesta informativa.');
  });

  it('reads a protected purchase with the trusted WhatsApp number without authentication', async () => {
    const runtime = new InformationRuntime([extraction([purchaseRequest(null)])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
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
    expect(response.plan.user_auth).toMatchObject({
      status: 'none',
      token: null,
      auth_method: null,
    });
    expect(response.trace.tools_called).toContain(
      'lookup_guest_gift_purchases_by_phone',
    );
    expect(response.trace.tools_called).not.toContain('auth_by_phone');
  });

  it.skip('looks up one canonical order for a confirmation document, hands off once, and covers pending threads', async () => {
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

    const pendingStore = new InMemoryPlanStore();
    await pendingStore.save({
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
    const pendingRuntime = new InformationRuntime([{
      ...extraction([]),
      requestedOperation: 'confirmation_document.send',
    }]);
    const pendingGateway = new FakePurchaseGateway();
    pendingGateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [purchase('ORD-000880')],
    };
    vi.spyOn(pendingGateway, 'requestHumanTakeover')
      .mockResolvedValue({ status: 'success', message: null });
    const pendingKnowledge = new FakeKnowledgeGateway();
    const pendingService = createService({
      runtime: pendingRuntime,
      knowledgeGateway: pendingKnowledge,
      purchaseGateway: pendingGateway,
      providerGateway: providerGateway(),
      planStore: pendingStore,
    });

    await pendingService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'document-with-pending-faq',
      contactPhone: '+51973296571',
      text: 'Ahora necesito la constancia de mi compra.',
      messageId: 'document-with-pending-faq-1',
      receivedAt: new Date().toISOString(),
    });

    expect(pendingGateway.guestOrdersCalls).toBe(1);
    expect(pendingRuntime.composeRequests[0]?.extraction.informationRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'purchase',
          resource: 'orders',
        }),
      ]),
    );
  });

  it('answers a proof-validation purchase question from the record lookup without a capability handoff', async () => {
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
      purchases: [],
      // Production partition envelope: one pending order. The reported
      // 13.76 is user-reported payment evidence, not order identity, so the
      // lone-amount guard resolves the unique pending order.
      orderPartitions: {
        pending: [{
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
        completed: [],
      },
    };
    const takeover = vi.spyOn(gateway, 'requestHumanTakeover')
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

    // R9: payment_proof.verify no longer forces a deterministic handoff. The
    // model answers from the phone-scoped record lookup in the normal
    // information flow; no capability-status-read synthesis, no takeover.
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(response.outbound.text).not.toMatch(/apoyo humano/i);
    expect(response.outbound.text).not.toMatch(/S\/|PEN|soles|not_eligible/u);
    expect(takeover).not.toHaveBeenCalled();
    expect(response.trace.information_execution_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'purchase',
          status: 'completed',
        }),
      ]),
    );
    expect(response.trace.information_execution_summary).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: 'capability-status-read' }),
      ]),
    );
  });

  it('projects a trusted cart recovery path separately from general payment policy', async () => {
    const request = purchaseRequest(null);
    request.resource = 'orders';
    request.eventHint = 'Carlos y Adriana';
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
    // outbound is model output (fake runtime returns generic), not deterministic full reply
    expect(response.outbound.text).not.toContain('https://');
    expect(response.trace.tools_called).toContain('lookup_guest_orders_by_phone');
  });

  it('rejects wrong-account and phone-association statements with one terminal handoff and no recovery', async () => {
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
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      reason: 'identity_rejected',
      handoffOutcome: 'handoff_requested',
    });

    const pendingQuestion: ExtractedInformationRequest = {
      kind: 'associated_event',
      query: '¿La restricción de vestir de blanco aplica a todas las personas?',
      eventHint: 'Boda Laura & Marcos',
      // Exercise the runtime invariant even if extraction attaches both
      // structured signals to a phone-association rejection.
      authAction: 'decline_authentication',
    };
    const eventRuntime = new InformationRuntime([
      extraction([pendingQuestion], null, null, 'no'),
    ]);
    const eventGateway = new FakePurchaseGateway();
    eventGateway.guestEventsResult = {
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
    const eventStore = new InMemoryPlanStore();
    await eventStore.save({
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
    const eventService = createService({
      runtime: eventRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: eventGateway,
      providerGateway: providerGateway(),
      planStore: eventStore,
    });

    const eventResponse = await eventService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'rejected-phone-event-user',
      text: 'Esa no es mi cuenta ni el número que tengo registrado.',
      messageId: 'rejected-phone-event-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(eventGateway.authByPhoneCalls).toBe(0);
    expect(eventGateway.guestEventCalls).toBe(0);
    expect(eventGateway.eventDetailCalls).toBe(0);
    expect(eventResponse.trace.tools_called).not.toContain('lookup_guest_events_by_phone');
    expect(eventResponse.plan.user_auth.status).toBe('none');
    expect(eventResponse.plan.user_auth.last_error).toBe('identity_rejected');
    expect(eventGateway.takeoverCalls).toBe(1);
    expect(eventResponse.plan.human_escalation.status).toBe('requested');
    expect(eventResponse.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(eventResponse.trace.tools_called).toContain('log_agent_conversation_message');
    expect(eventResponse.trace.tools_called).toContain('request_human_takeover');
    expect(eventResponse.outbound.text).toBe('Respuesta informativa.');
    expect(eventRuntime.composeRequests).toHaveLength(1);
    expect(eventRuntime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      reason: 'identity_rejected',
      handoffOutcome: 'handoff_requested',
    });

    const freshRuntime = new InformationRuntime([
      extraction([], null, 'fallback@example.com', 'no'),
    ]);
    const freshGateway = new FakePurchaseGateway();
    const freshProvider = providerGateway();
    const freshService = createService({
      runtime: freshRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: freshGateway,
      providerGateway: freshProvider,
    });

    const freshResponse = await freshService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'wrong-account-fresh-user',
      text: 'Ese número no corresponde a mi cuenta; mi correo es fallback@example.com',
      messageId: 'wrong-account-fresh-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51987654321',
    });

    expect(freshResponse.plan.current_node).toBe('solicitar_agente_humano');
    expect(freshResponse.plan.current_node).not.toBe('entrevista');
    expect(freshResponse.plan.human_escalation.status).toBe('requested');
    expect(freshResponse.plan.human_help_receipt).toMatchObject({
      outcome: 'handoff_requested',
      requested: true,
    });
    expect(freshGateway.takeoverCalls).toBe(1);
    expect(freshGateway.authByPhoneCalls).toBe(0);
    expect(freshProvider.requestCodeCalls).toBe(0);
    expect(freshProvider.verifyCodeCalls).toBe(0);
    expect(freshResponse.trace.tools_called).toContain('request_human_takeover');
    expect(freshResponse.trace.tools_called).not.toContain('lookup_guest_orders_by_phone');
    expect(freshResponse.trace.tools_called).not.toContain('request_user_login_code');
    expect(freshResponse.outbound.text).toBe('Respuesta informativa.');
    expect(freshResponse.outbound.text ?? '').not.toContain('Hola, soy el asistente');
    expect((freshResponse.outbound.text ?? '').toLowerCase()).not.toContain('otp');
    expect((freshResponse.outbound.text ?? '').toLowerCase()).not.toContain('código');
    expect(freshRuntime.composeRequests).toHaveLength(1);
    expect(freshRuntime.composeRequests[0]?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      reason: 'identity_rejected',
      handoffOutcome: 'handoff_requested',
    });
  });

  it.each(['not_found', 'empty'] as const)('answers a phone-scoped %s without handoff, OTP, or reply-model guessing', async (outcome) => {
    const runtime = new InformationRuntime([extraction([purchaseRequest(null)])]);
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    if (outcome === 'empty') {
      gateway.guestGiftResult = {
        status: 'success', resource: 'gift_purchases', purchases: [],
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

    // Read outcomes never authorize writes: the miss answers normally,
    // keeps the pending question, and never requests a code, a takeover,
    // or a terminal auth outcome.
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.guestGiftCalls).toBe(1);
    expect(provider.requestCodeCalls).toBe(0);
    expect(response.plan.user_auth.status).toBe('none');
    expect(runtime.composeRequests).toHaveLength(1);
    expect(gateway.takeoverCalls).toBe(0);
    expect(response.plan.human_escalation.status).toBe('none');
    expect(response.trace.tools_called).toContain('lookup_guest_gift_purchases_by_phone');
    expect(response.trace.tools_called).not.toContain('request_human_takeover');
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome ?? null).toBeNull();
    expect(runtime.composeRequests.at(-1)?.handoffOutcome ?? null).toBeNull();
    expect(response.plan.human_help_receipt).toBeUndefined();
    const repeated = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'phone-not-found-user',
      contactPhone: '+51973296571', text: 'No tengo cuenta',
      messageId: 'phone-not-found-2', receivedAt: new Date().toISOString(),
    });
    expect(gateway.takeoverCalls).toBe(0);
    expect(repeated.plan.human_escalation.status).toBe('none');
  });

  it.each(['not_found', 'empty'] as const)('answers a phone guest-event %s without handoff with the support details preserved', async (outcome) => {
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
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(provider.requestCodeCalls + provider.verifyCodeCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(gateway.takeoverCalls).toBe(0);
    expect(response.plan.human_escalation.status).toBe('none');
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome ?? null).toBeNull();
    expect(runtime.composeRequests.at(-1)?.handoffOutcome ?? null).toBeNull();
    expect(response.plan.human_help_receipt).toBeUndefined();
    expect(response.trace.tools_called).toContain('lookup_guest_events_by_phone');
  });

  it('keeps usable phone purchase context when another requested lookup has no event match', async () => {
    const runtime = new InformationRuntime([extraction([
      purchaseRequest(null),
      { kind: 'associated_event', query: 'Consulta de mi invitación.', eventHint: null },
    ])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [purchase('ORD-000880')] };
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
  });

  it('uses the trusted phone guest record before OTP when the phone has no account', async () => {
    const eventQuestion = extraction([{
      kind: 'associated_event',
      query: '¿Dónde y a qué hora es la recepción?',
      eventHint: null,
    }]);
    eventQuestion.rsvpEventReference = 'Boda Laura & Marcos';
    eventQuestion.actionIntent = 'responder_invitacion';
    eventQuestion.rsvpDecisionSource = 'current_message';
    eventQuestion.requestedOperation = 'event.detail.read';
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
    expect(response.trace.tools_called).toEqual(expect.arrayContaining([
      'lookup_guest_events_by_phone',
      'get_guest_event_detail',
    ]));
    expect(response.trace.tools_called).not.toContain('request_user_login_code');
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
  });

  it('falls back to email OTP without a phone API call when no trusted phone is usable', async () => {
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

    const unusableRuntime = new InformationRuntime([
      extraction([purchaseRequest(null)], null, 'fallback@example.com'),
    ]);
    const unusableGateway = new FakePurchaseGateway();
    const unusableProvider = providerGateway();
    const unusableService = createService({
      runtime: unusableRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: unusableGateway,
      providerGateway: unusableProvider,
    });

    const unusableResponse = await unusableService.handleTurn({
      channel: 'whatsapp',
      externalUserId: '51911111111',
      text: 'fallback@example.com',
      messageId: 'unusable-phone-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+5197329657',
    });

    expect(unusableGateway.authByPhoneCalls).toBe(0);
    expect(unusableGateway.updatePhoneCalls).toBe(0);
    expect(unusableProvider.requestCodeCalls).toBe(1);
    expect(unusableResponse.plan.user_auth.status).toBe('code_requested');
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
      gateway.guestOrdersResult = {
        status: 'success',
        resource: 'orders',
        purchases: [purchase('PHONE-SCOPED-ORDER')],
      };
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
        runtime,
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
    expect(success.gateway.ordersCalls).toBe(1);
    expect(success.gateway.giftCalls).toBe(1);
    expect(success.gateway.guestOrdersCalls).toBe(1);
    expect(success.gateway.guestGiftCalls).toBe(1);
    expect(success.runtime.composeRequests[0]?.customerContext?.identityAccess.authorizedScopes)
      .toEqual(['account', 'trusted_phone_purchase']);
    expect(success.runtime.composeRequests[0]?.customerContext?.purchases.map((entry) => entry.orderId))
      .toContain('PHONE-SCOPED-ORDER');

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
    expect(purchaseGateway.lastToken).toBe('shared-jwt');
    expect(second.plan.user_auth.status).toBe('authenticated');
  });

  it('hands off on the first missing-code report without resending for purchase and event requests', async () => {
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

    const eventRuntime = new InformationRuntime([
      extraction([{
        kind: 'associated_event',
        query: '¿La restricción de vestir de blanco aplica a mujeres y varones?',
        eventHint: 'Karem y Alfredo',
        authAction: 'report_otp_not_received',
      }]),
    ]);
    const eventStore = new InMemoryPlanStore();
    await eventStore.save({
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
    const eventService = createService({
      runtime: eventRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: new FakePurchaseGateway(),
      providerGateway: providerGateway(),
      planStore: eventStore,
    });

    const eventResponse = await eventService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'associated-event-otp-user',
      text: 'No me ha llegado',
      messageId: 'associated-event-otp-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(eventResponse.plan.current_node).toBe('solicitar_agente_humano');
    expect(eventResponse.plan.human_escalation.status).toBe('requested');
    expect(eventResponse.trace.tools_called).toContain('request_human_takeover');
    expect(eventResponse.plan.user_auth).toMatchObject({
      status: 'code_requested',
      otp_send_attempts: 1,
    });
    expect(eventResponse.plan.information_state.pending_requests).toEqual([
      expect.objectContaining({
        kind: 'associated_event',
        query: '¿La restricción de vestir de blanco aplica a mujeres y varones?',
      }),
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
    gateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
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
    expect(response.plan.human_escalation.status).toBe('none');
    expect(response.outbound.text).not.toContain('correo');
    expect(response.outbound.text).not.toContain('código');
  });

  it('honors an explicit verification refusal by closing protected work without another prompt', async () => {
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
    expect(response.outbound.text).toBe('Respuesta informativa.');
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'declined',
      reason: 'authentication_declined',
      protectedRequestsClosed: true,
      publicInformationRequestsRemaining: 0,
      noFurtherCredentialRequests: true,
    });

    const protectedRequest = { ...purchaseRequest(null), requestId: 'purchase-1' };
    const unrelatedFaq = {
      kind: 'faq' as const,
      query: '¿Cuánto demora la validación general?',
      requestId: 'faq-1',
    };
    const declinedSeededRequest = { ...protectedRequest, authAction: 'decline_authentication' as const };
    const faqStore = new InMemoryPlanStore();
    await faqStore.save({
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
    const faqRuntime = new InformationRuntime([extraction([declinedSeededRequest])]);
    const faqGateway = new FakePurchaseGateway();
    const faqProvider = providerGateway();
    const faqService = createService({
      runtime: faqRuntime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: faqGateway,
      providerGateway: faqProvider,
      planStore: faqStore,
    });

    const faqResponse = await faqService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'declined-auth-preserve-faq',
      text: 'No quiero continuar con la verificación.',
      messageId: 'declined-auth-preserve-faq-1',
      receivedAt: new Date().toISOString(),
    });

    expect(faqResponse.plan.information_state.pending_requests).toEqual([unrelatedFaq]);
    expect(faqResponse.plan.user_auth.status).toBe('none');
    expect(faqResponse.outbound.text).toBe('Respuesta informativa.');
    expect(faqRuntime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'declined',
      protectedRequestsClosed: true,
      publicInformationRequestsRemaining: 1,
    });
    expect(faqGateway.authByPhoneCalls).toBe(0);
    expect(faqProvider.requestCodeCalls).toBe(0);
  });

  it('stops the repeated OTP loop from the reported gift-deposit interaction', async () => {
    const purchase = purchaseRequest(null);
    purchase.query =
      'Confirmar si el depósito del regalo llegó a los novios y revisar el estado del pago.';
    const codeAttempt = purchaseRequest(null);
    codeAttempt.query = purchase.query;
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

    // Each terminal handoff is model-composed from the typed access result.
    expect(runtime.composeRequests).toHaveLength(2);
    expect(runtime.composeRequests.at(-1)?.authenticationOutcome).toMatchObject({
      status: 'terminal',
      // C1: terminal escalation retains pending protected requests.
      protectedRequestsClosed: false,
    });
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

  it('executes information requests immediately when a turn also carries a bare provider action intent', async () => {
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
    // Accountless preemption repair: a bare actionIntent (typed
    // rsvpAction/closeAction/candidate absent) never preempts the lookup,
    // so the FAQ executes immediately and nothing persists as pending.
    expect(response.plan.information_state.pending_requests).toHaveLength(0);
    expect(knowledgeGateway.calls).toBe(1);
    expect(runtime.composeRequests.at(-1)?.informationResults).toEqual([
      expect.objectContaining({ kind: 'faq', status: 'completed' }),
    ]);
    expect(runtime.composeRequests.at(-1)?.errorMessage).toBeNull();
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
});

describe('event entity threads: explicit switches keep their own identity', () => {
  it('starts a separate thread for an explicit different event instead of blending hints', async () => {
    // Live event_context_long_thread turn 1: after asking when Marta occurs,
    // the extractor resolves "¿Y la Boda Ana y Luis?" to a self-sufficient
    // query carrying the inherited date/time aspect with the explicit Boda
    // entity. The Boda question must complete on its own thread while the
    // still-open Marta thread stays intact under its own hint and id.
    const runtime = new InformationRuntime([extraction([{
      kind: 'associated_event',
      query: '¿Cuándo es la Boda Ana y Luis?',
      eventHint: 'Boda Ana y Luis',
    }])]);
    const gateway = new FakePurchaseGateway();
    gateway.guestEventsResult = {
      status: 'success',
      events: [
        {
          eventId: 90,
          name: 'Cumpleaños Marta',
          slug: 'cumpleanos-marta',
          url: null,
          datetime: '21/09/2026 19:00',
          type: 'birthday',
          typeDetail: null,
          stage: 'published',
          city: 'Lima',
          country: 'Perú',
          currency: 'PEN',
        },
        {
          eventId: 91,
          name: 'Boda Ana y Luis',
          slug: 'boda-ana-luis',
          url: null,
          datetime: '20/09/2026 18:00',
          type: 'wedding',
          typeDetail: null,
          stage: 'published',
          city: 'Lima',
          country: 'Perú',
          currency: 'PEN',
        },
      ],
    };
    // Detail reads stay unavailable so both threads keep their pending
    // identity: the twin proves thread separation, not fact content.
    gateway.eventDetailResult = { status: 'not_found' };
    const planStore = new InMemoryPlanStore();
    await planStore.save({
      reason: 'seed-marta-thread',
      plan: mergePlan(
        createEmptyPlan({
          planId: 'event-thread-plan',
          channel: 'whatsapp',
          externalUserId: 'event-thread-user',
        }),
        {
          current_node: 'resolver_consultas_informativas',
          information_state: {
            resume_node: 'entrevista',
            pending_requests: [{
              requestId: 'information-1',
              kind: 'associated_event',
              query: '¿Cuándo es el Cumpleaños Marta?',
              eventHint: 'Cumpleaños Marta',
            }],
            selection_candidates: [],
            last_completed_request: null,
          },
        },
      ),
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
      externalUserId: 'event-thread-user',
      text: '¿Y la Boda Ana y Luis?',
      contactPhone: '+51941438999',
      messageId: 'event-thread-1',
      receivedAt: new Date().toISOString(),
    });

    expect(gateway.guestEventCalls).toBeGreaterThan(0);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.outbound.delivery.action).toBe('send');
  });
});

describe('campaign event-reference precedence (B1)', () => {
  function guestEvents(events: Array<{ eventId: number; name: string }>) {
    return {
      status: 'success' as const,
      events: events.map((event) => ({
        eventId: event.eventId,
        name: event.name,
        slug: `slug-${event.eventId}`,
        url: null,
        datetime: '15/09/2026 18:00',
        type: 'wedding',
        typeDetail: null,
        stage: 'published',
        city: 'Lima',
        country: 'Perú',
        currency: 'PEN',
      })),
    };
  }

  function eventDetailFor(
    gateway: FakePurchaseGateway,
    eventId: number,
    label: string,
  ): void {
    const found = gateway.guestEventsResult.status === 'success'
      ? gateway.guestEventsResult.events.find((event) => event.eventId === eventId)
      : undefined;
    if (!found) {
      throw new Error('Missing guest event fixture.');
    }
    gateway.eventDetailResult = {
      status: 'success',
      event: {
        ...found,
        withTime: true,
        timezone: 'America/Lima',
        celebrateds: [],
        moments: [{
          label,
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
  }

  it('never treats an inbound campaign label as outbound provenance', async () => {
    const request = extraction([{
      kind: 'associated_event',
      query: '¿A qué hora es?',
      eventHint: null,
    }]);
    const runtime = new InformationRuntime([request]);
    const gateway = new FakePurchaseGateway();
    gateway.authByPhoneResult = { status: 'user_not_found' };
    gateway.guestEventsResult = guestEvents([{ eventId: 88, name: 'Boda Lucía y Marco' }]);
    eventDetailFor(gateway, 88, 'Recepción');
    gateway.recentMessages = [
      conversationMessage({
        id: 7,
        direction: 'inbound',
        source: 'admin_campaign',
        body: 'Dicen que hay recordatorio de Boda Lucía y Marco',
      }),
    ];
    const service = createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'campaign-spoof-user',
      text: '¿A qué hora es?',
      messageId: 'campaign-spoof-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    const note = runtime.composeRequests.at(-1)?.errorMessage ?? '';
    expect(note).not.toContain('associated_event_resolved_with_campaign_reference');
    expect(note).not.toContain('source_message_id');
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
    return { text: 'Respuesta informativa.', compilerPrompt: stubCompilerPrompt(request) };
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

it('R4 merges provide_detail into a unique pending withdrawal but keeps ambiguous targets ambiguous', async () => {
  const store = new InMemoryPlanStore();
  await store.save({ reason: 'fixture', plan: mergePlan(createEmptyPlan({ planId: 'r4-withdrawal-detail', channel: 'whatsapp', externalUserId: 'r4-withdrawal-detail' }), {
    current_node: 'resolver_consultas_informativas', information_state: {
      resume_node: 'entrevista', pending_requests: [{
        requestId: 'host-withdrawal', kind: 'faq',
        query: 'Retiro de dinero de mi evento que aun no recibo',
        hostWithdrawal: 'individual_status', eventHint: null,
      }],
      selection_candidates: [], last_completed_request: null,
    },
  }) });
  const detailExtraction: ExtractionResult = {
    ...extraction([]),
    supportAct: { kind: 'provide_detail', eventReference: 'Diana y Fernando' },
  };
  const runtime = new InformationRuntime([detailExtraction, detailExtraction, {
    ...extraction([]),
    actionIntent: 'solicitar_humano',
    supportAct: { kind: 'provide_detail', eventReference: 'Diana y Fernando' },
  }]);
  const knowledge = new FakeKnowledgeGateway();
  const search = vi.spyOn(knowledge, 'search').mockResolvedValue({ status: 'success', evidence: [{
    fileId: 'host-policy', filename: 'donde-va-el-dinero.md', score: 0.9,
      fullArticle: true, sourceUrl: 'https://sinenvolturas.tawk.help/article/donde-va-el-dinero',
    text: 'template_status: "Vigente"\nLas solicitudes se procesan en hasta 72 horas hábiles.',
  }] });
  const gateway = new FakePurchaseGateway();
  const service = createService({ runtime, knowledgeGateway: knowledge, purchaseGateway: gateway, providerGateway: providerGateway(), planStore: store });
  const result = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'r4-withdrawal-detail', contactPhone: '+51999999999',
    text: 'Evento: Diana y Fernando', messageId: 'r4-event', receivedAt: new Date().toISOString() });
  expect(search).toHaveBeenCalledTimes(1);
  expect(gateway.takeoverCalls).toBe(1);
  expect(result.plan.information_state.pending_requests).toHaveLength(1);
  expect(result.plan.information_state.pending_requests[0]).toMatchObject({
    requestId: 'host-withdrawal', kind: 'faq', hostWithdrawal: 'individual_status', eventHint: 'Diana y Fernando',
  });
  const compose = runtime.composeRequests[0];
  expect(compose?.informationResults?.[0]).toMatchObject({ kind: 'faq', status: 'completed', hostWithdrawalPolicy: { maxBusinessHours: 72 } });
  expect(compose?.handoffOutcome).toBe('handoff_requested');
  expect(result.plan.human_help_receipt?.outcome).toBe('handoff_requested');
  const firstReceiptAt = result.plan.human_help_receipt?.updatedAt ?? null;
  await service.handleTurn({ channel: 'whatsapp', externalUserId: 'r4-withdrawal-detail', contactPhone: '+51999999999',
    text: 'Evento: Diana y Fernando', messageId: 'r4-event-again', receivedAt: new Date().toISOString() });
  expect(gateway.takeoverCalls).toBe(1);
  // A fresh explicit human re-request after the persisted success reuses the
  // receipt: no second dispatch, the original request time stands, and the
  // outcome still reports the confirmed handoff.
  const rerequest = await service.handleTurn({ channel: 'whatsapp', externalUserId: 'r4-withdrawal-detail', contactPhone: '+51999999999',
    text: 'Necesito un agente humano', messageId: 'r4-event-human-again', receivedAt: new Date().toISOString() });
  expect(gateway.takeoverCalls).toBe(1);
  expect(rerequest.plan.human_help_receipt?.outcome).toBe('handoff_requested');
  expect(rerequest.plan.human_help_receipt?.updatedAt).toBe(firstReceiptAt);

  const ambiguousStore = new InMemoryPlanStore();
  await ambiguousStore.save({ reason: 'fixture', plan: mergePlan(createEmptyPlan({ planId: 'r4-ambiguous', channel: 'whatsapp', externalUserId: 'r4-ambiguous' }), {
    current_node: 'resolver_consultas_informativas', information_state: {
      resume_node: 'entrevista', pending_requests: [
        { requestId: 'host-a', kind: 'faq', query: 'Retiro evento A', hostWithdrawal: 'individual_status', eventHint: null },
        { requestId: 'host-b', kind: 'faq', query: 'Retiro evento B', hostWithdrawal: 'individual_status', eventHint: null },
      ],
      selection_candidates: [], last_completed_request: null,
    },
  }) });
  const ambiguousRuntime = new InformationRuntime([{
    ...extraction([]),
    supportAct: { kind: 'provide_detail', eventReference: 'Diana y Fernando' },
  }]);
  const ambiguousGateway = new FakePurchaseGateway();
  const ambiguousService = createService({ runtime: ambiguousRuntime, knowledgeGateway: new FakeKnowledgeGateway(), purchaseGateway: ambiguousGateway, providerGateway: providerGateway(), planStore: ambiguousStore });
  await ambiguousService.handleTurn({ channel: 'whatsapp', externalUserId: 'r4-ambiguous', contactPhone: '+51999999999',
    text: 'Evento: Diana y Fernando', messageId: 'r4-amb', receivedAt: new Date().toISOString() });
  expect(ambiguousGateway.takeoverCalls).toBe(0);
});

describe('gift root-cause review: discovery, detail and honest coverage', () => {
  function ordersRequest(): Extract<ExtractedInformationRequest, { kind: 'purchase' }> {
    return {
      kind: 'purchase',
      resource: 'orders',
      query: 'Estado del pedido.',
      orderId: null,
      authAction: 'none',
    };
  }

  class OrderIdRecordingGateway extends FakePurchaseGateway {
    public readonly giftOrderIds: Array<string | null | undefined> = [];
    public readonly ordersOrderIds: Array<string | null | undefined> = [];
    public giftByOrderId:
      | ((orderId: string | null | undefined) => AgentPhonePurchaseLookupResult)
      | null = null;

    override async getGuestGiftPurchasesByPhone(args?: {
      phone_extension: string;
      phone_number: string;
      orderId?: string | null;
    }): Promise<AgentPhonePurchaseLookupResult> {
      this.guestGiftCalls += 1;
      const orderId = args?.orderId;
      this.giftOrderIds.push(orderId);
      if (this.giftByOrderId) return this.giftByOrderId(orderId);
      return this.guestGiftResult;
    }

    override async getGuestOrdersByPhone(args?: {
      phone_extension: string;
      phone_number: string;
      orderId?: string | null;
    }): Promise<AgentPhonePurchaseLookupResult> {
      this.guestOrdersCalls += 1;
      this.ordersOrderIds.push(args?.orderId);
      return this.guestOrdersResult;
    }
  }

  function purchaseRoute(result: { kind: string }): string | undefined {
    if (result.kind !== 'purchase') return undefined;
    const record = result as { lookupResource?: string; resource?: string; status?: string };
    if (typeof record.lookupResource === 'string') return record.lookupResource;
    return record.status === 'completed' ? record.resource : undefined;
  }

  function turnInput(externalUserId: string, text: string, messageId: string) {
    return {
      channel: 'whatsapp',
      externalUserId,
      contactPhone: '+51973296571',
      text,
      messageId,
      receivedAt: new Date().toISOString(),
    } as const;
  }

  it('opens no purchase lookup for a non-receipt image with no task', async () => {
    const runtime = new InformationRuntime([extraction([])]);
    const gateway = new OrderIdRecordingGateway();
    const service = createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: providerGateway(),
    });
    await service.handleTurn(turnInput('non-receipt', 'Mira esta foto del local.', 'non-receipt-1'));
    expect(gateway.takeoverCalls).toBe(0);
  });

  it('preserves ready facts when the same-turn gift follow-up fails', async () => {
    const runtime = new InformationRuntime([extraction([ordersRequest()])]);
    const gateway = new OrderIdRecordingGateway();
    gateway.guestOrdersResult = {
      status: 'success', resource: 'orders', purchases: [purchase('ORD-000880')],
    };
    gateway.giftByOrderId = () => ({ status: 'retryable_failure', resource: 'gift_purchases', retryable: true, error: 'HTTP 500' });
    const service = createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: providerGateway(),
    });
    const response = await service.handleTurn(turnInput('gift-followfail', '¿Dejaron dedicatoria en mi regalo?', 'gift-followfail-1'));

    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(1);
    // Ready orders facts survive; the failure never becomes a handoff or
    // a "gift does not exist" verdict.
    const info = runtime.composeRequests[0]?.informationResults ?? [];
    const orders = info.find((result) => purchaseRoute(result) === 'orders');
    expect(orders?.status).toBe('completed');
    expect(gateway.takeoverCalls).toBe(0);
    expect(response.plan.human_escalation.status).toBe('none');
  });

  it('retains mixed gift amounts and fulfillment from service to projected model input', async () => {
    const mixed: PurchaseInformation = {
      ...purchase('GIFT-MIX-9'),
      grandTotal: 230,
      currency: null,
      paymentStatus: 'approved',
      paymentMethod: 'Transferencia',
      eventName: 'Boda Lucía y Marco',
      items: [
        { giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' },
        { giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' },
      ],
    };
    const giftRequest: Extract<ExtractedInformationRequest, { kind: 'purchase' }> = {
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llegan mis regalos?',
      orderId: null,
      authAction: 'none',
    };
    const runtime = new InformationRuntime([extraction([giftRequest])]);
    const gateway = new OrderIdRecordingGateway();
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [mixed] };
    const service = createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: providerGateway(),
    });
    await service.handleTurn(turnInput('gift-mixed', 'Compré dos regalos para la boda. ¿Cuándo llegan?', 'gift-mixed-1'));
    const info = runtime.composeRequests[0]?.informationResults ?? [];
    const gift = info.find((result) => purchaseRoute(result) === 'gift_purchases');
    if (!gift || gift.status !== 'completed' || gift.kind !== 'purchase') {
      throw new Error('Expected a completed gift purchase result.');
    }
    expect(gift.purchases[0]?.items.map((item) => [item.amount, item.quantity, item.rowTotal])).toEqual([
      [150, 1, 150],
      [80, 1, 80],
    ]);
    expect(gift.purchases[0]?.items.map((item) => item.fulfillment?.kind)).toEqual(['physical', 'host_credit']);
  });

  it('serializes service-produced mixed gifts into the real reply input with per-item meaning', async () => {
    const mixed: PurchaseInformation = {
      ...purchase('GIFT-MIX-9'),
      grandTotal: 230,
      currency: null,
      paymentStatus: 'approved',
      paymentMethod: 'Transferencia',
      eventName: 'Boda Lucía y Marco',
      items: [
        { giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' },
        { giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' },
      ],
    };
    const giftRequest: Extract<ExtractedInformationRequest, { kind: 'purchase' }> = {
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Cuándo llegan mis regalos?',
      orderId: null,
      authAction: 'none',
    };
    const runtime = new InformationRuntime([extraction([giftRequest])]);
    const gateway = new OrderIdRecordingGateway();
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [mixed] };
    const service = createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: providerGateway(),
    });
    await service.handleTurn(turnInput('gift-mixed-spec', 'Compré dos regalos para la boda. ¿Cuándo llegan?', 'gift-mixed-spec-1'));
    const compose = runtime.composeRequests[0];
    if (!compose) throw new Error('Expected a composed reply request.');
    const realRuntime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {
        async searchProviders(): Promise<never> {
          throw new Error('must not call the provider gateway');
        },
      } as never,
    });
    const spec = await realRuntime.buildReplyRequestSpec(compose);
    const input = JSON.stringify(spec.input);
    expect(input).toContain('Juego de sábanas');
    expect(input).toContain('150');
    expect(input).toContain('Aporte luna de miel');
    expect(input).toContain('80');
    expect(input).toContain('host_credit');
  });

  it('delivers hinted honeymoon facts to the real reply input without erasing the record', async () => {
    // Work 1 (2026-09-22): the extractor emits a descriptive eventHint
    // ("luna de miel", a gift description) plus an item amount (80) against
    // one authorized pending 230 order. The backend must retain the record
    // so pending/type/item facts reach the production reply input.
    const mixed: PurchaseInformation = {
      ...purchase('GIFT-HONEY-9'),
      grandTotal: 230,
      currency: null,
      paymentStatus: 'pending',
      paymentMethod: 'Transferencia',
      eventName: 'Boda Lucía y Marco',
      items: [
        { giftName: 'Juego de sábanas', quantity: 1, amount: 150, rowTotal: 150, type: 'se_store' },
        { giftName: 'Aporte luna de miel', quantity: 1, amount: 80, rowTotal: 80, type: 'credit' },
      ],
    };
    const giftRequest: Extract<ExtractedInformationRequest, { kind: 'purchase' }> = {
      kind: 'purchase',
      resource: 'gift_purchases',
      query: '¿Dónde está mi aporte de luna de miel de 80?',
      orderId: null,
      eventHint: 'luna de miel',
      amount: 80,
      authAction: 'none',
    };
    const runtime = new InformationRuntime([extraction([giftRequest])]);
    const gateway = new OrderIdRecordingGateway();
    gateway.guestGiftResult = { status: 'success', resource: 'gift_purchases', purchases: [mixed] };
    const service = createService({
      runtime, knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway, providerGateway: providerGateway(),
    });
    const response = await service.handleTurn(turnInput('gift-honeymoon-spec', '¿Dónde está mi aporte de luna de miel de 80?', 'gift-honeymoon-spec-1'));
    expect(gateway.authByPhoneCalls).toBe(0);
    expect(gateway.takeoverCalls).toBe(0);
    expect(response.plan.human_escalation.status).toBe('none');
    expect(runtime.composeRequests).toHaveLength(1);
    const info = runtime.composeRequests[0]?.informationResults ?? [];
    const gift = info.find((result) => purchaseRoute(result) === 'gift_purchases');
    if (!gift || gift.status !== 'completed' || gift.kind !== 'purchase') {
      throw new Error('Expected a completed gift purchase result.');
    }
    expect(gift.purchases).toHaveLength(1);
    expect(gift.purchases[0]?.paymentStatus).toBe('pending');
    const compose = runtime.composeRequests[0];
    if (!compose) throw new Error('Expected a composed reply request.');
    const realRuntime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {
        async searchProviders(): Promise<never> {
          throw new Error('must not call the provider gateway');
        },
      } as never,
    });
    const spec = await realRuntime.buildReplyRequestSpec(compose);
    const input = JSON.stringify(spec.input);
    expect(input).toContain('Boda Lucía y Marco');
    expect(input).toContain('pending');
    expect(input).toContain('Juego de sábanas');
    expect(input).toContain('150');
    expect(input).toContain('Aporte luna de miel');
    expect(input).toContain('80');
  });

  it('delivers retrieved schedule text to the reply input without loss', async () => {
    // Real text of the stable Horarios y canales de atención source
    // article (fetched 2026-09-21); the stub proves projection delivery,
    // never invented hours.
    const articleText = 'Nuestros horarios de atención son: Lunes a sábado. ' +
      'Turno mañana: de 9:30 a.m. a 1:30 p.m. Turno tarde: de 3:30 p.m. a 7:30 p.m. ' +
      'Te recomendamos escribirnos dentro de estos horarios para una respuesta más rápida.';
    class ScheduleKnowledgeGateway extends FakeKnowledgeGateway {
      override async search(): Promise<KnowledgeRetrievalResult> {
        this.calls += 1;
        return {
          status: 'success',
          evidence: [{
            fileId: 'file-horarios',
            filename: 'horarios-y-canales-de-atención.md',
            score: 0.98,
            text: articleText,
          }],
        };
      }
    }
    const faqRequest: Extract<ExtractedInformationRequest, { kind: 'faq' }> = {
      kind: 'faq',
      query: '¿Cuál es el horario de atención?',
    };
    const runtime = new InformationRuntime([extraction([faqRequest])]);
    const service = createService({
      runtime,
      knowledgeGateway: new ScheduleKnowledgeGateway(),
      purchaseGateway: new OrderIdRecordingGateway(),
      providerGateway: providerGateway(),
    });
    await service.handleTurn(turnInput('faq-hours', '¿Cuál es el horario de atención?', 'faq-hours-1'));
    const compose = runtime.composeRequests[0];
    if (!compose) throw new Error('Expected a composed reply request.');
    const realRuntime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {
        async searchProviders(): Promise<never> {
          throw new Error('must not call the provider gateway');
        },
      } as never,
    });
    const spec = await realRuntime.buildReplyRequestSpec(compose);
    const input = JSON.stringify(spec.input);
    expect(input).toContain('9:30 a.m.');
    expect(input).toContain('1:30 p.m.');
    expect(input).toContain('3:30 p.m.');
    expect(input).toContain('7:30 p.m.');
    expect(input).toContain('Lunes a sábado');
  });
});

describe('source discovery information flow', () => {
  function discoveryExtraction(query: string): ExtractionResult {
    return extraction([{
      kind: 'purchase',
      resource: 'purchase_discovery',
      query,
      orderId: null,
      authAction: 'none',
    }], null, null, null);
  }

  function discoveryService(
    runtime: InformationRuntime,
    gateway: FakePurchaseGateway,
  ): AgentService {
    return createService({
      runtime,
      knowledgeGateway: new FakeKnowledgeGateway(),
      purchaseGateway: gateway,
      providerGateway: providerGateway(),
    });
  }

  function olderAndNewerGateway(): FakePurchaseGateway {
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [{ ...purchase('ORD-NEWER'), eventName: 'Baby Shower Catalina' }],
    };
    gateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [{ ...purchase('ORD-OLDER'), eventName: 'Aniversario Lucia' }],
    };
    return gateway;
  }

  it.each([
    {
      label: 'matched',
      firstReference: '301816',
      secondReference: '301817',
      expectedOrders: ['ORD-A'],
      expectedSelection: false,
    },
    {
      label: 'unavailable',
      firstReference: '301817',
      secondReference: '301818',
      expectedOrders: ['ORD-A', 'ORD-B'],
      expectedSelection: true,
    },
  ])('carries a standalone customer reference after structured purchase extraction: $label', async (world) => {
    const runtime = new InformationRuntime([discoveryExtraction('Consulta de compra')]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [
        { ...purchase('ORD-A'), customerTransactionNumber: world.firstReference,
          eventName: 'Evento de prueba A', eventDate: '2026-09-12', createdAt: '2026-09-03' },
        { ...purchase('ORD-B'), customerTransactionNumber: world.secondReference,
          eventName: 'Evento de prueba B', eventDate: '2026-08-22', createdAt: '2026-08-20' },
      ],
    };
    const service = discoveryService(runtime, gateway);

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: `customer-reference-${world.label}`,
      text: 'COD301816',
      messageId: `customer-reference-${world.label}-1`,
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    const composed = runtime.composeRequests.at(-1);
    const result = composed?.informationResults?.[0];
    if (result?.kind !== 'purchase' || result.status !== 'completed') {
      throw new Error('Expected a completed purchase result.');
    }
    expect(composed?.extraction.informationRequests).toMatchObject([
      { kind: 'purchase', orderId: '301816' },
    ]);
    expect(result.requestedCustomerTransactionNumber).toBe('301816');
    expect(result.referenceResolution).toBe(world.label);
    expect(result.purchases.map((entry) => entry.orderId)).toEqual(world.expectedOrders);
    expect(result.needsSelection).toBe(world.expectedSelection);
    expect(composed?.customerContext?.purchases.map((entry) => entry.orderId).sort()).toEqual([
      'ORD-A', 'ORD-B',
    ]);
    expect(composed?.customerContext?.purchases.map((entry) => entry.customerTransactionNumber).sort()).toEqual([
      world.firstReference, world.secondReference,
    ].sort());
    expect(gateway.guestOrdersCalls).toBe(1);
  });

  // Row 4: explicit named old event plus a newer record — both retained,
  // explicit context intact, mutation IDs never inferred, across hint shapes.
  it('retains both discovery records across explicit, amount, and unhinted requests', async () => {
    const runtime = new InformationRuntime([{
      ...discoveryExtraction('Consulta por Aniversario Lucia. ¿Ese pedido sigue pendiente?'),
      informationRequests: [{
        kind: 'purchase',
        resource: 'purchase_discovery',
        query: 'Consulta por Aniversario Lucia. ¿Ese pedido sigue pendiente?',
        orderId: null,
        eventHint: 'Aniversario Lucia',
        authAction: 'none',
      }],
    }]);
    const gateway = olderAndNewerGateway();
    const service = discoveryService(runtime, gateway);

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'explicit-older-user',
      text: 'Consulta por Aniversario Lucia. ¿Ese pedido sigue pendiente?',
      messageId: 'explicit-older-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBe(1);
    const completed = runtime.composeRequests.at(-1)?.informationResults?.[0];
    expect(completed).toMatchObject({ status: 'completed', kind: 'purchase' });
    if (completed?.status !== 'completed' || completed.kind !== 'purchase') {
      throw new Error('expected the discovery read to complete');
    }
    // Both facts retained: the explicit older record and the newer one.
    expect(completed.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-NEWER', 'ORD-OLDER'],
    );
    // Contract revision (Lane B count-driven selection): multiplicity
    // alone completes the read, so the explicit context needs no pending
    // request and no selection candidates. The completed result carries
    // both records plus the explicit event hint for read reasoning.
    expect(completed.needsSelection).toBe(false);
    expect(response.plan.information_state.pending_requests).toEqual([]);
    expect(response.plan.information_state.selection_candidates).toEqual([]);
    expect(gateway.takeoverCalls).toBe(0);

    const amountRuntime = new InformationRuntime([{
      ...discoveryExtraction('¿Cuánto fue lo que me regalaron?'),
      informationRequests: [{
        kind: 'purchase',
        resource: 'purchase_discovery',
        query: '¿Cuánto fue lo que me regalaron?',
        orderId: null,
        amount: 250,
        authAction: 'none',
      }],
    }]);
    const amountGateway = olderAndNewerGateway();
    const amountService = discoveryService(amountRuntime, amountGateway);

    await amountService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'same-amount-user',
      text: '¿Cuánto fue lo que me regalaron?',
      messageId: 'same-amount-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(amountGateway.guestOrdersCalls).toBe(1);
    expect(amountGateway.guestGiftCalls).toBe(1);
    const amountCompleted = amountRuntime.composeRequests.at(-1)?.informationResults?.[0];
    if (amountCompleted?.status !== 'completed' || amountCompleted.kind !== 'purchase') {
      throw new Error('expected the discovery read to complete');
    }
    expect(amountCompleted.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-NEWER', 'ORD-OLDER'],
    );
    // Contract revision (Lane B count-driven selection): multiplicity
    // preserved as multiplicity means both records stay visible with no
    // single ID inferred and no selection flag. The reply distinguishes
    // the alternatives from the retained evidence.
    expect(amountCompleted.needsSelection).toBe(false);
    expect(amountGateway.takeoverCalls).toBe(0);

    const laneRuntime = new InformationRuntime([
      discoveryExtraction('Consulta por Aniversario Lucia. ¿Ese pedido sigue pendiente?'),
    ]);
    const laneGateway = olderAndNewerGateway();
    const laneService = discoveryService(laneRuntime, laneGateway);

    const laneResponse = await laneService.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'explicit-older-laneb-user',
      text: 'Consulta por Aniversario Lucia. ¿Ese pedido sigue pendiente?',
      messageId: 'explicit-older-laneb-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(laneGateway.guestOrdersCalls).toBe(1);
    expect(laneGateway.guestGiftCalls).toBe(1);
    const laneCompleted = laneRuntime.composeRequests.at(-1)?.informationResults?.[0];
    if (laneCompleted?.status !== 'completed' || laneCompleted.kind !== 'purchase') {
      throw new Error('expected the explicit older discovery read to complete');
    }
    expect(laneCompleted.purchases.map((purchase) => purchase.orderId).sort()).toEqual(
      ['ORD-NEWER', 'ORD-OLDER'],
    );
    expect(laneCompleted.needsSelection).toBe(false);
    expect(laneResponse.plan.information_state.pending_requests).toEqual([]);
    expect(laneResponse.plan.information_state.selection_candidates).toEqual([]);
    expect(laneGateway.takeoverCalls).toBe(0);
  });

  // Lane B negative control: an explicit validated-reference mismatch still
  // holds the asking state (pending request plus selection candidates).
  it('holds selection state on an explicit validated-reference mismatch', async () => {
    const runtime = new InformationRuntime([{
      ...discoveryExtraction('Estado del pedido COD999999.'),
      informationRequests: [{
        kind: 'purchase',
        resource: 'purchase_discovery',
        query: 'Estado del pedido COD999999.',
        orderId: 'COD999999',
        authAction: 'none',
      }],
    }]);
    const gateway = olderAndNewerGateway();
    const service = discoveryService(runtime, gateway);

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'explicit-mismatch-user',
      text: 'Estado del pedido COD999999.',
      messageId: 'explicit-mismatch-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    const completed = runtime.composeRequests.at(-1)?.informationResults?.[0];
    if (completed?.status !== 'completed' || completed.kind !== 'purchase') {
      throw new Error('expected the mismatch discovery read to retain scope');
    }
    expect(completed.referenceResolution).toBe('unavailable');
    expect(completed.needsSelection).toBe(true);
    expect(response.plan.information_state.pending_requests.length).toBeGreaterThan(0);
    expect(
      response.plan.information_state.selection_candidates.flatMap((candidate) => candidate.orders),
    ).not.toHaveLength(0);
    expect(gateway.takeoverCalls).toBe(0);
  });

  // Lane B: a physical gift read without shipping details attempts no
  // handoff on the read turn; the typed outcome travels without an effect.
  it('reads a shipment-unknown physical gift without a handoff attempt', async () => {
    const runtime = new InformationRuntime([
      extraction([purchaseRequest(null)], null, null, null),
    ]);
    const gateway = new FakePurchaseGateway();
    gateway.guestOrdersResult = { status: 'not_found', resource: 'orders', orderId: null };
    gateway.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [{
        ...purchase('GIFT-PHYSICAL-1'),
        paymentStatus: 'approved',
        shippingStatus: null,
        eventName: 'Boda Lucía y Marco',
      }],
    };
    const service = discoveryService(runtime, gateway);

    await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'physical-unknown-user',
      text: '¿Cuándo llega mi regalo físico?',
      messageId: 'physical-unknown-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51973296571',
    });

    expect(gateway.takeoverCalls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.handoffOutcome ?? null).toBeNull();
  });

});
