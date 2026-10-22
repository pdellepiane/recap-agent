import { describe, expect, it } from 'vitest';

import {
  emptySupportOutcomeState,
  mergeSupportOutcomeState,
} from '../src/core/information';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import {
  classifySupportOutcomeResultKind,
  computeSupportOutcomeSignature,
  deriveRequiresNextStep,
  nextSupportOutcomeRepeatCount,
  supportOutcomeComponentsFromSnapshot,
  type SupportOutcomeComponents,
} from '../src/runtime/support-outcome';
import {
  createEntryCustomerSnapshot,
  type CustomerContextSnapshot,
} from '../src/runtime/customer-context';
import type { PurchaseInformation } from '../src/core/information';

const purchase: PurchaseInformation = {
  orderId: 'ORD_6ab970ab70802',
  paymentStatus: 'approved',
  shippingStatus: null,
  grandTotal: 87.36,
  paymentMethod: 'Yape o Plin',
  eventName: 'Baby Shower',
  eventDate: '2026-10-17',
  eventUrl: null,
  currency: 'PEN',
  createdAt: '2026-09-27',
  items: [],
  customerTransactionNumber: null,
  isThanked: true,
};

function snapshotWith(purchases: readonly PurchaseInformation[]): CustomerContextSnapshot {
  const base = createEntryCustomerSnapshot({
    identity: null,
    currentContext: null,
    nowIso: '2026-10-20T00:00:00.000Z',
  });
  return {
    ...base,
    purchasesCarts: {
      ...base.purchasesCarts,
      status: purchases.length > 0 ? 'ready' : 'empty',
      purchases: [...purchases],
    },
  };
}

const baseComponents: SupportOutcomeComponents = {
  resultKind: 'resolved',
  status: 'ready',
  orderIds: ['ORD_6ab970ab70802'],
  paymentStatuses: ['approved'],
  referenceResolution: 'matched',
  coverage: 'complete',
};

describe('support outcome signature', () => {
  it('is stable for equal component tuples', () => {
    const first = computeSupportOutcomeSignature(baseComponents);
    const second = computeSupportOutcomeSignature({ ...baseComponents });

    expect(first.signature).toBe(second.signature);
    expect(first.signature).toMatch(/^[a-f0-9]{16}$/u);
    expect(first.unresolvedMoney).toBe(false);
  });

  it('changes when any component of the tuple changes', () => {
    const base = computeSupportOutcomeSignature(baseComponents).signature;

    expect(computeSupportOutcomeSignature({
      ...baseComponents,
      resultKind: 'reference_unavailable',
    }).signature).not.toBe(base);
    expect(computeSupportOutcomeSignature({
      ...baseComponents,
      status: 'empty',
    }).signature).not.toBe(base);
    expect(computeSupportOutcomeSignature({
      ...baseComponents,
      orderIds: ['ORD_other'],
    }).signature).not.toBe(base);
    expect(computeSupportOutcomeSignature({
      ...baseComponents,
      paymentStatuses: ['declined'],
    }).signature).not.toBe(base);
    expect(computeSupportOutcomeSignature({
      ...baseComponents,
      referenceResolution: 'unavailable',
    }).signature).not.toBe(base);
    expect(computeSupportOutcomeSignature({
      ...baseComponents,
      coverage: 'partial',
    }).signature).not.toBe(base);
  });

  it('ignores the order in which the ids and statuses arrive', () => {
    const ordered = computeSupportOutcomeSignature({
      ...baseComponents,
      orderIds: ['ORD_a', 'ORD_b'],
      paymentStatuses: ['approved', 'pending'],
    }).signature;
    const shuffled = computeSupportOutcomeSignature({
      ...baseComponents,
      orderIds: ['ORD_b', 'ORD_a'],
      paymentStatuses: ['pending', 'approved'],
    }).signature;

    expect(shuffled).toBe(ordered);
  });

  it('classifies the three unresolved money shapes', () => {
    expect(classifySupportOutcomeResultKind({
      orderIds: ['ORD_1'],
      paymentStatuses: ['approved'],
      referenceResolution: 'unavailable',
      turnCarriedReceiptMedia: false,
      priorReportedPayment: null,
    })).toBe('reference_unavailable');

    expect(classifySupportOutcomeResultKind({
      orderIds: [],
      paymentStatuses: [],
      referenceResolution: 'none',
      turnCarriedReceiptMedia: true,
      priorReportedPayment: null,
    })).toBe('empty_read_with_receipt');

    expect(classifySupportOutcomeResultKind({
      orderIds: ['ORD_1'],
      paymentStatuses: ['declined'],
      referenceResolution: 'matched',
      turnCarriedReceiptMedia: false,
      priorReportedPayment: {
        amount: 391.87,
        currency: 'PEN',
        method: 'Yape o Plin',
        claimedSuccess: true,
      },
    })).toBe('declined_vs_reported_success');

    expect(classifySupportOutcomeResultKind({
      orderIds: ['ORD_1'],
      paymentStatuses: ['approved'],
      referenceResolution: 'matched',
      turnCarriedReceiptMedia: false,
      priorReportedPayment: null,
    })).toBe('resolved');
  });

  it('marks the unresolved kinds as unresolved money', () => {
    const components = supportOutcomeComponentsFromSnapshot({
      snapshot: snapshotWith([]),
      referenceResolution: 'none',
      turnCarriedReceiptMedia: true,
      priorReportedPayment: null,
    });

    expect(components.resultKind).toBe('empty_read_with_receipt');
    expect(computeSupportOutcomeSignature(components).unresolvedMoney).toBe(true);
  });

  it('reads the components from the canonical customer-context snapshot', () => {
    const components = supportOutcomeComponentsFromSnapshot({
      snapshot: snapshotWith([purchase]),
      referenceResolution: 'matched',
      turnCarriedReceiptMedia: false,
      priorReportedPayment: null,
    });

    expect(components.resultKind).toBe('resolved');
    expect(components.orderIds).toEqual(['ORD_6ab970ab70802']);
    expect(components.paymentStatuses).toEqual(['approved']);
    expect(components.status).toBe('ready');
    expect(computeSupportOutcomeSignature(components).unresolvedMoney).toBe(false);
  });
});

