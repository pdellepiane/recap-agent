import { describe, expect, it } from 'vitest';

import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import {
  effectiveCloseActionForDispatch,
  retainAllInformationRequests,
  shouldAttemptPhoneLookupBeforeAsking,
} from '../src/runtime/agent-service';
import {
  assembleCustomerContext,
  groundedDisplayName,
  isNameGrounded,
  rankCandidatesByRelevance,
  resolveExplicitTargetWins,
} from '../src/runtime/customer-context';
import {
  deriveConversationContinuity,
  buildExtractorConversationHistory,
  buildPriorAnswerGist,
  buildTurnMessageContext,
  extractorHistoryByteBudget,
  measureAmbiguityRate,
} from '../src/runtime/turn-message-context';
import {
  normalizeCloseActionForDispatch,
  rsvpPlusOneSupportOfferRequired,
} from '../src/runtime/openai-agent-runtime';
import {
  projectCompletedPurchaseForModel,
  selectPurchaseReplyOutcome,
} from '../src/runtime/purchase-reply-projector';
import { resolveContinuityDecision } from '../src/runtime/conversation-continuity-policy';
import { createEmptyPlan } from '../src/core/plan';

function message(
  id: number,
  overrides: Partial<AgentConversationMessage> = {},
): AgentConversationMessage {
  return {
    id,
    direction: id % 2 === 0 ? 'outbound' : 'inbound',
    source: id % 2 === 0 ? 'agent' : null,
    body: `cuerpo-${id}`,
    status: 'sent',
    sentAt: `2026-09-01T10:${String(10 + id).padStart(2, '0')}:00.000Z`,
    createdAt: null,
    ...overrides,
  };
}

describe('R7 extractor history context', () => {
  it('projects untruncated recent-turn bodies within the documented byte budget', () => {
    const longBody = 'x'.repeat(5000);
    const context = buildTurnMessageContext({
      inbound: {
        channel: 'terminal_whatsapp',
        externalUserId: 'u',
        text: 'actual',
        messageId: 'wamid-now',
        receivedAt: '2026-09-01T10:30:00.000Z',
      },
      messages: [message(1, { body: longBody }), message(2), message(3)],
    });
    const history = buildExtractorConversationHistory(context);
    expect(history.length).toBeGreaterThan(0);
    // Bounded per-body cap, never the old 600-char head/tail merge.
    for (const entry of history) {
      expect(entry.body.length).toBeLessThanOrEqual(2000);
    }
    expect(history.find((entry) => entry.body.length > 600)).toBeDefined();
    const bytes = history.reduce((sum, entry) => sum + entry.body.length, 0);
    expect(bytes).toBeLessThanOrEqual(extractorHistoryByteBudget);
    expect(extractorHistoryByteBudget).toBe(12000);
  });

  it('exposes the prior assistant answer gist for carry-forward', () => {
    const context = buildTurnMessageContext({
      inbound: {
        channel: 'terminal_whatsapp',
        externalUserId: 'u',
        text: 'actual',
        messageId: 'wamid-now',
        receivedAt: '2026-09-01T10:30:00.000Z',
      },
      messages: [
        message(1, { direction: 'inbound', source: null, body: 'cuanto es mi pedido' }),
        message(2, { direction: 'outbound', source: 'agent', body: 'Tu pedido de la fiesta Niur esta pendiente de validacion.' }),
      ],
    });
    expect(buildPriorAnswerGist(context)).toContain('Niur');
  });

  it('measures the ambiguity/delta-vacio rate before/after', () => {
    const before = measureAmbiguityRate([
      { ambiguous: true, deltaEmpty: false },
      { ambiguous: false, deltaEmpty: true },
      { ambiguous: false, deltaEmpty: false },
      { ambiguous: false, deltaEmpty: false },
    ]);
    expect(before.total).toBe(4);
    expect(before.ambiguousOrEmpty).toBe(2);
    expect(before.rate).toBe(0.5);
    const after = measureAmbiguityRate([
      { ambiguous: true, deltaEmpty: false },
      { ambiguous: false, deltaEmpty: false },
      { ambiguous: false, deltaEmpty: false },
      { ambiguous: false, deltaEmpty: false },
    ]);
    expect(after.rate).toBeLessThan(before.rate);
  });
});

