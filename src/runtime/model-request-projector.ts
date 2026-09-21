import type { EstablishedExtractionDomain } from './extraction-projection';
import type { DecisionNode } from '../core/decision-nodes';
import type { PurchaseInformation } from '../core/information';
import type { ComposeReplyRequest } from './contracts';
import {
  instructionModuleRegistry,
  nodePromptManifest,
  ownerNodeSets,
  type InstructionModuleId,
  type InstructionModuleMetadata,
  type ToolName,
} from './prompt-manifest';

/**
 * G1 single typed request compiler boundary for extraction + reply.
 *
 * Pure construction only: consumes typed runtime evidence and returns which
 * instruction modules apply, ordered input sections, executable tools and a
 * local relevance manifest. Never interprets raw user text, never chooses
 * conversational intent or effect authorization, never adds a model call,
 * router, state machine, canned reply or post-generation replacement.
 *
 * Text loading stays in prompt-loader.ts; this module only selects registry
 * module ids. Byte sizes are attached by the caller through a size lookup
 * so the manifest never carries customer payloads.
 */

export type CompilerStage = 'extraction' | 'reply';

export type CompilerOwner = 'planning' | 'faq' | 'customer_assistance' | 'unknown';

export type CompilerTask =
  | 'purchase'
  | 'venue'
  | 'rsvp'
  | 'faq_policy'
  | 'handoff'
  | 'auth'
  | 'image'
  | 'planning'
  | 'wait_followup';

export type ModuleSelectionContext = {
  readonly stage: CompilerStage;
  readonly owner: CompilerOwner;
  /** Established lane from typed plan state; null means transient/unknown. */
  readonly establishedDomain: EstablishedExtractionDomain;
  /** Typed tasks for this turn (extracted tasks, completed facts, outcomes). */
  readonly tasks: readonly CompilerTask[];
  /**
   * Typed purchase approval-boundary flag: a purchase information request
   * asks for validation_window or payment_status. Gates the
   * receipt-is-not-approval module so venue reads and non-approval
   * purchase turns never carry it.
   */
  readonly approvalBoundary: boolean;
  /**
   * Typed gift-fulfillment flag: a completed purchase result carries
   * per-item fulfillment, a scoped host-credit policy, or an item-source
   * conflict. Gates the gift-presentation module so payment-only, FAQ,
   * RSVP and venue turns never carry gift prose guidance.
   */
  readonly giftFulfillment: boolean;
  /**
   * Typed planning-progress flag from plan state (active plan or shortlist).
   * Gates provider-management, close/pause and contact detail on
   * transient/unknown extraction so topic detection stays compact.
   */
  readonly hasPlanningDetail: boolean;
};

export type SelectedModule = {
  readonly id: InstructionModuleId;
  readonly files: InstructionModuleMetadata['files'];
  /** Typed applicability reason; never customer text or fixture names. */
  readonly reason: string;
  /** Evidence fields this module depends on. */
  readonly dependsOn: readonly string[];
};

export type RelevanceManifestEntry = SelectedModule & {
  readonly bytes: number;
};

export type RelevanceManifest = {
  /** Stable prompt identity: ordered module ids joined. */
  readonly promptIdentity: string;
  readonly modules: readonly RelevanceManifestEntry[];
  readonly totalBytes: number;
};

function selected(
  id: InstructionModuleId,
  reason: string,
  dependsOn: readonly string[],
): SelectedModule {
  return { id, files: instructionModuleRegistry[id].files, reason, dependsOn };
}

function registrySupports(
  id: InstructionModuleId,
  stage: CompilerStage,
  owner: CompilerOwner,
  tasks: readonly CompilerTask[],
): boolean {
  const meta = instructionModuleRegistry[id];
  if (!meta.stages.includes(stage)) return false;
  if (!meta.owners.includes(owner)) return false;
  // Stage/owner-wide invariants carry no task binding; task modules require
  // at least one applicable task so unrelated workflows stay unloaded.
  if (id === 'shared_invariants' || id === 'extraction_cross_domain') return true;
  return tasks.some((task) => meta.tasks.includes(task));
}

