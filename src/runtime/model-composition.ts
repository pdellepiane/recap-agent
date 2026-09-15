import crypto from 'node:crypto';

import type {
  AgentRuntime,
  AuthorizedProviderRenderField,
  ComposeReplyRequest,
  ComposeReplyResult,
  ModelOriginReceipt,
} from './contracts';
import type { ProviderSummary } from '../core/provider';
import type { StructuredMessage } from './structured-message';
import { buildExpectedDeliveredText, ReferenceRenderError } from '../audit/expected-render';

/**
 * L1 single model-composition seam.
 *
 * Accepts scoped facts and outcomes through the normal compose request (never
 * a `deterministicText` field) and snapshots this turn's actual model
 * paragraphs into an origin receipt. Delivery verifies content against that
 * receipt; a boolean flag would be dishonest, so the paragraphs travel along.
 */
export class ModelOriginViolationError extends Error {
  constructor(reason: string) {
    super(`model-origin-violation: ${reason}`);
    this.name = 'ModelOriginViolationError';
  }
}

/**
 * Typed composition failure: the reply model or a guardrail prevented this
 * turn's model-written reply. Carries no prose; the service delivers a typed
 * operational failure instead of canned fallback text.
 */
export class ModelComposedFailureError extends Error {
  constructor(readonly kind: 'guardrail_trip' | 'model_error') {
    super(`model-composed-failure: ${kind}`);
    this.name = 'ModelComposedFailureError';
  }
}

export function modelParagraphsOf(reply: ComposeReplyResult): string[] | null {
  const message = reply.structuredMessage;
  if (message?.type === 'generic' && Array.isArray(message.paragraphs_es)) {
    return [...message.paragraphs_es];
  }
  return null;
}

/**
 * Actual model-produced text spans for every surviving structured-output
 * origin. Generic replies contribute their paragraphs; welcome replies
 * contribute greeting/scope/ask; planning replies (recommendation and
 * multi-need) contribute intro/summary/match-label/rationale/caveat/next-step
 * spans in render order. Match labels can carry model prose, so they are
 * traced like any other prose field. Provider identities, titles, prices and
 * URLs are mechanical data rendered from evidence, never model spans, so they
 * stay out of the receipt. Nothing is fabricated: absent fields contribute no
 * span and an empty span set means no receipt.
 */
export function modelSpansOf(
  message: StructuredMessage | undefined,
): string[] | null {
  if (!message) return null;
  if (message.type === 'generic') {
    return Array.isArray(message.paragraphs_es) ? [...message.paragraphs_es] : null;
  }
  if (message.type === 'welcome') {
    const spans = [message.greeting_es, message.scope_es, message.ask_es].filter(
      (span): span is string => typeof span === 'string' && span.length > 0,
    );
    return spans.length > 0 ? spans : null;
  }
  if (message.type === 'recommendation') {
    const spans: string[] = [];
    if (typeof message.intro_es === 'string' && message.intro_es.length > 0) {
      spans.push(message.intro_es);
    }
    for (const rec of message.providers ?? []) {
      if (typeof rec.match_label_es === 'string' && rec.match_label_es.length > 0) {
        spans.push(rec.match_label_es);
      }
      if (typeof rec.rationale_es === 'string' && rec.rationale_es.length > 0) {
        spans.push(rec.rationale_es);
      }
      if (typeof rec.caveat_es === 'string' && rec.caveat_es.length > 0) {
        spans.push(rec.caveat_es);
      }
    }
    return spans.length > 0 ? spans : null;
  }
  if (message.type === 'multi_need_recommendation') {
    const spans: string[] = [];
    if (typeof message.intro_es === 'string' && message.intro_es.length > 0) {
      spans.push(message.intro_es);
    }
    for (const need of message.needs ?? []) {
      if (typeof need.summary_es === 'string' && need.summary_es.length > 0) {
        spans.push(need.summary_es);
      }
      for (const rec of need.providers ?? []) {
        if (typeof rec.match_label_es === 'string' && rec.match_label_es.length > 0) {
          spans.push(rec.match_label_es);
        }
        if (typeof rec.rationale_es === 'string' && rec.rationale_es.length > 0) {
          spans.push(rec.rationale_es);
        }
        if (typeof rec.caveat_es === 'string' && rec.caveat_es.length > 0) {
          spans.push(rec.caveat_es);
        }
      }
    }
    if (typeof message.next_step_es === 'string' && message.next_step_es.length > 0) {
      spans.push(message.next_step_es);
    }
    return spans.length > 0 ? spans : null;
  }
  return null;
}

