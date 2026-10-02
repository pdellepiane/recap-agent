import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  mergePlan,
  normalizeRawPlan,
  ownerValues,
  planSchema,
  type PlanSnapshot,
} from '../src/core/plan';
import {
  applyOwnerForTurn,
  applyOwnerTransfer,
  capabilityRequiresIdentityAccess,
  emptyCustomerCapabilitySignals,
  emptyOwnerDomainSignals,
  isPlanOwner,
  resolveInitialOwner,
  resumeReturnOwner,
} from '../src/runtime/owner-routing';

function testPlan(): PlanSnapshot {
  return createEmptyPlan({
    planId: 'plan-l4',
    channel: 'whatsapp',
    externalUserId: 'user-l4',
  });
}

function planWithSelection(): PlanSnapshot {
  return mergePlan(testPlan(), {
    vendor_category: 'Locales',
    active_need_category: 'Locales',
    selected_provider_ids: [12],
    selected_provider_hints: ['Salón Lima'],
  });
}

describe('l4 persistent ownership', () => {
  it('defines exactly three persistent owners', () => {
    expect(ownerValues).toEqual(['planning', 'faq', 'customer_assistance']);
    expect(planSchema.safeParse({ owner: 'entry' }).success).toBe(false);
    expect(isPlanOwner('planning')).toBe(true);
    expect(isPlanOwner('entry')).toBe(false);
    expect(isPlanOwner(null)).toBe(false);
  });

  it('defaults fresh plans to planning without capability or return owner', () => {
    const plan = testPlan();
    expect(plan.owner).toBe('planning');
    expect(plan.owner_capability).toBeNull();
    expect(plan.owner_pending_question).toBeNull();
    expect(plan.owner_pending_task).toBeNull();
    expect(plan.owner_return).toBeNull();
  });

  it('sanitizes legacy owner values on normalize without a second store', () => {
    const parsed = planSchema.safeParse(
      normalizeRawPlan({
        ...testPlan(),
        owner: 'entry',
        owner_capability: 'purchase',
        owner_return: 'support_agent',
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.owner).toBe('planning');
      expect(parsed.data.owner_capability).toBeNull();
      expect(parsed.data.owner_return).toBeNull();
    }
  });

  it('clears a stale capability when leaving Customer assistance', () => {
    const assisting = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'purchase',
    });
    expect(assisting.owner_capability).toBe('purchase');
    const moved = mergePlan(assisting, { owner: 'faq' });
    expect(moved.owner).toBe('faq');
    expect(moved.owner_capability).toBeNull();
  });

  it('preserves selections across owner switches', () => {
    const withSelection = planWithSelection();
    expect(withSelection.selected_provider_ids).toEqual([12]);
    const moved = mergePlan(withSelection, {
      owner: 'customer_assistance',
      owner_capability: 'support',
    });
    expect(moved.selected_provider_ids).toEqual([12]);
    expect(moved.selected_provider_hints).toEqual(['Salón Lima']);
    const back = mergePlan(moved, { owner: 'planning' });
    expect(back.selected_provider_ids).toEqual([12]);
  });
});

describe('l4 transient selection and established turns', () => {
  it('selects customer assistance only for grounded or public work', () => {
    expect(
      resolveInitialOwner({
        ...emptyOwnerDomainSignals,
        customerWork: true,
        identityAccessGrounded: true,
        protectedTaskRequested: true,
      }),
    ).toBe('customer_assistance');
    expect(
      resolveInitialOwner({
        ...emptyOwnerDomainSignals,
        customerWork: true,
        faqWork: true,
        identityAccessGrounded: false,
        protectedTaskRequested: true,
      }),
    ).toBe('faq');
    expect(
      resolveInitialOwner({ ...emptyOwnerDomainSignals, faqWork: true }),
    ).toBe('faq');
    expect(resolveInitialOwner(emptyOwnerDomainSignals)).toBe('planning');
  });

});

