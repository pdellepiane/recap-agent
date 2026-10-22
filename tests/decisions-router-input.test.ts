import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import type { CartInformation, PurchaseInformation } from '../src/core/information';
import { buildCapabilityDigest } from '../src/runtime/capability-digest';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import {
  buildRouterInput,
  loadRouterInputTemplate,
  type RouterInputArgs,
} from '../src/runtime/decisions-router-input';
import { loadRouterQuestions } from '../src/runtime/decisions-router-questions';
import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  createEntryCustomerSnapshot,
  type CustomerContextSnapshot,
} from '../src/runtime/customer-context';

/** Explicit byte budget for the rendered router input. */
const ROUTER_INPUT_BYTE_BUDGET = 16_000;

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

const declinedPurchase: PurchaseInformation = {
  ...purchase,
  orderId: 'ORD_6ad637da04583',
  paymentStatus: 'declined',
  grandTotal: 403.53,
  eventName: 'Nicolas',
  currency: 'PEN',
  customerTransactionNumber: 'COD309553',
  isThanked: false,
  thanks: undefined,
};

const cart: CartInformation = {
  cartId: 'cart:470893',
  status: 'abandoned',
  wasAbandoned: true,
  subtotal: 464.86,
  items: [],
};

function snapshotWith(
  purchases: readonly PurchaseInformation[],
  carts: readonly CartInformation[],
): CustomerContextSnapshot {
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
      completeness: 'complete',
      purchases: [...purchases],
      carts: [...carts],
    },
  };
}

function routerArgs(overrides: Partial<RouterInputArgs> = {}): RouterInputArgs {
  const plan = createEmptyPlan({
    planId: 'plan-1',
    channel: 'terminal_whatsapp',
    externalUserId: 'user-1',
  });
  return {
    currentMessage: { text: 'Por favor devuelvan mi dinero', hasImage: false },
    recentMessages: [
      { direction: 'inbound', preview: 'mensaje 1' },
      { direction: 'outbound', preview: 'mensaje 2' },
    ],
    snapshot: snapshotWith([purchase], [cart]),
    capabilityDigest: buildCapabilityDigest(buildRuntimeCapabilityManifest()),
    plan: {
      ...plan,
      conversation_health: {
        ...plan.conversation_health,
        consecutive_non_progress_turns: 3,
        capability_blocked_streak: 0,
        help_offer_status: 'offered',
      },
      support_outcome: {
        signature: 'abc123def4567890',
        repeat_count: 2,
        unresolved_money: true,
        limitation_already_stated: false,
        prior_limitation_turns: 0,
        updated_at: '2026-10-20T00:00:00.000Z',
      },
    },
    ...overrides,
  };
}

async function loadTemplate(): Promise<string> {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
  const template = await loadRouterInputTemplate(loader);
  return template.template;
}