describe('support outcome repeat counter', () => {
  it('increments on a repeated signature and restarts on a change', () => {
    const first = nextSupportOutcomeRepeatCount({
      currentSignature: null,
      currentRepeatCount: 0,
      nextSignature: 'sig-a',
    });
    expect(first).toBe(1);

    const second = nextSupportOutcomeRepeatCount({
      currentSignature: 'sig-a',
      currentRepeatCount: first,
      nextSignature: 'sig-a',
    });
    expect(second).toBe(2);

    const changed = nextSupportOutcomeRepeatCount({
      currentSignature: 'sig-a',
      currentRepeatCount: second,
      nextSignature: 'sig-b',
    });
    expect(changed).toBe(1);
  });

  it('keeps the stored count when there is no new signature', () => {
    expect(nextSupportOutcomeRepeatCount({
      currentSignature: 'sig-a',
      currentRepeatCount: 3,
      nextSignature: null,
    })).toBe(3);
  });
});

describe('support outcome next-step requirement', () => {
  it('does not require a next step once the request was answered', () => {
    expect(deriveRequiresNextStep({
      requestState: 'answered',
      paymentStatuses: ['approved'],
    })).toBe(false);
  });

  it('requires a next step when the request is open in any of its states', () => {
    for (const requestState of ['unresolved', 'needs_input', 'with_person'] as const) {
      expect(deriveRequiresNextStep({
        requestState,
        paymentStatuses: ['approved'],
      })).toBe(true);
    }
    // The code treats an absent record as not answered, so the thread still
    // has to move. The reply layer only calls this with `answered` or
    // `unresolved`, so this is a contract assertion rather than a live path.
    expect(deriveRequiresNextStep({
      requestState: null,
      paymentStatuses: [],
    })).toBe(true);
  });

  it('requires a next step for a payment status outside approved and pending', () => {
    expect(deriveRequiresNextStep({
      requestState: 'answered',
      paymentStatuses: ['declined'],
    })).toBe(true);
    expect(deriveRequiresNextStep({
      requestState: 'answered',
      paymentStatuses: ['approved', 'pending'],
    })).toBe(false);
    expect(deriveRequiresNextStep({
      requestState: 'answered',
      paymentStatuses: [null, ''],
    })).toBe(false);
  });
});

