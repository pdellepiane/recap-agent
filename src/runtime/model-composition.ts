import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ModelOriginReceipt,
} from './contracts';

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

function modelParagraphsOf(reply: ComposeReplyResult): string[] | null {
  const message = reply.structuredMessage;
  if (message?.type === 'generic' && Array.isArray(message.paragraphs_es)) {
    return [...message.paragraphs_es];
  }
  return null;
}

export async function composeModelReply(
  runtime: AgentRuntime,
  request: ComposeReplyRequest,
): Promise<ComposeReplyResult> {
  const reply = await runtime.composeReply(request);
  const paragraphs = modelParagraphsOf(reply);
  const origin: ModelOriginReceipt | null = paragraphs === null
    ? null
    : { modelParagraphs: paragraphs, bundleId: request.replyBundle?.id ?? request.promptBundleId };
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
 * Content origin check for migrated paths. The delivered text must equal this
 * turn's model paragraphs after the documented transport transforms. Any
 * replacement, prepended canned fragment, or appended canned question fails.
 * Absent receipt means the path is not migrated yet and is not checked.
 */
export function assertModelOrigin(args: {
  origin: ModelOriginReceipt | null | undefined;
  reply: ComposeReplyResult;
  deliveredText: string;
}): void {
  if (args.origin === null || args.origin === undefined) return;
  const current = modelParagraphsOf(args.reply);
  if (current === null) {
    throw new ModelOriginViolationError('migrated reply lost its generic model paragraphs');
  }
  const expected = args.origin.modelParagraphs;
  if (
    current.length !== expected.length ||
    current.some((paragraph, index) => paragraph !== expected[index])
  ) {
    throw new ModelOriginViolationError('delivered paragraphs differ from this turn model output');
  }
  const rendered = applyDocumentedTransportTransforms(current.join('\n\n'));
  if (rendered !== args.deliveredText) {
    throw new ModelOriginViolationError('delivered text differs from transformed model output');
  }
}
