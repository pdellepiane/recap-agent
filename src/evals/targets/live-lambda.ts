import crypto from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { configureRequiredLocalAwsProfile } from '../../aws/local-profile';
import { assertRequiredLocalAwsIdentity } from '../../aws/local-identity';
import { resolveDevelopmentTarget, type DevelopmentStackOutputs } from '../../aws/development-target';

import { createEmptyPlan, mergePlan, normalizeRawPlan, planIntentValues, planSchema, type PlanSnapshot } from '../../core/plan';
import { getConfig } from '../../runtime/config';
import { DynamoPlanStore } from '../../storage/dynamo-plan-store';
import { buildFixtureConversationKey, DynamoEvalFixtureStateStore, type EvalFixtureStateStore } from '../../runtime/eval-fixture-state';
import { buildFixturePhoneLookupKeys } from '../../runtime/eval-fixture-gateway';
import type {
  EvalCase,
  EvalRunConfig,
  EvalTurnResult,
  LambdaTurnResponse,
  OutputOriginEvidence,
} from '../case-schema';
import { lambdaTurnResponseSchema } from '../case-schema';
import {
  redactArtifactText,
  projectSafePlan,
  projectSafeRecord,
  projectSafeTrace,
} from '../../runtime/artifact-redaction';
import {
  attachEvaluationState,
  buildFixtureEffectSummariesFromReceipts,
  getEvaluationPlan,
  type FixtureEffectSummary,
} from '../evaluation-state';
import { conversationPartitionKey } from '../../storage/conversation-key';
import { parseTurnCoordinationHeaders, runOverlappingTurns } from '../concurrent-turns';
import { hashPrivateOutput, OUTPUT_TRANSFORMATION_VERSION } from '../../audit/output-origin';
import { redactImageUrlForLog } from '../../core/image-attachments';

/**
 * Packet O1 execution identity. One execution (run/config/case) owns one
 * deterministic seed; every logical input conversation ID maps to a unique
 * physical ID within this execution. Repeated logical IDs map identically,
 * distinct logical IDs stay distinct, and two executions never share a
 * physical conversation. Business phones, guest/event IDs, tokens, and
 * expected facts are never rewritten — only conversation routing IDs
 * (externalUserId, sessionId, wire message_id) are mapped.
 */
export type ExecutionConversationMapping = {
  seed: string;
  defaultExternalUserId: string;
  defaultSessionId: string;
  externalUserIdByLogical: Map<string, string>;
  sessionIdByLogical: Map<string, string>;
};

export function buildExecutionIdentitySeed(runId: string, configLabel: string, caseId: string): string {
  return crypto
    .createHash('sha256')
    .update(`${runId}\0${configLabel}\0${caseId}`, 'utf8')
    .digest('hex')
    .slice(0, 8);
}

export function buildExecutionConversationMapping(args: {
  runId: string;
  configLabel: string;
  caseId: string;
  channel: string;
  logicalExternalUserIds: Array<string | null | undefined>;
  logicalSessionIds: Array<string | null | undefined>;
}): ExecutionConversationMapping {
  const seed = buildExecutionIdentitySeed(args.runId, args.configLabel, args.caseId);
  const defaultExternalUserId = `${args.channel}-${args.configLabel}-${args.caseId}-${seed}`;
  const defaultSessionId = `${args.caseId}-session-${seed}`;
  const externalUserIdByLogical = new Map<string, string>();
  const sessionIdByLogical = new Map<string, string>();
  let userSuffix = 0;
  for (const logical of args.logicalExternalUserIds) {
    if (typeof logical !== 'string' || logical.trim().length === 0) continue;
    if (!externalUserIdByLogical.has(logical)) {
      userSuffix += 1;
      externalUserIdByLogical.set(logical, `${defaultExternalUserId}--u${userSuffix}`);
    }
  }
  let sessionSuffix = 0;
  for (const logical of args.logicalSessionIds) {
    if (typeof logical !== 'string' || logical.trim().length === 0) continue;
    if (!sessionIdByLogical.has(logical)) {
      sessionSuffix += 1;
      sessionIdByLogical.set(logical, `${defaultSessionId}--s${sessionSuffix}`);
    }
  }
  return { seed, defaultExternalUserId, defaultSessionId, externalUserIdByLogical, sessionIdByLogical };
}

