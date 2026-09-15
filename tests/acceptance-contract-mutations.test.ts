import { describe, expect, it } from 'vitest';

import {
  assertCompleteTransportAccounting,
  checkTransportMetricsCompleteness,
  summarizeTransportRequests,
} from '../src/audit/openai-transport-capture';
import { hashPrivateOutput, validateOutputOriginEvidence } from '../src/audit/output-origin';
import { assertExpectedCasesExecuted } from '../src/evals/reporting';
import { collectOriginGateFailures, resolveTextSemanticCandidate } from '../src/evals/runner';
import { validateSemanticJudgePacket } from '../src/evals/scorers/semantic-judge';
import { independentlyObserveWireOutput } from '../src/evals/targets/live-lambda';
import type { EvalTurnResult } from '../src/evals/case-schema';
import type { OpenAiTransportRequest } from '../src/runtime/contracts';

function observedFailure(mutationId: string, assertion: () => void): string {
  try {
    assertion();
  } catch (error) {
    return `${mutationId}: ${error instanceof Error ? error.message : String(error)}`;
  }
  throw new Error(`${mutationId}: mutation was accepted unexpectedly`);
}

function completeRequest(sequence: number): OpenAiTransportRequest {
  return {
    sequence,
    stage: 'reply',
    requestId: `request-${sequence}`,
    responseId: `response-${sequence}`,
    statusCode: 200,
    succeeded: true,
    totalPayloadBytes: 100,
    instructionBytes: 10,
    inputBytes: 20,
    toolBytes: 30,
    outputSchemaBytes: 40,
    requestBodySha256: 'a'.repeat(64),
  };
}