/**
 * Extraction module selection from typed lane state. Unknown/transient
 * owners keep a compact cross-domain profile (support, planning, mixed and
 * topic-switch detection); provider-management, close/pause and contact
 * detail load only with typed planning progress (active plan or shortlist).
 * Established support/FAQ/RSVP lanes drop the inactive planning module;
 * established support lanes keep contact capture for auth continuation.
 * RSVP readability stays in information lanes so cross-domain continuations
 * keep working.
 */
export function selectExtractionModules(
  context: ModuleSelectionContext,
): SelectedModule[] {
  const modules: SelectedModule[] = [
    selected('shared_invariants', 'stable conversational invariants on every call', []),
    selected(
      'extraction_cross_domain',
      'typed operation boundary for the current turn',
      ['allowedActionIntents', 'candidateOperations'],
    ),
  ];
  const established = context.establishedDomain;
  if (established === null || context.owner === 'unknown') {
    if (registrySupports('extraction_information', 'extraction', context.owner, context.tasks)) {
      modules.push(
        selected('extraction_information', 'transient owner needs compact support recognition', ['plan.information_state']),
      );
    }
    if (registrySupports('extraction_rsvp', 'extraction', context.owner, context.tasks)) {
      modules.push(
        selected('extraction_rsvp', 'transient owner needs compact invitation recognition', ['plan.rsvp_state']),
      );
    }
    modules.push(
      selected('extraction_planning', 'transient owner needs compact planning recognition', ['plan.provider_needs']),
    );
    if (context.hasPlanningDetail) {
      modules.push(
        selected('extraction_contact', 'transient turn with planning progress captures contact detail', ['plan.contact_email']),
      );
      modules.push(
        selected('extraction_provider_management', 'transient turn with planning progress manages providers', ['plan.provider_needs']),
      );
      modules.push(
        selected('extraction_close_pause', 'transient turn with planning progress may close or pause', ['plan.provider_needs']),
      );
    }
    return modules.filter((module) =>
      registrySupports(module.id, 'extraction', context.owner, context.tasks),
    );
  }
  if (established === 'purchase' || established === 'support') {
    modules.push(
      selected('extraction_information', 'established information lane', ['plan.information_state']),
    );
    modules.push(
      selected('extraction_rsvp', 'invitation readability preserved across information lanes', ['plan.rsvp_state']),
    );
    modules.push(
      selected('extraction_contact', 'established support lane keeps contact capture for auth continuation', ['plan.contact_email']),
    );
    return modules.filter((module) =>
      registrySupports(module.id, 'extraction', context.owner, context.tasks),
    );
  }
  modules.push(
    selected('extraction_rsvp', 'established invitation lane', ['plan.rsvp_state']),
  );
  modules.push(
    selected('extraction_information', 'event-fact readability preserved across invitation lanes', ['plan.information_state']),
  );
  return modules.filter((module) =>
    registrySupports(module.id, 'extraction', context.owner, context.tasks),
  );
}

/**
 * Reply compiler context from typed turn state only. Single derivation
 * shared by instruction loading, input gating and test doubles: owner comes
 * from the serving node, tasks come from validated results/requests/
 * outcomes (never raw text), and the approval boundary comes from the
 * requested purchase aspects. An authenticationOutcome only exists for
 * validated terminal/declined outcomes, so the auth task (and its module)
 * loads exclusively on those turns.
 */
export type ReplyCompilerSource = Pick<
  ComposeReplyRequest,
  | 'currentNode'
  | 'informationResults'
  | 'customerContext'
  | 'extraction'
  | 'plan'
  | 'capabilityDecision'
  | 'handoffOutcome'
  | 'authenticationOutcome'
  | 'imageEvidence'
  | 'rsvpPhoneEvidence'
>;

