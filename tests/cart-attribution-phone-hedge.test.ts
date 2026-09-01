import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cart reply attribution and hedge fix', () => {
  it('operational note cart clause requires explicit phone attribution and hedge suppression', () => {
    const agentServicePath = path.resolve(process.cwd(), 'src/runtime/agent-service.ts');
    const content = fs.readFileSync(agentServicePath, 'utf8');
    // Change 1 - explicit phone attribution
    expect(content).toContain('al revisar las compras y carritos asociados a tu numero de WhatsApp');
    expect(content).toContain('encontraste el carrito al revisar las compras y carritos asociados a tu numero de WhatsApp');
    // still retains existing constraints
    expect(content).toContain('en esta conversacion; no afirmes que se envio por correo ni menciones otro canal de envio, sin inventar ni repetir la URL');
    expect(content).toContain('ruta de recuperación para este carrito');
    expect(content).toContain('carrito abandonado');
    // Change 2 - hedge source is agent-service.ts:3442 partial coverage base, cart-only suppresses generic hedge
    // base partial note still present at 3442
    expect(content).toContain('aclara brevemente que la cobertura es parcial');
    // cart-only clause suppresses vague hedge
    expect(content).toContain('no anadas hedges genericos sobre informacion parcial');
    // precise qualification removed - must NOT be present (judge read as near-denial 0.72)
    expect(content).not.toContain('no hay compras registradas');
    expect(content).not.toContain('lo asociado a tu numero es el carrito abandonado');
    // grounded transfer availability fact (only when policy present)
    expect(content).toContain('La transferencia bancaria figura como opcion general para completar la compra segun la politica indexada de medios de pago.');
    // must not introduce forbidden purchase-not-found phrases verbatim in the cart instruction as positive output
    // check cart clause specifically does not contain the hard forbidden phrases
    const cartClauseStart = content.indexOf('al revisar las compras y carritos asociados a tu numero de WhatsApp');
    const cartClause = cartClauseStart >= 0 ? content.slice(cartClauseStart, cartClauseStart + 800) : '';
    expect(cartClause.toLowerCase()).not.toContain('no encontramos ninguna compra');
    expect(cartClause.toLowerCase()).not.toContain('no se encontro ningun pedido');
    // hedge suppression uses negation "sin usar frases de compra no encontrada" not the verbatim forbidden string "no existe"
    expect(cartClause.toLowerCase()).not.toContain('no existe');
    // cart clause must not contain 72h window language (ungrounded for cart)
    expect(cartClause.toLowerCase()).not.toContain('72 horas');
    expect(cartClause.toLowerCase()).not.toContain('72h');
    expect(cartClause.toLowerCase()).not.toContain('ventana');
  });

  it('response contract hedge source is not the origin', () => {
    const contractPath = path.resolve(process.cwd(), 'prompts/nodes/resolver_consultas_informativas/response_contract.txt');
    const contract = fs.readFileSync(contractPath, 'utf8');
    expect(contract).not.toContain('cobertura es parcial');
    expect(contract).not.toContain('informacion disponible es parcial');
  });

  it('registry contains explicit phone attribution entry with valid SHA', () => {
    const coveragePath = path.resolve(process.cwd(), 'evals/live-behavior-coverage.yaml');
    const coverage = fs.readFileSync(coveragePath, 'utf8');
    expect(coverage).toContain('fix-cart-reply-explicit-phone-attribution');
    expect(coverage).toMatch(/fix-cart-reply-explicit-phone-attribution[\s\S]*?implementedBy:\s*[0-9a-f]{7,40}/);
    expect(coverage).toContain('live_behavior.abandoned_cart_only_sonia');
  });
});
