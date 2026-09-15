import type { EvalTurnResult, SilenceObservation } from './case-schema';
import { imageAttachmentRefSchema, isFileRefActive } from '../core/image-attachments';
import { getPrivatePlanForEvidence } from './evaluation-state';

/**
 * Typed acceptance path for legitimate outbound silence.
 *
 * A suppressed turn carries `deliveredText: null` with
 * `delivery.action === 'suppress'`. Silence is exempt from the
 * output-origin gate only when suppression evidence is legitimate:
 * an established pause reason (human escalation soft-pause) or a
 * model-selected classifier suppression observed in enforce mode.
 * Failed generation, missing receipts, and forged suppression claims
 * never use this exemption (fail closed).
 */
export const ESTABLISHED_SUPPRESSION_REASONS = [
  'human_escalation_active',
] as const;

export const MODEL_SELECTED_SUPPRESSION_REASONS = [
  'suppress_acknowledgement',
  'suppress_reaction',
  'suppress_automated_response',
] as const;

/**
 * F2 canonical image-only silence disposition. An image-only turn with no
 * outstanding task persists the attachment reference and delivers typed
 * silence with this exact reason. This path is explicit and standalone:
 * the image reason is never added to the acknowledgement/reaction/automated
 * helper above, and no other reason may spoof the image path.
 */
export const IMAGE_ONLY_SILENCE_REASON = 'image_only_no_outstanding_task';

const IMAGE_SILENCE_PERSIST_REASONS: readonly string[] = [
  'image_file_silence',
  'image_url_silence',
];

export type SilenceExemption = {
  exempt: boolean;
  reason: string;
};

type SilenceCandidate = Pick<
  EvalTurnResult,
  'deliveredText' | 'outputText' | 'delivery' | 'outputOrigin' | 'trace' | 'plan' | 'input'
>;

export function validateSilenceExemption(turn: SilenceCandidate): SilenceExemption {
  if (turn.deliveredText !== null) {
    return { exempt: false, reason: 'nonempty delivered text is not silence' };
  }
  if (turn.outputOrigin?.status === 'generation_failed') {
    return { exempt: false, reason: 'failed generation must never use the silence exemption' };
  }
  if (turn.outputOrigin?.status === 'mismatch') {
    return { exempt: false, reason: 'mismatched origin must never use the silence exemption' };
  }
  if (turn.outputOrigin?.status === 'verified') {
    return { exempt: false, reason: 'verified origin with null text is incoherent' };
  }
  if (turn.delivery?.action !== 'suppress') {
    return { exempt: false, reason: 'missing suppress delivery action' };
  }
  const reason = turn.delivery.reason;
  if ((ESTABLISHED_SUPPRESSION_REASONS as readonly string[]).includes(reason)) {
    return { exempt: true, reason: `established suppression: ${reason}` };
  }
  if ((MODEL_SELECTED_SUPPRESSION_REASONS as readonly string[]).includes(reason)) {
    const classifier = turn.trace.response_classifier;
    if (classifier?.would_suppress === true && classifier.mode === 'enforce') {
      return { exempt: true, reason: `model-selected suppression: ${reason}` };
    }
    return { exempt: false, reason: 'suppression claim lacks model-selected enforce evidence' };
  }
  return { exempt: false, reason: `unknown suppression reason: ${reason}` };
}

/**
 * S3 invocation binding for image-silence proof. The live target observes the
 * real inbound message ID on the wire; passing it here binds the saved
 * attachment ref to this invocation instead of a fixture-supplied claim. When
 * omitted (unit probes, offline turns without wire identity), validation
 * still requires a valid active ref plus a validated current image input, but
 * callers with wire identity always pass it. nowMs is injectable for tests.
 */
export type ImageSilenceEvidenceOptions = {
  observedMessageId?: string | null;
  nowMs?: number;
};

function normalizeObservedMessageId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolves the plan carrying real attachment linkage for silence evidence.
 * Prefers the private evaluation snapshot over the serialized public plan,
 * which omits raw file IDs/URLs/digests by design. Falls back to the turn's
 * own plan when no private snapshot was attached (unit probes).
 */
function resolveSilencePlan(turn: SilenceCandidate): SilenceCandidate['plan'] {
  const asTurn = turn as unknown as EvalTurnResult;
  if (asTurn !== null && typeof asTurn === 'object' && 'turnIndex' in asTurn && 'input' in asTurn) {
    return getPrivatePlanForEvidence(asTurn);
  }
  return turn.plan;
}

type QualifyingImageRef = {
  kind: 'file' | 'url';
  messageId: string;
};

