import { describe, expect, it } from 'vitest';

import type {
  PurchaseInformation,
  PurchasePaymentDetails,
} from '../src/core/information';
import { projectPurchaseEvidenceItems } from '../src/runtime/information-orchestrator';
import {
  buildFixturePurchaseRecords,
  buildLivePurchaseFactLines,
  projectLivePurchaseFacts,
  type FixturePurchaseWorld,
} from '../src/evals/purchase-evidence';
import { turnTraceSchema, type EvalTurnResult } from '../src/evals/case-schema';

function payment(overrides: Partial<PurchasePaymentDetails> = {}): PurchasePaymentDetails {
  return {
    method: 'Yape',
    amount: 87.36,
    paidAt: '2026-10-17T20:31:00.000Z',
    paymentId: 'pay-internal-123',
    transactionStatus: 'approved',
    gatewayMessage: null,
    operationCode: 'mobile-payment',
    originBank: null,
    voucherProvided: false,
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseInformation> = {}): PurchaseInformation {
  return {
    orderId: 'ORD-307431',
    paymentStatus: 'approved',
    shippingStatus: null,
    grandTotal: 87.36,
    currency: 'PEN',
    currencySymbol: 'S/',
    paymentMethod: 'Yape',
    eventName: 'Baby Shower Mirta',
    eventDate: '2026-10-17',
    eventUrl: null,
    createdAt: '2026-10-15',
    items: [],
    ...overrides,
  };
}

function liveTurn(evidence: unknown[]): EvalTurnResult {
  return {
    turnIndex: 0,
    trace: {
      information_execution_summary: [{
        requestId: 'purchase-1',
        kind: 'purchase',
        status: 'completed',
        source: 'agent_api',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'b'.repeat(64),
        evidence,
        resultCount: 1,
        durationMs: 5,
      }],
    },
  } as unknown as EvalTurnResult;
}

function liveEvidence(purchaseFact: Record<string, unknown>): unknown[] {
  return [{
    fileId: '',
    filename: '',
    score: 0,
    contentHash: 'd'.repeat(64),
    purchaseFact,
  }];
}

describe('purchase evidence facts', () => {
  it('carries the host receipt and the payment summary of an approved purchase', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({
      isThanked: true,
      thanks: { message: 'Hemos recibido tu regalo', sendMethod: 'whatsapp' },
      payment: payment(),
    })]);

    const fact = entry?.purchaseFact;
    expect(fact?.thanksPresent).toBe(true);
    expect(fact?.thanksMessage).toBe('Hemos recibido tu regalo');
    expect(fact?.thanksSendMethod).toBe('whatsapp');
    expect(fact?.paymentStatus).toBe('approved');
    expect(fact?.payment).toMatchObject({
      method: 'Yape',
      amount: 87.36,
      paidAt: '2026-10-17T20:31:00.000Z',
      transactionStatus: 'approved',
      operationCode: 'mobile-payment',
      voucherProvided: false,
      declineCode: null,
    });
  });

  it('reports no host receipt when the record carries none', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({ isThanked: null, thanks: null })]);

    expect(entry?.purchaseFact?.thanksPresent).toBe(false);
    expect(entry?.purchaseFact?.thanksMessage).toBeNull();
    expect(entry?.purchaseFact?.thanksSendMethod).toBeNull();
  });

  it('labels the charged total apart from the gift value', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({
      grandTotal: 87.36,
      items: [{
        giftName: 'Cambiador portátil',
        quantity: 1,
        amount: 79,
        rowTotal: 79,
        type: 'credit',
        fulfillment: { kind: 'host_credit', chosenBy: 'host', giftShipmentApplicable: false },
      }],
    })]);

    const fact = entry?.purchaseFact;
    expect(fact?.amounts?.charged_total).toEqual({
      value: 87.36,
      currency: 'PEN',
      currencySymbol: 'S/',
    });
    expect(fact?.amounts?.gift_value).toEqual([{
      value: 79,
      currency: 'PEN',
      currencySymbol: 'S/',
      itemName: 'Cambiador portátil',
    }]);
    expect(fact?.amounts?.reported_amount).toBeNull();
    // The two amounts stay distinguishable instead of collapsing into one.
    expect(fact?.amounts?.charged_total?.value).not.toBe(fact?.amounts?.gift_value[0]?.value);
    // The existing flat fields survive the labeled structure.
    expect(fact?.total).toBe(87.36);
    expect(fact?.items?.[0]?.amount).toBe(79);
    expect(fact?.items?.[0]?.rowTotal).toBe(79);
  });

  it('emits the reference value only when the record carries one', () => {
    const [present, absent] = projectPurchaseEvidenceItems([
      purchase({ customerTransactionNumber: '309553' }),
      purchase({ orderId: 'ORD-307432' }),
    ]);

    expect(present?.purchaseFact?.referencePresent).toBe(true);
    expect(present?.purchaseFact?.reference).toBe('309553');
    expect(absent?.purchaseFact?.referencePresent).toBe(false);
    expect(absent?.purchaseFact?.reference).toBeNull();
  });

  it('keeps the private dedication message redacted', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({
      dedication: {
        message: 'Secreto',
        isPrivate: true,
        sendPhysical: false,
        physicalStatus: null,
      },
    })]);

    expect(entry?.purchaseFact?.dedication).toEqual({
      message: null,
      sendPhysical: false,
      physicalStatus: null,
    });
  });

  it('reflects the gateway outcome of a declined card record', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({
      grandTotal: 398.53,
      paymentStatus: 'declined',
      declineCode: 'insufficient_funds',
      payment: payment({
        method: 'PayU',
        amount: 398.53,
        paidAt: null,
        transactionStatus: 'declined',
        gatewayMessage: 'card declined',
        operationCode: null,
        voucherProvided: null,
      }),
    })]);

    const fact = entry?.purchaseFact;
    expect(fact?.paymentStatus).toBe('declined');
    expect(fact?.payment?.transactionStatus).toBe('declined');
    expect(fact?.payment?.gatewayMessage).toBe('card declined');
    expect(fact?.payment?.declineCode).toBe('insufficient_funds');
    expect(fact?.payment?.paidAt).toBeNull();
    expect(fact?.amounts?.charged_total?.value).toBe(398.53);
  });

  it('never projects the gateway payment id, the destination account or the voucher location', () => {
    const [entry] = projectPurchaseEvidenceItems([purchase({
      payment: payment({
        paymentId: 'pay-internal-123',
        voucherImage: 'https://voucher.example/secret.png',
        destinationAccount: {
          holder: 'Ana Cerdan',
          bank: 'Interbank',
          number: '123456789',
          cci: '123',
          type: 'ahorro',
        },
      }),
    })]);

    const serialized = JSON.stringify(entry?.purchaseFact?.payment ?? null);
    expect(serialized).not.toContain('pay-internal-123');
    expect(serialized).not.toContain('voucher.example');
    expect(serialized).not.toContain('Ana Cerdan');
    expect(serialized).not.toContain('123456789');
  });
});