export function deriveReplyCompilerContext(
  request: ReplyCompilerSource,
): ModuleSelectionContext {
  const planningNodes = ownerNodeSets.planning as readonly string[];
  const owner: CompilerOwner = planningNodes.includes(request.currentNode)
    ? 'planning'
    : request.currentNode === 'responder_invitacion' ||
      request.currentNode === 'solicitar_agente_humano' ||
      request.currentNode === 'ofrecer_agente_humano'
      ? 'customer_assistance'
      : request.currentNode === 'resolver_consultas_informativas'
        ? 'customer_assistance'
        : request.currentNode === 'contacto_inicial' ||
          request.currentNode === 'deteccion_intencion'
          ? 'unknown'
          : 'planning';
  const tasks = new Set<CompilerTask>();
  const addRequestKindTask = (kind: string): void => {
    if (kind === 'purchase') tasks.add('purchase');
    if (kind === 'associated_event') tasks.add('venue');
    if (kind === 'faq') tasks.add('faq_policy');
  };
  for (const result of request.informationResults ?? []) {
    if (result.kind === 'purchase') tasks.add('purchase');
    if (result.kind === 'associated_event') tasks.add('venue');
    if (result.kind === 'faq') tasks.add('faq_policy');
  }
  for (const item of request.extraction.informationRequests ?? []) {
    addRequestKindTask(item.kind);
  }
  for (const pending of request.plan.information_state.pending_requests ?? []) {
    addRequestKindTask(pending.kind);
  }
  if (request.extraction.supportAct != null) {
    tasks.add('faq_policy');
  }
  const capabilityDecision = request.capabilityDecision ?? null;
  const operation = capabilityDecision !== null && 'operation' in capabilityDecision
    ? capabilityDecision.operation
    : null;
  if (operation !== null) {
    if (typeof operation === 'string') {
      if (operation.startsWith('purchase') || operation.startsWith('payment_proof') || operation.startsWith('refund_or_withdrawal') || operation.startsWith('confirmation_document')) {
        tasks.add('purchase');
      }
      if (operation.startsWith('event.')) tasks.add('venue');
      if (operation.startsWith('rsvp')) tasks.add('rsvp');
      if (operation.startsWith('faq')) tasks.add('faq_policy');
      if (operation.startsWith('human.')) tasks.add('handoff');
      if (operation.startsWith('auth')) tasks.add('auth');
      if (operation.startsWith('media.')) tasks.add('image');
      if (operation.startsWith('provider')) tasks.add('planning');
    }
  }
  if (
    request.currentNode === 'responder_invitacion' ||
    request.rsvpPhoneEvidence != null
  ) {
    tasks.add('rsvp');
  }
  if (
    request.handoffOutcome != null ||
    capabilityDecision?.status === 'unsupported'
  ) {
    tasks.add('handoff');
  }
  if (request.authenticationOutcome != null) tasks.add('auth');
  if (request.imageEvidence != null) tasks.add('image');
  if (owner === 'planning') tasks.add('planning');
  const approvalBoundary = (request.extraction.informationRequests ?? []).some(
    (item) => item.kind === 'purchase' &&
      (item.aspects ?? []).some(
        (aspect) => aspect === 'validation_window' || aspect === 'payment_status',
      ),
  );
  const purchaseCarriesFulfillment = (purchase: PurchaseInformation): boolean =>
    purchase.creditFulfillmentPolicy != null ||
    purchase.itemSourceConflict != null ||
    purchase.items.some((item) => item.fulfillment != null);
  const giftFulfillment = (request.informationResults ?? []).some(
    (result) => result.kind === 'purchase' && result.status === 'completed' &&
      result.purchases.some(purchaseCarriesFulfillment),
  ) || (request.customerContext?.detailedPurchases ?? []).some(purchaseCarriesFulfillment);
  return {
    stage: 'reply',
    owner,
    establishedDomain: null,
    tasks: [...tasks],
    approvalBoundary,
    giftFulfillment,
    hasPlanningDetail: false,
  };
}

/**
 * Reply module selection from typed tasks and outcomes. Mixed tasks compose
 * every applicable module; escalation is an outcome attached to its task and
 * never suppresses an already-completed answer module. Candidates are
 * filtered through the registry so a module can only load for its declared
 * stages, owners and tasks (authorization boundary, not preference).
 */
