import type { z } from 'zod';
import { eventTypeSchema } from '../core/event-type';
import { providerCategorySchema } from '../core/provider-category';
import { closeActionWireSchema } from '../runtime/close-flow-schemas';
import { requestedOperationSchema } from '../runtime/extraction-schemas';
import { rsvpActionValues } from '../core/rsvp';

import type { PromptLoader } from '../runtime/prompt-loader';
import type { ExtractionRequestSpec, ReplyRequestSpec } from '../runtime/openai-agent-runtime';
import type { ModuleSelectionContext } from '../runtime/model-request-projector';
import { moduleFilesFor, selectExtractionModules, selectReplyModules } from '../runtime/model-request-projector';
import {
  instructionModuleRegistry,
  type InstructionModuleId,
  type InstructionModuleMetadata,
} from '../runtime/prompt-manifest';
import { buildOpenAiTextSchema } from '../runtime/openai-structured-schema';

/** Declarations bind instruction responsibility to real schema/context surfaces.
 * They do not claim to prove the meaning of arbitrary prose. Review freshness
 * invalidates human approval when either prose or these dependencies changes.
 */
export type InstructionContract = {
  readonly owns: readonly string[];
  readonly outputPaths?: readonly string[];
  readonly outputEnums?: Readonly<Record<string, readonly string[]>>;
  readonly evidencePaths?: readonly string[];
  readonly requiresContext?: Readonly<Record<string, unknown>>;
  readonly incompatibleWith?: readonly InstructionModuleId[];
};

export const instructionContracts: Readonly<Record<string, InstructionContract>> = {
  shared_invariants: { owns: ['reply.delivery_language_and_truth'] },
  reply_customer_context_fields: { owns: ['reply.record_field_semantics'] },
  extraction_cross_domain: { owns: ['extraction.requested_operation_capture'], outputPaths: ['requestedOperation', 'ambiguity', 'conversationSummary'], outputEnums: { requestedOperation: requestedOperationSchema.options } },
  extraction_customer_fields: { owns: ['extraction.record_field_semantics'] },
  extraction_information: { owns: ['extraction.information_request_capture'], outputPaths: ['informationRequests', 'supportAct', 'humanHelpIntent', 'phoneConfirmation'] },
  extraction_rsvp: { owns: ['extraction.rsvp_capture'], outputPaths: ['rsvpAction', 'rsvpEventReference', 'rsvpParty'], outputEnums: { rsvpAction: rsvpActionValues } },
  extraction_planning: { owns: ['extraction.planning_capture'], outputPaths: ['eventType', 'location', 'providerQueryIntents'], outputEnums: { eventType: eventTypeSchema.options, vendorCategory: providerCategorySchema.options } },
  extraction_contact: { owns: ['extraction.contact_capture'], outputPaths: ['contactName', 'contactEmail', 'contactPhone'] },
  extraction_provider_management: { owns: ['extraction.provider_operation_capture'], outputPaths: ['providerPlanOperations'] },
  extraction_provider_selection: { owns: ['extraction.provider_selection_capture'], outputPaths: ['selectedProviderHints', 'selectedProviderReferences'] },
  extraction_provider_inspection: { owns: ['extraction.provider_inspection_capture'], outputPaths: ['providerExplanationRequest', 'providerDetailRequest'] },
  extraction_close_pause: { owns: ['extraction.final_close_capture'], outputPaths: ['closeAction'], outputEnums: { 'closeAction.type': closeActionWireSchema.shape.type.options } },
  reply_planning_interview: { owns: ['reply.planning_interview'], evidencePaths: ['plan'] },
  reply_planning_owner: { owns: ['reply.planning_guidance'], evidencePaths: ['plan'] },
  reply_thank_you_provenance: { owns: ['reply.thank_you_actor_provenance'], requiresContext: { hasThankYouRecord: true } },
  reply_purchase_facts: { owns: ['reply.purchase_fact_labels'], evidencePaths: ['plan'] },
  reply_pending_payment: { owns: ['reply.pending_total_review'], requiresContext: { hasPendingPurchase: true } },
  reply_purchase_partial_failure: { owns: ['reply.purchase_source_incompleteness'], requiresContext: { hasPartialPurchaseFailure: true } },
  reply_customer_reference_matched: { owns: ['reply.customer_reference_match'], requiresContext: { customerReferenceResolution: 'matched' }, incompatibleWith: ['reply_customer_reference_unavailable'] },
  reply_customer_reference_unavailable: { owns: ['reply.customer_reference_unavailable'], requiresContext: { customerReferenceResolution: 'unavailable' }, incompatibleWith: ['reply_customer_reference_matched'] },
  reply_venue_facts: { owns: ['reply.authorized_event_facts'] },
  reply_public_event_search: { owns: ['reply.public_event_search'], requiresContext: { hasNoAssociatedEvent: true } },
  reply_rsvp_facts: { owns: ['reply.rsvp_facts'] },
  reply_rsvp_lookup_failed: { owns: ['reply.rsvp_lookup_failure'], requiresContext: { hasFailedRsvpLookup: true } },
  reply_rsvp_candidate_states: { owns: ['reply.rsvp_candidate_states'], requiresContext: { hasKnownRsvpCandidateStates: true } },
  reply_rsvp_companion_rejected: { owns: ['reply.rsvp_companion_failure'], requiresContext: { hasRejectedRsvpCompanion: true } },
  reply_faq_policy: { owns: ['reply.published_policy_facts'] },
  reply_faq_commission: { owns: ['reply.gift_commission_no_arithmetic'] },
  reply_withdrawal_fee: { owns: ['reply.withdrawal_fee_no_conversion'] },
  reply_host_withdrawal_policy: { owns: ['reply.withdrawal_processing_window'] },
  reply_handoff_outcome: { owns: ['reply.handoff_receipt_truth'] },
  reply_auth_limitation: { owns: ['reply.authentication_outcome'] },
  reply_image_context: { owns: ['reply.image_access_limits'] },
  reply_support_continuity: { owns: ['reply.support_continuity'], requiresContext: { hasSupportContinuity: true } },
  reply_wait_followup: { owns: ['reply.wait_followup'] },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Resolve declared field paths through the exact serialized output schema. */
export function schemaPathExists(schema: unknown, fieldPath: string): boolean {
  const root = schema;
  function visit(value: unknown, parts: readonly string[], visited: ReadonlySet<unknown>): boolean {
    if (!isRecord(value) || visited.has(value)) return false;
    if (parts.length === 0) return true;
    const nextVisited = new Set(visited).add(value);
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
      let resolved: unknown = root;
      for (const key of value.$ref.slice(2).split('/')) {
        resolved = isRecord(resolved) ? resolved[key.replace(/~1/gu, '/').replace(/~0/gu, '~')] : undefined;
      }
      if (visit(resolved, parts, nextVisited)) return true;
    }
    for (const union of ['anyOf', 'oneOf', 'allOf']) {
      const branches = value[union];
      if (Array.isArray(branches) && branches.some((branch) => visit(branch, parts, nextVisited))) return true;
    }
    const [head, ...tail] = parts;
    if (head === '[]') return visit(value.items, tail, nextVisited);
    return isRecord(value.properties) && typeof head === 'string' &&
      visit(value.properties[head], tail, nextVisited);
  }
  return visit(schema, fieldPath.split('.'), new Set());
}

