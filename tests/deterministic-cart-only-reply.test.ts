import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { AgentService } from '../src/runtime/agent-service';
import type { InformationTaskResult } from '../src/core/information';
import type { ExtractionResult, AgentRuntime } from '../src/runtime/contracts';
import type { TurnMessageContext } from '../src/runtime/turn-message-context';
import type { PlanStore } from '../src/storage/plan-store';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type { PromptLoader } from '../src/runtime/prompt-loader';

function createService(): AgentService {
  const planStore = {
    getByExternalUser: async () => null,
    save: async () => undefined,
  } as unknown as PlanStore;
  const runtime = {
    extract: async () => ({ extraction: {} }) as unknown as ExtractionResult,
    composeReply: async () => ({ text: 'llm reply', structuredMessage: { type: 'generic', paragraphs_es: ['llm reply'] } }),
  } as unknown as AgentRuntime;
  const providerGateway = {} as unknown as ProviderGateway;
  const promptLoader = {
    loadNodeBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
    loadExtractorBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
  } as unknown as PromptLoader;
  return new AgentService({
    planStore,
    runtime,
    providerGateway,
    promptLoader,
    renderers: {},
  });
}

function makeMessageContext(hasRecovery: boolean): TurnMessageContext {
  const recentMessages = hasRecovery
    ? [
        {
          direction: 'outbound' as const,
          body: 'Hola Sonia Maribel, hiciste un regalo para Carlos & Adriana pero no terminaste el proceso. Puedes completarlo aqui: https://sinenvolturas.com/cart/recover/ea14739a-4064-4791-a646-aa24b799d2da',
          source: 'campaign' as const,
          timestamp: new Date().toISOString(),
        },
      ]
    : [
        {
          direction: 'outbound' as const,
          body: 'Hola, gracias por escribirnos',
          source: 'campaign' as const,
          timestamp: new Date().toISOString(),
        },
      ];
  return {
    historyStatus: 'available',
    recentMessages: recentMessages as unknown as TurnMessageContext['recentMessages'],
    retrievedMessageCount: recentMessages.length,
  } as TurnMessageContext;
}

function makePurchaseResult(
  purchases: unknown[],
  carts: Array<{ wasAbandoned?: boolean; eventName?: string | null }>,
  opts: { needsSelection?: boolean; status?: string } = {},
): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'purchase',
    status: (opts.status ?? 'completed') as 'completed',
    resource: 'orders',
    purchases: purchases as unknown as InformationTaskResult & { purchases: unknown[]; carts: unknown[] } extends { purchases: infer P } ? P : never,
    carts: carts as unknown as InformationTaskResult & { carts: unknown[] } extends { carts: infer C } ? C : never,
    needsSelection: opts.needsSelection ?? false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'partial',
  } as unknown as InformationTaskResult;
}

function makeExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    contactPhone: null,
    phoneConfirmation: null,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    ...overrides,
  } as unknown as ExtractionResult;
}