describe('acceptance contract mutation controls', () => {
  it('rejects each required test-only mutant and records the observed failure', () => {
    const failures = [
      observedFailure('omitted-schema-bytes', () => {
        const request = { ...completeRequest(0), outputSchemaBytes: null };
        assertCompleteTransportAccounting(summarizeTransportRequests([request]), 1);
      }),
      observedFailure('dropped-second-call', () => {
        assertCompleteTransportAccounting(summarizeTransportRequests([completeRequest(0)]), 2);
      }),
      observedFailure('missing-origin', () => {
        const result = validateOutputOriginEvidence(undefined);
        if (result.valid) throw new Error('missing origin passed');
        throw new Error(result.reason);
      }),
      observedFailure('missing-evidence', () => {
        validateSemanticJudgePacket({
          candidateVisibleEvidence: 'current user message',
          independentEffectTruth: '',
          expectations: 'rubric',
          futureTurnCount: 0,
        });
      }),
      observedFailure('missing-mandatory-case', () => {
        assertExpectedCasesExecuted(['mandatory.case'], []);
      }),
    ];

    expect(failures).toHaveLength(5);
    expect(failures.join('\n')).toContain('omitted-schema-bytes: transport request 0 is missing serialized byte accounting');
    expect(failures.join('\n')).toContain('dropped-second-call: transport request count mismatch');
    expect(failures.join('\n')).toContain('missing-origin: missing output-origin evidence');
    expect(failures.join('\n')).toContain('missing-evidence: semantic judge packet is missing independent effect truth');
    expect(failures.join('\n')).toContain('missing-mandatory-case: mandatory evaluation cases missing');
  });

  it('rejects inconsistent hashes, forged receipts, and unknown transformations', () => {
    const identical = hashPrivateOutput('Texto identico del modelo.');
    const failures = [
      observedFailure('inconsistent-hashes', () => {
        const result = validateOutputOriginEvidence({
          status: 'verified',
          candidateSha256: hashPrivateOutput('Texto candidato distinto.'),
          deliveredSha256: hashPrivateOutput('Texto entregado por cable.'),
          transformationVersion: 'transport-v2',
          mismatchFields: [],
        });
        if (result.valid) throw new Error('inconsistent hashes passed');
        throw new Error(result.reason);
      }),
      observedFailure('forged-verified', () => {
        const result = validateOutputOriginEvidence({
          status: 'verified',
          candidateSha256: identical,
          deliveredSha256: identical,
          transformationVersion: 'transport-v2',
          mismatchFields: ['model_paragraphs'],
        });
        if (result.valid) throw new Error('forged verified passed');
        throw new Error(result.reason);
      }),
      observedFailure('unknown-transformation', () => {
        const result = validateOutputOriginEvidence({
          status: 'verified',
          candidateSha256: identical,
          deliveredSha256: identical,
          transformationVersion: 'transport-v9',
          mismatchFields: [],
        });
        if (result.valid) throw new Error('unknown transformation passed');
        throw new Error(result.reason);
      }),
      observedFailure('model-call-replacement', () => {
        const candidate = 'Respuesta original del modelo.';
        const observed = independentlyObserveWireOutput('Texto reemplazado en el cable.', {
          status: 'verified',
          candidateSha256: hashPrivateOutput(candidate),
          deliveredSha256: hashPrivateOutput(candidate),
          transformationVersion: 'transport-v2',
          mismatchFields: [],
        });
        if (observed.status !== 'mismatch') throw new Error('replaced wire output kept verified status');
        throw new Error(`wire replacement detected: ${observed.mismatchFields.join(',')}`);
      }),
      observedFailure('forged-wire-verified', () => {
        const wire = 'Texto entregado por cable.';
        const observed = independentlyObserveWireOutput(wire, {
          status: 'verified',
          candidateSha256: hashPrivateOutput(wire),
          deliveredSha256: hashPrivateOutput(wire),
          transformationVersion: 'transport-v2',
          mismatchFields: ['model_paragraphs'],
        });
        if (observed.status !== 'mismatch') throw new Error('forged wire receipt kept verified status');
        throw new Error(`forged wire receipt detected: ${observed.mismatchFields.join(',')}`);
      }),
      observedFailure('unknown-wire-transformation', () => {
        const wire = 'Texto entregado por cable.';
        const observed = independentlyObserveWireOutput(wire, {
          status: 'verified',
          candidateSha256: hashPrivateOutput(wire),
          deliveredSha256: hashPrivateOutput(wire),
          transformationVersion: 'transport-v9',
          mismatchFields: [],
        });
        if (observed.status !== 'mismatch') throw new Error('unknown wire transformation kept verified status');
        throw new Error(`unknown wire transformation detected: ${observed.mismatchFields.join(',')}`);
      }),
      observedFailure('stale-transport-v1', () => {
        const wire = 'Texto entregado por cable.';
        const wireHash = hashPrivateOutput(wire);
        const result = validateOutputOriginEvidence({
          status: 'verified',
          candidateSha256: wireHash,
          deliveredSha256: wireHash,
          transformationVersion: 'transport-v1',
          mismatchFields: [],
        });
        if (result.valid) throw new Error('stale v1 receipt validated as new evidence');
        throw new Error(result.reason);
      }),
      observedFailure('stale-wire-transport-v1', () => {
        const wire = 'Texto entregado por cable.';
        const wireHash = hashPrivateOutput(wire);
        const observed = independentlyObserveWireOutput(wire, {
          status: 'verified',
          candidateSha256: wireHash,
          deliveredSha256: wireHash,
          transformationVersion: 'transport-v1',
          mismatchFields: [],
        });
        if (observed.status !== 'mismatch') throw new Error('stale v1 wire receipt kept verified status');
        throw new Error(`stale wire version detected: ${observed.mismatchFields.join(',')}`);
      }),
      observedFailure('injected-renderer-prose', () => {
        const candidate = 'Synthetic model sentence.';
        const delivered = 'Synthetic model sentence.\n\nSecond runtime sentence injected by the renderer.';
        const observed = independentlyObserveWireOutput(delivered, {
          status: 'verified',
          candidateSha256: hashPrivateOutput(candidate),
          deliveredSha256: hashPrivateOutput(candidate),
          transformationVersion: 'transport-v2',
          mismatchFields: [],
        });
        if (observed.status !== 'mismatch') throw new Error('injected renderer prose kept verified status');
        throw new Error(`injected renderer prose detected: ${observed.mismatchFields.join(',')}`);
      }),
    ];

    expect(failures).toHaveLength(9);
    expect(failures.join('\n')).toContain('inconsistent-hashes: candidate and delivered output hashes differ');
    expect(failures.join('\n')).toContain('forged-verified: output mismatch fields=model_paragraphs');
    expect(failures.join('\n')).toContain('unknown-transformation: unknown output transformation version');
    expect(failures.join('\n')).toContain('model-call-replacement: wire replacement detected: delivered_sha256,candidate_sha256');
    expect(failures.join('\n')).toContain('forged-wire-verified: forged wire receipt detected: model_paragraphs,declared_mismatch');
    expect(failures.join('\n')).toContain('unknown-wire-transformation: unknown wire transformation detected: transformation_version');
    expect(failures.join('\n')).toContain('stale-transport-v1: unknown output transformation version');
    expect(failures.join('\n')).toContain('stale-wire-transport-v1: stale wire version detected: transformation_version');
    expect(failures.join('\n')).toContain('injected-renderer-prose: injected renderer prose detected: delivered_sha256,candidate_sha256');
  });

  it('fails finalization gates on unjudged intermediate turns and incomplete transport', () => {
    const delivered = 'Turno entregado por cable.';
    const deliveredSha = hashPrivateOutput(delivered);
    const failures = [
      observedFailure('mismatch-unjudged-intermediate-turn', () => {
        const gateFailures = collectOriginGateFailures([
          originTurn(0, delivered, {
            status: 'verified',
            candidateSha256: deliveredSha,
            deliveredSha256: deliveredSha,
            transformationVersion: 'transport-v2',
            mismatchFields: [],
          }),
          originTurn(1, 'Turno intermedio reemplazado.', {
            status: 'mismatch',
            candidateSha256: hashPrivateOutput('Candidato intermedio.'),
            deliveredSha256: hashPrivateOutput('Turno intermedio reemplazado.'),
            transformationVersion: 'transport-v2',
            mismatchFields: ['delivered_text'],
          }),
          originTurn(2, delivered, {
            status: 'verified',
            candidateSha256: deliveredSha,
            deliveredSha256: deliveredSha,
            transformationVersion: 'transport-v2',
            mismatchFields: [],
          }),
        ]);
        if (gateFailures.length === 0) throw new Error('unjudged intermediate mismatch passed');
        throw new Error(gateFailures.join('; '));
      }),
      observedFailure('missing-transport-aggregates', () => {
        const result = checkTransportMetricsCompleteness({
          observedRequestCount: 1,
          totalPayloadBytes: null,
          instructionBytes: null,
          inputBytes: null,
          toolBytes: null,
          outputSchemaBytes: null,
          requests: [],
        }, 'reply');
        if (result.aggregateComplete) throw new Error('missing aggregates passed');
        throw new Error(result.reasons.join('; '));
      }),
      observedFailure('fabricated-zero-transport', () => {
        const result = checkTransportMetricsCompleteness({
          observedRequestCount: 0,
          totalPayloadBytes: 0,
          instructionBytes: 0,
          inputBytes: 0,
          toolBytes: 0,
          outputSchemaBytes: 0,
          requests: [],
        }, 'reply');
        if (result.aggregateComplete) throw new Error('fabricated zero transport passed');
        throw new Error(result.reasons.join('; '));
      }),
      observedFailure('unreconciled-aggregates', () => {
        const metrics = summarizeTransportRequests([completeRequest(0), completeRequest(1)]);
        const result = checkTransportMetricsCompleteness({ ...metrics, totalPayloadBytes: 1 }, 'reply');
        if (result.complete) throw new Error('unreconciled aggregates passed');
        throw new Error(result.reasons.join('; '));
      }),
    ];

    expect(failures).toHaveLength(4);
    expect(failures.join('\n')).toContain('mismatch-unjudged-intermediate-turn: turn 1: output-origin status=mismatch');
    expect(failures.join('\n')).toContain('missing-transport-aggregates: reply: transport totalPayloadBytes is missing');
    expect(failures.join('\n')).toContain('fabricated-zero-transport: reply: no transport requests observed');
    expect(failures.join('\n')).toContain('unreconciled-aggregates: reply: transport totalPayloadBytes aggregate=1 does not reconcile with per-request sum=200');
  });

  it('accepts fully reconciled private evidence and marks redacted aggregates', () => {
    const full = checkTransportMetricsCompleteness(
      summarizeTransportRequests([completeRequest(0), completeRequest(1)]),
      'reply',
    );
    expect(full.complete).toBe(true);
    expect(full.aggregateComplete).toBe(true);
    expect(full.detailRedacted).toBe(false);

    const redacted = checkTransportMetricsCompleteness({
      observedRequestCount: 1,
      totalPayloadBytes: 100,
      instructionBytes: 10,
      inputBytes: 20,
      toolBytes: 30,
      outputSchemaBytes: 40,
      requests: [],
    }, 'reply');
    expect(redacted.complete).toBe(false);
    expect(redacted.aggregateComplete).toBe(true);
    expect(redacted.detailRedacted).toBe(true);
  });

  it('routes empty candidates through validated silence observation before judging', () => {
    const failures = [
      observedFailure('forged-suppression', () => {
        const resolved = resolveTextSemanticCandidate(
          silenceObservedTurn({ reason: 'operator_says_quiet' }),
        );
        if (resolved.route !== 'failure') throw new Error('forged suppression reached the judge');
        throw new Error(resolved.failureMessage ?? 'forged suppression failed');
      }),
      observedFailure('unpersisted-image', () => {
        const resolved = resolveTextSemanticCandidate(
          silenceObservedTurn({
            reason: 'image_only_no_outstanding_task',
            planPersisted: false,
            attachments: [],
          }),
        );
        if (resolved.route !== 'failure') throw new Error('unpersisted image reached the judge');
        throw new Error(resolved.failureMessage ?? 'unpersisted image failed');
      }),
      observedFailure('empty-send', () => {
        const resolved = resolveTextSemanticCandidate(
          silenceObservedTurn({ action: 'send', reason: 'reply_composed', deliveredText: '' }),
        );
        if (resolved.route !== 'failure') throw new Error('empty send reached the judge');
        throw new Error(resolved.failureMessage ?? 'empty send failed');
      }),
      observedFailure('generation-failed-silence', () => {
        const resolved = resolveTextSemanticCandidate(
          silenceObservedTurn({ originStatus: 'generation_failed' }),
        );
        if (resolved.route !== 'failure') throw new Error('failed generation reached the judge');
        throw new Error(resolved.failureMessage ?? 'failed generation failed');
      }),
    ];

    expect(failures).toHaveLength(4);
    expect(failures.join('\n')).toContain('forged-suppression: unknown suppression reason');
    expect(failures.join('\n')).toContain('unpersisted-image: unpersisted image');
    expect(failures.join('\n')).toContain('empty-send: empty send');
    expect(failures.join('\n')).toContain('generation-failed-silence: failed generation');

    const thanks = resolveTextSemanticCandidate(
      silenceObservedTurn({
        reason: 'suppress_acknowledgement',
        classifier: { mode: 'enforce', wouldSuppress: true },
      }),
    );
    expect(thanks.route).toBe('silence');
    expect(thanks.candidateText).toBe('');
    expect(thanks.dispositionBlock).toContain('CANDIDATE SILENCE DISPOSITION');
  });
});

