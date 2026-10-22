import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import type { CartInformation, PurchaseInformation } from '../src/core/information';
import type { OpenRequest } from '../src/core/open-request';
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

/** The eight placeholders the template is allowed to reference. */
const TEMPLATE_PLACEHOLDERS = [
  'botClaimedDerivationPending',
  'capabilities',
  'carts',
  'currentMessage',
  'hasImage',
  'openRequest',
  'purchases',
  'recentMessages',
];

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

const withPersonRequest: OpenRequest = {
  key: 'wamid.request-1',
  opening_text: 'Quiero la devolución de mi compra ORD_6ad637da04583',
  state: 'with_person',
  since: '2026-10-20T00:00:00.000Z',
  turns: 3,
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

function routerArgs(
  overrides: Partial<RouterInputArgs> = {},
  openRequests: readonly OpenRequest[] = [],
): RouterInputArgs {
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
        help_offer_status: 'offered',
      },
      open_requests: [...openRequests],
    },
    ...overrides,
  };
}

async function loadTemplate(): Promise<string> {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
  const template = await loadRouterInputTemplate(loader);
  return template.template;
}

function placeholderNames(template: string): string[] {
  return [...template.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gu)]
    .map((match) => match[1] ?? '');
}

/** Read the rendered `solicitud_actual` line back as JSON. */
function solicitudActual(rendered: string): unknown {
  const line = rendered
    .split('\n')
    .find((entry) => entry.startsWith('solicitud_actual: ') === true);
  expect(line).toBeDefined();
  return JSON.parse((line ?? '').slice('solicitud_actual: '.length));
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
      'derivacion_pendiente',
      'solicitud_actual',
    ]);
  });

  it('renders the open-request record as solicitud_actual', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(
      routerArgs({}, [withPersonRequest]),
      template,
    );

    // The record is one object, not a list: the router reads one request.
    expect(solicitudActual(rendered)).toEqual({
      texto_inicial: 'Quiero la devolución de mi compra ORD_6ad637da04583',
      estado: 'with_person',
      turnos: 3,
    });
  });

  it('renders a null record when the thread has none', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(routerArgs(), template);

    expect(rendered).toContain('solicitud_actual: null');
    expect(solicitudActual(rendered)).toBeNull();
  });

  it('never renders the removed decision keys', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(
      routerArgs({}, [withPersonRequest]),
      template,
    );

    expect(rendered).not.toContain('signature');
    expect(rendered).not.toContain('repeatCount');
    expect(rendered).not.toContain('turnsSinceProgress');
    expect(rendered).not.toContain('resultado_turno');
    expect(rendered).not.toContain('turnos_sin_avance');
  });

  it('uses exactly the eight fixed template placeholders', async () => {
    const template = await loadTemplate();

    expect([...new Set(placeholderNames(template))].sort()).toEqual(TEMPLATE_PLACEHOLDERS);
  });

  it('throws when the template references an unknown placeholder', () => {
    expect(() => buildRouterInput(
      routerArgs(),
      'mensaje_actual: {{currentMessage}}\nturnos_sin_avance: {{turnsSinceProgress}}',
    )).toThrow(/unknown field: turnsSinceProgress/u);
  });

  it('projects the purchase, cart, capability and record facts', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(
      routerArgs({}, [withPersonRequest]),
      template,
    );

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
    expect(rendered).toContain('derivacion_pendiente: true');
  });

  it('keeps every authorized purchase and cart in the digest', async () => {
    const template = await loadTemplate();
    const rendered = buildRouterInput(routerArgs({
      snapshot: snapshotWith(
        [purchase, declinedPurchase, purchase],
        [cart, cart],
      ),
    }), template);

    // Two records share the first order id, so a digest that dropped or
    // deduplicated records would render fewer occurrences.
    expect(rendered.match(/"orderId":"ORD_6ab970ab70802"/gu)).toHaveLength(2);
    expect(rendered.match(/"orderId":"ORD_6ad637da04583"/gu)).toHaveLength(1);
    expect(rendered.match(/"cartId":"cart:470893"/gu)).toHaveLength(2);
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
    const args = routerArgs({}, [withPersonRequest]);
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
    const heavy = routerArgs(
      {
        currentMessage: { text: 'a'.repeat(2_000), hasImage: true },
        recentMessages: Array.from({ length: 5 }, (_, index) => ({
          direction: index % 2 === 0 ? 'inbound' as const : 'outbound' as const,
          preview: 'b'.repeat(240),
        })),
        snapshot: snapshotWith(
          [purchase, declinedPurchase, purchase, declinedPurchase],
          [cart, cart, cart, cart],
        ),
      },
      [withPersonRequest],
    );

    const rendered = buildRouterInput(heavy, template);
    const bytes = Buffer.byteLength(rendered, 'utf8');
    expect(bytes).toBeLessThanOrEqual(ROUTER_INPUT_BYTE_BUDGET);
    console.info(`rendered heavy router input bytes: ${bytes}`);
  });

  it('loads the three fixed choice questions from the tracked prompt files', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const loaded = await loadRouterQuestions(loader);

    expect(loaded.questions.map((question) => question.name)).toEqual([
      'route',
      'same_open_request',
      'request_settled',
    ]);
    expect(loaded.questions.map((question) => question.type)).toEqual([
      'choice',
      'choice',
      'choice',
    ]);

    const route = loaded.questions[0];
    expect(route?.choices.map((choice) => choice.value)).toEqual([
      'answer_with_records',
      'ask_clarification',
      'offer_human',
      'escalate_human',
      'rsvp_flow',
      'planning_flow',
      'suppress_ack',
    ]);
    expect(new Set(route?.choices.map((choice) => choice.description)).size).toBe(7);

    expect(loaded.questions[1]?.choices.map((choice) => choice.value)).toEqual([
      'same',
      'new',
    ]);
    expect(loaded.questions[2]?.choices.map((choice) => choice.value)).toEqual([
      'settled',
      'open',
    ]);
  });
});