export function resolvePhysicalExternalUserId(
  mapping: ExecutionConversationMapping,
  logical: string | null | undefined,
): string {
  if (typeof logical !== 'string' || logical.trim().length === 0) return mapping.defaultExternalUserId;
  return mapping.externalUserIdByLogical.get(logical) ?? mapping.defaultExternalUserId;
}

export function resolvePhysicalSessionId(
  mapping: ExecutionConversationMapping,
  logical: string | null | undefined,
): string {
  if (typeof logical !== 'string' || logical.trim().length === 0) return mapping.defaultSessionId;
  return mapping.sessionIdByLogical.get(logical) ?? mapping.defaultSessionId;
}

export async function runLiveLambdaCase(args: {
  currentCase: EvalCase;
  config: EvalRunConfig;
  artifactDir: string;
  /**
   * S1 test seam. Unit tests inject an isolated fixture store; live runs use
   * the development EvalFixtureTable resolved from the stack. Unit-direct
   * store calls are never completion: this caller must integrate
   * recordOutboundReceipt-equivalent observation through recordFixtureOutboundObservation.
   */
  fixtureStore?: EvalFixtureStateStore;
}): Promise<{
  turns: EvalTurnResult[];
  status: 'passed' | 'failed' | 'errored' | 'skipped';
}> {
  configureRequiredLocalAwsProfile({
    profile: process.env.AWS_PROFILE,
    region: process.env.AWS_REGION,
  });

  assertRequiredLocalAwsIdentity();
  const liveDefaults = await resolveLiveLambdaDefaults(args);
  const functionUrl = liveDefaults.functionUrl;
  if (!functionUrl) {
    return {
      turns: [],
      status: 'skipped',
    };
  }
  const channelApiKey = process.env.DEV_CHANNEL_API_KEY;
  if (!channelApiKey) {
    throw new Error('DEV_CHANNEL_API_KEY is required for live Lambda evaluations.');
  }

  const channel =
    args.currentCase.configOverrides?.liveLambda?.channel ??
    args.config.liveLambda?.channel ??
    process.env.TERMINAL_CHANNEL ??
    'terminal_whatsapp';
  // Packet O1 execution identity: logical input conversation IDs map to
  // unique physical IDs for this run/config/case execution. Case IDs stay
  // stable; business phones, guest/event IDs, tokens, and expected facts
  // are never rewritten.
  const executionRunId = args.config.run_id?.trim() || args.config.label;
  const conversationMapping = buildExecutionConversationMapping({
    runId: executionRunId,
    configLabel: args.config.label,
    caseId: args.currentCase.id,
    channel,
    logicalExternalUserIds: args.currentCase.inputs.map((input) => input.externalUserId),
    logicalSessionIds: args.currentCase.inputs.map((input) => input.sessionId ?? undefined),
  });
  const planStore = new DynamoPlanStore(liveDefaults.plansTableName, {
    region: liveDefaults.region,
  });
  const seedChannel = args.currentCase.inputs[0]?.channel ?? channel;
  const seedExternalUserId = resolvePhysicalExternalUserId(
    conversationMapping,
    args.currentCase.inputs[0]?.externalUserId,
  );
  if (args.currentCase.seedPlan) {
    try {
      const seedPlan = args.currentCase.seedPlan as Record<string, unknown>;
      const { channel: _seedChannel, external_user_id: _seedUser, ...seedRest } = seedPlan;
      void _seedChannel;
      void _seedUser;
      await planStore.save({
        plan: mergePlan(
          createEmptyPlan({
            planId: crypto.randomUUID(),
            channel: seedChannel,
            externalUserId: seedExternalUserId,
          }),
          seedRest as Parameters<typeof mergePlan>[1],
        ),
        reason: 'eval-seed',
      });
    } catch (error) {
      throw new Error(
        `Unable to seed the live evaluation plan for ${args.currentCase.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const runTurn = async (turnIndex: number): Promise<EvalTurnResult> => {
    const input = args.currentCase.inputs[turnIndex];
    if (!input) throw new Error('Missing live evaluation turn.');
    const startedAt = Date.now();
    const selectedScenario = input.backendFixture?.scenario ?? args.currentCase.backendFixture?.scenario ?? null;
    // S1 evaluation identity: the wire marker carries the actual run/case so
    // Lambda scopes durable fixture history by run/case/conversation instead
    // of scenario-derived or local default IDs. O1: the fixture runId is
    // config-scoped (matrix configs never share counters) and the
    // conversation travels on the mapped physical ID for this execution.
    const runId = executionRunId;
    const caseId = args.currentCase.id;
    const effectiveFixture = selectedScenario
      ? { scenario: selectedScenario, runId, caseId }
      : null;
    const outboundImage = input.image && 'redacted' in input.image ? undefined : input.image;
    const sentChannel = input.channel ?? channel;
    const sentUser = resolvePhysicalExternalUserId(conversationMapping, input.externalUserId);
    const sentSessionId = resolvePhysicalSessionId(conversationMapping, input.sessionId ?? undefined);
    const sentMessageId = `${args.currentCase.id}-${turnIndex}-${conversationMapping.seed}`;
    const sentContactPhone = resolveConfiguredContactPhone(input.contactPhone);
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${channelApiKey}`,
      },
      body: JSON.stringify({
        channel: sentChannel,
        user_id: sentUser,
        text: input.text,
        ...(outboundImage ? { image: outboundImage } : {}),
        message_id: sentMessageId,
        received_at: input.receivedAt ?? new Date().toISOString(),
        session_id: sentSessionId,
        contact_phone: sentContactPhone,
        client_mode: 'cli',
        ...(effectiveFixture ? { backendFixture: effectiveFixture } : {}),
      }),
      signal: AbortSignal.timeout(95_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Live Lambda returned HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const raw = await response.json();
    const parsed = lambdaTurnResponseSchema.parse(raw);
    const typedTrace = lambdaTurnResponseSchema.shape.trace.parse(parsed.trace);
    const coordination = parseTurnCoordinationHeaders(response.headers);
    if (coordination) typedTrace.turn_coordination = coordination;
    const typedPerf = parsed.perf === undefined || parsed.perf === null
      ? parsed.perf
      : lambdaTurnResponseSchema.shape.perf.parse(parsed.perf);
    let turnPlan = parsed.plan ? planSchema.parse(parsed.plan) : null;
    // S3 private/public separation. The response plan is the redacted public
    // projection (raw file IDs/URLs/digests omitted, last-response text
    // scrubbed). The private plan read directly from the development plans
    // table with a consistent read carries the real attachment linkage and
    // the original last_outbound_context. It is used for outbound-receipt
    // validation below; the attached evaluation plan keeps its existing
    // precedence so judge and expectation evidence are unchanged.
    // Documented fallback: the response plan, then a seed-shaped plan, when
    // the direct read is unavailable (unit probes).
    let directPrivatePlan: PlanSnapshot | null = null;
    try {
      directPrivatePlan = await planStore.getByExternalUser(sentChannel, sentUser);
    } catch {
      directPrivatePlan = null;
    }
    if (!turnPlan) {
      try {
        turnPlan = directPrivatePlan ?? await planStore.getByExternalUser(
          sentChannel,
          sentUser,
        );
      } catch {
        turnPlan = null;
      }
    }
    const evaluationPlan = turnPlan ??
      planSchema.parse(
        normalizeRawPlan({
          ...seedPlanFallback(sentChannel, sentUser),
          ...normalizePlanFromTrace(
            parsed,
            sentChannel,
            sentUser,
          ),
        }),
      );
    // S3 private/public separation. The attached private snapshot prefers the
    // direct consistent-read plan (real attachment linkage + original
    // last_outbound_context) over the redacted wire projection; the
    // serialized turn plan below stays the redacted public projection.
    const privateEvidencePlan = directPrivatePlan ?? evaluationPlan;
    const wireOriginalSha256 = parsed.message_original_sha256 === undefined
      ? undefined
      : parsed.message_original_sha256;
    const outputOrigin = independentlyObserveWireOutput(
      parsed.message,
      parsed.output_origin,
      {
        originalSha256: wireOriginalSha256,
        redactionApplied: parsed.message_redaction_applied ?? false,
      },
    );
    const turn: EvalTurnResult = {
      turnIndex,
      input: redactLiveInput(input),
      outputText: parsed.message ?? '',
      deliveredText: parsed.message,
      ...(parsed.delivery ? { delivery: { ...parsed.delivery } } : {}),
      outputOrigin,
      // S1 wire identity for the S3 silence seam: downstream validation binds
      // saved attachment refs to this actually-sent inbound message id.
      observedMessageId: sentMessageId,
      currentNode: parsed.current_node,
      trace: projectSafeTrace(typedTrace) as LambdaTurnResponse['trace'],
      perf:
        typedPerf === undefined || typedPerf === null
          ? typedPerf
          : projectSafeRecord(typedPerf),
      plan: projectSafePlan(evaluationPlan),
      latencyMs: Date.now() - startedAt,
    };
    attachEvaluationState(turn, {
      plan: privateEvidencePlan,
      input: turn.input,
      outputText: parsed.message ?? '',
      fixtureEffects: [],
    });
    // S1 outbound observation. After validating the actual response and
    // before dispatching the next turn, fixture-scoped turns record the
    // successful outbound receipt through the same durable scope Lambda used.
    // A mismatch or missing record is a harness error, never a fabricated
    // reply. This proves receipt by the evaluation client, not delivery to a
    // WhatsApp user.
    if (effectiveFixture) {
      await recordFixtureOutboundObservation({
        store: resolveFixtureObservationStore(args, liveDefaults),
        runId,
        caseId,
        conversationKey: buildFixtureConversationKey(sentChannel, sentUser),
        scenario: selectedScenario as string,
        phone: sentContactPhone,
        sentMessageId,
        // Most-private plan first (same snapshot attached above as private
        // evidence). A redacted fallback cannot match the original hash and
        // fails closed as a harness error instead of fabricating a receipt.
        privatePlan: privateEvidencePlan,
        deliveryAction: parsed.delivery?.action,
        responseText: parsed.message,
        observedOriginalSha256: wireOriginalSha256 ?? (parsed.message === null
          ? null
          : hashPrivateOutput(parsed.message)),
      });
    }
    return turn;
  };

  /**
   * Recheck b9a7662d task 2: verified fixture effect ledger. Receipts are
   * read under the exact config-scoped fixture run ID + case ID through
   * paginated consistent reads (Dynamo store) at each turn boundary before
   * subsequent turns and teardown, so later writes never satisfy an earlier
   * assertion. Setup effects are excluded by filtering the pre-turn baseline.
   * Overlapping turns share one boundary collection (no completion-order
   * attribution; invocation/receipt identity only). Counts derive from
   * recorded outcomes; a failed collection attaches no effects (unknown,
   * never zero). Tool calls without receipts are never writes.
   */
  const effectRunId = executionRunId;
  const effectCaseId = args.currentCase.id;
  const effectStore = tryResolveEffectStore(args, liveDefaults);
  let baselineSyntheticIds = new Set<string>();
  if (effectStore) {
    try {
      const baseline = await effectStore.list(effectRunId, effectCaseId);
      baselineSyntheticIds = new Set(baseline.map((receipt) => receipt.syntheticId));
    } catch {
      baselineSyntheticIds = new Set<string>();
    }
  }
  async function collectConversationalEffects(): Promise<FixtureEffectSummary[] | null> {
    if (!effectStore) return null;
    try {
      const all = await effectStore.list(effectRunId, effectCaseId);
      const conversational = all.filter((receipt) => !baselineSyntheticIds.has(receipt.syntheticId));
      return buildFixtureEffectSummariesFromReceipts(conversational);
    } catch {
      return null;
    }
  }
  function attachCollectedEffects(turn: EvalTurnResult, summaries: FixtureEffectSummary[] | null): void {
    attachEvaluationState(turn, {
      plan: getEvaluationPlan(turn),
      input: turn.input,
      outputText: turn.outputText,
      ...(summaries === null ? {} : { fixtureEffects: summaries }),
    });
  }

  const turns: EvalTurnResult[] = [];
  if (args.currentCase.concurrentFirstTwoTurns) {
    const [first, second] = args.currentCase.inputs;
    // O1: overlap is intentional for this case only; compare the mapped
    // physical conversation so the exact intended overlap is preserved while
    // logical IDs stay execution-scoped.
    const firstUser = resolvePhysicalExternalUserId(conversationMapping, first?.externalUserId);
    const secondUser = resolvePhysicalExternalUserId(conversationMapping, second?.externalUserId);
    if (!first || !second
      || (first.channel ?? channel) !== (second.channel ?? channel)
      || firstUser !== secondUser) {
      throw new Error('Concurrent live cases require two turns for the same conversation.');
    }
    const lockClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: liveDefaults.region }));
    try {
      const overlapped = await runOverlappingTurns({
        first: () => runTurn(0),
        second: () => runTurn(1),
        firstLockIsHeld: async () => {
          const result = await lockClient.send(new GetCommand({
            TableName: liveDefaults.plansTableName,
            Key: { pk: conversationPartitionKey(seedChannel, seedExternalUserId), sk: 'TURN_LOCK' },
            ConsistentRead: true,
            ProjectionExpression: 'lease_until_ms',
          }));
          const expiry: unknown = result.Item?.lease_until_ms;
          return typeof expiry === 'number' && expiry > Date.now();
        },
      });
      // One shared boundary for both overlapping turns: no completion-order
      // attribution.
      const overlappedEffects = await collectConversationalEffects();
      for (const overlappedTurn of overlapped) {
        attachCollectedEffects(overlappedTurn, overlappedEffects);
      }
      turns.push(...overlapped);
    } finally {
      lockClient.destroy();
    }
  }
  for (let index = turns.length; index < args.currentCase.inputs.length; index += 1) {
    const turn = await runTurn(index);
    attachCollectedEffects(turn, await collectConversationalEffects());
    turns.push(turn);
  }

  return {
    turns,
    status: 'passed',
  };
}