/**
 * Collects saved attachment refs that can prove this invocation's image
 * persistence. Every ref must parse under the current typed
 * imageAttachmentRefSchema: legacy aliases (file_id, fileID, message_id,
 * ref) never qualify. File refs must be active (unexpired) at nowMs; expired
 * refs never qualify. When an observed inbound message ID is provided, only
 * refs linked to that exact ID qualify, so an older reference can never prove
 * a new image save.
 */
function qualifyingImageRefs(
  turn: SilenceCandidate,
  options?: ImageSilenceEvidenceOptions,
): QualifyingImageRef[] {
  const plan = resolveSilencePlan(turn) as { image_attachments?: unknown } | undefined;
  const attachments = plan?.image_attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const nowMs = options?.nowMs ?? Date.now();
  const observed = normalizeObservedMessageId(options?.observedMessageId);
  const qualifying: QualifyingImageRef[] = [];
  for (const entry of attachments) {
    const parsed = imageAttachmentRefSchema.safeParse(entry);
    if (!parsed.success) continue;
    const ref = parsed.data;
    if (observed !== null && ref.messageId !== observed) continue;
    if (ref.kind === 'file') {
      if (!isFileRefActive(ref, nowMs)) continue;
      qualifying.push({ kind: 'file', messageId: ref.messageId });
    } else {
      qualifying.push({ kind: 'url', messageId: ref.messageId });
    }
  }
  return qualifying;
}

/**
 * Requires a validated current image input on this turn. Base64 and URL
 * shapes qualify; harness-redacted inputs (bytes already stripped, MIME kept)
 * qualify as presence while runtime validation is proven by the saved active
 * ref below. Error shapes (image_too_large, media_unavailable), missing
 * images, and malformed payloads never qualify: a new unavailable image can
 * never be proven persisted by an old reference.
 */
function hasValidatedCurrentImageInput(turn: SilenceCandidate): boolean {
  const image = (turn.input as { image?: unknown } | undefined)?.image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return false;
  const record = image as Record<string, unknown>;
  if ('error' in record) return false;
  if (typeof record['data'] === 'string' && record['data'].length > 0) return true;
  if (typeof record['url'] === 'string' && record['url'].length > 0) return true;
  if (record['redacted'] === true) return true;
  return false;
}

/**
 * F2 successful image-ref save proof. Persisted-silence text alone
 * (`plan_persist_reason`) never proves the upload: at least one stored
 * attachment ref must carry real linkage (a message id plus a file or url
 * identity). Forged persist-reason text with no saved ref stays a failure.
 */
export function hasSuccessfulImageRefSave(
  turn: SilenceCandidate,
  options?: ImageSilenceEvidenceOptions,
): boolean {
  return qualifyingImageRefs(turn, options).length > 0;
}

/**
 * F2 explicit image-only silence validation. Every conjunct is required:
 * the observed suppress disposition with the exact image-silence reason, no
 * assistant text on the wire, a missing (never failed/mismatched/verified)
 * origin, a persisted plan carrying a successful image ref save, and an
 * image-only input (empty text with an image). A question-bearing turn or a
 * failed generation fails closed through the normal gate.
 *
 * S3 binding. The image input must be a validated current payload (error and
 * malformed shapes never qualify), and the saved ref must be an active typed
 * ref linked to the observed inbound message ID when one is provided: an
 * older reference, an expired reference, a legacy-aliased entry, an unknown
 * save, or a mere persist-reason string never qualifies. A validated silence
 * still routes to the mandatory semantic judge with full task context; there
 * is no automatic pass, and a pending-question image-only turn is judged
 * against that task rather than accepted because its text is empty.
 */
