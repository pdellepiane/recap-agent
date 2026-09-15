import { describe, expect, it } from 'vitest';

import {
  createEmptyPlan,
  mergePlan,
  normalizeRawPlan,
  ownerValues,
  planSchema,
  type PlanOwner,
  type PlanSnapshot,
} from '../src/core/plan';
import {
  applyOwnerForTurn,
  applyOwnerTransfer,
  capabilityRequiresIdentityAccess,
  emptyCustomerCapabilitySignals,
  emptyOwnerDomainSignals,
  isPlanOwner,
  resolveCustomerCapability,
  resolveInitialOwner,
  resolveOwnerForTurn,
  resumeReturnOwner,
} from '../src/runtime/owner-routing';
import { ownerForNode, ownerNodeSets } from '../src/runtime/prompt-manifest';

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

  it('keeps the established owner without a mandatory router call', () => {
    expect(
      resolveOwnerForTurn({
        currentOwner: 'customer_assistance',
        signals: { ...emptyOwnerDomainSignals, customerWork: true },
      }),
    ).toBe('customer_assistance');
    expect(
      resolveOwnerForTurn({
        currentOwner: 'faq',
        signals: { ...emptyOwnerDomainSignals, faqWork: true },
      }),
    ).toBe('faq');
    expect(
      resolveOwnerForTurn({
        currentOwner: 'planning',
        signals: emptyOwnerDomainSignals,
      }),
    ).toBe('planning');
  });

  it('proposes a transfer only when the current domain has no work', () => {
    expect(
      resolveOwnerForTurn({
        currentOwner: 'planning',
        signals: { ...emptyOwnerDomainSignals, planningWork: true, faqWork: true },
      }),
    ).toBe('planning');
    expect(
      resolveOwnerForTurn({
        currentOwner: 'planning',
        signals: { ...emptyOwnerDomainSignals, faqWork: true },
      }),
    ).toBe('faq');
  });
});

describe('l4 single-transfer bound', () => {
  it('applies one silent transfer with a return owner and no announcement', () => {
    const result = applyOwnerTransfer({
      from: 'planning',
      to: 'faq',
      transfersThisTurn: 0,
      identityAccessGrounded: false,
      protectedTaskRequested: false,
    });
    expect(result).toEqual({
      transferred: true,
      owner: 'faq',
      transfersThisTurn: 1,
      returnOwner: 'planning',
    });
  });

  it('fails a second same-turn transfer while a real switch still succeeds', () => {
    const second = applyOwnerTransfer({
      from: 'faq',
      to: 'customer_assistance',
      transfersThisTurn: 1,
      identityAccessGrounded: true,
      protectedTaskRequested: true,
    });
    expect(second.transferred).toBe(false);
    if (!second.transferred) {
      expect(second.reason).toBe('transfer_budget_exhausted');
      expect(second.owner).toBe('faq');
    }
    const first = applyOwnerTransfer({
      from: 'faq',
      to: 'customer_assistance',
      transfersThisTurn: 0,
      identityAccessGrounded: true,
      protectedTaskRequested: true,
    });
    expect(first.transferred).toBe(true);
  });

  it('gates FAQ to person-specific assistance on grounded identity/access', () => {
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
  });

  it('rejects same-owner transfers without consuming budget', () => {
    const result = applyOwnerTransfer({
      from: 'faq',
      to: 'faq',
      transfersThisTurn: 0,
      identityAccessGrounded: false,
      protectedTaskRequested: false,
    });
    expect(result.transferred).toBe(false);
    if (!result.transferred) {
      expect(result.reason).toBe('same_owner');
      expect(result.transfersThisTurn).toBe(0);
    }
  });
});

describe('l4 capability slices without churn', () => {
  it('prioritizes auth over purchase over rsvp with support as default', () => {
    expect(
      resolveCustomerCapability({ ...emptyCustomerCapabilitySignals, supportWork: true }),
    ).toBe('support');
    expect(
      resolveCustomerCapability({
        ...emptyCustomerCapabilitySignals,
        purchaseWork: true,
        rsvpWork: true,
        supportWork: true,
      }),
    ).toBe('purchase');
    expect(
      resolveCustomerCapability({
        ...emptyCustomerCapabilitySignals,
        authWork: true,
        purchaseWork: true,
      }),
    ).toBe('auth');
    expect(
      resolveCustomerCapability({ ...emptyCustomerCapabilitySignals, rsvpWork: true }),
    ).toBe('rsvp');
  });

  it('switches capabilities without a transfer or unrelated disclosure', () => {
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
  });

  it('requires identity/access for purchase, rsvp and auth but not support', () => {
    expect(capabilityRequiresIdentityAccess('purchase')).toBe(true);
    expect(capabilityRequiresIdentityAccess('rsvp')).toBe(true);
    expect(capabilityRequiresIdentityAccess('auth')).toBe(true);
    expect(capabilityRequiresIdentityAccess('support')).toBe(false);
    expect(capabilityRequiresIdentityAccess(null)).toBe(false);
  });

  it('returns the identical plan object on no-tool continuations', () => {
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

  it('FAQ to assistance waits for identity then transfers with a task ref', () => {
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

  it('support to RSVP to support switches slices with zero transfers', () => {
    let plan = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'support',
    });
    const toRsvp = applyOwnerForTurn({
      plan,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, rsvpWork: true },
      transfersThisTurn: 0,
    });
    expect(toRsvp.transferred).toBe(false);
    expect(toRsvp.capability).toBe('rsvp');
    plan = toRsvp.plan;
    const backToSupport = applyOwnerForTurn({
      plan,
      signals: { ...emptyOwnerDomainSignals, customerWork: true },
      capabilitySignals: { ...emptyCustomerCapabilitySignals, supportWork: true },
      transfersThisTurn: 0,
    });
    expect(backToSupport.transferred).toBe(false);
    expect(backToSupport.capability).toBe('support');
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

  it('mixed FAQ and protected purchase stays gated until identity is grounded', () => {    const faq = mergePlan(testPlan(), { owner: 'faq' });
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
  });

  it('keeps Customer assistance on bare continuations without new domain work', () => {
    const assisting = mergePlan(testPlan(), {
      owner: 'customer_assistance',
      owner_capability: 'purchase',
    });
    const continued = applyOwnerForTurn({
      plan: assisting,
      signals: emptyOwnerDomainSignals,
      capabilitySignals: emptyCustomerCapabilitySignals,
      transfersThisTurn: 0,
    });
    expect(continued.transferred).toBe(false);
    expect(continued.owner).toBe('customer_assistance');
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

describe('l4 owner node map', () => {
  it('covers invitation responses under Customer operations only', () => {
    expect(ownerForNode('responder_invitacion')).toBe('customer_assistance');
    expect(ownerForNode('resolver_consultas_informativas')).toBe('faq');
    const assistance: PlanOwner = 'customer_assistance';
    expect(ownerForNode('resolver_consultas_informativas', assistance)).toBe(
      'customer_assistance',
    );
    expect(ownerForNode('entrevista')).toBe('planning');
    expect(ownerForNode('crear_lead_cerrar')).toBe('planning');
    expect(ownerNodeSets.faq).toEqual(['resolver_consultas_informativas']);
    expect(ownerNodeSets.customer_assistance).toContain('responder_invitacion');
  });
});