function tryResolveEffectStore(
  args: { fixtureStore?: EvalFixtureStateStore },
  liveDefaults: { evalFixtureTableName: string | null; region: string },
): EvalFixtureStateStore | null {
  try {
    return resolveFixtureObservationStore(args, liveDefaults);
  } catch {
    return null;
  }
}

/**
 * S1 outbound receipt observation through the live-target caller.
 *
 * Records a successful outbound observation only when every conjunct holds:
 * the turn delivered a send with real text, the most-private plan's
 * last_outbound_context carries this invocation's message id, the record is
 * not truncated, and its full hash equals the independently observed
 * original response hash (S2 finalization + S3 separation are prerequisites).
 * Anything else is a harness error when a send was claimed, never a
 * fabricated reply. Constructed, suppressed, or failed responses are never
 * marked sent. Turns without a trusted channel phone carry no phone-scoped
 * fixture history, so they record nothing and rely on plan-backed
 * continuity instead.
 */
export async function recordFixtureOutboundObservation(args: {
  store: EvalFixtureStateStore;
  runId: string;
  caseId: string;
  conversationKey: string;
  scenario: string;
  phone: string | null;
  sentMessageId: string;
  privatePlan: Pick<PlanSnapshot, 'last_outbound_context'> | null;
  deliveryAction: 'send' | 'suppress' | 'failure' | undefined;
  responseText: string | null;
  observedOriginalSha256: string | null;
}): Promise<'recorded' | 'skipped_no_send' | 'skipped_no_phone'> {
  if (args.deliveryAction !== 'send' || args.responseText === null || args.responseText.length === 0) {
    return 'skipped_no_send';
  }
  if (!args.phone) {
    return 'skipped_no_phone';
  }
  const lastOutbound = args.privatePlan?.last_outbound_context ?? null;
  if (!lastOutbound) {
    throw new Error(
      `Harness error: claimed send for ${args.sentMessageId} has no last_outbound_context in the private plan.`,
    );
  }
  if (lastOutbound.message_id !== args.sentMessageId) {
    throw new Error(
      `Harness error: last_outbound_context message_id ${lastOutbound.message_id} does not match invocation ${args.sentMessageId}.`,
    );
  }
  if (lastOutbound.text_truncated) {
    throw new Error(
      `Harness error: last_outbound_context for ${args.sentMessageId} is truncated and cannot prove the answer.`,
    );
  }
  if (!args.observedOriginalSha256 || hashPrivateOutput(lastOutbound.text) !== args.observedOriginalSha256) {
    throw new Error(
      `Harness error: last_outbound_context text hash for ${args.sentMessageId} does not match the independently observed response hash.`,
    );
  }
  await args.store.recordMessage({
    runId: args.runId,
    caseId: args.caseId,
    scenario: args.scenario,
    conversationKey: args.conversationKey,
    phone: args.phone,
    phoneKeys: buildFixturePhoneLookupKeys(args.phone),
    direction: 'outbound',
    body: args.responseText,
    // Deterministic per-turn receipt id: harness retries stay idempotent and
    // never collide with the inbound turn id (which the merge dedupes on).
    whatsappMessageId: `outbound:${args.sentMessageId}`,
    sentAt: new Date().toISOString(),
    delivery: 'sent',
  });
  return 'recorded';
}