describe('R7 greeting-fallback elimination', () => {
  it('never allows onboarding or welcome mid-conversation', () => {
    const plan = createEmptyPlan({
      planId: 'p1',
      channel: 'terminal_whatsapp',
      externalUserId: 'u',
    });
    const continuity = deriveConversationContinuity({
      plan,
      recentMessages: [message(1, { direction: 'inbound', source: null, body: 'hola' }), message(2)],
      historyStatus: 'available',
    });
    expect(continuity.hasPriorContext).toBe(true);
    expect(continuity.welcomeAllowed).toBe(false);
    const decision = resolveContinuityDecision({
      hasPriorContext: true,
      historyStatus: 'available',
      action: 'respond',
      campaignReplyKind: 'acknowledgement_only',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: false,
      hasSubstantiveRelationshipRemark: false,
      attendingState: 'none',
      hasActionableUnresolvedRequest: false,
    });
    // Mid-conversation acknowledgement never reopens onboarding/welcome.
    expect(decision.allowOnboarding).toBe(false);
    expect(decision.shouldSuppressWelcome).toBe(true);
  });

  it('allows welcome only on a true conversation start', () => {
    const plan = createEmptyPlan({
      planId: 'p2',
      channel: 'terminal_whatsapp',
      externalUserId: 'u',
    });
    const continuity = deriveConversationContinuity({
      plan,
      recentMessages: [],
      historyStatus: 'empty',
    });
    expect(continuity.welcomeAllowed).toBe(true);
  });
});

describe('R7 grounding enforcement', () => {
  it('explicit old target wins over recency (Tia-Niur class)', () => {
    const target = resolveExplicitTargetWins({
      orderIds: ['ORD-OLD', 'ORD-NEW'],
      eventIds: [111, 222],
      relevantOrderIds: ['ORD-OLD'],
      relevantEventIds: [],
    });
    expect(target.kind).toBe('target');
    expect(target.kind === 'target' ? target.orderId : null).toBe('ORD-OLD');
    // Cross-event facts never bleed: without an explicit target both stay candidates.
    const candidates = resolveExplicitTargetWins({
      orderIds: ['ORD-OLD', 'ORD-NEW'],
      eventIds: [],
      relevantOrderIds: [],
      relevantEventIds: [],
    });
    expect(candidates.kind).toBe('candidates');
  });

  it('ranks the explicit years-old target above a newer pending order', () => {
    const ranked = rankCandidatesByRelevance(
      [
        { orderId: 'ORD-NEW', eventName: 'Fiesta Nueva', paymentStatus: 'pending', createdAt: '2026-09-01T00:00:00.000Z', eventDate: null },
        { orderId: 'ORD-OLD', eventName: 'Fiesta Tia', paymentStatus: 'paid', createdAt: '2023-01-01T00:00:00.000Z', eventDate: null },
      ],
      { explicitOrderId: 'ORD-OLD', explicitEventHint: null, questionFocus: 'payment' },
    );
    expect(ranked[0]?.orderId).toBe('ORD-OLD');
  });

  it('rejects hallucinated names (carina ANDREA&RODRIGO class)', () => {
    expect(isNameGrounded('Andrea', ['Andrea', 'Rodrigo'])).toBe(true);
    expect(isNameGrounded('Carina', ['Andrea', 'Rodrigo'])).toBe(false);
    expect(isNameGrounded(null, ['Andrea'])).toBe(false);
    // Seed/summary facts with a backend ref stay usable; inventions fail.
    expect(groundedDisplayName('Andrea', 'ref-1')).toBe('Andrea');
    expect(groundedDisplayName('Carina', null)).toBeNull();
  });

  it('nulls display names without a backend customer reference', () => {
    const snapshot = assembleCustomerContext({
      execution: null,
      identity: { customerRef: null, displayName: 'Inventado', scope: null, source: null },
      currentContext: null,
      nowIso: '2026-09-01T10:00:00.000Z',
    });
    expect(snapshot.identityAccess.displayName).toBeNull();
  });

  it('projects explicit currency-unknown negative evidence (never S/)', () => {
    const outcome = selectPurchaseReplyOutcome({
      purchases: [
        {
          orderId: 'ORD-1',
          eventId: null,
          eventName: 'Fiesta',
          eventDate: null,
          createdAt: null,
          paymentStatus: 'pending',
          grandTotal: 150,
          currency: null,
          currencySymbol: null,
          paymentMethod: null,
          payment: null,
          items: [],
        } as never,
      ],
      carts: [],
      needsSelection: false,
      coverage: 'complete',
      referenceResolution: 'not_requested',
      requestedAspects: ['summary'],
      referenceAuthorized: false,
      userReported: {},
    });
    expect(outcome.kind).toBe('order_unique');
    const completed = {
      requestId: 'r1',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: (outcome.kind === 'order_unique' ? [] : []),
      needsSelection: false,
      coverage: 'complete',
    } as never;
    void completed;
    // Project through the model projector via a completed result shape.
    const projected = projectCompletedPurchaseForModel(
      {
        requestId: 'r1',
        kind: 'purchase',
        status: 'completed',
        resource: 'orders',
        purchases: [
          {
            orderId: 'ORD-1',
            eventId: null,
            eventName: 'Fiesta',
            eventDate: null,
            createdAt: null,
            paymentStatus: 'pending',
            grandTotal: 150,
            currency: null,
            currencySymbol: null,
            paymentMethod: 'Yape',
            payment: null,
            items: [],
          } as never,
        ],
        needsSelection: false,
        coverage: 'complete',
      } as never,
      { requestedAspects: ['summary', 'payment_status'] },
    ) as { outcome: { order: Record<string, unknown> } };
    expect(projected.outcome.order.currencyAvailability).toBe('unknown');
    expect(projected.outcome.order.currency_unknown).toBe(true);
    expect('currency' in (projected.outcome.order as object)).toBe(false);
  });
});