function originTurn(
  turnIndex: number,
  outputText: string,
  outputOrigin: EvalTurnResult['outputOrigin'],
): EvalTurnResult {
  return { turnIndex, outputText, outputOrigin } as unknown as EvalTurnResult;
}

function silenceObservedTurn(overrides: {
  reason?: string;
  action?: 'send' | 'suppress' | 'failure';
  deliveredText?: string | null;
  originStatus?: 'missing' | 'generation_failed' | 'mismatch' | 'verified';
  planPersisted?: boolean;
  attachments?: Array<Record<string, unknown>>;
  classifier?: { mode: 'observe' | 'enforce'; wouldSuppress: boolean } | null;
}): EvalTurnResult {
  return {
    turnIndex: 0,
    input: {
      text: '',
      image: { redacted: true, mime_type: 'image/png' },
    },
    outputText: '',
    deliveredText: overrides.deliveredText ?? null,
    delivery: {
      action: overrides.action ?? 'suppress',
      reason: overrides.reason ?? 'suppress_acknowledgement',
    },
    outputOrigin: {
      status: overrides.originStatus ?? 'missing',
      candidateSha256: null,
      deliveredSha256: null,
      transformationVersion: null,
      mismatchFields: ['candidate_output_origin'],
    },
    plan: {
      image_attachments: overrides.attachments ?? [],
    },
    trace: {
      plan_persisted: overrides.planPersisted ?? true,
      plan_persist_reason: 'image_file_silence',
      ...(overrides.classifier === null
        ? {}
        : {
          response_classifier: {
            mode: overrides.classifier?.mode ?? 'enforce',
            action: 'suppress_acknowledgement',
            reason: 'test suppression evidence',
            would_suppress: overrides.classifier?.wouldSuppress ?? true,
            context_source: 'local_plan',
            has_prior_outbound_message: true,
            fallback_used: false,
            conversation_health: 'progressing',
            health_reason: 'normal_progress',
            human_help_response: 'not_applicable',
            prompt_bundle_id: null,
            prompt_file_paths: [],
          },
        }),
    },
  } as unknown as EvalTurnResult;
}
