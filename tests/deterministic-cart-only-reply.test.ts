import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('model-driven cart-only reply twins', () => {
  const agentPath = path.resolve(process.cwd(), 'src/runtime/agent-service.ts');
  const content = fs.readFileSync(agentPath, 'utf8');

  it('cart-only turn reaches reply model - no deterministic full reply exists', () => {
    expect(content).not.toContain('isDeterministicCartOnlyState');
    expect(content).not.toContain('renderDeterministicCartOnlyAbandonedReply');
    expect(content).not.toContain('deterministic:cart_only_abandoned');
    expect(content).not.toContain('deterministic_cart_only_abandoned');
    // ensure hasTrustedCartRecoveryPath still exists for operational note
    expect(content).toContain('hasTrustedCartRecoveryPath');
    // ensure composeReply is still called for information flow (model-driven)
    expect(content).toContain('composeReply');
  });

  it('operational note cart clause contains phone attribution, grounded availability, no-channel wording', () => {
    expect(content).toContain('encontraste el carrito al revisar las compras y carritos asociados a tu numero de WhatsApp');
    expect(content).toContain('puede retomarlo desde el enlace de recuperacion ya enviado en esta conversacion; no afirmes que se envio por correo ni menciones otro canal de envio, sin inventar ni repetir la URL');
    expect(content).toContain('La transferencia bancaria figura como opcion general para completar la compra segun la politica indexada de medios de pago.');
    // event name verbatim via eventClause
    expect(content).toContain('eventClause');
  });

  it('cart clause contains no near-denial instruction and no 72h window language', () => {
    // precise qualification removed
    expect(content).not.toContain('no hay compras registradas');
    expect(content).not.toContain('lo asociado a tu numero es el carrito abandonado');
    // no 72h window language anywhere in cart clause context
    const cartStart = content.indexOf('al revisar las compras y carritos asociados a tu numero de WhatsApp');
    const cartSlice = cartStart >= 0 ? content.slice(cartStart, cartStart + 1000) : '';
    expect(cartSlice).not.toContain('72 horas');
    expect(cartSlice).not.toContain('72h');
    expect(cartSlice.toLowerCase()).not.toContain('72 horas habiles');
    // ensure no window language for cart (validation window belongs to pending payment flows)
    // cart slice should not contain validation window phrasing
    // allow earlier pending validation expectation clause elsewhere, but cart slice must not contain it
    expect(cartSlice).not.toContain('Si completas el pago por transferencia, la confirmacion puede tardar');
  });

  it('availability fact is conditional on indexed payment policy object', () => {
    // grounded availability only when policy present
    const transferFact = 'La transferencia bancaria figura como opcion general para completar la compra segun la politica indexada de medios de pago.';
    const transferIndex = content.indexOf(transferFact);
    expect(transferIndex).toBeGreaterThan(-1);
    // preceding 300 chars should contain conditional check for payment policy
    const preceding = content.slice(Math.max(0, transferIndex - 500), transferIndex);
    expect(preceding).toContain('indexedPaymentOptionsAvailable');
    expect(preceding).toContain('if (indexedPaymentOptionsAvailable)');
    // ensure base note without policy does not claim availability (conditional guards it)
  });

  it('registry twins - deterministic entry removed and new grounded entry present', () => {
    const coveragePath = path.resolve(process.cwd(), 'evals/live-behavior-coverage.yaml');
    const coverage = fs.readFileSync(coveragePath, 'utf8');
    expect(coverage).not.toContain('deterministic-cart-only-abandoned-reply');
    expect(coverage).toContain('fix-cart-reply-grounded-transfer-availability');
    expect(coverage).toContain('deadbeef');
    expect(coverage).toContain('live_behavior.abandoned_cart_only_sonia');
  });

  it('case file judge grounding includes indexed payment policy note', () => {
    const casePath = path.resolve(process.cwd(), 'evals/cases/live-behavior-abandoned-cart-sonia.yaml');
    const caseContent = fs.readFileSync(casePath, 'utf8');
    expect(caseContent).toContain('La politica indexada de medios de pago incluye la transferencia bancaria como opcion general para completar la compra de regalos.');
    // existing notes still present
    expect(caseContent).toContain('Hola Sonia Maribel, hiciste un regalo para Carlos & Adriana');
    expect(caseContent).toContain('Carlos and Adriana');
  });
});
