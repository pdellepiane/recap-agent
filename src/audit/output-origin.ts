import crypto from 'node:crypto';

/**
 * Hash-only output-origin evidence. `candidateText` MUST be the expected
 * channel render rebuilt from the immutable model-output snapshot and
 * validated provider ids BEFORE comparing with delivery — never a copy of
 * `deliveredText`. Equality here therefore proves the delivered bytes equal
 * the expected render; the distinct model-content hash lives in the model
 * origin receipt. Unknown transformation versions fail closed in
 * `validateOutputOriginEvidence`.
 */
export const OUTPUT_TRANSFORMATION_VERSION = 'transport-v2' as const;

export type OutputOriginEvidence = {
  status: 'verified' | 'mismatch' | 'missing' | 'generation_failed';
  candidateSha256: string | null;
  deliveredSha256: string | null;
  transformationVersion: string | null;
  mismatchFields: readonly string[];
};

export function hashPrivateOutput(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function observeOutputOrigin(args: {
  candidateText: string | null;
  deliveredText: string | null;
  transformationVersion: string | null;
  mismatchFields?: readonly string[];
}): OutputOriginEvidence {
  const mismatchFields = [...(args.mismatchFields ?? [])];
  if (args.candidateText === null) {
    return {
      status: 'generation_failed',
      candidateSha256: null,
      deliveredSha256: args.deliveredText === null ? null : hashPrivateOutput(args.deliveredText),
      transformationVersion: args.transformationVersion,
      mismatchFields: mismatchFields.length > 0 ? mismatchFields : ['model_output'],
    };
  }
  if (args.deliveredText === null || args.candidateText !== args.deliveredText) {
    mismatchFields.push('delivered_text');
  }
  return {
    status: mismatchFields.length > 0 ? 'mismatch' : 'verified',
    candidateSha256: hashPrivateOutput(args.candidateText),
    deliveredSha256: args.deliveredText === null ? null : hashPrivateOutput(args.deliveredText),
    transformationVersion: args.transformationVersion,
    mismatchFields,
  };
}

export function missingOutputOrigin(deliveredText: string | null): OutputOriginEvidence {
  return {
    status: 'missing',
    candidateSha256: null,
    deliveredSha256: deliveredText === null ? null : hashPrivateOutput(deliveredText),
    transformationVersion: null,
    mismatchFields: ['candidate_output_origin'],
  };
}

export function validateOutputOriginEvidence(
  evidence: OutputOriginEvidence | null | undefined,
): { valid: boolean; reason: string } {
  if (!evidence) return { valid: false, reason: 'missing output-origin evidence' };
  if (evidence.status !== 'verified') {
    return { valid: false, reason: `output-origin status=${evidence.status}` };
  }
  if (evidence.transformationVersion !== OUTPUT_TRANSFORMATION_VERSION) {
    return { valid: false, reason: 'unknown output transformation version' };
  }
  if (!evidence.candidateSha256 || !evidence.deliveredSha256) {
    return { valid: false, reason: 'missing candidate or delivered output hash' };
  }
  if (evidence.candidateSha256 !== evidence.deliveredSha256) {
    return { valid: false, reason: 'candidate and delivered output hashes differ' };
  }
  if (evidence.mismatchFields.length > 0) {
    return { valid: false, reason: `output mismatch fields=${evidence.mismatchFields.join(',')}` };
  }
  return { valid: true, reason: 'output-origin evidence verified' };
}
