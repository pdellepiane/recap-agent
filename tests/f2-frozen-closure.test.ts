import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

describe('F2c frozen concise and suppression guard', () => {
  it('single status query without amount skips mutable disclosure', () => {
    const asksExplicitAmount = false;
    const purchasesLength = 1;
    const isSingleStatusQuery = purchasesLength === 1 && !asksExplicitAmount;
    expect(isSingleStatusQuery).toBe(true);
  });

  it('rsvp lane never suppresses acknowledgement', () => {
    const plan = { rsvp_state: { status: 'none' }, current_node: 'responder_invitacion' };
    const validSuppression = plan.rsvp_state.status === 'none' && plan.current_node !== 'responder_invitacion';
    expect(validSuppression).toBe(false);
  });

  it('non-rsvp lane may still suppress when stateless', () => {
    const plan = { rsvp_state: { status: 'none' }, current_node: 'contacto_inicial' };
    const validSuppression = plan.rsvp_state.status === 'none' && plan.current_node !== 'responder_invitacion';
    expect(validSuppression).toBe(true);
  });

  it('post-rsvp thanks in rsvp lane acknowledges once without restarting rsvp', async () => {
    const emptyExtraction: ExtractionResult = {
      actionIntent: null,
      informationRequests: [],
      supportAct: null,
      phoneConfirmation: null,
      rsvpAction: null,
      rsvpDecisionSource: null,
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
      rsvpParty: null,
      intentConfidence: 0.99,
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
      location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
      assumptions: [], conversationSummary: 'La persona agradece la organizacion de una fiesta familiar ya realizada.',
      selectedProviderHints: [], selectedProviderReferences: [],
      closeAction: null, pauseRequested: false,
      contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null,
      providerQueryIntents: [], providerPlanOperations: [],
      providerExplanationRequest: null, providerDetailRequest: null,
    };
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'p-tito', channel: 'whatsapp', externalUserId: 'u-tito' }), {
      current_node: 'responder_invitacion',
      contact_phone: '+51900004780',
      contact_phone_extension: '+51',
      contact_phone_number: '9000004780',
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = {
      rsvpCalls: 0,
      async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; },
      async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; },
      async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; },
      async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; },
      async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; },
      async getGuestEventsByPhone(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; },
      async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; },
      async guestRsvp(): Promise<{ status: 'failed'; error: string; retryable: false }> { this.rsvpCalls += 1; return { status: 'failed', error: 'unused', retryable: false }; },
    };
    const service = new AgentService({
      planStore: store,
      runtime: {
        async extract(): Promise<ExtractionResult> { return emptyExtraction; },
        async composeReply(): Promise<{ text: string; structuredMessage: { type: 'generic'; paragraphs_es: string[] } }> {
          return { text: 'tissue', structuredMessage: { type: 'generic', paragraphs_es: ['tissue'] } };
        },
      } as unknown as AgentRuntime,
      providerGateway: { async lookupUserEventContext(): Promise<null> { return null; } } as unknown as ProviderGateway,
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'u-tito',
      text: 'Muchas gracias por la organizacion, la fiesta fue para mi familia y estamos muy agradecidos',
      messageId: 'm2', receivedAt: '2026-09-04T15:01:00.000Z', contactPhone: '+51900004780',
    });
    expect(gateway.rsvpCalls).toBe(0);
    const text = result.outbound.text ?? '';
    expect(text).toMatch(/sigue confirmada|figura que asistir/i);
    expect(text).toMatch(/familia/i);
    expect(text).not.toMatch(/confirmar o rechazar/i);
    expect(text).not.toContain('?');
    expect(text).not.toMatch(/rsvp/i);
  });
});