function resolveFixtureObservationStore(
  args: { fixtureStore?: EvalFixtureStateStore },
  liveDefaults: { evalFixtureTableName: string | null; region: string },
): EvalFixtureStateStore {
  if (args.fixtureStore) return args.fixtureStore;
  if (liveDefaults.evalFixtureTableName) {
    return new DynamoEvalFixtureStateStore(liveDefaults.evalFixtureTableName, {
      region: liveDefaults.region,
    });
  }
  throw new Error(
    'Harness error: fixture-scoped live turns require the development EvalFixtureTable (EVAL_FIXTURE_TABLE_NAME).',
  );
}
/**
 * Independent wire-output observation for the live target.
 * The declared candidate hash is never trusted: a verified receipt is only
 * preserved when the declared candidate hash equals the independently
 * recomputed wire-delivered hash. Raw model paragraphs stay at the producer
 * (R01 hash-only evidence); this function distinguishes producer-side raw
 * divergence ('model_paragraphs', carried in declared mismatch fields) from
 * wire-side divergence ('candidate_sha256', 'delivered_sha256',
 * 'delivered_text', recomputed here).
 *
 * When the handler applied artifact redaction, `wire.originalSha256` carries
 * the hash of the original delivered text computed before redaction. The
 * redacted public representation must never be hashed as model-provenance
 * proof: declared hashes are verified against the original hash, and the
 * expected redacted-text divergence is recorded without failing the turn.
 * Without wire evidence (or without redaction), the message itself is hashed
 * exactly as before.
 */