export function selectReplyModules(
  context: ModuleSelectionContext,
): SelectedModule[] {
  const candidates: SelectedModule[] = [
    selected('shared_invariants', 'stable conversational invariants on every call', []),
  ];
  const has = (task: CompilerTask): boolean => context.tasks.includes(task);
  if (has('planning') || context.owner === 'planning') {
    candidates.push(
      selected('reply_planning_owner', 'planning owner task on this turn', ['plan.provider_needs', 'turnDecision']),
    );
  }
  if (has('purchase')) {
    candidates.push(
      selected('reply_purchase_facts', 'requested purchase record semantics and payment facts', ['informationResults.purchase', 'customerContext.detailedPurchases']),
    );
  }
  if (has('venue')) {
    candidates.push(
      selected('reply_venue_facts', 'requested event moment venue and address', ['informationResults.associated_event', 'customerContext.invitations']),
    );
  }
  if (has('rsvp')) {
    candidates.push(
      selected('reply_rsvp_facts', 'grounded invitation candidates, state and explicit action', ['rsvpPhoneEvidence', 'extraction.rsvpAction']),
    );
  }
  if (has('faq_policy')) {
    candidates.push(
      selected('reply_faq_policy', 'source-backed policy facts for the asked question', ['informationResults.faq']),
    );
  }
  if (has('image')) {
    candidates.push(
      selected('reply_image_context', 'native image context and earlier question', ['imageEvidence', 'extraction.imageReference']),
    );
  }
  if (context.approvalBoundary === true) {
    candidates.push(
      selected('reply_approval_boundary', 'receipt-is-not-approval boundary for the requested purchase validation', ['extraction.informationRequests']),
    );
  }
  if (context.giftFulfillment === true) {
    candidates.push(
      selected('reply_gift_fulfillment', 'gift fulfillment evidence present; explain business meaning naturally', ['informationResults.purchase']),
    );
  }
  if (has('auth')) {
    candidates.push(
      selected('reply_auth_limitation', 'validated terminal/declined/scoped-miss auth outcome for this turn', ['authenticationOutcome']),
    );
  }
  if (has('handoff')) {
    candidates.push(
      selected('reply_handoff_outcome', 'actual handoff result for the requested task', ['handoffOutcome', 'capabilityDecision']),
    );
  }
  if (has('wait_followup')) {
    candidates.push(
      selected('reply_wait_followup', 'waited turn behind a fresh prior reply; extend only with new information', ['messageContext.turnWait', 'plan.last_outbound_context']),
    );
  }
  if (
    has('purchase') || has('venue') || has('rsvp') || has('handoff') ||
    context.owner === 'customer_assistance'
  ) {
    candidates.push(
      selected('reply_support_continuity', 'pending task and prior answer for support continuity', ['plan.owner_pending_question', 'messageContext']),
    );
  }
  return candidates.filter((module) =>
    registrySupports(module.id, 'reply', context.owner, context.tasks),
  );
}

/**
 * Ordered unique tracked files for the selected modules. Fixed module order
 * keeps exact-prefix stability with shared invariants first. Evidence-only
 * modules contribute no files; their facts travel in the input sections.
 */
export function moduleFilesFor(
  selectedModules: readonly SelectedModule[],
): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const module of selectedModules) {
    for (const file of module.files) {
      if (!seen.has(file)) {
        seen.add(file);
        files.push(file);
      }
    }
  }
  return files;
}

/**
 * G3 executable tools for the reply call. Planning owners running a planning
 * task keep the node allowlist (further gated downstream by search readiness
 * and close confirmation); every other stage/owner combination exposes no
 * generation-stage tools because reads complete before reply. Unrelated
 * planning state therefore cannot add provider tools to a support answer,
 * and tool guidance text never promises an unexposed tool.
 */
export function selectReplyTools(
  context: ModuleSelectionContext,
  currentNode: DecisionNode,
): readonly ToolName[] {
  const nodeMax = nodePromptManifest[currentNode].allowedTools;
  if (context.owner === 'planning' && context.tasks.includes('planning')) {
    return nodeMax;
  }
  return [];
}

/** G2 extraction never exposes generation-stage tools. */
export function selectExtractionTools(): readonly ToolName[] {
  return [];
}

/**
 * Ordered section assembly. Fixed module/tool ordering with stable
 * invariants first and dynamic context last keeps exact-prefix stability.
 * Sections carry caller-serialized content; the compiler only orders and
 * joins, so no customer text is inspected here.
 */
export type InputSection = {
  readonly key: string;
  readonly content: string | null;
};

