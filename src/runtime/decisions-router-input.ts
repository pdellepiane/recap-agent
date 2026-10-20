/**
 * WP2 — Decisions API router: the deterministic input builder.
 *
 * The rendered string is the exact `input` sent to `POST /v1/decisions`. It
 * projects only the fields Decision 1 fixes: the current message and its
 * image flag, the last five message previews, a profile digest, the
 * capability digest, the outcome signature with its repeat count, the
 * pending-derivation flag and the turns-since-progress count.
 *
 * The builder is PURE: no I/O, no model call, no clock. It renders a tracked
 * prompt template and returns the string. The template is loaded separately
 * through the PromptLoader.
 */
import type { PlanSnapshot } from '../core/plan';
import type { CapabilityDigest } from './capability-digest';
import type { CustomerContextSnapshot } from './customer-context';
import type { PromptLoader } from './prompt-loader';

/** Prompt file backing the router input template. */
export const routerInputTemplatePath = 'router/input_template.txt';

export type RouterCurrentMessage = {
  readonly text: string;
  readonly hasImage: boolean;
};

export type RouterMessagePreview = {
  readonly direction: 'inbound' | 'outbound';
  readonly preview: string;
};

/** Plan facts the router reads. Structurally a `PlanSnapshot` subset. */
export type RouterPlanState = Pick<PlanSnapshot, 'conversation_health' | 'support_outcome'>;

export type RouterInputArgs = {
  readonly currentMessage: RouterCurrentMessage;
  readonly recentMessages: readonly RouterMessagePreview[];
  readonly snapshot: CustomerContextSnapshot;
  readonly capabilityDigest: CapabilityDigest;
  readonly plan: RouterPlanState;
};

export type RouterInputTemplate = {
  readonly template: string;
  readonly promptBundleId: string;
  readonly promptFilePaths: readonly string[];
};

/** Decision 1 fixes the history window at five message previews. */
export const ROUTER_RECENT_MESSAGE_LIMIT = 5;

/** Bounded projections of customer-owned text inside the router input. */
const MAX_CURRENT_MESSAGE_CHARS = 2_000;
const MAX_MESSAGE_PREVIEW_CHARS = 240;

/** One purchase row of the profile digest. */
export type RouterPurchaseDigest = {
  readonly orderId: string;
  readonly eventName: string | null;
  readonly paymentStatus: string | null;
  readonly grandTotal: number | null;
  readonly currency: string | null;
  readonly referencePresent: boolean;
  readonly thanksPresent: boolean;
  readonly pending: boolean;
  readonly declined: boolean;
};

/** One cart row of the profile digest. */
export type RouterCartDigest = {
  readonly cartId: string;
  readonly subtotal: number | null;
};

/** Load the tracked input template through the PromptLoader. */
export async function loadRouterInputTemplate(
  loader: PromptLoader,
): Promise<RouterInputTemplate> {
  const bundle = await loader.loadModuleFilesBundle([routerInputTemplatePath], []);
  const header = `## ${routerInputTemplatePath}\n`;
  const template = bundle.instructions.startsWith(header)
    ? bundle.instructions.slice(header.length).trim()
    : bundle.instructions.trim();
  return {
    template,
    promptBundleId: bundle.id,
    promptFilePaths: [...bundle.filePaths],
  };
}

/**
 * Render the router input. Pure and deterministic: the same typed inputs and
 * the same template always produce the same string, in the same order.
 */
export function buildRouterInput(args: RouterInputArgs, template: string): string {
  const values: Record<string, string> = {
    currentMessage: boundText(args.currentMessage.text, MAX_CURRENT_MESSAGE_CHARS),
    hasImage: String(args.currentMessage.hasImage),
    recentMessages: JSON.stringify(
      args.recentMessages.slice(-ROUTER_RECENT_MESSAGE_LIMIT).map((message) => ({
        direction: message.direction,
        preview: boundText(message.preview, MAX_MESSAGE_PREVIEW_CHARS),
      })),
    ),
    purchases: JSON.stringify(purchaseDigests(args.snapshot)),
    carts: JSON.stringify(cartDigests(args.snapshot)),
    capabilities: JSON.stringify(
      args.capabilityDigest.operations.map((operation) => ({
        id: operation.id,
        available: operation.available,
        reason: operation.reason,
        class: operation.class,
      })),
    ),
    outcome: JSON.stringify({
      signature: args.plan.support_outcome?.signature ?? null,
      repeatCount: args.plan.support_outcome?.repeat_count ?? 0,
    }),
    botClaimedDerivationPending: String(
      args.plan.conversation_health.help_offer_status === 'offered',
    ),
    turnsSinceProgress: String(args.plan.conversation_health.consecutive_non_progress_turns),
  };
  return renderTemplate(template, values);
}

/** Every authorized purchase, in snapshot order. Nothing is dropped. */
export function purchaseDigests(
  snapshot: CustomerContextSnapshot,
): readonly RouterPurchaseDigest[] {
  return snapshot.purchasesCarts.purchases.map((purchase) => ({
    orderId: purchase.orderId,
    eventName: purchase.eventName ?? null,
    paymentStatus: purchase.paymentStatus ?? null,
    grandTotal: purchase.grandTotal ?? null,
    currency: purchase.currency ?? null,
    referencePresent: hasCustomerReference(purchase.customerTransactionNumber),
    thanksPresent: purchase.isThanked === true || purchase.thanks != null,
    pending: normalizeStatus(purchase.paymentStatus) === 'pending',
    declined: normalizeStatus(purchase.paymentStatus) === 'declined',
  }));
}

/** Every authorized cart, in snapshot order. Nothing is dropped. */
export function cartDigests(snapshot: CustomerContextSnapshot): readonly RouterCartDigest[] {
  return snapshot.purchasesCarts.carts.map((cart) => ({
    cartId: cart.cartId,
    subtotal: cart.subtotal ?? null,
  }));
}

function hasCustomerReference(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function boundText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…`;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gu, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Router input template references an unknown field: ${key}`);
    }
    return value;
  });
}
