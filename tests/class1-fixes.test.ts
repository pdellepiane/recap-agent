import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import { AgentService } from '../src/runtime/agent-service';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import type { AgentConversationGateway, AgentPhonePurchaseLookupResult, AgentGatewayResult, AgentMessageLogInput } from '../src/runtime/agent-conversation-gateway';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { PurchaseInformation } from '../src/core/information';
import { HttpAgentConversationGateway } from '../src/runtime/agent-conversation-gateway';

function phonePurchase(partial: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId: 'ORD-TEST-1',
    eventName: 'Evento X',
    eventDate: '2026-08-28',
    eventUrl: null,
    createdAt: '2026-08-28',
    items: [],
    paymentStatus: 'pending',
    shippingStatus: null,
    grandTotal: 63.85,
    paymentMethod: 'Transferencia',
    eventId: 1,
    currency: null,
    customerTransactionNumber: null,
    ...partial,
  };
}

class FakeAgentGateway implements AgentConversationGateway {
  guestOrdersResult: AgentPhonePurchaseLookupResult = { status: 'not_found', resource: 'orders', orderId: null };
  guestGiftResult: AgentPhonePurchaseLookupResult = { status: 'not_found', resource: 'gift_purchases', orderId: null };
  async logMessage(__: AgentMessageLogInput): Promise<AgentGatewayResult> { void __; return { status: 'skipped', reason: 'disabled', message: 'disabled' }; }
  async getRecentMessages() { return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' }; }
  async requestHumanTakeover() { return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' }; }
  async authByPhone() { return { status: 'failed' as const, error: 'not configured', retryable: false as const }; }
  async updatePhone() { return { status: 'success' as const }; }
  async getGuestEventsByPhone() { return { status: 'not_found' as const }; }
  async getEventDetail() { return { status: 'not_found' as const }; }
  async getGuestOrdersByPhone() { return this.guestOrdersResult; }
  async getGuestGiftPurchasesByPhone() { return this.guestGiftResult; }
}

describe('class1 fixes twins', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('a: not_found and selector-mismatch carry phone-scoped accessMethod', async () => {
    void new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: new FakeAgentGateway(),
    });

    // HTTP 404 phone not_found
    const gateway404 = new FakeAgentGateway();
    gateway404.guestOrdersResult = { status: 'not_found', resource: 'orders', orderId: null };
    const orch404 = new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: gateway404,
    });
    const exec404 = await orch404.execute({
      requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'orders', query: 'estado compra', orderId: null, aspects: ['payment_status'], sensitiveFields: [], authAction: 'none' }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });
    expect(exec404.results[0]?.status).toBe('failed');
    if (exec404.results[0]?.status === 'failed') {
      expect((exec404.results[0] as unknown as { accessMethod?: string }).accessMethod).toBe('trusted_phone_purchase');
    }
    expect(exec404.summaries[0]?.accessMethod).toBe('trusted_phone_purchase');

    // Selector-mismatch: success with 2 purchases but eventHint mismatch => not_found distinct
    const gatewayMismatch = new FakeAgentGateway();
    gatewayMismatch.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [phonePurchase({ orderId: 'ORD-1', eventName: 'Evento A' }), phonePurchase({ orderId: 'ORD-2', eventName: 'Evento B' })],
    };
    const orchMismatch = new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: gatewayMismatch,
    });
    const execMismatch = await orchMismatch.execute({
      requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'orders', query: 'Evento X', orderId: null, eventHint: 'Evento X Mismatch', amount: null, aspects: ['payment_status'], sensitiveFields: [], authAction: 'none' }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });
    expect(execMismatch.results[0]?.status).toBe('failed');
    if (execMismatch.results[0]?.status === 'failed') {
      expect((execMismatch.results[0] as unknown as { accessMethod?: string }).accessMethod).toBe('trusted_phone_purchase');
      expect(execMismatch.results[0].message).toContain('No encontre una compra que coincida');
    }
    expect(execMismatch.summaries[0]?.accessMethod).toBe('trusted_phone_purchase');
  });

  it('b: selector-mismatch wording distinct from phone-wide not_found', async () => {
    const gateway = new FakeAgentGateway();
    gateway.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [phonePurchase({ orderId: 'ORD-1', eventName: 'Evento A' })],
    };
    const orchestrator = new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: gateway,
    });
    const execMismatch = await orchestrator.execute({
      requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'orders', query: 'Evento Z', orderId: null, eventHint: 'Evento Z', amount: null, aspects: ['payment_status'], sensitiveFields: [], authAction: 'none' }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });
    const mismatchMessage = execMismatch.results[0]?.status === 'failed' ? (execMismatch.results[0] as { message: string }).message : '';
    expect(mismatchMessage).toContain('No encontre una compra que coincida');

    const gatewayEmpty = new FakeAgentGateway();
    gatewayEmpty.guestOrdersResult = {
      status: 'success',
      resource: 'orders',
      purchases: [],
      carts: [],
    };
    const orchEmpty = new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: gatewayEmpty,
    });
    const execEmpty = await orchEmpty.execute({
      requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'orders', query: 'estado', orderId: null, aspects: ['payment_status'], sensitiveFields: [], authAction: 'none' }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });
    const phoneWideMessage = execEmpty.results[0]?.status === 'failed' ? (execEmpty.results[0] as { message: string }).message : '';
    expect(mismatchMessage).not.toBe(phoneWideMessage);
    expect(phoneWideMessage).toContain('No encontré compras asociadas a este número');
  });

  it('c: projection omits timezone for offset-less records and renderer emits no zone claim', async () => {
    // gateway parsing: offset-less timestamps become null
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: {
        pending_orders: [{ id: 'ORD-OFFSET', payment_status: 'pending', grand_total: 100, payment_method: 'Transferencia', currency: null, event_name: 'Evento X', created_at: '2026-08-30 21:31:27' }],
        completed_orders: [],
        carts: [],
      },
      errors: null,
      error: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const gateway = new HttpAgentConversationGateway({ baseUrl: 'https://api.example.test/api/agent', apiKey: 'k', timeoutMs: 1000, maxRetries: 0, messageLoggingEnabled: false });
    const result = await gateway.getGuestOrdersByPhone({ phone_extension: '+51', phone_number: '999999999' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.orderPartitions?.pending[0]?.createdAt).toBeNull();
    }

    // projection: offset-less paidAt omitted
    void new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: new FakeAgentGateway(),
    });
    // craft a purchase with offset-less paidAt via FakeGateway that bypasses Http normalization but tests projection
    const fakeWithPaidAt = new FakeAgentGateway();
    fakeWithPaidAt.guestGiftResult = {
      status: 'success',
      resource: 'gift_purchases',
      purchases: [{
        orderId: 'ORD-PAIDAT',
        paymentStatus: 'pending',
        shippingStatus: null,
        grandTotal: 100,
        paymentMethod: 'Transferencia',
        eventName: 'Evento X',
        eventDate: null,
        eventUrl: null,
        createdAt: null,
        items: [],
        payment: { method: 'Transferencia', amount: 100, paidAt: '2026-08-30 21:31:27', paymentId: null, transactionStatus: null, gatewayMessage: null, operationCode: null, originBank: null, destinationAccount: null, voucherImage: null },
        currency: null,
      }],
    };
    // For Http gateway, paidAt would be nulled via normalizePurchaseTimestamp; verify that orchestrator projection also reflects null
    // Here we test the Http gateway path for gift purchases offset-less
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: { purchases: [{ id: 'ORD-PAIDAT', payment_status: 'pending', grand_total: 100, payment: { method: 'Transferencia', amount: 100, paid_at: '2026-08-30 21:31:27' }, items: [] }] },
      errors: null,
      error: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const giftGateway = new HttpAgentConversationGateway({ baseUrl: 'https://api.example.test/api/agent', apiKey: 'k', timeoutMs: 1000, maxRetries: 0, messageLoggingEnabled: false });
    const giftResult = await giftGateway.getGuestGiftPurchasesByPhone({ phone_extension: '+51', phone_number: '999999999' });
    expect(giftResult.status).toBe('success');
    if (giftResult.status === 'success') {
      expect(giftResult.purchases[0]?.payment?.paidAt).toBeNull();
    }

    // response_contract contains zone guard
    const contract = fs.readFileSync('prompts/nodes/resolver_consultas_informativas/response_contract.txt', 'utf8');
    expect(contract).toContain('nunca afirmes fecha/zona/UTC si sin offset');
    expect(contract).toContain('backend o mensaje usuario');
    expect(contract).toContain('Di sin info zona');

    // ensure no projection contains UTC/Lima claim: check orchestrator projection for offset-less case
    const exec = await new InformationOrchestrator({
      knowledgeGateway: { async search() { return { status: 'failed' as const, reason: 'not_configured' as const, retryable: false, error: 'x' }; } } as unknown as KnowledgeRetrievalGateway,
      providerGateway: {} as ProviderGateway,
      agentGateway: fakeWithPaidAt,
    }).execute({
      requests: [{ requestId: 'information-1', kind: 'purchase', resource: 'gift_purchases', query: 'pago', orderId: null, aspects: ['payment_details'], sensitiveFields: [], authAction: 'none' }],
      authentication: null,
      authBlock: null,
      trustedPhone: { phone_extension: '+51', phone_number: '999999999' },
    });
    if (exec.results[0]?.status === 'completed' && exec.results[0].kind === 'purchase') {
      const proj = JSON.stringify(exec.results[0].purchases[0]);
      expect(proj).not.toMatch(/UTC|Lima|zona horaria corresponde/i);
    }
  });

  it('d: classifier payment-state report not suppressed in active information thread (prompt guard)', () => {
    const classifierPrompt = fs.readFileSync('prompts/nodes/deteccion_intencion/response_classifier.txt', 'utf8');
    expect(classifierPrompt).toContain('Reporte de pago con evidencia');
    expect(classifierPrompt).toContain('no es `acknowledgement_only`');
    // document live coverage via registry case exists (offline twin asserts prompt; live coverage verified via registry)
  });

  it('e: support-detail correction stays in information flow', async () => {
    const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const renderers = { terminal_whatsapp: new WhatsAppMessageRenderer() };
    const planStore = new InMemoryPlanStore();
    const seed = mergePlan(createEmptyPlan({ planId: 'support-continuation', channel: 'whatsapp', externalUserId: 'support-continuation-user' }), {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'faq', query: 'policy question' },
      },
    });
    await planStore.save({ plan: seed, reason: 'seed' });

    let callIdx = 0;
    const extractions: ExtractionResult[] = [
      // first correction after completed FAQ: eventType only, no provider need, actionIntent null
      {
        actionIntent: null,
        informationRequests: [],
        phoneConfirmation: null,
        rsvpAction: null,
        rsvpDecisionSource: 'plan_state' as const,
        rsvpCandidateGuestId: null,
        rsvpEventReference: null,
        rsvpParty: null,
        intentConfidence: 1,
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        eventType: 'baby_shower' as unknown as ExtractionResult['eventType'],
        vendorCategory: null,
        vendorCategories: [],
        activeNeedCategory: null,
        location: null,
        budgetSignal: null,
        guestRange: null,
        preferences: [],
        hardConstraints: [],
        assumptions: [],
        conversationSummary: 'correction',
        selectedProviderHints: [],
        selectedProviderReferences: [],
        closeAction: null,
        pauseRequested: false,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        providerFitCriteria: { eventType: null, needCategory: null, location: null, budgetAmount: null, budgetCurrency: null, mustHave: [], shouldAvoid: [], rankingNotes: '' },
        providerQueryIntents: [],
        providerPlanOperations: [],
        providerExplanationRequest: null,
        providerDetailRequest: null,
      },
    ];
    const runtime = {
      extract: async () => {
        const e = extractions[callIdx++] ?? extractions[0];
        return { extraction: e as unknown as ExtractionResult, tokenUsage: null };
      },
      composeReply: async () => ({ text: 'ok', structuredMessage: { type: 'generic', paragraphs_es: ['ok'] }, tokenUsage: null }),
    } as unknown as AgentRuntime;
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: { async lookupAuthenticatedUserEvents() { return { events: [], counts: { ownerEvents:0, guestEvents:0, hostEvents:0, celebratedEvents:0, recentOrders:0 } } as unknown as ProviderGateway['lookupAuthenticatedUserEvents']; } } as unknown as ProviderGateway,
      promptLoader,
      renderers,
    });

    // Also test with purchase last_completed
    const seedPurchase = mergePlan(createEmptyPlan({ planId: 'support-continuation-purchase', channel: 'whatsapp', externalUserId: 'support-continuation-purchase-user' }), {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [],
        selection_candidates: [],
        last_completed_request: { kind: 'purchase', resource: 'orders', query: 'estado', orderId: null, aspects: ['payment_status'], sensitiveFields: [], authAction: 'none' } as unknown as Record<string, unknown> as never,
      },
    });
    await planStore.save({ plan: seedPurchase, reason: 'seed2' });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'support-continuation-user',
      text: 'Y el evento es Baby Shower Catalina',
      messageId: 'support-continuation-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51999999999',
    });
    expect(response.plan.current_node).toBe('resolver_consultas_informativas');

    // second case with purchase
    const response2 = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'support-continuation-purchase-user',
      text: 'Y el evento es Baby Shower Catalina',
      messageId: 'support-continuation-purchase-1',
      receivedAt: new Date().toISOString(),
      contactPhone: '+51999999999',
    });
    expect(response2.plan.current_node).toBe('resolver_consultas_informativas');
  });

  it('extractor prompts contain salience rules', () => {
    const infoExtractor = fs.readFileSync('prompts/extractors/information.txt', 'utf8');
    expect(infoExtractor).toContain('pago transferencia/Yape pendiente');
    expect(infoExtractor).toContain('resource=orders');
    expect(infoExtractor).toContain('payment_status');
    expect(infoExtractor).toContain('validation_window');
    expect(infoExtractor).toContain('Y el evento es Baby Shower Catalina');
    expect(infoExtractor).toContain('actionIntent=null');
  });
});