describe('purchase evidence facts in the eval projection', () => {
  it('projects the new facts from a typed live purchase fact', () => {
    const facts = projectLivePurchaseFacts([liveTurn(liveEvidence({
      eventLabel: 'Baby Shower Mirta',
      total: 87.36,
      currency: 'PEN',
      currencySymbol: 'S/',
      paymentMethod: 'Yape',
      paymentStatus: 'approved',
      eventDate: '2026-10-17',
      createdAt: '2026-10-15',
      referencePresent: true,
      reference: '309553',
      thanksPresent: true,
      thanksMessage: 'Hemos recibido tu regalo',
      thanksSendMethod: 'whatsapp',
      payment: {
        method: 'Yape',
        amount: 87.36,
        paidAt: '2026-10-17T20:31:00.000Z',
        transactionStatus: 'approved',
        gatewayMessage: null,
        operationCode: 'mobile-payment',
        originBank: null,
        voucherProvided: false,
        declineCode: null,
      },
      amounts: {
        charged_total: { value: 87.36, currency: 'PEN', currencySymbol: 'S/' },
        gift_value: [{ value: 79, currency: 'PEN', currencySymbol: 'S/', itemName: 'Cambiador portátil' }],
        reported_amount: null,
      },
      items: [{ name: 'Cambiador portátil', quantity: 1, amount: 79, rowTotal: 79, fulfillment: 'host_credit' }],
    }))]);

    expect(facts).toHaveLength(1);
    const fact = facts[0];
    expect(fact?.thanksPresent).toBe(true);
    expect(fact?.thanksMessage).toBe('Hemos recibido tu regalo');
    expect(fact?.payment?.transactionStatus).toBe('approved');
    expect(fact?.reference).toBe('309553');
    expect(fact?.amounts?.charged_total?.value).toBe(87.36);
    expect(fact?.amounts?.gift_value[0]?.value).toBe(79);
    expect(fact?.amounts?.gift_value[0]?.itemName).toBe('Cambiador portátil');

    const text = buildLivePurchaseFactLines([liveTurn(liveEvidence({
      eventLabel: 'Baby Shower Mirta',
      total: 87.36,
      currency: 'PEN',
      currencySymbol: 'S/',
      paymentMethod: 'Yape',
      paymentStatus: 'approved',
      eventDate: '2026-10-17',
      createdAt: '2026-10-15',
      referencePresent: true,
      reference: '309553',
      thanksPresent: true,
      thanksMessage: 'Hemos recibido tu regalo',
      thanksSendMethod: 'whatsapp',
      payment: {
        method: 'Yape',
        amount: 87.36,
        paidAt: '2026-10-17T20:31:00.000Z',
        transactionStatus: 'approved',
        gatewayMessage: null,
        operationCode: 'mobile-payment',
        originBank: null,
        voucherProvided: false,
        declineCode: null,
      },
      amounts: {
        charged_total: { value: 87.36, currency: 'PEN', currencySymbol: 'S/' },
        gift_value: [{ value: 79, currency: 'PEN', currencySymbol: 'S/', itemName: 'Cambiador portátil' }],
        reported_amount: null,
      },
    }))]).join('\n');
    expect(text).toContain('total_cargado=87.36');
    expect(text).toContain('valores_regalo=[Cambiador portátil=79');
    expect(text).toContain('monto_reportado=desconocido');
    expect(text).toContain('resultado_gateway=approved');
    expect(text).toContain('agradecimiento=[presente');
    expect(text).toContain('referencia_cliente=presente valor=309553');
  });

  it('reads the host receipt, the payment block and the reference from the fixture world', () => {
    const world: FixturePurchaseWorld = {
      guestGiftPurchases: {
        '+51900001303': {
          purchases: [{
            id: 'gift-mirta',
            increment_id: '309553',
            payment_status: 'approved',
            shipping_status: null,
            grand_total: 87.36,
            currency_code: 'PEN',
            currency_symbol: 'S/',
            payment_method: 'Yape',
            is_thanked: true,
            thanks: { message: 'Hemos recibido tu regalo', send_method: 'whatsapp' },
            event_name: 'Baby Shower Mirta',
            event_date: '2026-10-17',
            created_at: '2026-10-15',
            items: [{ gift_name: 'Cambiador portátil', quantity: 1, amount: 79, row_total: 79, type: 'credit' }],
            payment: {
              method: 'Yape',
              amount: 87.36,
              paid_at: '2026-10-17 20:31:00',
              transaction_status: 'approved',
              op_code: 'mobile-payment',
            },
          }],
        },
      },
    };

    const records = buildFixturePurchaseRecords(world, ['+51900001303']);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.customerReferencePresent).toBe(true);
    expect(record?.customerReference).toBe('309553');
    expect(record?.thanksPresent).toBe(true);
    expect(record?.thanksMessage).toBe('Hemos recibido tu regalo');
    expect(record?.thanksSendMethod).toBe('whatsapp');
    expect(record?.payment?.transactionStatus).toBe('approved');
    expect(record?.payment?.operationCode).toBe('mobile-payment');
    expect(record?.amounts?.charged_total).toEqual({
      value: 87.36,
      currencyCode: 'PEN',
      currencySymbol: 'S/',
    });
    expect(record?.amounts?.gift_value).toEqual([{
      value: 79,
      currencyCode: 'PEN',
      currencySymbol: 'S/',
      itemName: 'Cambiador portátil',
    }]);
    expect(record?.amounts?.reported_amount).toBeNull();
  });

  it('keeps an internal identifier out of the projected reference value', () => {
    const world: FixturePurchaseWorld = {
      guestOrders: {
        '+51900001303': {
          pending_orders: [{
            id: 'order-1',
            increment_id: 'internal-order-77',
            payment_status: 'pending',
            grand_total: 120.5,
            event_name: 'Evento de prueba',
            event_date: '2026-09-12',
            created_at: '2026-08-22',
            items: [],
          }],
          completed_orders: [],
          carts: [],
        },
      },
    };

    const records = buildFixturePurchaseRecords(world, ['+51900001303']);
    expect(records[0]?.customerReferencePresent).toBe(true);
    expect(records[0]?.customerReference).toBeNull();
  });

  it('keeps historical stored traces loadable', () => {
    const base = {
      trace_id: 't1',
      conversation_id: null,
      plan_id: 'p1',
      previous_node: 'contacto_inicial',
      next_node: 'resolver_consultas_informativas',
      node_path: ['contacto_inicial', 'resolver_consultas_informativas'],
      intent: null,
      missing_fields: [],
      search_ready: false,
      prompt_bundle_id: 'b1',
      prompt_file_paths: [],
      tools_considered: [],
      tools_called: [],
      tool_outputs: [],
      provider_results: [],
      plan_persisted: true,
      plan_persist_reason: 'test',
      timing_ms: {
        total: 0,
        load_plan: 0,
        prepare_working_plan: 0,
        extraction: 0,
        apply_extraction: 0,
        compute_sufficiency: 0,
        provider_search: 0,
        provider_enrichment: 0,
        prompt_bundle_load: 0,
        compose_reply: 0,
        save_plan: 0,
      },
      token_usage: {
        classifier: null,
        extraction: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        reply: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    };
    const summary = (purchaseFact: Record<string, unknown>) => [{
      requestId: 'purchase-1',
      kind: 'purchase',
      status: 'completed',
      source: 'agent_api',
      outcomeCode: 'completed_with_results',
      retryable: null,
      queryHash: 'b'.repeat(64),
      evidence: [{
        fileId: '',
        filename: '',
        score: 0,
        contentHash: 'd'.repeat(64),
        purchaseFact,
      }],
      resultCount: 1,
      durationMs: 5,
    }];
    const historical = {
      ...base,
      information_execution_summary: summary({
        eventLabel: 'Evento',
        total: 10,
        currency: 'PEN',
        currencySymbol: 'S/',
        paymentMethod: 'Yape',
        paymentStatus: 'approved',
        eventDate: '2026-09-12',
        createdAt: '2026-08-22',
        referencePresent: false,
      }),
    };

    const parsed = turnTraceSchema.safeParse(historical);
    expect(parsed.success).toBe(true);

    const extended = {
      ...base,
      information_execution_summary: summary({
        eventLabel: 'Evento',
        total: 10,
        currency: 'PEN',
        currencySymbol: 'S/',
        paymentMethod: 'Yape',
        paymentStatus: 'approved',
        eventDate: '2026-09-12',
        createdAt: '2026-08-22',
        referencePresent: true,
        reference: '309553',
        thanksPresent: true,
        thanksMessage: 'Gracias',
        thanksSendMethod: 'whatsapp',
        payment: {
          method: 'Yape',
          amount: 10,
          paidAt: '2026-09-01 11:00:00',
          transactionStatus: 'approved',
          gatewayMessage: null,
          operationCode: 'mobile-payment',
          originBank: null,
          voucherProvided: false,
          declineCode: null,
        },
        amounts: {
          charged_total: { value: 10, currency: 'PEN', currencySymbol: 'S/' },
          gift_value: [{ value: 8, currency: 'PEN', currencySymbol: 'S/', itemName: 'Regalo' }],
          reported_amount: null,
        },
      }),
    };

    const parsedExtended = turnTraceSchema.safeParse(extended);
    expect(parsedExtended.success).toBe(true);
    if (!parsedExtended.success) return;
    const fact = parsedExtended.data.information_execution_summary[0]?.evidence[0]?.purchaseFact;
    expect(fact?.reference).toBe('309553');
    expect(fact?.thanksPresent).toBe(true);
    expect(fact?.payment?.transactionStatus).toBe('approved');
    expect(fact?.amounts?.charged_total?.value).toBe(10);
  });
});