describe('R7 maximal-answer-first and dispatch', () => {
  it('repairs request_contact into proceed_confirmed when fully seeded (S12)', () => {
    expect(
      effectiveCloseActionForDispatch({
        closeActionType: 'request_contact',
        contactComplete: true,
        hasEligibleSelection: true,
        eventDateAvailable: true,
        lifecycleActive: true,
      }),
    ).toBe('proceed_confirmed');
    expect(
      normalizeCloseActionForDispatch({
        closeActionType: 'request_contact',
        contactComplete: true,
        hasEligibleSelection: true,
        eventDateAvailable: true,
        lifecycleActive: true,
      }),
    ).toBe('proceed_confirmed');
    // Incomplete state stays request_contact (no premature dispatch).
    expect(
      effectiveCloseActionForDispatch({
        closeActionType: 'request_contact',
        contactComplete: false,
        hasEligibleSelection: true,
        eventDateAvailable: true,
        lifecycleActive: true,
      }),
    ).toBe('request_contact');
  });

  it('requires the human-support offer on plus-one turns (system.txt:13)', () => {
    expect(
      rsvpPlusOneSupportOfferRequired({
        companionCount: 'multiple',
        plusOneResponse: 'unknown',
        hasRsvpWork: true,
      }),
    ).toBe(true);
    expect(
      rsvpPlusOneSupportOfferRequired({
        companionCount: 'one',
        plusOneResponse: 'yes',
        hasRsvpWork: true,
      }),
    ).toBe(false);
    expect(
      rsvpPlusOneSupportOfferRequired({
        companionCount: 'unknown',
        plusOneResponse: 'unknown',
        hasRsvpWork: true,
      }),
    ).toBe(false);
    expect(
      rsvpPlusOneSupportOfferRequired({
        companionCount: 'multiple',
        plusOneResponse: 'unknown',
        hasRsvpWork: false,
      }),
    ).toBe(false);
  });
});

describe('R7 accountless lookup and multi-request retention', () => {
  it('executes the phone-scoped lookup instead of asking when a phone is known', () => {
    expect(
      shouldAttemptPhoneLookupBeforeAsking({
        hasPurchaseOrEventRequest: true,
        contactPhonePresent: true,
        alreadyAuthenticated: false,
      }),
    ).toBe(true);
    expect(
      shouldAttemptPhoneLookupBeforeAsking({
        hasPurchaseOrEventRequest: true,
        contactPhonePresent: false,
        alreadyAuthenticated: false,
      }),
    ).toBe(false);
    expect(
      shouldAttemptPhoneLookupBeforeAsking({
        hasPurchaseOrEventRequest: false,
        contactPhonePresent: true,
        alreadyAuthenticated: false,
      }),
    ).toBe(false);
  });

  it('advances ALL requests in multi-request messages (spanish_only email need kept)', () => {
    const merged = retainAllInformationRequests(
      [{ requestId: 'information-1', kind: 'purchase' }],
      [
        { requestId: 'information-1', kind: 'purchase' },
        { requestId: 'information-2', kind: 'associated_event' },
      ],
    );
    expect(merged.map((request) => request.requestId)).toEqual([
      'information-1',
      'information-2',
    ]);
  });
});