export function orderInputSections(sections: readonly InputSection[]): string {
  return sections
    .filter((section): section is { key: string; content: string } => section.content !== null)
    .map((section) => section.content)
    .join('\n');
}

/**
 * Local audit manifest. Bytes come from the caller's size lookup over
 * loaded module text; source uses field paths, never customer payloads.
 */
export function buildRelevanceManifest(
  selectedModules: readonly SelectedModule[],
  byteSizeOf: (module: InstructionModuleId) => number,
): RelevanceManifest {
  const entries = selectedModules.map((module) => ({
    ...module,
    bytes: byteSizeOf(module.id),
  }));
  return {
    promptIdentity: selectedModules.map((module) => module.id).join('+'),
    modules: entries,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  };
}

/**
 * G5 request manifest: describes the request actually sent, not a parallel
 * theory. Modules carry their tracked files, typed reason, evidence
 * dependencies and loaded bytes; tools carry their typed applicability
 * reason; fact groups reference caller-serialized evidence by key with
 * source field paths, never customer payloads.
 */
export type ManifestToolEntry = {
  readonly name: string;
  readonly reason: string;
};

export type ManifestFactGroup = {
  readonly key: string;
  readonly source: string;
  readonly reason: string;
  readonly bytes: number;
};

export type CompilerRequestManifest = RelevanceManifest & {
  readonly tools: readonly ManifestToolEntry[];
  readonly factGroups: readonly ManifestFactGroup[];
};

export function buildCompilerRequestManifest(args: {
  readonly selectedModules: readonly SelectedModule[];
  readonly byteSizeOf: (module: InstructionModuleId) => number;
  readonly tools: readonly ManifestToolEntry[];
  readonly factGroups: readonly ManifestFactGroup[];
}): CompilerRequestManifest {
  const base = buildRelevanceManifest(args.selectedModules, args.byteSizeOf);
  const factBytes = args.factGroups.reduce((total, group) => total + group.bytes, 0);
  return {
    ...base,
    tools: [...args.tools],
    factGroups: [...args.factGroups],
    totalBytes: base.totalBytes + factBytes,
  };
}

/**
 * G2: category-priority context is needed only for transient owners.
 * Established support/FAQ/RSVP extraction never receives planning category
 * priorities; the lane is read from the plan snapshot instead.
 */
export function extractionCategoryContextNeeded(
  established: EstablishedExtractionDomain,
): boolean {
  return established === null;
}

/**
 * G3: the broad capability catalogue is omitted on support/FAQ replies.
 * Planning owners keep their scoped capability summary and transient entry
 * turns keep orientation; support, FAQ, handoff, auth and image turns
 * answer from typed evidence.
 */
export function replyOmitsCapabilityCatalogue(owner: CompilerOwner): boolean {
  return owner === 'faq' || owner === 'customer_assistance';
}

/**
 * G3: a free-form operational note is redundant when the turn already
 * carries a typed outcome the node contract renders (capability decision,
 * handoff result or auth outcome). Genuine transport/unknown errors without
 * typed outcomes keep their note.
 */
export function replyOmitsOperationalNote(args: {
  readonly hasTypedOutcome: boolean;
}): boolean {
  return args.hasTypedOutcome;
}

export type { InstructionModuleId };

/**
 * Single projector boundary: reply-evidence projection lives under this
 * compiler. Re-exported here so production callers depend on one boundary;
 * reply-evidence-projector.ts remains the implementation, not a second
 * independent projector deciding content.
 */
export {
  checkReplyNarrativeClaims,
  projectOperationalFailure,
  projectReply,
  projectSupportHandoffEvidence,
  resolveComposedReply,
  resolveWaitFollowupEvidence,
  type ReplyContinuitySummary,
  type ReplyDisposition,
  type ReplyNarrativeClaim,
  type ReplyProjection,
  type ReplyProjectionInput,
  type ResolvedComposedReply,
  type SupportHandoffEvidence,
  type SupportHandoffReplyOutcome,
  type WaitFollowupEvidence,
} from './reply-evidence-projector';
export {
  DEFAULT_WAIT_FOLLOWUP_FRESHNESS_MS,
  WAIT_FOLLOWUP_PRIOR_SUMMARY_MAX_CHARS,
} from './reply-evidence-projector';