export function independentlyObserveWireOutput(
  message: string | null,
  declared: OutputOriginEvidence | undefined,
  wire?: {
    originalSha256?: string | null;
    redactionApplied?: boolean;
  },
): OutputOriginEvidence {
  const redactionApplied = wire?.redactionApplied === true;
  if (redactionApplied && wire?.originalSha256 === undefined) {
    return {
      status: 'mismatch',
      candidateSha256: declared?.candidateSha256 ?? null,
      deliveredSha256: message === null ? null : hashPrivateOutput(message),
      transformationVersion: declared?.transformationVersion ?? null,
      mismatchFields: [...(declared?.mismatchFields ?? []), 'original_sha256'],
    };
  }
  const deliveredSha256 = redactionApplied
    ? (wire?.originalSha256 ?? null)
    : (message === null ? null : hashPrivateOutput(message));
  if (!declared) {
    return { status: 'missing', candidateSha256: null, deliveredSha256, transformationVersion: null, mismatchFields: ['candidate_output_origin'] };
  }
  const mismatchFields = [...declared.mismatchFields];
  const mark = (field: string): void => {
    if (!mismatchFields.includes(field)) mismatchFields.push(field);
  };
  if (declared.deliveredSha256 !== deliveredSha256) {
    mark('delivered_sha256');
  }
  if (declared.status === 'missing' || declared.status === 'generation_failed') {
    return { ...declared, deliveredSha256, mismatchFields };
  }
  if (message === null) {
    if (declared.status === 'verified') mark('delivered_text');
  } else if (declared.status === 'verified') {
    if (declared.candidateSha256 !== deliveredSha256) {
      mark('candidate_sha256');
    }
    if (declared.transformationVersion !== OUTPUT_TRANSFORMATION_VERSION) {
      mark('transformation_version');
    }
    if (declared.mismatchFields.length > 0) {
      mark('declared_mismatch');
    }
  } else if (declared.transformationVersion !== OUTPUT_TRANSFORMATION_VERSION && declared.transformationVersion !== null) {
    mark('transformation_version');
  }
  return { ...declared, status: mismatchFields.length > 0 ? 'mismatch' : declared.status, deliveredSha256, mismatchFields };
}