describe('decisions router input builder', () => {
  it('renders exactly the fields Decision 1 fixes', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(routerArgs(), template);

    const labels = [...rendered.matchAll(/^([a-z_]+):/gmu)].map((match) => match[1]);

    expect(labels).toEqual([
      'mensaje_actual',
      'imagen_actual',
      'mensajes_previos',
      'compras',
      'carritos',
      'capacidades',
      'resultado_turno',
      'derivacion_pendiente',
      'turnos_sin_avance',
    ]);
  });

  it('projects the purchase, cart, capability and outcome facts', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(routerArgs(), template);

    expect(rendered).toContain('Por favor devuelvan mi dinero');
    expect(rendered).toContain('imagen_actual: false');
    expect(rendered).toContain('"orderId":"ORD_6ab970ab70802"');
    expect(rendered).toContain('"eventName":"Baby Shower"');
    expect(rendered).toContain('"paymentStatus":"approved"');
    expect(rendered).toContain('"grandTotal":87.36');
    expect(rendered).toContain('"currency":"PEN"');
    expect(rendered).toContain('"referencePresent":false');
    expect(rendered).toContain('"thanksPresent":true');
    expect(rendered).toContain('"pending":false');
    expect(rendered).toContain('"declined":false');
    expect(rendered).toContain('"cartId":"cart:470893"');
    expect(rendered).toContain('"subtotal":464.86');
    expect(rendered).toContain('"id":"refund_or_withdrawal.execute"');
    expect(rendered).toContain('"class":"unsupported"');
    expect(rendered).toContain('"signature":"abc123def4567890"');
    expect(rendered).toContain('"repeatCount":2');
    expect(rendered).toContain('derivacion_pendiente: true');
    expect(rendered).toContain('turnos_sin_avance: 3');
  });

  it('marks the pending and declined purchase flags', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(routerArgs({
      snapshot: snapshotWith([declinedPurchase], []),
    }), template);

    expect(rendered).toContain('"paymentStatus":"declined"');
    expect(rendered).toContain('"declined":true');
    expect(rendered).toContain('"pending":false');
    expect(rendered).toContain('"referencePresent":true');
    expect(rendered).toContain('"thanksPresent":false');
  });

  it('keeps at most the last five message previews', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(routerArgs({
      recentMessages: Array.from({ length: 8 }, (_, index) => ({
        direction: index % 2 === 0 ? 'inbound' as const : 'outbound' as const,
        preview: `mensaje ${index}`,
      })),
    }), template);

    expect(rendered).not.toContain('mensaje 0');
    expect(rendered).not.toContain('mensaje 2');
    expect(rendered).toContain('mensaje 3');
    expect(rendered).toContain('mensaje 7');
  });

  it('is deterministic and stays inside the byte budget', async () => {
    const template = await loadTemplate();
    const args = routerArgs();
    const first = buildRouterInput(args, template);
    const second = buildRouterInput(args, template);

    expect(first).toBe(second);

    const bytes = Buffer.byteLength(first, 'utf8');
    expect(bytes).toBeLessThanOrEqual(ROUTER_INPUT_BYTE_BUDGET);
    // Reported measurement for the acceptance perf gate.
    console.info(`rendered router input bytes: ${bytes}`);
  });

  it('stays inside the byte budget on a heavy turn', async () => {
    const template = await loadTemplate();
    const heavy = routerArgs({
      currentMessage: { text: 'a'.repeat(2_000), hasImage: true },
      recentMessages: Array.from({ length: 5 }, (_, index) => ({
        direction: index % 2 === 0 ? 'inbound' as const : 'outbound' as const,
        preview: 'b'.repeat(240),
      })),
      snapshot: snapshotWith(
        [purchase, declinedPurchase, purchase, declinedPurchase],
        [cart, cart, cart, cart],
      ),
    });

    const rendered = buildRouterInput(heavy, template);
    const bytes = Buffer.byteLength(rendered, 'utf8');
    expect(bytes).toBeLessThanOrEqual(ROUTER_INPUT_BYTE_BUDGET);
    console.info(`rendered heavy router input bytes: ${bytes}`);
  });

  it('loads the four fixed questions from the tracked prompt files', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const loaded = await loadRouterQuestions(loader);

    expect(loaded.questions.map((question) => question.name)).toEqual([
      'needs_human_now',
      'capability_blocked',
      'route',
      'loop_risk',
    ]);
    const route = loaded.questions.find((question) => question.name === 'route');
    expect(route?.type).toBe('choice');
    if (route?.type !== 'choice') return;
    expect(route.choices.map((choice) => choice.value)).toEqual([
      'answer_with_records',
      'ask_clarification',
      'offer_human',
      'escalate_human',
      'rsvp_flow',
      'planning_flow',
      'suppress_ack',
    ]);
    expect(new Set(route.choices.map((choice) => choice.description)).size).toBe(7);

    const loopRisk = loaded.questions.find((question) => question.name === 'loop_risk');
    expect(loopRisk?.type).toBe('score');
    if (loopRisk?.type !== 'score') return;
    expect(loopRisk.levels.map((level) => level.label)).toEqual(['0', '1', '2', '3', '4']);
    expect(new Set(loopRisk.levels.map((level) => level.description)).size).toBe(5);

    const blocked = loaded.questions.find((question) => question.name === 'capability_blocked');
    expect(blocked?.instructions).toContain('devoluciones o retiros');
    expect(blocked?.instructions).toContain('modificar una compra');
    expect(blocked?.instructions).toContain('documentos de confirmación');
    expect(blocked?.instructions).toContain('Yape o Plin');
    expect(blocked?.instructions).toContain('bandejas de correo');
    expect(blocked?.instructions).toContain('referencePresent');
    expect(blocked?.instructions).toContain('notificación al anfitrión');
  });
});