/** Resolve nested enum fields through the real emitted JSON schema. */
function schemaEnumValues(schema: unknown, fieldPath: string): string[] {
  function visit(value: unknown, parts: readonly string[], visited: ReadonlySet<unknown>): string[] {
    if (!isRecord(value) || visited.has(value)) return [];
    const nextVisited = new Set(visited).add(value);
    const out: string[] = [];
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
      let resolved: unknown = schema;
      for (const key of value.$ref.slice(2).split('/')) {
        resolved = isRecord(resolved) ? resolved[key.replace(/~1/gu, '/').replace(/~0/gu, '~')] : undefined;
      }
      out.push(...visit(resolved, parts, nextVisited));
    }
    if (parts.length === 0) {
      if (Array.isArray(value.enum)) out.push(...value.enum.filter((entry): entry is string => typeof entry === 'string'));
      if (typeof value.const === 'string') out.push(value.const);
    } else {
      const [head, ...tail] = parts;
      if (head === '[]') out.push(...visit(value.items, tail, nextVisited));
      else if (isRecord(value.properties) && head) out.push(...visit(value.properties[head], tail, nextVisited));
    }
    for (const union of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(value[union])) out.push(...value[union].flatMap((branch: unknown) => visit(branch, parts, nextVisited)));
    }
    return [...new Set(out)];
  }
  return visit(schema, fieldPath.split('.'), new Set());
}

function evidencePathExists(evidence: unknown, fieldPath: string): boolean {
  let cursor: unknown = evidence;
  for (const segment of fieldPath.split('.')) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) return false;
    cursor = cursor[segment];
  }
  return cursor !== undefined && cursor !== null;
}

export type AuxiliaryInstructionContract = {
  readonly file: string;
  readonly evidenceFactGroup: string;
};

export const extractionAuxiliaryInstructions: readonly AuxiliaryInstructionContract[] = [
  { file: 'extractors/image_reference.txt', evidenceFactGroup: 'image_presence' },
  { file: 'extractors/campaign_reference.txt', evidenceFactGroup: 'campaign_reference_context' },
  { file: 'extractors/continuity.txt', evidenceFactGroup: 'conversation_continuity' },
  { file: 'extractors/otp_continuation.txt', evidenceFactGroup: 'otp_evidence' },
];