describe('deterministic cart-only abandoned reply', () => {
  it('renders exact deterministic text with policy and contains required clauses', () => {
    const service = createService();
    const render = (service as unknown as { renderDeterministicCartOnlyAbandonedReply: (e: string, p: boolean) => string }).renderDeterministicCartOnlyAbandonedReply.bind(service);
    const text = render('Carlos and Adriana', true);
    expect(text).toBe(
      'Al revisar las compras y carritos asociados a tu numero de WhatsApp encontre un carrito abandonado para Carlos and Adriana que no se completo. Puedes retomarlo desde el enlace de recuperacion que ya te enviamos en esta conversacion. Si completas el pago por transferencia, la confirmacion puede tardar hasta 72 horas habiles.',
    );
    expect(text).toContain('Al revisar las compras y carritos asociados a tu numero de WhatsApp');
    expect(text).toContain('carrito abandonado para Carlos and Adriana que no se completo');
    expect(text).toContain('que ya te enviamos en esta conversacion');
    expect(text).toContain('Si completas el pago por transferencia, la confirmacion puede tardar hasta 72 horas habiles');
  });

  it('deterministic text without policy omits 72h clause and stays exact', () => {
    const service = createService();
    const render = (service as unknown as { renderDeterministicCartOnlyAbandonedReply: (e: string, p: boolean) => string }).renderDeterministicCartOnlyAbandonedReply.bind(service);
    const text = render('Carlos and Adriana', false);
    expect(text).toBe(
      'Al revisar las compras y carritos asociados a tu numero de WhatsApp encontre un carrito abandonado para Carlos and Adriana que no se completo. Puedes retomarlo desde el enlace de recuperacion que ya te enviamos en esta conversacion.',
    );
    expect(text).not.toContain('72 horas');
    expect(text).not.toContain('transferencia');
  });

  it('deterministic text has no forbidden phrases, no URL, no correo, no gift count', () => {
    const service = createService();
    const render = (service as unknown as { renderDeterministicCartOnlyAbandonedReply: (e: string, p: boolean) => string }).renderDeterministicCartOnlyAbandonedReply.bind(service);
    const text = render('Carlos and Adriana', true).toLowerCase();
    expect(text).not.toContain('no encontramos ninguna compra');
    expect(text).not.toContain('no se encontro ningun pedido');
    expect(text).not.toContain('no existe');
    expect(text).not.toContain('correo');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('http://');
    expect(text).not.toContain('otp');
    expect(text).not.toContain('approved');
    // no digits-only gift count like "2 regalos" should not appear
    expect(text).not.toMatch(/\b\d+\s*regalo/);
    // no amount like "150" standalone? the template itself contains no digits
    expect(text).not.toMatch(/\b150\b/);
  });

  it('narrow guard true only for cart-only abandoned + trusted path + no unresolved need', () => {
    const service = createService();
    const guard = (service as unknown as { isDeterministicCartOnlyState: (a: unknown) => boolean }).isDeterministicCartOnlyState.bind(service);
    const ctx = makeMessageContext(true);
    const extraction = makeExtraction();
    const purchaseResult = makePurchaseResult([], [{ wasAbandoned: true, eventName: 'Carlos and Adriana' }]);
    const informationResults: InformationTaskResult[] = [
      purchaseResult,
      {
        requestId: 'information-payment-options-policy',
        kind: 'faq',
        status: 'completed',
        evidence: [],
      } as unknown as InformationTaskResult,
    ];
    expect(
      guard({
        phonePurchaseResult: purchaseResult as unknown as { status: string; kind: string; purchases?: unknown[]; carts?: Array<{ wasAbandoned?: boolean; eventName?: string | null }> },
        messageContext: ctx,
        informationResults,
        extraction,
      }),
    ).toBe(true);
  });

  it('guard false without trusted recovery path', () => {
    const service = createService();
    const guard = (service as unknown as { isDeterministicCartOnlyState: (a: unknown) => boolean }).isDeterministicCartOnlyState.bind(service);
    const ctx = makeMessageContext(false);
    const extraction = makeExtraction();
    const purchaseResult = makePurchaseResult([], [{ wasAbandoned: true, eventName: 'Carlos and Adriana' }]);
    const informationResults: InformationTaskResult[] = [purchaseResult];
    expect(
      guard({
        phonePurchaseResult: purchaseResult as unknown as { status: string; kind: string; purchases?: unknown[]; carts?: Array<{ wasAbandoned?: boolean; eventName?: string | null }> },
        messageContext: ctx,
        informationResults,
        extraction,
      }),
    ).toBe(false);
  });

  it('guard false for active cart', () => {
    const service = createService();
    const guard = (service as unknown as { isDeterministicCartOnlyState: (a: unknown) => boolean }).isDeterministicCartOnlyState.bind(service);
    const ctx = makeMessageContext(true);
    const extraction = makeExtraction();
    const purchaseResult = makePurchaseResult([], [{ wasAbandoned: false, eventName: 'Carlos and Adriana' }]);
    const informationResults: InformationTaskResult[] = [purchaseResult];
    expect(
      guard({
        phonePurchaseResult: purchaseResult as unknown as { status: string; kind: string; purchases?: unknown[]; carts?: Array<{ wasAbandoned?: boolean; eventName?: string | null }> },
        messageContext: ctx,
        informationResults,
        extraction,
      }),
    ).toBe(false);
  });

  it('guard false for mixed order+cart', () => {
    const service = createService();
    const guard = (service as unknown as { isDeterministicCartOnlyState: (a: unknown) => boolean }).isDeterministicCartOnlyState.bind(service);
    const ctx = makeMessageContext(true);
    const extraction = makeExtraction();
    const purchaseResult = makePurchaseResult(
      [{ orderId: 'ord-1', eventName: 'Carlos and Adriana' }],
      [{ wasAbandoned: true, eventName: 'Carlos and Adriana' }],
    );
    const informationResults: InformationTaskResult[] = [purchaseResult];
    expect(
      guard({
        phonePurchaseResult: purchaseResult as unknown as { status: string; kind: string; purchases?: unknown[]; carts?: Array<{ wasAbandoned?: boolean; eventName?: string | null }> },
        messageContext: ctx,
        informationResults,
        extraction,
      }),
    ).toBe(false);
  });

  it('guard false when unresolved additional need present', () => {
    const service = createService();
    const guard = (service as unknown as { isDeterministicCartOnlyState: (a: unknown) => boolean }).isDeterministicCartOnlyState.bind(service);
    const ctx = makeMessageContext(true);
    const extraction = makeExtraction();
    const purchaseResult = makePurchaseResult([], [{ wasAbandoned: true, eventName: 'Carlos and Adriana' }]);
    const informationResults: InformationTaskResult[] = [
      purchaseResult,
      {
        requestId: 'information-2',
        kind: 'purchase',
        status: 'needs_input',
        nextInput: 'email',
        guidance: { reason: 'email_required', email: null, requirements: [] },
      } as unknown as InformationTaskResult,
    ];
    expect(
      guard({
        phonePurchaseResult: purchaseResult as unknown as { status: string; kind: string; purchases?: unknown[]; carts?: Array<{ wasAbandoned?: boolean; eventName?: string | null }> },
        messageContext: ctx,
        informationResults,
        extraction,
      }),
    ).toBe(false);
  });

  it('guard false for ambiguous extraction', () => {
    const service = createService();
    const guard = (service as unknown as { isDeterministicCartOnlyState: (a: unknown) => boolean }).isDeterministicCartOnlyState.bind(service);
    const ctx = makeMessageContext(true);
    const extraction = makeExtraction({
      ambiguity: { status: 'ambiguous', clarificationQuestion: 'cual?', interpretations: [] },
    } as unknown as Partial<ExtractionResult>);
    const purchaseResult = makePurchaseResult([], [{ wasAbandoned: true, eventName: 'Carlos and Adriana' }]);
    const informationResults: InformationTaskResult[] = [purchaseResult];
    expect(
      guard({
        phonePurchaseResult: purchaseResult as unknown as { status: string; kind: string; purchases?: unknown[]; carts?: Array<{ wasAbandoned?: boolean; eventName?: string | null }> },
        messageContext: ctx,
        informationResults,
        extraction,
      }),
    ).toBe(false);
  });

  it('deterministic file contains exact template and guard', () => {
    const agentPath = path.resolve(process.cwd(), 'src/runtime/agent-service.ts');
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).toContain('isDeterministicCartOnlyState');
    expect(content).toContain('renderDeterministicCartOnlyAbandonedReply');
    expect(content).toContain('Al revisar las compras y carritos asociados a tu numero de WhatsApp encontre un carrito abandonado para');
    expect(content).toContain('que no se completo. Puedes retomarlo desde el enlace de recuperacion que ya te enviamos en esta conversacion.');
    expect(content).toContain('Si completas el pago por transferencia, la confirmacion puede tardar hasta 72 horas habiles');
    expect(content).toContain('hasTrustedCartRecoveryPath');
    expect(content).toContain('deterministic:cart_only_abandoned');
  });

  it('registry contains new deterministic entry with hex placeholder', () => {
    const coveragePath = path.resolve(process.cwd(), 'evals/live-behavior-coverage.yaml');
    const coverage = fs.readFileSync(coveragePath, 'utf8');
    expect(coverage).toContain('deterministic-cart-only-abandoned-reply');
    expect(coverage).toMatch(/deterministic-cart-only-abandoned-reply[\s\S]*?implementedBy:\s*[0-9a-f]{7,40}/);
    expect(coverage).toContain('live_behavior.abandoned_cart_only_sonia');
  });
});