describe('support outcome state merge', () => {
  it('keeps the repeat count through partial updates and resets on a new signature', () => {
    const plan = mergePlan(createEmptyPlan({
      planId: 'memory-plan', channel: 'whatsapp', externalUserId: 'memory-user',
    }), {
      support_outcome: {
        signature: 'sig-a', repeat_count: 2, unresolved_money: true,
      },
    });
    const partial = mergePlan(plan, {
      support_outcome: { signature: 'sig-a', updated_at: '2026-10-21T00:00:00.000Z' },
    });
    expect(partial.support_outcome).toMatchObject({
      signature: 'sig-a', repeat_count: 2,
    });
    const postCompose = mergePlan(partial, {
      support_outcome: { ...partial.support_outcome, reported_payment: null },
    });
    expect(postCompose.support_outcome).toMatchObject({
      signature: 'sig-a', repeat_count: 2,
    });
    expect(mergePlan(postCompose, {
      support_outcome: { signature: 'sig-b', repeat_count: 1, unresolved_money: false },
    }).support_outcome).toMatchObject({
      signature: 'sig-b', repeat_count: 1, unresolved_money: false,
    });
  });

  it('keeps the larger repeat count for the same signature', () => {
    const merged = mergeSupportOutcomeState(
      {
        ...emptySupportOutcomeState(),
        signature: 'sig-a',
        repeat_count: 3,
        unresolved_money: true,
        updated_at: '2026-10-20T00:00:00.000Z',
      },
      {
        ...emptySupportOutcomeState(),
        signature: 'sig-a',
        repeat_count: 2,
        unresolved_money: true,
        updated_at: '2026-10-20T00:01:00.000Z',
      },
    );

    expect(merged.repeat_count).toBe(3);
    expect(merged.signature).toBe('sig-a');
  });

  it('resets the streak when the signature changes', () => {
    const merged = mergeSupportOutcomeState(
      {
        ...emptySupportOutcomeState(),
        signature: 'sig-a',
        repeat_count: 4,
        unresolved_money: true,
        updated_at: '2026-10-20T00:00:00.000Z',
      },
      {
        ...emptySupportOutcomeState(),
        signature: 'sig-b',
        repeat_count: 1,
        unresolved_money: false,
        updated_at: '2026-10-20T00:01:00.000Z',
      },
    );

    expect(merged.signature).toBe('sig-b');
    expect(merged.repeat_count).toBe(1);
    expect(merged.unresolved_money).toBe(false);
  });

  it('leaves the state untouched when the incoming signature is null', () => {
    const current = {
      ...emptySupportOutcomeState(),
      signature: 'sig-a',
      repeat_count: 2,
      unresolved_money: true,
      updated_at: '2026-10-20T00:00:00.000Z',
    };

    expect(mergeSupportOutcomeState(current, emptySupportOutcomeState())).toEqual(current);
  });

  it('stores the state on the plan and keeps old plans loadable', () => {
    const plan = createEmptyPlan({
      planId: 'plan-1',
      channel: 'terminal_whatsapp',
      externalUserId: 'user-1',
    });
    expect(plan.support_outcome).toEqual(emptySupportOutcomeState());

    const merged = mergePlan(plan, {
      support_outcome: {
        signature: 'sig-a',
        repeat_count: 1,
        unresolved_money: true,
        updated_at: '2026-10-20T00:00:00.000Z',
      },
    });
    expect(merged.support_outcome.signature).toBe('sig-a');
    expect(merged.support_outcome.repeat_count).toBe(1);

    const repeated = mergePlan(merged, {
      support_outcome: {
        signature: 'sig-a',
        repeat_count: 2,
        unresolved_money: true,
        updated_at: '2026-10-20T00:01:00.000Z',
      },
    });
    expect(repeated.support_outcome.repeat_count).toBe(2);
  });
});