function redactLiveInput(input: EvalTurnResult['input']): EvalTurnResult['input'] {
  return {
    ...input,
    text: redactArtifactText(input.text),
    // Image bytes never reach evaluation reports: only MIME/size-bucket
    // facts are retained. URL inputs keep redacted shape evidence only.
    ...(input.image && 'data' in input.image
      ? {
        image: {
          redacted: true as const,
          mime_type: input.image.mime_type,
          byte_length: Buffer.byteLength(input.image.data, 'utf8'),
        },
      }
      : {}),
    ...(input.image && 'url' in input.image
      ? {
        image: {
          redacted: true as const,
          url_host_redacted: redactImageUrlForLog(input.image.url),
          url_bytes: Buffer.byteLength(input.image.url, 'utf8'),
        },
      }
      : {}),
    ...(input.externalUserId
      ? { externalUserId: input.externalUserId }
      : {}),
    ...(input.contactPhone !== undefined ? { contactPhone: null } : {}),
  };
}

function resolveConfiguredContactPhone(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith('$')) {
    return value;
  }
  const variableName = value.slice(1);
  const configured = process.env[variableName];
  if (!configured) {
    throw new Error(`${variableName} is required for this live phone-auth case.`);
  }
  return configured;
}

async function resolveLiveLambdaDefaults(args: {
  currentCase: EvalCase;
  config: EvalRunConfig;
}): Promise<{
  functionUrl: string | null;
  plansTableName: string;
  region: string;
  evalFixtureTableName: string | null;
}> {
  const appConfig = getConfig();
  const region = process.env.AWS_REGION ?? appConfig.aws.region;
  const stackName = process.env.DEV_STACK_NAME ?? 'recap-agent-runtime-dev';
  const directFunctionUrl =
    args.currentCase.configOverrides?.liveLambda?.functionUrl ??
    args.config.liveLambda?.functionUrl ??
    process.env.DEV_AGENT_FUNCTION_URL ??
    null;
  const directPlansTableName = process.env.DEV_PLANS_TABLE_NAME ?? null;
  const outputs = await getStackOutputs(stackName, region);
  const { functionUrl, plansTableName, evalFixtureTableName } = resolveDevelopmentTarget(outputs, {
    functionUrl: directFunctionUrl, plansTableName: directPlansTableName,
  });

  return {
    functionUrl,
    plansTableName,
    region,
    evalFixtureTableName,
  };
}

