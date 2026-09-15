import crypto from 'node:crypto';
import { z } from 'zod';

export const PACKET_VERSION = 1;
export const MAX_DIAGNOSTIC_BYTES = 12288;
export const MAX_CALL_SUMMARIES = 16;
export const MAX_CANDIDATE_DETAILS = 8;

export const KNOWN_TRACE_TOOLS = [
  'list_categories',
  'list_locations',
  'search_providers_from_plan',
  'get_relevant_providers',
  'get_category_by_slug',
  'search_providers_by_keyword',
  'search_providers_by_category_location',
  'search_providers_by_query_intent',
  'get_provider_detail',
  'get_provider_detail_and_track_view',
  'get_related_providers',
  'list_provider_reviews',
  'get_event_vendor_context',
  'list_event_favorite_providers',
  'list_user_events_vendor_context',
  'create_quote_request',
  'add_vendor_to_event_favorites',
  'create_provider_review',
  'request_human_takeover',
  'guest_rsvp',
  'lookup_rsvp_invitations',
  'lookup_guest_events_by_phone',
  'get_guest_event_detail',
  'knowledge_base_search',
  'associated_event_lookup',
  'agent_api_purchase_lookup',
  'finish_plan',
] as const;

const boundedCount = z.number().int().min(0).max(1000000);
const boundedBytes = z.number().int().min(0).max(100000000);

const extractionPacketSchema = z.object({
  actionIntent: z.string().max(64).nullable(),
  humanHelpIntent: z.enum(['none', 'request', 'accept_offer', 'retry', 'decline_offer']),
  phoneConfirmation: z.enum(['yes', 'no', 'unclear']).nullable(),
  supportKind: z.string().max(64).nullable(),
  supportTopic: z.string().max(64).nullable(),
  supportDetail: z.string().max(64).nullable(),
  authActions: z.array(z.string().max(64)).max(16),
  requestedOperation: z.string().max(64).nullable(),
  extractionProfile: z.string().max(64),
  rejectedReasons: z.array(z.string().max(64)).max(16),
}).strict();

const authHelpPacketSchema = z.object({
  terminalReason: z.string().max(64).nullable(),
  sendAttempts: boundedCount,
  verifyAttempts: boundedCount,
  trustedPhonePresent: z.boolean(),
  manifestAvailable: z.boolean(),
  manifestReason: z.string().max(128).nullable(),
  gatewayKind: z.enum(['fixture', 'real', 'disabled', 'none']),
  decisionAction: z.string().max(64),
  decisionReason: z.string().max(128),
  attempted: z.boolean(),
  gatewayOutcome: z.enum(['success', 'failed', 'unknown', 'disabled', 'none']),
  requested: z.boolean(),
  softPaused: z.boolean(),
  dedupe: z.enum(['dispatched', 'replay', 'skipped', 'none']),
}).strict();

const purchasePacketSchema = z.object({
  referenceSupplied: z.boolean(),
  resolution: z.enum(['matched', 'unavailable', 'none']),
  candidateCount: boundedCount,
  selectedAlias: z.string().max(8).nullable(),
  authFieldFlags: z.object({ phone: z.boolean(), email: z.boolean() }).strict(),
}).strict();

const effectPacketSchema = z.object({
  operation: z.enum([
    'otp.request', 'otp.verify', 'rsvp.write', 'handoff.write',
    'provider.quote.write', 'provider.favorite.write', 'provider.review.write',
  ]),
  attempts: boundedCount,
  successes: boundedCount,
  replays: boundedCount,
  outcome: z.enum(['success', 'failed', 'unknown', 'disabled', 'none']),
  receiptPresent: z.boolean(),
  scenario: z.string().max(128),
}).strict();