describe('l4 single-transfer bound', () => {
  it('rejects ungated and same-owner transfers with reasons and no budget cost', () => {
    const blocked = applyOwnerTransfer({
      from: 'faq',
      to: 'customer_assistance',
      transfersThisTurn: 0,
      identityAccessGrounded: false,
      protectedTaskRequested: true,
    });
    expect(blocked.transferred).toBe(false);
    if (!blocked.transferred) {
      expect(blocked.reason).toBe('identity_access_not_grounded');
    }
    const publicFollowUp = applyOwnerTransfer({
      from: 'faq',
      to: 'customer_assistance',
      transfersThisTurn: 0,
      identityAccessGrounded: false,
      protectedTaskRequested: false,
    });
    expect(publicFollowUp.transferred).toBe(true);
    const same = applyOwnerTransfer({
      from: 'faq',
      to: 'faq',
      transfersThisTurn: 0,
      identityAccessGrounded: false,
      protectedTaskRequested: false,
    });
    expect(same.transferred).toBe(false);
    if (!same.transferred) {
      expect(same.reason).toBe('same_owner');
      expect(same.transfersThisTurn).toBe(0);
    }
  });
});

describe('l4 capability slices without churn', () => {
  it('switches capability slices without transfers while keeping pending tasks', () => {
    const assisting = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'support',
      owner_pending_task: 'support:open',
    });
    const switched = applyOwnerForTurn({
      plan: assisting,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, rsvpWork: true },
      transfersThisTurn: 0,
    });
    expect(switched.transferred).toBe(false);
    expect(switched.owner).toBe('customer_assistance');
    expect(switched.capability).toBe('rsvp');
    expect(switched.plan.owner_pending_task).toBe('support:open');
    const backToSupport = applyOwnerForTurn({
      plan: switched.plan,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, supportWork: true },
      transfersThisTurn: 0,
    });
    expect(backToSupport.transferred).toBe(false);
    expect(backToSupport.capability).toBe('support');
  });

  it('requires identity/access for purchase, rsvp and auth but not support', () => {
    expect(capabilityRequiresIdentityAccess('purchase')).toBe(true);
    expect(capabilityRequiresIdentityAccess('rsvp')).toBe(true);
    expect(capabilityRequiresIdentityAccess('auth')).toBe(true);
    expect(capabilityRequiresIdentityAccess('support')).toBe(false);
    expect(capabilityRequiresIdentityAccess(null)).toBe(false);
  });

  it('continues bare turns without transfer, churn, or owner loss', () => {
    const assisting = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'support',
    });
    const continued = applyOwnerForTurn({
      plan: assisting,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, supportWork: true },
      transfersThisTurn: 0,
    });
    expect(continued.transferred).toBe(false);
    expect(continued.plan).toBe(assisting);
    const purchasing = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'purchase',
    });
    const bare = applyOwnerForTurn({
      plan: purchasing,
      signals: emptyOwnerDomainSignals,
      capabilitySignals: emptyCustomerCapabilitySignals,
      transfersThisTurn: 0,
    });
    expect(bare.transferred).toBe(false);
    expect(bare.owner).toBe('customer_assistance');
  });
});