async function getStackOutputs(stackName: string, region: string) {
  const client = new CloudFormationClient({ region });
  const response = await client.send(
    new DescribeStacksCommand({
      StackName: stackName,
    }),
  );
  const outputs = response.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(
    outputs
      .filter((item) => item.OutputKey && item.OutputValue)
      .map((item) => [item.OutputKey as string, item.OutputValue as string]),
  ) as DevelopmentStackOutputs;
}

function seedPlanFallback(channel: string, externalUserId: string) {
  return {
    plan_id: 'unknown',
    channel,
    external_user_id: externalUserId,
    conversation_id: null,
    lifecycle_state: 'active',
    contact_name: null,
    contact_email: null,
    current_node: 'contacto_inicial',
    intent: null,
    intent_confidence: null,
    event_type: null,
    vendor_category: null,
    active_need_category: null,
    location: null,
    budget_signal: null,
    guest_range: null,
    preferences: [],
    hard_constraints: [],
    missing_fields: [],
    provider_needs: [],
    recommended_provider_ids: [],
    recommended_providers: [],
    selected_provider_ids: [],
    selected_provider_hints: [],
    assumptions: [],
    conversation_summary: '',
    last_user_goal: null,
    open_questions: [],
    updated_at: new Date(0).toISOString(),
  };
}

function normalizePlanFromTrace(
  response: LambdaTurnResponse,
  channel: string,
  externalUserId: string,
) {
  const normalizedIntent = planIntentValues.includes(
    response.trace.intent as (typeof planIntentValues)[number],
  )
    ? (response.trace.intent as (typeof planIntentValues)[number])
    : null;

  return {
    plan_id: response.plan_id,
    channel,
    external_user_id: externalUserId,
    conversation_id: response.conversation_id,
    current_node: response.current_node,
    intent: normalizedIntent,
    missing_fields: response.trace.missing_fields,
    recommended_providers: response.trace.provider_results,
    recommended_provider_ids: response.trace.provider_results.map((provider) => provider.id),
    updated_at: new Date().toISOString(),
  };
}