const replyPacketSchema = z.object({
  rendererId: z.string().max(64),
  branchReason: z.string().max(128),
  instructionBytes: boundedBytes,
  inputBytes: boundedBytes,
  textDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const decisionPacketsSchema = z.object({
  version: z.literal(PACKET_VERSION),
  extraction: extractionPacketSchema,
  authHelp: authHelpPacketSchema,
  purchase: purchasePacketSchema,
  effects: z.array(effectPacketSchema).max(7),
  reply: replyPacketSchema,
}).strict();

export type DecisionPackets = z.infer<typeof decisionPacketsSchema>;
export type EffectPacket = z.infer<typeof effectPacketSchema>;

export function hashHex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashJudgeRequest(args: {
  rubric: string;
  candidateText: string;
  context?: string;
  model: string;
  evidenceDigest?: string;
}): string {
  const serialized = JSON.stringify({
    rubric: args.rubric,
    candidateText: args.candidateText,
    context: args.context ?? '',
    model: args.model,
    evidenceDigest: args.evidenceDigest ?? '',
  });
  return hashHex(serialized);
}

/**
 * F2 versioned silence-disposition packet. The semantic judge receives this
 * structured observation for empty candidates (suppress action/reason, no
 * delivered text, observed classifier and effect context, image ref-save
 * proof) instead of a pretend assistant sentence. Only typed scalars travel:
 * no transcripts or identifiers that could leak PII; the reason field carries
 * typed disposition vocabulary guarded against leaks. Invocation binding
 * (observed message ID linkage, active typed refs, validated current input)
 * is enforced at validation time in src/evals/silence.ts against the private
 * plan snapshot; this packet records the resulting booleans and counts, and
 * its reason field is leak-guarded above.
 */
export const SILENCE_DISPOSITION_VERSION = 1;

const silenceDispositionEffectSchema = z.object({
  operation: z.string().max(64),
  attempts: boundedCount,
  successes: boundedCount,
  outcome: z.enum(['success', 'failed', 'unknown', 'disabled', 'none']),
}).strict();

const silenceDispositionPacketSchema = z.object({
  version: z.literal(SILENCE_DISPOSITION_VERSION),
  action: z.string().max(32),
  reason: z.string().max(256),
  deliveredNull: z.literal(true),
  originStatus: z.string().max(32).nullable(),
  path: z.enum(['established', 'model_selected', 'image_only']),
  classifier: z.object({
    mode: z.enum(['observe', 'enforce']).nullable(),
    action: z.string().max(64).nullable(),
    wouldSuppress: z.boolean().nullable(),
  }).strict(),
  effects: z.array(silenceDispositionEffectSchema).max(7),
  imageRefSaved: z.boolean(),
  imageRefCount: boundedCount,
  inputImagePresent: z.boolean(),
}).strict();

export type SilenceDispositionPacket = z.infer<typeof silenceDispositionPacketSchema>;

/**
 * S3 permanent control. The disposition reason travels into judge context, so
 * it must carry only typed disposition vocabulary: a synthetic file ID,
 * signed URL, email, phone, credential, or content digest inside the reason
 * fails the packet instead of escaping into judge evidence or artifacts.
 * Legitimate reasons are short typed constants and never trip this guard.
 */
const SILENCE_REASON_LEAK_PATTERNS: RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /https?:\/\/[^\s"'<>]+/iu,
  /\bwww\.[^\s"'<>]+/iu,
  /\bfile-[A-Za-z0-9_-]{3,}\b/u,
  /\bsynth-[a-z0-9-]{8,}\b/iu,
  /\b[a-f0-9]{64}\b/iu,
  /(?<![\d-])\+?\d[\d\s().-]{7,}\d/u,
];

function findSilenceReasonLeak(reason: string): string | null {
  for (const pattern of SILENCE_REASON_LEAK_PATTERNS) {
    if (pattern.test(reason)) return pattern.source;
  }
  return null;
}

export function buildSilenceDispositionPacket(args: {
  action: string;
  reason: string;
  originStatus: string | null;
  path: 'established' | 'model_selected' | 'image_only';
  classifier?: { mode?: string | null; action?: string | null; wouldSuppress?: boolean | null } | null;
  effects?: Array<{ operation: string; attempts: number; successes: number; outcome: string }>;
  imageRefSaved: boolean;
  imageRefCount: number;
  inputImagePresent: boolean;
}): SilenceDispositionPacket {
  const leaked = findSilenceReasonLeak(args.reason);
  if (leaked !== null) {
    throw new Error(`Silence disposition reason leaks sensitive content (${leaked}).`);
  }
  const mode = args.classifier?.mode === 'enforce' || args.classifier?.mode === 'observe'
    ? args.classifier.mode
    : null;
  const outcome = (value: string): 'success' | 'failed' | 'unknown' | 'disabled' | 'none' =>
    value === 'success' || value === 'failed' || value === 'unknown' || value === 'disabled' || value === 'none'
      ? value
      : 'none';
  const packet: SilenceDispositionPacket = {
    version: SILENCE_DISPOSITION_VERSION,
    action: args.action.slice(0, 32),
    reason: args.reason.slice(0, 256),
    deliveredNull: true,
    originStatus: args.originStatus?.slice(0, 32) ?? null,
    path: args.path,
    classifier: {
      mode,
      action: typeof args.classifier?.action === 'string' ? args.classifier.action.slice(0, 64) : null,
      wouldSuppress: typeof args.classifier?.wouldSuppress === 'boolean' ? args.classifier.wouldSuppress : null,
    },
    effects: (args.effects ?? []).slice(0, 7).map((entry) => ({
      operation: entry.operation.slice(0, 64),
      attempts: Math.max(0, Math.min(1000000, Math.floor(entry.attempts))),
      successes: Math.max(0, Math.min(1000000, Math.floor(entry.successes))),
      outcome: outcome(entry.outcome),
    })),
    imageRefSaved: args.imageRefSaved,
    imageRefCount: Math.max(0, Math.min(1000000, Math.floor(args.imageRefCount))),
    inputImagePresent: args.inputImagePresent,
  };
  const check = silenceDispositionPacketSchema.safeParse(packet);
  if (!check.success) throw new Error('Invalid silence disposition packet.');
  return check.data;
}

export function validateSilenceDispositionPacket(value: unknown): { ok: boolean; errors: string[] } {
  const parsed = silenceDispositionPacketSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }
  const leaked = findSilenceReasonLeak(parsed.data.reason);
  if (leaked !== null) {
    return { ok: false, errors: [`reason: sensitive content must never travel in judge evidence (${leaked})`] };
  }
  return { ok: true, errors: [] };
}

/**
 * Renders the validated disposition as labeled judge context. The candidate
 * itself stays empty: this block is observed evidence about the silence,
 * never model prose, and the judge must weigh it against that turn's task.
 */
export function formatSilenceDispositionForJudge(packet: SilenceDispositionPacket): string {
  const effects = packet.effects.length > 0
    ? packet.effects.map((entry) => `${entry.operation}:attempts=${entry.attempts}:successes=${entry.successes}:outcome=${entry.outcome}`).join(',')
    : 'none';
  return [
    'CANDIDATE SILENCE DISPOSITION (observed evidence, never model prose):',
    `action=${packet.action} reason=${packet.reason} delivered_text=none origin=${packet.originStatus ?? 'none'}`,
    `silence_path=${packet.path} classifier_mode=${packet.classifier.mode ?? 'none'} classifier_action=${packet.classifier.action ?? 'none'} classifier_would_suppress=${packet.classifier.wouldSuppress ?? 'none'}`,
    `observed_effects=[${effects}] image_ref_saved=${packet.imageRefSaved ? 'yes' : 'no'} image_refs=${packet.imageRefCount} input_image=${packet.inputImagePresent ? 'yes' : 'no'}`,
    'Judge this silence against that turn\u2019s actual task: silence after thanks or a persisted supplemental image may pass; the same silence on an unanswered question fails.',
  ].join('\n');
}

export function buildDecisionPackets(args: {
  extraction: z.infer<typeof extractionPacketSchema>;
  authHelp: z.infer<typeof authHelpPacketSchema>;
  purchase: z.infer<typeof purchasePacketSchema>;
  effects: Array<z.infer<typeof effectPacketSchema>>;
  reply: z.infer<typeof replyPacketSchema>;
}): DecisionPackets {
  const packets: DecisionPackets = {
    version: PACKET_VERSION,
    extraction: { ...args.extraction },
    authHelp: { ...args.authHelp },
    purchase: { ...args.purchase },
    effects: args.effects.map((entry) => ({ ...entry })),
    reply: { ...args.reply },
  };
  const check = decisionPacketsSchema.safeParse(packets);
  if (!check.success) throw new Error('Invalid decision packets.');
  assertNoRawSecrets(JSON.stringify(packets));
  return check.data;
}

export function validateDecisionPackets(value: unknown): { ok: boolean; errors: string[] } {
  const parsed = decisionPacketsSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }
  const record = value as Record<string, unknown>;
  const extraKeys = Object.keys(record).filter(
    (key) => !['version', 'extraction', 'authHelp', 'purchase', 'effects', 'reply'].includes(key),
  );
  if (extraKeys.length > 0) return { ok: false, errors: [`unknown packet fields: ${extraKeys.join(',')}`] };
  if (record['unknownTool'] !== undefined) return { ok: false, errors: ['unknown tool field present'] };
  try {
    assertNoRawSecrets(JSON.stringify(parsed.data));
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'secret leak'] };
  }
  return { ok: true, errors: [] };
}