export function validateImageOnlySilence(
  turn: SilenceCandidate,
  options?: ImageSilenceEvidenceOptions,
): SilenceExemption {
  if (turn.delivery?.action !== 'suppress') {
    return { exempt: false, reason: 'missing suppress delivery action' };
  }
  if (turn.delivery?.reason !== IMAGE_ONLY_SILENCE_REASON) {
    return { exempt: false, reason: `not the image-silence disposition: ${turn.delivery?.reason ?? 'missing reason'}` };
  }
  if (turn.deliveredText !== null && turn.deliveredText !== undefined) {
    return { exempt: false, reason: 'image silence carries no delivered text' };
  }
  if ((turn.outputText ?? '') !== '') {
    return { exempt: false, reason: 'image silence carries no assistant text' };
  }
  const originStatus = turn.outputOrigin?.status;
  if (originStatus !== 'missing') {
    return { exempt: false, reason: `image silence requires missing origin, observed ${originStatus ?? 'none'}` };
  }
  if (turn.trace?.plan_persisted !== true) {
    return { exempt: false, reason: 'unpersisted image silence is a failure, never silence' };
  }
  const persistReason = turn.trace?.plan_persist_reason;
  if (typeof persistReason !== 'string' || !IMAGE_SILENCE_PERSIST_REASONS.includes(persistReason)) {
    return { exempt: false, reason: `unexpected image persist reason: ${persistReason ?? 'none'}` };
  }
  const refs = qualifyingImageRefs(turn, options);
  if (refs.length === 0) {
    return { exempt: false, reason: 'persist-reason text alone never proves an image save: no saved active typed ref linked to this invocation' };
  }
  if (persistReason === 'image_file_silence' && !refs.some((ref) => ref.kind === 'file')) {
    return { exempt: false, reason: 'image file silence requires a saved active file ref, not a url ref' };
  }
  if (persistReason === 'image_url_silence' && !refs.some((ref) => ref.kind === 'url')) {
    return { exempt: false, reason: 'image url silence requires a saved url ref, not a file ref' };
  }
  const inputText = (turn.input as { text?: unknown } | undefined)?.text;
  if (typeof inputText !== 'string' || inputText.trim().length > 0) {
    return { exempt: false, reason: 'question-bearing turns must answer, never silence' };
  }
  if (!hasValidatedCurrentImageInput(turn)) {
    return { exempt: false, reason: 'image silence requires a validated current image input: unavailable or malformed input never qualifies' };
  }
  return { exempt: true, reason: `persisted image-only silence: ${turn.delivery.reason}` };
}

function baseObservation(
  turn: EvalTurnResult | undefined,
  options?: ImageSilenceEvidenceOptions,
): {
  dispositionAction: string | null;
  dispositionReason: string | null;
  deliveredNull: boolean;
  originStatus: string | null;
  imageRefSaved: boolean;
} {
  return {
    dispositionAction: turn?.delivery?.action ?? null,
    dispositionReason: turn?.delivery?.reason ?? null,
    deliveredNull: turn?.deliveredText === null || turn?.deliveredText === undefined,
    originStatus: turn?.outputOrigin?.status ?? null,
    imageRefSaved: turn ? hasSuccessfulImageRefSave(turn, options) : false,
  };
}

/**
 * F2 validated silence observation for semantic judging. Runs BEFORE any
 * blanket empty-text rejection so legitimate thanks and supplemental-image
 * silence reach the judge with a structured disposition instead of an
 * automatic failure, while hard failures (generation failure, origin
 * mismatch, missing turn, empty send, unknown suppression, unpersisted
 * image) stay failures. Speech turns route back to normal text judging.
 */
export function observeSilenceForJudge(
  turn: EvalTurnResult | undefined,
  options?: ImageSilenceEvidenceOptions,
): SilenceObservation {
  const base = baseObservation(turn, options);
  if (!turn) {
    return { route: 'failure', path: null, reason: 'missing turn', ...base };
  }
  if (turn.outputOrigin?.status === 'generation_failed') {
    return { route: 'failure', path: null, reason: 'failed generation must never use the silence exemption', ...base };
  }
  if (turn.outputOrigin?.status === 'mismatch') {
    return { route: 'failure', path: null, reason: 'mismatched origin must never use the silence exemption', ...base };
  }
  const outputText = turn.outputText ?? '';
  if (outputText.trim().length > 0) {
    return { route: 'speech', path: null, reason: 'delivered text present', ...base };
  }
  if (turn.deliveredText !== null && turn.deliveredText !== undefined) {
    return { route: 'failure', path: null, reason: 'empty send must never use the silence exemption', ...base };
  }
  if (turn.delivery?.action === 'send') {
    return { route: 'failure', path: null, reason: 'empty send must never use the silence exemption', ...base };
  }
  const exemption = validateSilenceExemption(turn);
  if (exemption.exempt) {
    const path = (ESTABLISHED_SUPPRESSION_REASONS as readonly string[]).includes(turn.delivery?.reason ?? '')
      ? 'established' as const
      : 'model_selected' as const;
    return { route: 'silence', path, reason: exemption.reason, ...base };
  }
  const imageSilence = validateImageOnlySilence(turn, options);
  if (imageSilence.exempt) {
    return { route: 'silence', path: 'image_only', reason: imageSilence.reason, ...base };
  }
  if (
    turn.delivery?.action === 'suppress' &&
    turn.delivery?.reason === IMAGE_ONLY_SILENCE_REASON
  ) {
    return { route: 'failure', path: null, reason: `unpersisted image silence is a failure: ${imageSilence.reason}`, ...base };
  }
  if (turn.delivery?.action === 'suppress') {
    return { route: 'failure', path: null, reason: exemption.reason, ...base };
  }
  return { route: 'failure', path: null, reason: exemption.reason, ...base };
}
