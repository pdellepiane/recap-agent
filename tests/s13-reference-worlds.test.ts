import { describe, expect, it } from 'vitest';

import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';
import { parseOrderReference, normalizeBackendCustomerTransactionNumber } from '../src/core/order-reference';
import { parseInternationalPhone, splitInternationalPhone } from '../src/runtime/phone';

const UNIQUE_PHONE = '+51900001301';
const MATCHED_PHONE = '+51900001302';
const MULTIPLE_PHONE = '+51900001303';

function split(phone: string): { phone_extension: string; phone_number: string } {
  const parts = splitInternationalPhone(phone);
  if (!parts) throw new Error(`Invalid fixture phone ${phone}`);
  return parts;
}

describe('s13 reference worlds adapter contract', () => {
  it('pins fixture-only inbound phones through the canonical normalizer', () => {
    for (const phone of [UNIQUE_PHONE, MATCHED_PHONE, MULTIPLE_PHONE]) {
      const parsed = parseInternationalPhone(phone);
      expect(parsed.status).toBe('valid');
      if (parsed.status === 'valid') {
        expect(parsed.countryCode).toBe('+51');
        expect(parsed.digits).toBe(phone.replace(/\D/gu, ''));
      }
      expect(splitInternationalPhone(phone)).not.toBeNull();
    }
    const uniqueParts = split(UNIQUE_PHONE);
    expect(`${uniqueParts.phone_extension.replace(/\D/gu, '')}${uniqueParts.phone_number}`).toBe('51900001301');
  });

  it('separates backend ids from customer references across unavailable and matched worlds', async () => {
    // Unavailable-unique: one approved order with absent code, amount, and currency, no carts.
    const uniqueGateway = await FixtureAgentConversationGateway.create('s13-reference-unavailable-unique');
    const uniqueResult = await uniqueGateway.getGuestOrdersByPhone(split(UNIQUE_PHONE));
    expect(uniqueResult.status).toBe('success');
    if (uniqueResult.status !== 'success') return;
    expect(uniqueResult.purchases).toHaveLength(1);
    expect(uniqueResult.carts ?? []).toEqual([]);
    const unique = uniqueResult.purchases[0];
    expect(unique).toBeDefined();
    if (!unique) return;
    expect(unique.eventName).toBe('Evento de prueba A');
    expect(unique.paymentStatus).toBe('approved');
    expect(unique.customerTransactionNumber).toBeNull();
    expect(unique.grandTotal).toBeNull();
    expect(unique.currency).toBeNull();
    expect(unique.orderId).toBe('order-s13-unavailable-unique-01');
    expect(unique.orderId).not.toContain('301816');
    // Matched: a requested reference is not an internal id filter.
    const matchedGateway = await FixtureAgentConversationGateway.create('s13-reference-matched');
    const requested = parseOrderReference('COD301816');
    expect(requested).toEqual({ kind: 'customer_transaction', transactionNumber: '301816' });
    const lookupOrderId = requested?.kind === 'backend_order_id' ? requested.orderId : null;
    expect(lookupOrderId).toBeNull();
    const matchedResult = await matchedGateway.getGuestOrdersByPhone({ ...split(MATCHED_PHONE), orderId: lookupOrderId });
    expect(matchedResult.status).toBe('success');
    if (matchedResult.status !== 'success') return;
    expect(matchedResult.purchases).toHaveLength(2);
    expect(matchedResult.carts ?? []).toEqual([]);
    const byRef = new Map(matchedResult.purchases.map((p) => [p.customerTransactionNumber, p]));
    const matchA = byRef.get('301816');
    const matchB = byRef.get('301817');
    expect(matchA?.eventName).toBe('Evento de prueba A');
    expect(matchB?.eventName).toBe('Evento de prueba B');
    expect(matchA?.orderId).toBe('order-s13-matched-a-01');
    expect(matchB?.orderId).toBe('order-s13-matched-b-01');
    expect(matchA?.orderId).not.toBe('301816');
    expect(normalizeBackendCustomerTransactionNumber('301816')).toBe('301816');
    const selected = matchedResult.purchases.filter((p) => p.customerTransactionNumber === '301816');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.eventName).toBe('Evento de prueba A');
    // Unavailable-multiple: two candidates without references, authorized totals for disambiguation.
    const multipleGateway = await FixtureAgentConversationGateway.create('s13-reference-unavailable-multiple');
    const multipleResult = await multipleGateway.getGuestOrdersByPhone(split(MULTIPLE_PHONE));
    expect(multipleResult.status).toBe('success');
    if (multipleResult.status !== 'success') return;
    expect(multipleResult.purchases).toHaveLength(2);
    expect(multipleResult.carts ?? []).toEqual([]);
    for (const purchase of multipleResult.purchases) {
      expect(purchase.customerTransactionNumber).toBeNull();
    }
    const events = multipleResult.purchases.map((p) => p.eventName).sort();
    expect(events).toEqual(['Evento de prueba A', 'Evento de prueba B']);
    const statuses = new Set(multipleResult.purchases.map((p) => p.paymentStatus));
    expect(statuses.size).toBe(2);
    for (const purchase of multipleResult.purchases) {
      expect(typeof purchase.grandTotal).toBe('number');
      expect(purchase.currency).toBe('PEN');
    }
    const unmatched = parseOrderReference('COD301816');
    expect(unmatched?.kind).toBe('customer_transaction');
    const matches = multipleResult.purchases.filter((p) => p.customerTransactionNumber === '301816');
    expect(matches).toHaveLength(0);
  });
});