describe('l4 cross-owner sequences with exact effects', () => {
  it('planning to FAQ to planning preserves selections with two transfers', () => {
    let plan = planWithSelection();
    const toFaq = applyOwnerForTurn({
      plan,
      signals: { ...emptyOwnerDomainSignals, faqWork: true },
      capabilitySignals: emptyCustomerCapabilitySignals,
      transfersThisTurn: 0,
    });
    expect(toFaq.transferred).toBe(true);
    expect(toFaq.owner).toBe('faq');
    plan = toFaq.plan;
    const backToPlanning = applyOwnerForTurn({
      plan,
      signals: { ...emptyOwnerDomainSignals, planningWork: true },
      capabilitySignals: emptyCustomerCapabilitySignals,
      transfersThisTurn: 0,
    });
    expect(backToPlanning.transferred).toBe(true);
    expect(backToPlanning.owner).toBe('planning');
    expect(backToPlanning.plan.selected_provider_ids).toEqual([12]);
    expect(backToPlanning.plan.owner_return).toBe('faq');
  });

  it('gates FAQ to assistance transfers on grounded identity, mixed work included', () => {
    const faq = mergePlan(testPlan(), { owner: 'faq' });
    const blocked = applyOwnerForTurn({
      plan: faq,
      signals: {
        ...emptyOwnerDomainSignals,
        customerWork: true,
        protectedTaskRequested: true,
        identityAccessGrounded: false,
      },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, purchaseWork: true },
      transfersThisTurn: 0,
    });
    expect(blocked.transferred).toBe(false);
    expect(blocked.owner).toBe('faq');
    const mixed: Parameters<typeof applyOwnerForTurn>[0] = {
      plan: faq,
      signals: {
        ...emptyOwnerDomainSignals,
        faqWork: true,
        customerWork: true,
        protectedTaskRequested: true,
        identityAccessGrounded: false,
      },
      capabilitySignals: {
        ...emptyCustomerCapabilitySignals,
        purchaseWork: true,
        supportWork: true,
      },
      transfersThisTurn: 0,
    };
    expect(applyOwnerForTurn(mixed).transferred).toBe(false);
    expect(applyOwnerForTurn(mixed).owner).toBe('faq');
    expect(
      applyOwnerForTurn({
        ...mixed,
        signals: {
          ...mixed.signals,
          faqWork: false,
          identityAccessGrounded: true,
        },
      }).owner,
    ).toBe('customer_assistance');
    const allowed = applyOwnerForTurn({
      plan: faq,
      signals: {
        ...emptyOwnerDomainSignals,
        customerWork: true,
        protectedTaskRequested: true,
        identityAccessGrounded: true,
      },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, purchaseWork: true },
      transfersThisTurn: 0,
      pendingTask: 'purchase:req-1',
      pendingQuestion: '¿Cuál pedido quieres revisar?',
    });
    expect(allowed.transferred).toBe(true);
    expect(allowed.owner).toBe('customer_assistance');
    expect(allowed.capability).toBe('purchase');
    expect(allowed.plan.owner_pending_task).toBe('purchase:req-1');
    expect(allowed.plan.owner_pending_question).toBe('¿Cuál pedido quieres revisar?');
    expect(allowed.transfersThisTurn).toBe(1);
  });

  it('purchase ambiguity to RSVP read to purchase clarification keeps the question', () => {
    let plan = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'purchase',
      owner_pending_question: '¿De qué evento es esta compra?',
    });
    const rsvpRead = applyOwnerForTurn({
      plan,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, rsvpWork: true },
      transfersThisTurn: 0,
    });
    expect(rsvpRead.capability).toBe('rsvp');
    expect(rsvpRead.plan.owner_pending_question).toBe('¿De qué evento es esta compra?');
    plan = rsvpRead.plan;
    const clarified = applyOwnerForTurn({
      plan,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, purchaseWork: true },
      transfersThisTurn: 0,
      pendingQuestion: null,
    });
    expect(clarified.capability).toBe('purchase');
    expect(clarified.plan.owner_pending_question).toBeNull();
  });

  it('confirmed submission to uncertain to repeat keeps the owner with no new task', () => {    const finished = mergePlan(testPlan(), {
      owner: 'planning',
      lifecycle_state: 'finished',
    });
    const uncertain = applyOwnerForTurn({
      plan: finished,
      signals: emptyOwnerDomainSignals,
      capabilitySignals: emptyCustomerCapabilitySignals,
      transfersThisTurn: 0,
    });
    expect(uncertain.transferred).toBe(false);
    expect(uncertain.owner).toBe('planning');
    const repeat = applyOwnerForTurn({
      plan: uncertain.plan,
      signals: emptyOwnerDomainSignals,
      capabilitySignals: emptyCustomerCapabilitySignals,
      transfersThisTurn: 0,
    });
    expect(repeat.transferred).toBe(false);
    expect(repeat.plan.owner_pending_task).toBeNull();
  });

  it('resumes a paused owner without losing its pending task', () => {
    const paused = mergePlan(testPlan(), {
      owner: 'faq',
      owner_return: 'planning',
      owner_pending_task: 'faq:open',
    });
    const resumed = resumeReturnOwner(paused);
    expect(resumed.owner).toBe('planning');
    expect(resumed.owner_return).toBeNull();
    expect(resumed.owner_pending_task).toBe('faq:open');
    const fresh = testPlan();
    expect(resumeReturnOwner(fresh)).toBe(fresh);
  });
});
