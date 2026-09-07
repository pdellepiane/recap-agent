import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

function extractionConfirm(): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: 'attending',
    rsvpDecisionSource: 'current_message',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
    location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
    assumptions: [], conversationSummary: 'rsvp', selectedProviderHints: [],
    selectedProviderReferences: [], closeAction: null, pauseRequested: false,
    contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null,
    providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null,
    providerDetailRequest: null,
  };
}

class ConfirmRuntime implements AgentRuntime {
  constructor(private readonly e: ExtractionResult) {}
  async extract(): Promise<ExtractionResult> { return this.e; }
  async composeReply(): Promise<{ text: string; structuredMessage: { type: 'generic'; paragraphs_es: string[] } }> {
    return { text: 'tissue', structuredMessage: { type: 'generic', paragraphs_es: ['tissue'] } };
  }
}

class MismatchGateway implements AgentConversationGateway {
  public handoffCalls = 0;
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: Array<{ id: number; direction: 'outbound'; source: string; body: string; status: string; sentAt: string; createdAt: null }> }> {
    return { status: 'success', messages: [
      { id: 16123, direction: 'outbound', source: 'frontend_followup', body: 'Ultimo recordatorio: Cumple Marcelo manana 18:00. Confirma aqui.', status: 'sent', sentAt: '2026-09-04T10:00:00.000Z', createdAt: null },
    ] };
  }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { this.handoffCalls += 1; return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'unused', retryable: false }; }
}

describe('F2 reminder mismatch escalates once without denial', () => {
  it('empty lookup with explicit confirm and reminder calls handoff once', async () => {
    const store = new InMemoryPlanStore();
    const seeded = mergePlan(createEmptyPlan({ planId: 'p-mis', channel: 'whatsapp', externalUserId: 'u-mis' }), {
      current_node: 'contacto_inicial',
      contact_phone: '+51900000421',
      contact_phone_extension: '+51',
      contact_phone_number: '900000421',
    });
    await store.save({ plan: seeded, reason: 'seed' });
    const gateway = new MismatchGateway();
    const service = new AgentService({
      planStore: store,
      runtime: new ConfirmRuntime(extractionConfirm()),
      providerGateway: { async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
        return { lookup: { email: null, phone: '900000421' }, user: null, events: [], counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
      } } as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    });
    const result = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'u-mis',
      text: 'Si, confirmo que asistire',
      messageId: 'm1', receivedAt: '2026-09-04T15:00:00.000Z', contactPhone: '+51900000421',
    });
    expect(gateway.handoffCalls).toBe(1);
    const text = result.outbound.text ?? '';
    expect(text).toContain('Gracias por tu mensaje');
    expect(text).not.toContain('Gracias por confirmar tu asistencia');
    expect(text).not.toMatch(/confirmar tu asistencia/i);
    expect(text).not.toMatch(/qued[oó] registrada/i);
    expect(text).toContain('Cumple Marcelo');
    expect(text.toLowerCase()).toContain('no puedo verificar');
    expect(text).not.toMatch(/no encontr[eé] ninguna invitaci/i);
    expect(text).not.toMatch(/rsvp/i);
  });
});
