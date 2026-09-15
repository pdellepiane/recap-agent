import crypto from 'node:crypto';

import {
  checkTransportMetricsCompleteness,
  type TransportCompleteness,
} from './openai-transport-capture';
import type {
  OpenAiTransportMetrics,
  OpenAiTransportRequest,
  TokenUsage,
} from '../runtime/contracts';

/**
 * Step-D matched-request measurement (lean-conversation audit, 2026-09-11).
 *
 * Aggregates complete model-request observations AFTER SDK serialization,
 * across every stage of a matched turn (classifier, extraction, reply,
 * tool-loop follow-ups, repair generations, image, knowledge retrieval).
 * Retries and failed attempts are included, never zeroed: a failed fetch
 * still contributes its serialized bytes and its model-call count.
 *
 * Every record is content-free: block IDs, byte counts and hashes only.
 * No instruction text, user message, payload or model output is stored.
 */

export type MatchedDomain =
  | 'auth'
  | 'purchase'
  | 'rsvp'
  | 'faq'
  | 'support'
  | 'close'
  | 'planning'
  | 'image';

export type MatchedStageSummary = {
  stage: OpenAiTransportRequest['stage'];
  observedRequestCount: number;
  totalPayloadBytes: number | null;
  instructionBytes: number | null;
  inputBytes: number | null;
  toolBytes: number | null;
  outputSchemaBytes: number | null;
  requestBodyHashes: Array<string | null>;
  completeness: TransportCompleteness;
};

export type MatchedTurnMeasurement = {
  caseId: string;
  domain: MatchedDomain;
  model: string;
  modelCalls: number;
  totalPayloadBytes: number | null;
  instructionBytes: number | null;
  inputBytes: number | null;
  toolBytes: number | null;
  outputSchemaBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stages: MatchedStageSummary[];
  transportComplete: boolean;
  transportReasons: string[];
};

export type MatchedDomainAggregate = {
  domain: MatchedDomain;
  turns: number;
  modelCalls: number;
  totalPayloadBytes: number | null;
  instructionBytes: number | null;
  inputBytes: number | null;
  toolBytes: number | null;
  outputSchemaBytes: number | null;
};

export type EvidenceBlockAttribution = {
  blockId: string;
  bytes: number;
  sha256: string;
};

function sumOrNull(values: Array<number | null>): number | null {
  return values.every((value) => value !== null)
    ? values.reduce((total, value) => total + (value ?? 0), 0)
    : null;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Content-free per-stage summary; completeness reuses the E10 helper. */
export function summarizeMatchedStage(
  stage: OpenAiTransportRequest['stage'],
  metrics: OpenAiTransportMetrics,
  label: string,
): MatchedStageSummary {
  return {
    stage,
    observedRequestCount: metrics.observedRequestCount,
    totalPayloadBytes: metrics.totalPayloadBytes,
    instructionBytes: metrics.instructionBytes,
    inputBytes: metrics.inputBytes,
    toolBytes: metrics.toolBytes,
    outputSchemaBytes: metrics.outputSchemaBytes,
    requestBodyHashes: metrics.requests.map((request) => request.requestBodySha256),
    completeness: checkTransportMetricsCompleteness(metrics, label),
  };
}

/**
 * Matched-turn totals over all captured stages. Failed attempts stay
 * counted inside observedRequestCount and their bytes stay summed.
 * Absent evidence is missing (null), never zero.
 */
export function summarizeMatchedTurn(args: {
  caseId: string;
  domain: MatchedDomain;
  model: string;
  stages: MatchedStageSummary[];
  tokenUsage?: TokenUsage | null;
}): MatchedTurnMeasurement {
  const reasons = args.stages.flatMap((stage) => stage.completeness.reasons);
  return {
    caseId: args.caseId,
    domain: args.domain,
    model: args.model,
    modelCalls: args.stages.reduce((total, stage) => total + stage.observedRequestCount, 0),
    totalPayloadBytes: sumOrNull(args.stages.map((stage) => stage.totalPayloadBytes)),
    instructionBytes: sumOrNull(args.stages.map((stage) => stage.instructionBytes)),
    inputBytes: sumOrNull(args.stages.map((stage) => stage.inputBytes)),
    toolBytes: sumOrNull(args.stages.map((stage) => stage.toolBytes)),
    outputSchemaBytes: sumOrNull(args.stages.map((stage) => stage.outputSchemaBytes)),
    inputTokens: args.tokenUsage?.input_tokens ?? null,
    outputTokens: args.tokenUsage?.output_tokens ?? null,
    stages: args.stages,
    transportComplete: reasons.length === 0 && args.stages.length > 0,
    transportReasons: reasons,
  };
}

/** Per-domain roll-up over matched turns; denominators stay explicit. */
export function aggregateMatchedByDomain(
  turns: readonly MatchedTurnMeasurement[],
): MatchedDomainAggregate[] {
  const byDomain = new Map<MatchedDomain, MatchedTurnMeasurement[]>();
  for (const turn of turns) {
    const group = byDomain.get(turn.domain) ?? [];
    group.push(turn);
    byDomain.set(turn.domain, group);
  }
  return [...byDomain.entries()].map(([domain, group]) => ({
    domain,
    turns: group.length,
    modelCalls: group.reduce((total, turn) => total + turn.modelCalls, 0),
    totalPayloadBytes: sumOrNull(group.map((turn) => turn.totalPayloadBytes)),
    instructionBytes: sumOrNull(group.map((turn) => turn.instructionBytes)),
    inputBytes: sumOrNull(group.map((turn) => turn.inputBytes)),
    toolBytes: sumOrNull(group.map((turn) => turn.toolBytes)),
    outputSchemaBytes: sumOrNull(group.map((turn) => turn.outputSchemaBytes)),
  }));
}

/**
 * Per-block byte attribution for a reply-evidence object. Stores block ID,
 * UTF-8 bytes and hash only; block payloads never leave the process.
 */
export function attributeEvidenceBlockBytes(
  evidence: Record<string, unknown>,
): EvidenceBlockAttribution[] {
  return Object.entries(evidence).map(([blockId, value]) => {
    const serialized = JSON.stringify(value) ?? 'null';
    return {
      blockId,
      bytes: Buffer.byteLength(serialized, 'utf8'),
      sha256: sha256Hex(`${blockId}:${serialized}`),
    };
  });
}
