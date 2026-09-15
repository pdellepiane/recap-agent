import { describe, expect, it } from 'vitest';

import type { EvalTurnResult } from '../src/evals/case-schema';import { collectOriginGateFailures } from '../src/evals/runner';
import { validateSilenceExemption } from '../src/evals/silence';

function silenceTurn(overrides: {
  reason: string;
  classifier?: { mode: 'observe' | 'enforce'; would_suppress: boolean; action: string };
  originStatus?: 'missing' | 'generation_failed' | 'mismatch' | 'verified';
  deliveredText?: string | null;
  action?: 'send' | 'suppress' | 'failure';
}): EvalTurnResult {
  return {
    turnIndex: 0,
    deliveredText: overrides.deliveredText ?? null,
    outputText: '',
    delivery: {
      action: overrides.action ?? 'suppress',
      reason: overrides.reason,
    },
    outputOrigin: {
      status: overrides.originStatus ?? 'missing',
      candidateSha256: null,
      deliveredSha256: null,
      transformationVersion: null,
      mismatchFields: ['candidate_output_origin'],
    },
    trace: {
      response_classifier: overrides.classifier
        ? {
            mode: overrides.classifier.mode,
            action: overrides.classifier.action,
            reason: 'test suppression evidence',
            would_suppress: overrides.classifier.would_suppress,
            context_source: 'local_plan',
            has_prior_outbound_message: true,
            fallback_used: false,
            conversation_health: 'progressing',
            health_reason: 'normal_progress',
            human_help_response: 'not_applicable',
            prompt_bundle_id: null,
            prompt_file_paths: [],
          }
        : undefined,
    },
  } as unknown as EvalTurnResult;
}

describe('typed silence exemption', () => {
  it('accepts thanks silence with model-selected enforce evidence', () => {
    const turn = silenceTurn({
      reason: 'suppress_acknowledgement',
      classifier: { mode: 'enforce', would_suppress: true, action: 'suppress_acknowledgement' },
    });
    expect(validateSilenceExemption(turn).exempt).toBe(true);
    expect(collectOriginGateFailures([turn])).toEqual([]);
  });

  it('accepts the human-takeover pause without classifier evidence', () => {
    const turn = silenceTurn({ reason: 'human_escalation_active' });
    expect(validateSilenceExemption(turn).exempt).toBe(true);
    expect(collectOriginGateFailures([turn])).toEqual([]);
  });

  it('rejects a required unanswered question without suppression evidence', () => {
    const turn = silenceTurn({ reason: 'reply_composed', action: 'send' });
    const verdict = validateSilenceExemption(turn);
    expect(verdict.exempt).toBe(false);
    expect(collectOriginGateFailures([turn])).toHaveLength(1);
  });

  it('rejects forged suppression claims', () => {
    const unknownReason = silenceTurn({ reason: 'operator_says_quiet' });
    expect(validateSilenceExemption(unknownReason).exempt).toBe(false);

    const observeOnly = silenceTurn({
      reason: 'suppress_acknowledgement',
      classifier: { mode: 'observe', would_suppress: true, action: 'suppress_acknowledgement' },
    });
    expect(validateSilenceExemption(observeOnly).exempt).toBe(false);

    const noClassifier = silenceTurn({ reason: 'suppress_reaction' });
    expect(validateSilenceExemption(noClassifier).exempt).toBe(false);

    const verifiedNull = silenceTurn({
      reason: 'human_escalation_active',
      originStatus: 'verified',
    });
    expect(validateSilenceExemption(verifiedNull).exempt).toBe(false);

    for (const turn of [unknownReason, observeOnly, noClassifier, verifiedNull]) {
      expect(collectOriginGateFailures([turn])).toHaveLength(1);
    }
  });

  it('never exempts failed generation or a missing nonempty reply', () => {
    const failed = silenceTurn({
      reason: 'human_escalation_active',
      originStatus: 'generation_failed',
    });
    expect(validateSilenceExemption(failed).exempt).toBe(false);

    const mismatched = silenceTurn({
      reason: 'human_escalation_active',
      originStatus: 'mismatch',
    });
    expect(validateSilenceExemption(mismatched).exempt).toBe(false);

    const emptySend = silenceTurn({
      reason: 'reply_composed',
      action: 'send',
      deliveredText: '',
    });
    expect(validateSilenceExemption(emptySend).exempt).toBe(false);

    expect(collectOriginGateFailures([failed, mismatched, emptySend])).toHaveLength(3);
  });

  it('distinguishes thanks silence from required-answer suppression and generation failure', () => {    // Thanks with no task and model-selected enforce evidence: legitimate
    // silence, exempt from the origin gate.
    const thanks = silenceTurn({
      reason: 'suppress_acknowledgement',
      classifier: { mode: 'enforce', would_suppress: true, action: 'suppress_acknowledgement' },
    });
    expect(validateSilenceExemption(thanks)).toMatchObject({ exempt: true });

    // A required answer replaced by a suppress disposition without
    // model-selected enforce evidence: not silence, a missing required
    // answer. It must never count as successful duplicate prevention.
    const suppressedAnswer = silenceTurn({ reason: 'response_classifier_suppressed' });
    expect(validateSilenceExemption(suppressedAnswer)).toMatchObject({ exempt: false });
    expect(validateSilenceExemption(suppressedAnswer).reason).toContain('unknown suppression reason');

    // A generation failure is neither silence nor suppression: the
    // operational failure disposition stays distinct so a later turn can
    // still answer the pending question.
    const failed = silenceTurn({
      reason: 'reply_compose_failed',
      action: 'failure',
      originStatus: 'generation_failed',
    });
    const failedVerdict = validateSilenceExemption(failed);
    expect(failedVerdict).toMatchObject({ exempt: false });
    expect(failedVerdict.reason).toContain('failed generation');

    expect(collectOriginGateFailures([thanks])).toEqual([]);
    expect(collectOriginGateFailures([suppressedAnswer, failed])).toHaveLength(2);
  });
});