/**
 * Canonical model content: every prose-carrying output field plus every
 * referenced provider id and need category, in render order. This is the
 * model-content identity verified against the immutable receipt snapshot. It
 * covers match labels, summaries, rationales, caveats, intros, next steps,
 * greetings and paragraphs, so inserted, removed, reordered or changed prose,
 * swapped ids and changed raw model output all alter the digest.
 */
export function canonicalModelContent(
  message: StructuredMessage | undefined,
): string | null {
  if (!message) return null;
  if (message.type === 'generic') {
    return JSON.stringify({
      type: message.type,
      paragraphs_es: message.paragraphs_es ?? null,
    });
  }
  if (message.type === 'welcome') {
    return JSON.stringify({
      type: message.type,
      greeting_es: message.greeting_es ?? null,
      scope_es: message.scope_es ?? null,
      ask_es: message.ask_es ?? null,
    });
  }
  if (message.type === 'recommendation') {
    return JSON.stringify({
      type: message.type,
      intro_es: message.intro_es ?? null,
      providers: (message.providers ?? []).map((rec) => ({
        provider_id: rec.provider_id,
        match_label_es: rec.match_label_es ?? null,
        rationale_es: rec.rationale_es ?? null,
        caveat_es: rec.caveat_es ?? null,
      })),
    });
  }
  if (message.type === 'multi_need_recommendation') {
    return JSON.stringify({
      type: message.type,
      intro_es: message.intro_es ?? null,
      needs: (message.needs ?? []).map((need) => ({
        category: need.category,
        summary_es: need.summary_es ?? null,
        providers: need.providers.map((rec) => ({
          provider_id: rec.provider_id,
          match_label_es: rec.match_label_es ?? null,
          rationale_es: rec.rationale_es ?? null,
          caveat_es: rec.caveat_es ?? null,
        })),
      })),
      next_step_es: message.next_step_es ?? null,
    });
  }
  return null;
}

