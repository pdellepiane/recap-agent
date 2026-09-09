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

  it('unavailable-unique exposes one approved order with absent code, amount and currency and no carts', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s13-reference-unavailable-unique');
    const parts = split(UNIQUE_PHONE);
    const result = await gateway.getGuestOrdersByPhone(parts);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.purchases).toHaveLength(1);
    expect(result.carts ?? []).toEqual([]);
    const purchase = result.purchases[0];
    expect(purchase).toBeDefined();
    if (!purchase) return;
    expect(purchase.eventName).toBe('Evento de prueba A');
    expect(purchase.paymentStatus).toBe('approved');
    expect(purchase.customerTransactionNumber).toBeNull();
    expect(purchase.grandTotal).toBeNull();
    expect(purchase.currency).toBeNull();
    expect(purchase.orderId).toBe('order-s13-unavailable-unique-01');
    expect(purchase.orderId).not.toContain('301816');
  });

  it('matched keeps backend ids separate and requested reference is not an internal id filter', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s13-reference-matched');
    const parts = split(MATCHED_PHONE);
    const requested = parseOrderReference('COD301816');
    expect(requested).toEqual({ kind: 'customer_transaction', transactionNumber: '301816' });
    const lookupOrderId = requested?.kind === 'backend_order_id' ? requested.orderId : null;
    expect(lookupOrderId).toBeNull();
    const result = await gateway.getGuestOrdersByPhone({ ...parts, orderId: lookupOrderId });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.purchases).toHaveLength(2);
    expect(result.carts ?? []).toEqual([]);
    const byRef = new Map(result.purchases.map((p) => [p.customerTransactionNumber, p]));
    const matchA = byRef.get('301816');
    const matchB = byRef.get('301817');
    expect(matchA?.eventName).toBe('Evento de prueba A');
    expect(matchB?.eventName).toBe('Evento de prueba B');
    expect(matchA?.orderId).toBe('order-s13-matched-a-01');
    expect(matchB?.orderId).toBe('order-s13-matched-b-01');
    expect(matchA?.orderId).not.toBe('301816');
    expect(normalizeBackendCustomerTransactionNumber('301816')).toBe('301816');
    const selected = result.purchases.filter((p) => p.customerTransactionNumber === '301816');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.eventName).toBe('Evento de prueba A');
  });

  it('unavailable-multiple has two candidates without references and authorized totals for disambiguation', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s13-reference-unavailable-multiple');
    const parts = split(MULTIPLE_PHONE);
    const result = await gateway.getGuestOrdersByPhone(parts);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.purchases).toHaveLength(2);
    expect(result.carts ?? []).toEqual([]);
    for (const purchase of result.purchases) {
      expect(purchase.customerTransactionNumber).toBeNull();
    }
    const events = result.purchases.map((p) => p.eventName).sort();
    expect(events).toEqual(['Evento de prueba A', 'Evento de prueba B']);
    const statuses = new Set(result.purchases.map((p) => p.paymentStatus));
    expect(statuses.size).toBe(2);
    for (const purchase of result.purchases) {
      expect(typeof purchase.grandTotal).toBe('number');
      expect(purchase.currency).toBe('PEN');
    }
    const requested = parseOrderReference('COD301816');
    expect(requested?.kind).toBe('customer_transaction');
    const matches = result.purchases.filter((p) => p.customerTransactionNumber === '301816');
    expect(matches).toHaveLength(0);
  });
});