function imageSilenceTurn(overrides: {
  persistReason?: string | null;
  planPersisted?: boolean;
  attachments?: Array<Record<string, unknown>>;
  inputText?: string;
  inputImage?: Record<string, unknown> | null;
  originStatus?: 'missing' | 'generation_failed' | 'mismatch' | 'verified';
  deliveredText?: string | null;
  outputText?: string;
  deliveryReason?: string;
  deliveryAction?: 'send' | 'suppress' | 'failure';
}): EvalTurnResult {
  return {
    turnIndex: 0,
    input: {
      text: overrides.inputText ?? '',
      ...(overrides.inputImage === null ? {} : {
        image: (overrides.inputImage ?? { redacted: true, mime_type: 'image/png' }) as never,
      }),
    },
    outputText: overrides.outputText ?? '',
    deliveredText: overrides.deliveredText ?? null,
    delivery: {
      action: overrides.deliveryAction ?? 'suppress',
      reason: overrides.deliveryReason ?? 'image_only_no_outstanding_task',
    },
    outputOrigin: {
      status: overrides.originStatus ?? 'missing',
      candidateSha256: null,
      deliveredSha256: null,
      transformationVersion: null,
      mismatchFields: ['candidate_output_origin'],
    },
    plan: {
      image_attachments: (overrides.attachments ?? [{
        kind: 'file',
        fileId: 'file-silence-1',
        expiresAt: '2030-01-01T00:00:00.000Z',
        mimeType: 'image/png',
        byteLength: 1234,
        contentDigest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        messageId: 'wamid.silence1',
        receivedAt: '2026-09-14T00:00:00.000Z',
      }]) as never,
    },
    trace: {
      plan_persisted: overrides.planPersisted ?? true,
      plan_persist_reason: overrides.persistReason === undefined ? 'image_file_silence' : overrides.persistReason,
    },
  } as unknown as EvalTurnResult;
}

describe('image-only silence observation correction (Packet D)', () => {
  it('exempts a persisted image-only silent turn from the origin gate', () => {
    const fileSilence = imageSilenceTurn({ persistReason: 'image_file_silence' });
    const urlSilence = imageSilenceTurn({
      persistReason: 'image_url_silence',
      attachments: [{ kind: 'url', url: 'https://example.com/silence.jpg', messageId: 'wamid.silence1', receivedAt: '2026-09-14T00:00:00.000Z' }],
    });
    expect(collectOriginGateFailures([fileSilence])).toEqual([]);
    expect(collectOriginGateFailures([urlSilence])).toEqual([]);
  });

  it('never exempts arbitrary empty output through the image-silence path', () => {
    const wrongReason = imageSilenceTurn({ deliveryReason: 'reply_composed' });
    const emptySend = imageSilenceTurn({ deliveryAction: 'send', deliveredText: '' });
    const nonEmptyWireText = imageSilenceTurn({ outputText: ' ' });
    expect(collectOriginGateFailures([wrongReason])).toHaveLength(1);
    expect(collectOriginGateFailures([emptySend])).toHaveLength(1);
    expect(collectOriginGateFailures([nonEmptyWireText])).toHaveLength(1);
  });

  it('requires persistence evidence for image-only silence', () => {
    const notPersisted = imageSilenceTurn({ planPersisted: false });
    const wrongPersistReason = imageSilenceTurn({ persistReason: 'image_unavailable' });
    const nullPersistReason = imageSilenceTurn({ persistReason: null });
    const noAttachments = imageSilenceTurn({ attachments: [] });
    for (const turn of [notPersisted, wrongPersistReason, nullPersistReason, noAttachments]) {
      expect(collectOriginGateFailures([turn])).toHaveLength(1);
    }
  });

  it('fails question-bearing turns and failed generation instead of silencing them', () => {
    const captioned = imageSilenceTurn({ inputText: 'Cuanto dice aqui?' });
    const imageless = imageSilenceTurn({ inputImage: null });
    const failed = imageSilenceTurn({ originStatus: 'generation_failed' });
    const mismatched = imageSilenceTurn({ originStatus: 'mismatch' });
    const verifiedNull = imageSilenceTurn({ originStatus: 'verified' });
    for (const turn of [captioned, imageless, failed, mismatched, verifiedNull]) {
      expect(collectOriginGateFailures([turn])).toHaveLength(1);
    }
  });
});

describe('F2 image-only silence requires a successful ref save, not persist text alone', () => {
  it('accepts a url ref with message linkage as a successful save', () => {
    const urlSilence = imageSilenceTurn({
      persistReason: 'image_url_silence',
      attachments: [{ kind: 'url', url: 'https://example.com/r.jpg', messageId: 'wamid.url1', receivedAt: '2026-09-14T00:00:00.000Z' }],
    });
    expect(collectOriginGateFailures([urlSilence])).toEqual([]);
  });

  it('rejects persist-reason text with a ref that carries no file or url identity', () => {
    const forgedRef = imageSilenceTurn({
      attachments: [{ kind: 'file', messageId: 'wamid.forged' }],
    });
    expect(collectOriginGateFailures([forgedRef])).toHaveLength(1);
  });

  it('rejects persist-reason text with a ref missing message linkage', () => {
    const unlinkable = imageSilenceTurn({
      attachments: [{ kind: 'file', fileId: 'file-orphan-1' }],
    });
    expect(collectOriginGateFailures([unlinkable])).toHaveLength(1);
  });
});
