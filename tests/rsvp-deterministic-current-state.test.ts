import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway, AgentGuestEventsResult, AgentGuestRsvpResult } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

describe('RSVP hybrid fragment composition (T6-fix-11)', () => {
  it('attending fragment contains polarity event date and no-change without model tissue', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const invitation = { eventId: 1, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending', accessMethod: 'guest_record' } as unknown;
    const fragment = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(invitation, false);
    expect(fragment).toContain('Otra celebración prueba');
    expect(fragment).toContain('19 de agosto de 2026');
    expect(fragment.toLowerCase()).toContain('figura que asistirás');
    expect(fragment.toLowerCase()).toContain('ya está confirmada');
    expect(fragment.toLowerCase()).toContain('no fue necesario hacer otro cambio');
    expect(fragment.toLowerCase()).toContain('no se realizó un nuevo registro');
    expect(fragment).toContain('Gracias,');
    expect(fragment.startsWith('Gracias,')).toBe(true);
    expect(fragment).not.toContain('Que disfrutes');
    expect(fragment).not.toContain('19/08/2026');
  });

  it('declining fragment with offer contains question without no-change', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const invitation = { eventId: 1, guestId: 1, eventName: 'Evento Decline', eventDate: '2026-09-12', state: 'declining', accessMethod: 'guest_record' } as unknown;
    const withOffer = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(invitation, true);
    expect(withOffer).toContain('no asistirás');
    expect(withOffer).toContain('Evento Decline');
    expect(withOffer).toContain('12 de septiembre de 2026');
    expect(withOffer).toContain('¿Deseas que confirme tu asistencia?');
    expect(withOffer.trim().endsWith('?')).toBe(true);
    expect(withOffer.toLowerCase()).not.toContain('no fue necesario hacer otro cambio');
    expect(withOffer).not.toContain('Gracias');
    const withoutOffer = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(invitation, false);
    expect(withoutOffer).toContain('no asistirás');
    expect(withoutOffer.toLowerCase()).toContain('no fue necesario hacer otro cambio');
    expect(withoutOffer).not.toContain('¿Deseas que confirme tu asistencia?');
  });

  it('fragment determinism is byte-identical for identical inputs', () => {
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: new RsvpRuntime([]),
      providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
    }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
    const inv = { eventId: 1, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending', accessMethod: 'guest_record' } as unknown;
    const a = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(inv, false);
    const b = (service as unknown as { renderRsvpCurrentStateDeterministically: (a: unknown, b: boolean) => string }).renderRsvpCurrentStateDeterministically(inv, false);
    expect(a).toBe(b);
    expect(Buffer.from(a).toString()).toBe(Buffer.from(b).toString());
  });

  it('handleTurn hybrid merges fragment lead with model tissue and fragment is deterministic', async () => {
    const tissueParagraph1 = 'Gracias por tu mensaje, aprecio tu confirmación.';
    const tissueParagraph2 = 'Quedo atento por si necesitas algo más.';
    const runOnce = async (): Promise<{ text: string; fragment: string }> => {
      const runtime = new RsvpRuntime([rsvpExtraction({ action: null })], tissueParagraph1, tissueParagraph2);
      const invitations: UserEventLookupResult['events'] = [rsvpLookupInvitation({ guestId: 584352, eventId: 38331, eventName: 'Otra celebración prueba', hasResponded: true, willAttend: true, datetime: '2026-08-19 05:00:00' })];
      const store = new InMemoryPlanStore();
      const seeded = mergePlan(createEmptyPlan({ planId: 'plan-attending', channel: 'whatsapp', externalUserId: 'user-attending' }), {
        current_node: 'responder_invitacion',
        intent: 'responder_invitacion',
        contact_phone: '+51973296571',
        contact_phone_extension: '+51',
        contact_phone_number: '973296571',
        rsvp_state: {
          status: 'awaiting_action',
          pending_action: 'attending',
          candidates: [{ guest_id: 584352, event_name: 'Otra celebración prueba', event_date: '2026-08-19 05:00:00' }],
          requested_at: '2026-08-17T15:00:00.000Z',
          selection_attempts: 0,
        },
      });
      await store.save({ plan: seeded, reason: 'seed' });
      const service = new AgentService({
        planStore: store,
        runtime,
        providerGateway: {
          async lookupUserEventContext(): Promise<UserEventLookupResult | null> {
            return { lookup: { email: null, phone: '973296571' }, user: null, events: invitations, counts: { ownerEvents: 0, guestEvents: invitations.length, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 } };
          },
        } as unknown as ProviderGateway,
        agentConversationGateway: new RsvpGateway(),
        promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
        renderers: { whatsapp: new WhatsAppMessageRenderer() },
      });
      const inbound = { channel: 'whatsapp', externalUserId: 'user-attending', text: '¿Mi asistencia ya está confirmada?', messageId: 'msg-1', receivedAt: '2026-08-27T15:00:00.000Z', contactPhone: '+51973296571' };
      const result = await service.handleTurn(inbound);
      const text = result.outbound.text ?? '';
      // Extract fragment via verifier for determinism check
      const verifier = new AgentService({
        planStore: new InMemoryPlanStore(),
        runtime: new RsvpRuntime([]),
        providerGateway: { async lookupUserEventContext() { return null; } } as unknown as ProviderGateway,
        promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
        renderers: { whatsapp: new WhatsAppMessageRenderer() },
      }) as unknown as { renderRsvpCurrentStateDeterministically: (inv: unknown, offer: boolean) => string };
      const fragment = verifier.renderRsvpCurrentStateDeterministically({ eventId: 1, guestId: 584352, eventName: 'Otra celebración prueba', eventDate: '2026-08-19 05:00:00', state: 'attending' } as unknown, true);
      return { text, fragment };
    };
    const first = await runOnce();
    const second = await runOnce();
    // Fragment determinism (byte-identical)
    expect(first.fragment).toBe(second.fragment);
    expect(Buffer.from(first.fragment).toString()).toBe(Buffer.from(second.fragment).toString());
    // Outbound contains fragment elements
    expect(first.text).toContain('Otra celebración prueba');
    expect(first.text).toContain('19 de agosto de 2026');
    expect(first.text.toLowerCase()).toContain('figura que asistirás');
    expect(first.text.toLowerCase()).toContain('ya está confirmada');
    expect(first.text.toLowerCase()).toContain('no fue necesario hacer otro cambio');
    expect(first.text.toLowerCase()).toContain('no se realizó un nuevo registro');
    // Outbound contains model tissue (distinct paragraphs) — sanitizer may strip trailing period
    expect(first.text).toContain(tissueParagraph1.replace(/\.$/, ''));
    expect(first.text).toContain(tissueParagraph2.replace(/\.$/, ''));
    // Fragment leads the reply (appears before tissue)
    expect(first.text.indexOf(first.fragment)).toBe(0);
    expect(first.text.indexOf(tissueParagraph1.replace(/\.$/, ''))).toBeGreaterThan(first.text.indexOf(first.fragment));
    // No raw slash date leak
    expect(first.text).not.toContain('19/08/2026');
    // Hybrid determinism: outbound text is byte-identical across runs when tissue is deterministic
    expect(first.text).toBe(second.text);
  });
});

class RsvpRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];
  constructor(private readonly extractions: ExtractionResult[], private readonly p1?: string, private readonly p2?: string) {}
  async extract(): Promise<ExtractionResult> {
    const e = this.extractions.shift();
    if (!e) throw new Error('No extraction queued');
    return e;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    const para1 = this.p1 ?? 'Tu asistencia para Otra celebración prueba el 19/08/2026 está pendiente. Modelo.';
    const para2 = this.p2 ?? 'Fecha cruda 19/08/2026 no debe aparecer.';
    // If custom tissue provided, use it; else default
    const paragraphs = this.p1 && this.p2 ? [this.p1, this.p2] : [para1, para2];
    return {
      text: '',
      structuredMessage: {
        type: 'generic',
        paragraphs_es: paragraphs,
      },
    };
  }
}

class RsvpGateway implements AgentConversationGateway {
  async logMessage(input: unknown): Promise<{ status: 'skipped'; reason: 'disabled'; message: string }> { void input; return { status: 'skipped', reason: 'disabled', message: 'Disabled.' }; }
  async getRecentMessages(): Promise<{ status: 'success'; messages: [] }> { return { status: 'success', messages: [] }; }
  async requestHumanTakeover(): Promise<{ status: 'success'; message: string }> { return { status: 'success', message: 'Requested.' }; }
  async authByPhone(): Promise<{ status: 'failed'; error: string; retryable: false }> { return { status: 'failed', error: 'Unused.', retryable: false }; }
  async updatePhone(): Promise<{ status: 'success' }> { return { status: 'success' }; }
  async getGuestEventsByPhone(): Promise<AgentGuestEventsResult> { return { status: 'not_found' }; }
  async getEventDetail(): Promise<{ status: 'not_found'; error: string; retryable: false }> { return { status: 'not_found', error: 'not', retryable: false }; }
  async guestRsvp(): Promise<AgentGuestRsvpResult> { return { status: 'failed', error: 'unused', retryable: false }; }
}

function rsvpExtraction(args: { action?: 'attending'|'declining'|null }): ExtractionResult {
  return {
    actionIntent: 'responder_invitacion',
    informationRequests: [],
    rsvpAction: args.action ?? null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    intentConfidence: 0.98,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [], conversationSummary: 'rsvp', selectedProviderHints: [], selectedProviderReferences: [], closeAction: null, pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: null, providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null, providerDetailRequest: null,
  };
}

function rsvpLookupInvitation(args: { guestId?: number; eventId?: number; eventName?: string; hasResponded?: boolean; willAttend?: boolean | null; datetime?: string | null }): UserEventLookupResult['events'][number] {
  return {
    relation: 'guest', guestId: args.guestId ?? 584352, eventId: args.eventId ?? 38331, slug: null, url: null, name: args.eventName ?? 'Otra celebración prueba', place: null, type: null, datetime: args.datetime ?? '2026-08-19 05:00:00', stage: null, isVisible: null, isPublic: null, currency: null, country: null, guestStatus: { hasResponded: args.hasResponded ?? true, willAttend: args.willAttend ?? true, hasCouple: null, responseDate: null }, hostType: null, hostPermission: null, hostStatus: null, celebratedType: null, amountCollected: null, amountTransferred: null, transactionsCount: null, invitedGuestCount: null, confirmedGuestCount: null, orders: [],
  };
}