/** Validate the request built by production, not a legacy audit bundle. */
export function auditActualRequestContract(args: {
  readonly spec: ExtractionRequestSpec | ReplyRequestSpec;
  readonly context: ModuleSelectionContext;
  readonly evidence: unknown;
  readonly outputSchema?: z.ZodType;
  readonly serializedOutputSchema?: unknown;
  readonly contracts?: Readonly<Record<string, InstructionContract>>;
  readonly registry?: Readonly<Record<string, InstructionModuleMetadata>>;
  readonly auxiliaryInstructions?: readonly AuxiliaryInstructionContract[];
}): string[] {
  const issues: string[] = [];
  const contracts = args.contracts ?? instructionContracts;
  const registry = args.registry ?? instructionModuleRegistry;
  const schema = args.serializedOutputSchema ?? (args.outputSchema
    ? buildOpenAiTextSchema(args.outputSchema, 'prompt_contract') : undefined);
  const owned = new Map<string, string>();
  const expectedModules = args.context.stage === 'extraction'
    ? selectExtractionModules(args.context) : selectReplyModules(args.context);
  if (JSON.stringify(expectedModules.map((module) => module.id)) !== JSON.stringify(args.spec.modules.map((module) => module.id))) {
    issues.push('Selected modules differ from typed compiler context');
  }
  const selected = new Set(args.spec.modules.map((module) => module.id));
  for (const module of args.spec.modules) {
    const meta = registry[module.id];
    const contract = contracts[module.id];
    if (!meta || !contract) { issues.push(`Missing instruction contract/registry: ${module.id}`); continue; }
    if (!meta.stages.includes(args.context.stage)) issues.push(`Wrong stage: ${module.id}`);
    if (!meta.owners.includes(args.context.owner)) issues.push(`Wrong owner: ${module.id}`);
    if (JSON.stringify(module.files) !== JSON.stringify(meta.files)) issues.push(`Module file drift: ${module.id}`);
    for (const invariant of contract.owns) {
      const owner = owned.get(invariant);
      if (owner) issues.push(`Duplicate invariant owner: ${invariant} (${owner}, ${module.id})`);
      owned.set(invariant, module.id);
    }
    for (const path of contract.outputPaths ?? []) {
      if (!schemaPathExists(schema, path)) issues.push(`Unavailable output binding: ${module.id}.${path}`);
    }
    for (const [path, expected] of Object.entries(contract.outputEnums ?? {})) {
      const actual = schemaEnumValues(schema, path);
      if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
        issues.push(`Output enum drift: ${module.id}.${path}`);
      }
    }
    for (const path of contract.evidencePaths ?? []) {
      if (!evidencePathExists(args.evidence, path)) issues.push(`Missing evidence binding: ${module.id}.${path}`);
    }
    for (const [key, value] of Object.entries(contract.requiresContext ?? {})) {
      if (Reflect.get(args.context, key) !== value) issues.push(`Inapplicable evidence outcome: ${module.id}.${key}`);
    }
    for (const incompatible of contract.incompatibleWith ?? []) {
      if (selected.has(incompatible)) issues.push(`Incompatible instruction modules: ${module.id}/${incompatible}`);
    }
  }
  const expectedFiles = moduleFilesFor(args.spec.modules);
  for (const auxiliary of args.auxiliaryInstructions ?? (args.context.stage === 'extraction' ? extractionAuxiliaryInstructions : [])) {
    const fact = args.spec.manifest.factGroups.find((group) => group.key === auxiliary.evidenceFactGroup);
    const hasInstruction = args.spec.filePaths.includes(auxiliary.file);
    if ((!fact || fact.bytes === 0) && hasInstruction) issues.push(`Auxiliary instruction lacks evidence: ${auxiliary.file}`);
    if (fact && fact.bytes > 0 && !expectedFiles.includes(auxiliary.file)) expectedFiles.push(auxiliary.file);
  }
  if (JSON.stringify(expectedFiles) !== JSON.stringify(args.spec.filePaths)) issues.push('Emitted instruction files differ from contracted module files');
  if (JSON.stringify(args.spec.manifest.modules.map((module) => module.id)) !== JSON.stringify([...selected])) {
    issues.push('Manifest differs from selected instruction modules');
  }
  const toolNames = 'scopedTools' in args.spec ? args.spec.scopedTools : [];
  if (JSON.stringify(toolNames) !== JSON.stringify(args.spec.manifest.tools.map((tool) => tool.name))) issues.push('Executable tool manifest differs from actual tools');
  if (args.context.stage === 'extraction' && toolNames.length > 0) issues.push('Extraction exposes executable tools');
  return issues;
}

/** Verify that emitted instruction text is exactly the selected tracked files. */
export async function auditLoadedRequestInstructions(
  spec: ExtractionRequestSpec | ReplyRequestSpec,
  loader: PromptLoader,
): Promise<string[]> {
  const loaded = await loader.loadModuleFilesBundle(spec.filePaths, []);
  return loaded.instructions === spec.instructions ? [] : ['Serialized instructions differ from tracked selected files'];
}