function assertNoRawSecrets(serialized: string): void {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(serialized)) throw new Error('Packet leaks email.');
  if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u.test(serialized)) throw new Error('Packet leaks credential.');
  if (/(?<![\d-])\+?\d[\d\s().-]{7,}\d/u.test(serialized) && /519|\+51|\(\d{3}\)/.test(serialized)) {
    throw new Error('Packet leaks phone.');
  }
  if (/COD301816|synth-[a-z0-9-]{8,}|sk-[a-z0-9-]+/iu.test(serialized)) throw new Error('Packet leaks receipt/reference.');
}

export function enforceTraceEnvelope(trace: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...trace };
  let droppedCandidateDetails = 0;
  let droppedCalls = 0;
  if (Array.isArray(output['tool_inputs']) && output['tool_inputs'].length > MAX_CALL_SUMMARIES) {
    droppedCalls += (output['tool_inputs'] as unknown[]).length - MAX_CALL_SUMMARIES;
    output['tool_inputs'] = (output['tool_inputs'] as unknown[]).slice(0, MAX_CALL_SUMMARIES);
  }
  if (Array.isArray(output['tool_outputs']) && output['tool_outputs'].length > MAX_CALL_SUMMARIES) {
    droppedCalls += (output['tool_outputs'] as unknown[]).length - MAX_CALL_SUMMARIES;
    output['tool_outputs'] = (output['tool_outputs'] as unknown[]).slice(0, MAX_CALL_SUMMARIES);
  }
  if (Array.isArray(output['provider_candidate_audit']) && output['provider_candidate_audit'].length > MAX_CANDIDATE_DETAILS) {
    droppedCandidateDetails = (output['provider_candidate_audit'] as unknown[]).length - MAX_CANDIDATE_DETAILS;
    output['provider_candidate_audit'] = (output['provider_candidate_audit'] as unknown[]).slice(0, MAX_CANDIDATE_DETAILS);
  }
  let serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_DIAGNOSTIC_BYTES) {
    const candidates = Array.isArray(output['provider_candidate_audit']) ? [...(output['provider_candidate_audit'] as unknown[])] : [];
    while (candidates.length > 0 && Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_DIAGNOSTIC_BYTES) {
      candidates.pop();
      droppedCandidateDetails += 1;
      output['provider_candidate_audit'] = candidates;
    }
    serialized = JSON.stringify(output);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_DIAGNOSTIC_BYTES) {
      if (Array.isArray(output['tool_inputs'])) {
        const keep = Math.max(0, MAX_CALL_SUMMARIES - 4);
        droppedCalls += (output['tool_inputs'] as unknown[]).length - keep;
        output['tool_inputs'] = (output['tool_inputs'] as unknown[]).slice(0, keep);
      }
      if (Array.isArray(output['tool_outputs'])) {
        const keep = Math.max(0, MAX_CALL_SUMMARIES - 4);
        droppedCalls += (output['tool_outputs'] as unknown[]).length - keep;
        output['tool_outputs'] = (output['tool_outputs'] as unknown[]).slice(0, keep);
      }
    }
    while (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_DIAGNOSTIC_BYTES) {
      const entries = Object.entries(output).filter(([, v]) => typeof v === 'string' && v.length > 512);
      if (entries.length === 0) break;
      entries.sort((a, b) => (b[1] as string).length - (a[1] as string).length);
      const first = entries[0];
      if (!first) break;
      output[first[0]] = (first[1] as string).slice(0, 512);
      droppedCalls += 1;
    }
  }
  const truncated = droppedCandidateDetails > 0 || droppedCalls > 0 ||
    Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_DIAGNOSTIC_BYTES;
  const finalBytes = Buffer.byteLength(JSON.stringify({ ...output, truncation: undefined }), 'utf8');
  output['truncation'] = {
    truncated,
    droppedCandidateDetails,
    droppedCalls,
    diagnosticBytes: Math.min(finalBytes, MAX_DIAGNOSTIC_BYTES),
    envelopeBytes: MAX_DIAGNOSTIC_BYTES,
    maxCallSummaries: MAX_CALL_SUMMARIES,
    maxCandidateDetails: MAX_CANDIDATE_DETAILS,
  };
  const guarded = JSON.stringify(output);
  if (Buffer.byteLength(guarded, 'utf8') > MAX_DIAGNOSTIC_BYTES + 512) {
    output['provider_candidate_audit'] = [];
    (output['truncation'] as Record<string, unknown>)['droppedCandidateDetails'] = droppedCandidateDetails;
    (output['truncation'] as Record<string, unknown>)['truncated'] = true;
  }
  return output;
}
