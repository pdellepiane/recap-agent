import { describe, expect, it } from 'vitest';

import {
  normalizeBackendCustomerTransactionNumber,
  normalizeExtractedOrderReference,
  parseOrderReference,
} from '../src/core/order-reference';

describe('order reference normalization', () => {
  it.each([
    ['COD301816', '301816'],
    ['cod 301816', '301816'],
    ['COD-301816', '301816'],
    ['COD_026064', '026064'],
    ['301816', '301816'],
  ])('normalizes customer transaction reference %s', (input, expected) => {
    expect(parseOrderReference(input)).toEqual({
      kind: 'customer_transaction',
      transactionNumber: expected,
    });
    expect(normalizeExtractedOrderReference(input)).toBe(expected);
  });

  it('preserves opaque backend order identifiers', () => {
    expect(parseOrderReference('ORD_6a8f0f25af72e')).toEqual({
      kind: 'backend_order_id',
      orderId: 'ORD_6a8f0f25af72e',
    });
    expect(normalizeExtractedOrderReference(' ORD-000880 ')).toBe('ORD-000880');
  });

  it('normalizes documented backend increment ids without accepting arbitrary ids', () => {
    expect(normalizeBackendCustomerTransactionNumber('COD301816')).toBe('301816');
    expect(normalizeBackendCustomerTransactionNumber(301816)).toBe('301816');
    expect(normalizeBackendCustomerTransactionNumber('ORD_opaque')).toBeNull();
  });
});