export function hashCanonicalModelContent(canonical: string): string {
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Deep immutable snapshot of the raw structured model output. */
export function snapshotStructuredMessage(
  message: StructuredMessage,
): StructuredMessage {
  return JSON.parse(JSON.stringify(message)) as StructuredMessage;
}

/**
 * Snapshot of the authorized mechanical provider fields the channel renderer
 * projects into cards. Only identity, link and data slots declared by the
 * renderer are captured; no conversational prose travels here. The freeform
 * promo summary stays model evidence (model context/prose) and is never
 * snapshotted as mechanical data; only the short promo badge is mechanical.
 */
export function snapshotProviderFields(
  providerResults: readonly ProviderSummary[] | undefined,
): AuthorizedProviderRenderField[] {
  return (providerResults ?? []).map((provider) => ({
    id: provider.id,
    title: provider.title,
    category: provider.category ?? null,
    location: provider.location ?? null,
    priceLevel: provider.priceLevel ?? null,
    promoBadge: provider.promoBadge ?? null,
    detailUrl: provider.detailUrl ?? null,
  }));
}

/** True when delivered mechanical provider fields differ from the snapshot. */
export function providerMetadataDiffers(
  snapshot: readonly AuthorizedProviderRenderField[],
  delivered: readonly ProviderSummary[],
): boolean {
  const expectedById = new Map(snapshot.map((field) => [field.id, field]));
  for (const candidate of snapshotProviderFields(delivered)) {
    const expected = expectedById.get(candidate.id);
    if (expected === undefined) continue;
    if (
      expected.title !== candidate.title ||
      expected.category !== candidate.category ||
      expected.location !== candidate.location ||
      expected.priceLevel !== candidate.priceLevel ||
      expected.promoBadge !== candidate.promoBadge ||
      expected.detailUrl !== candidate.detailUrl
    ) {
      return true;
    }
  }
  return false;
}

/** Every provider id referenced by the snapshot model output, in render order. */
export function modelProviderIdsOf(
  message: StructuredMessage | undefined,
): number[] {
  if (!message) return [];
  if (message.type === 'recommendation') {
    return (message.providers ?? []).map((rec) => rec.provider_id);
  }
  if (message.type === 'multi_need_recommendation') {
    return (message.needs ?? []).flatMap((need) =>
      need.providers.map((rec) => rec.provider_id),
    );
  }
  return [];
}

/**
 * Ordered span containment probe. Diagnostic only: ordered containment alone
 * is insufficient for delivery acceptance because injected text can surround
 * intact spans, so production verification never relies on it. Delivery
 * acceptance requires full expected-render equality plus snapshot prose
 * verification (see assertModelOrigin and AgentService.observeModelDelivery).
 */
export function deliveredContainsModelSpans(args: {
  spans: readonly string[];
  deliveredText: string;
}): boolean {
  const delivered = applyDocumentedTransportTransforms(args.deliveredText);
  let cursor = 0;
  for (const span of args.spans) {
    const normalized = applyDocumentedTransportTransforms(span);
    if (normalized.length === 0) continue;
    const found = delivered.indexOf(normalized, cursor);
    if (found < 0) return false;
    cursor = found + normalized.length;
  }
  return true;
}

/**
 * Immutable origin receipt for this turn's raw structured model output.
 * Snapshots the message (deep clone, never a live reference) and the
 * authorized mechanical provider fields supplied with the compose request,
 * and stores the canonical model-content hash. `modelParagraphs` is kept for
 * hash-only wire evidence readers. A receipt is never generated post-mutation
 * from a mutated object: callers pass the pristine compose result.
 */
export function buildModelOriginReceipt(
  reply: ComposeReplyResult,
  bundleId: string,
  providerResults?: readonly ProviderSummary[],
): ModelOriginReceipt | null {
  const paragraphs = modelSpansOf(reply.structuredMessage);
  if (paragraphs === null || reply.structuredMessage === undefined) return null;
  const canonical = canonicalModelContent(reply.structuredMessage);
  if (canonical === null) return null;
  return {
    modelParagraphs: paragraphs,
    modelMessage: snapshotStructuredMessage(reply.structuredMessage),
    providerFields: snapshotProviderFields(providerResults),
    modelContentSha256: hashCanonicalModelContent(canonical),
    bundleId,
    transformationVersion: 'transport-v2',
  };
}

export async function composeModelReply(
  runtime: AgentRuntime,
  request: ComposeReplyRequest,
): Promise<ComposeReplyResult> {
  const reply = await runtime.composeReply(request);
  const origin = buildModelOriginReceipt(
    reply,
    request.replyBundle?.id ?? request.promptBundleId,
    request.providerResults,
  );
  return { ...reply, origin };
}

/** Declared transport transformations, and nothing else. See E07. */
export function applyDocumentedTransportTransforms(value: string): string {
  return value
    .replace(/\bfilecite\s+turn\d+\s+file\s+\d+\b/giu, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}

/**
 * Content origin check for migrated paths. Verifies two things together:
 *
 * 1. Current structured prose fields equal the original model fields: the
 *    canonical content of the current message must match the immutable
 *    receipt snapshot (and the snapshot must match its own content hash, so
 *    a tampered receipt fails closed). This rejects inserted, removed,
 *    reordered or changed prose, swapped provider ids, changed match labels
 *    and any changed raw model output.
 * 2. Full expected transformed render equals full delivered text: the
 *    expected channel render is rebuilt with the independent reference
 *    serializer from the snapshot message and snapshotted authorized fields
 *    BEFORE comparing, so provider titles and links surrounding intact prose
 *    no longer cause false mismatches, while any surrounding injected text,
 *    swapped links, renderer injection or ungrounded metadata fails. Ordered
 *    containment alone is never sufficient. The delivery renderer is never
 *    called here; transport-v2 only.
 *
 * Only the existing declared formatting plus provider identity/link/data
 * slots may surround model prose; no runtime-written conversational sentence
 * is allowed, and none is added here. Unknown transformation versions fail
 * closed. Absent receipt means the path is not migrated yet and is not
 * checked.
 */
export function assertModelOrigin(args: {
  origin: ModelOriginReceipt | null | undefined;
  reply: ComposeReplyResult;
  deliveredText: string;
  providerResults?: readonly ProviderSummary[];
  channel?: string | null;
}): void {
  if (args.origin === null || args.origin === undefined) return;
  if (args.origin.transformationVersion !== 'transport-v2') {
    throw new ModelOriginViolationError('unknown transport transformation version');
  }
  if (args.origin.modelMessage === undefined || args.origin.modelContentSha256 === undefined) {
    throw new ModelOriginViolationError('legacy origin receipt without content snapshot');
  }
  const snapshotCanonical = canonicalModelContent(args.origin.modelMessage);
  if (
    snapshotCanonical === null ||
    hashCanonicalModelContent(snapshotCanonical) !== args.origin.modelContentSha256
  ) {
    throw new ModelOriginViolationError('origin receipt content does not match its content hash');
  }
  const current = modelSpansOf(args.reply.structuredMessage);
  if (current === null) {
    throw new ModelOriginViolationError('migrated reply lost its model-produced spans');
  }
  const currentCanonical = canonicalModelContent(args.reply.structuredMessage);
  if (currentCanonical === null || currentCanonical !== snapshotCanonical) {
    throw new ModelOriginViolationError('delivered spans differ from this turn model output');
  }
  const snapshotIds = new Set(args.origin.providerFields.map((field) => field.id));
  for (const id of modelProviderIdsOf(args.origin.modelMessage)) {
    if (!snapshotIds.has(id)) {
      throw new ModelOriginViolationError('model references a provider without a snapshot');
    }
  }
  if (args.providerResults !== undefined) {
    const liveIds = new Set(args.providerResults.map((provider) => provider.id));
    for (const id of modelProviderIdsOf(args.origin.modelMessage)) {
      if (!liveIds.has(id)) {
        throw new ModelOriginViolationError('model references an unauthorized provider id');
      }
    }
  }
  if (
    args.providerResults !== undefined &&
    args.origin.providerFields.length > 0 &&
    providerMetadataDiffers(args.origin.providerFields, args.providerResults)
  ) {
    throw new ModelOriginViolationError('provider metadata differs from authorized snapshot');
  }
  let expected: string;
  try {
    expected = buildExpectedDeliveredText({
      message: args.origin.modelMessage,
      providerFields: args.origin.providerFields,
      channel: args.channel ?? 'whatsapp',
    });
  } catch (error) {
    if (error instanceof ReferenceRenderError) {
      throw new ModelOriginViolationError(`expected render failed: ${error.message}`);
    }
    throw error;
  }
  if (expected.length === 0 || args.deliveredText.length === 0) {
    throw new ModelOriginViolationError('blank model output never verifies');
  }
  if (expected !== args.deliveredText) {
    throw new ModelOriginViolationError('delivered text differs from expected rendered output');
  }
}
