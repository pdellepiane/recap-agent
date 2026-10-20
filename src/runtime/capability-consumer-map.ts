/**
 * WP1 — capability truth: one explicit consumer class per runtime operation.
 *
 * The capability manifest answers "is this operation available right now".
 * It never answered "who actually performs it", so routing had to guess from
 * operation names. This registry closes that gap: every id in
 * `runtimeOperationIds` carries exactly one class and the concrete consumer
 * that implements it (gateway method, compose tool, orchestrator entry point,
 * knowledge retrieval, or the model call that reviews the evidence).
 *
 * Pure data and pure functions only: no I/O, no network, no AWS, no side
 * effects at import time.
 */
import {
  runtimeOperationIds,
  runtimeWriteOperationIds,
  type RuntimeOperationId,
} from './capability-manifest';
import { toolNames } from './prompt-manifest';

export const capabilityConsumerClasses = [
  'backend_read',
  'model_review',
  'effect_write',
  'unsupported',
] as const;

export type CapabilityConsumerClass = (typeof capabilityConsumerClasses)[number];

export const capabilityConsumerKinds = [
  'gateway_method',
  'compose_tool',
  'orchestrator',
  'knowledge_retrieval',
  'model_call',
] as const;

export type CapabilityConsumerKind = (typeof capabilityConsumerKinds)[number];

export type CapabilityConsumerRef = {
  readonly kind: CapabilityConsumerKind;
  /** Concrete consumer: gateway method, compose tool, orchestrator entry point. */
  readonly name: string;
  /** Repo-relative file that owns the consumer. */
  readonly source: string;
  /** Exact `file:line` of the consumer call site. */
  readonly location: string;
};

export type CapabilityConsumerEntry = {
  readonly id: RuntimeOperationId;
  readonly class: CapabilityConsumerClass;
  /** Consumers implementing the operation. Empty only for `unsupported`. */
  readonly consumers: readonly CapabilityConsumerRef[];
  /** Why this class is the honest one for this operation. */
  readonly note: string;
};

function gatewayMethod(
  name: string,
  source: string,
  location: string,
): CapabilityConsumerRef {
  return { kind: 'gateway_method', name, source, location };
}

function composeTool(
  name: string,
  source: string,
  location: string,
): CapabilityConsumerRef {
  return { kind: 'compose_tool', name, source, location };
}

function orchestrator(
  name: string,
  source: string,
  location: string,
): CapabilityConsumerRef {
  return { kind: 'orchestrator', name, source, location };
}

function knowledgeRetrieval(
  name: string,
  source: string,
  location: string,
): CapabilityConsumerRef {
  return { kind: 'knowledge_retrieval', name, source, location };
}

function modelCall(
  name: string,
  source: string,
  location: string,
): CapabilityConsumerRef {
  return { kind: 'model_call', name, source, location };
}

const AGENT_SERVICE = 'src/runtime/agent-service.ts';
const ORCHESTRATOR = 'src/runtime/information-orchestrator.ts';
const AGENT_RUNTIME = 'src/runtime/openai-agent-runtime.ts';

/**
 * The operation -> consumer registry. Total by construction: the
 * `satisfies` clause fails compilation when an operation id is added to the
 * manifest without a classification, and `validateCapabilityConsumerMap`
 * re-checks the same invariant at runtime.
 */
export const capabilityConsumerMap = {
  'faq.read': {
    id: 'faq.read',
    class: 'backend_read',
    consumers: [
      orchestrator(
        'InformationOrchestrator.executeRequest (faq branch)',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:995',
      ),
      knowledgeRetrieval(
        'KnowledgeRetrievalGateway.search',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:1006',
      ),
    ],
    note: 'General-information policy questions are answered from the knowledge base retrieval path.',
  },
  'event.association.read': {
    id: 'event.association.read',
    class: 'backend_read',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.getGuestEventsByPhone',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:1450',
      ),
      gatewayMethod(
        'AgentConversationGateway.getGuestEventsByPhone',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:3578',
      ),
    ],
    note: 'Lists the events a phone-scoped guest is associated with; read only, no mutation.',
  },
  'event.detail.read': {
    id: 'event.detail.read',
    class: 'backend_read',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.getEventDetail',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:1967',
      ),
      gatewayMethod(
        'AgentConversationGateway.getEventDetail',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:3607',
      ),
    ],
    note: 'Reads one event detail for an authorized guest; read only, no mutation.',
  },
  'purchase.orders.read': {
    id: 'purchase.orders.read',
    class: 'backend_read',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.getGuestOrdersByPhone',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:3175',
      ),
      gatewayMethod(
        'AgentConversationGateway.getOrders',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:3446',
      ),
    ],
    note: 'Phone-scoped and account-scoped order reads; source-specific, never exposed as a user-requested operation.',
  },
  'purchase.gift_detail.read': {
    id: 'purchase.gift_detail.read',
    class: 'backend_read',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.getGuestGiftPurchasesByPhone',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:3180',
      ),
      gatewayMethod(
        'AgentConversationGateway.getGiftPurchases',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:3447',
      ),
    ],
    note: 'Gift purchase reads for phone-scoped and account-scoped customers; read only, no mutation.',
  },
  'rsvp.state.read': {
    id: 'rsvp.state.read',
    class: 'backend_read',
    consumers: [
      orchestrator(
        'AgentService.lookupRsvpPhoneEvidence',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:3549',
      ),
      gatewayMethod(
        'AgentConversationGateway.getGuestEventsByPhone',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:3578',
      ),
    ],
    note: 'Reads the current attendance state of the phone-scoped guest before any RSVP effect.',
  },
  'rsvp.response.write': {
    id: 'rsvp.response.write',
    class: 'effect_write',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.guestRsvp',
        'src/runtime/rsvp-effect-executor.ts',
        'src/runtime/rsvp-effect-executor.ts:502',
      ),
    ],
    note: 'Registers or declines attendance; the runtime executes it and records the receipt.',
  },
  'provider.plan': {
    id: 'provider.plan',
    class: 'backend_read',
    consumers: [
      composeTool('list_categories', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:3986'),
      composeTool('get_category_by_slug', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4001'),
      composeTool('list_locations', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4014'),
    ],
    note: 'Marketplace taxonomy reads (categories, locations) used to shape the provider interview.',
  },
  'provider.search': {
    id: 'provider.search',
    class: 'backend_read',
    consumers: [
      composeTool('search_providers_from_plan', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4027'),
      composeTool('search_providers_by_keyword', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4048'),
      composeTool('search_providers_by_category_location', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4074'),
      composeTool('search_providers_by_query_intent', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4104'),
      composeTool('get_relevant_providers', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4119'),
      composeTool('get_provider_detail', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4139'),
      composeTool('get_provider_detail_and_track_view', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4157'),
      composeTool('get_related_providers', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4179'),
      composeTool('list_provider_reviews', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4194'),
      composeTool('get_event_vendor_context', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4210'),
      composeTool('list_event_favorite_providers', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4233'),
      composeTool('list_user_events_vendor_context', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4255'),
    ],
    note: 'Provider catalogue and detail reads exposed as compose tools; read only, no mutation.',
  },
  'provider.quote.write': {
    id: 'provider.quote.write',
    class: 'effect_write',
    consumers: [
      composeTool('create_quote_request', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4300'),
      composeTool('finish_plan', AGENT_RUNTIME, 'src/runtime/openai-agent-runtime.ts:4379'),
    ],
    note: 'Sends the quote/contact request and closes the plan; both are effects the runtime executes.',
  },
  'auth.phone': {
    id: 'auth.phone',
    class: 'backend_read',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.authByPhone',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:8989',
      ),
    ],
    note: 'Phone authentication lookup; the repo already excludes it from runtimeWriteOperationIds.',
  },
  'auth.email_otp': {
    id: 'auth.email_otp',
    class: 'effect_write',
    consumers: [
      gatewayMethod(
        'ProviderGateway.requestUserLoginCode',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:9156',
      ),
      gatewayMethod(
        'ProviderGateway.verifyUserLoginCode',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:9296',
      ),
      orchestrator(
        'AgentService.isAuthCapabilityOperation',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:6818',
      ),
    ],
    note: 'Channel-level capability for the email one-time-code path. The executable operations it gates are auth.otp.send and auth.otp.verify; it is not one of the S16 write ids because it names the channel, not a single effect.',
  },
  'human.takeover.write': {
    id: 'human.takeover.write',
    class: 'effect_write',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.requestHumanTakeover',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:10043',
      ),
    ],
    note: 'Hands the conversation to a human agent; the runtime executes it and records the handoff receipt.',
  },
  'confirmation_document.send': {
    id: 'confirmation_document.send',
    class: 'unsupported',
    consumers: [],
    note: 'Always unavailable with reason not_implemented (src/runtime/capability-manifest.ts:150); no runtime consumer exists.',
  },
  'media.image.inspect': {
    id: 'media.image.inspect',
    class: 'model_review',
    consumers: [
      modelCall(
        'composeModelReply (native image evidence)',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:6421',
      ),
      modelCall(
        'composeModelReply (media-only turn)',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:5141',
      ),
    ],
    note: 'Intentionally available: the reply model reviews the projected image content. No runtime inspection tool exists, and the runtime never marks it not_implemented.',
  },
  'payment_proof.verify': {
    id: 'payment_proof.verify',
    class: 'model_review',
    consumers: [
      modelCall(
        'composeModelReply (information lane, purchase/payment evidence)',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:7563',
      ),
      orchestrator(
        'InformationOrchestrator.projectPurchase',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:3472',
      ),
    ],
    note: 'Intentionally available: the reply model reviews the payment evidence against the record. No runtime verifier exists, and the runtime never marks it not_implemented.',
  },
  'purchase.modify': {
    id: 'purchase.modify',
    class: 'unsupported',
    consumers: [],
    note: 'Always unavailable with reason not_implemented (src/runtime/capability-manifest.ts:151); no runtime consumer exists.',
  },
  'refund_or_withdrawal.execute': {
    id: 'refund_or_withdrawal.execute',
    class: 'unsupported',
    consumers: [],
    note: 'Always unavailable with reason not_implemented (src/runtime/capability-manifest.ts:152); no runtime consumer exists.',
  },
  'provider.favorites.write': {
    id: 'provider.favorites.write',
    class: 'effect_write',
    consumers: [
      composeTool(
        'add_vendor_to_event_favorites',
        AGENT_RUNTIME,
        'src/runtime/openai-agent-runtime.ts:4331',
      ),
    ],
    note: 'Adds a vendor to the event shortlist; the runtime executes it and records the receipt.',
  },
  'provider.review.write': {
    id: 'provider.review.write',
    class: 'effect_write',
    consumers: [
      composeTool(
        'create_provider_review',
        AGENT_RUNTIME,
        'src/runtime/openai-agent-runtime.ts:4360',
      ),
    ],
    note: 'Publishes a provider review; the runtime executes it and records the receipt.',
  },
  'auth.phone_update.write': {
    id: 'auth.phone_update.write',
    class: 'effect_write',
    consumers: [
      gatewayMethod(
        'AgentConversationGateway.updatePhone',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:9414',
      ),
    ],
    note: 'Replaces the phone bound to the customer account; the runtime executes it.',
  },
  'auth.otp.send': {
    id: 'auth.otp.send',
    class: 'effect_write',
    consumers: [
      gatewayMethod(
        'ProviderGateway.requestUserLoginCode',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:9156',
      ),
    ],
    note: 'Sends the one-time login code to the customer email; the runtime executes it.',
  },
  'auth.otp.verify': {
    id: 'auth.otp.verify',
    class: 'effect_write',
    consumers: [
      gatewayMethod(
        'ProviderGateway.verifyUserLoginCode',
        AGENT_SERVICE,
        'src/runtime/agent-service.ts:9296',
      ),
    ],
    note: 'Verifies the one-time login code and opens the account session; the runtime executes it.',
  },
  'purchase.read': {
    id: 'purchase.read',
    class: 'backend_read',
    consumers: [
      orchestrator(
        'InformationOrchestrator.requestedPurchaseSources (discovery fan-out)',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:395',
      ),
      orchestrator(
        'InformationOrchestrator.purchaseOperationForSource',
        ORCHESTRATOR,
        'src/runtime/information-orchestrator.ts:400',
      ),
    ],
    note: 'Generic discovery read. It grants no new access: the executor expands it into purchase.orders.read and purchase.gift_detail.read with per-source capability checks.',
  },
} as const satisfies Readonly<Record<RuntimeOperationId, CapabilityConsumerEntry>>;

export type CapabilityConsumerMap = typeof capabilityConsumerMap;

/** Entries in the stable `runtimeOperationIds` order. */
export const capabilityConsumerEntries: readonly CapabilityConsumerEntry[] =
  runtimeOperationIds.map((id) => capabilityConsumerMap[id]);

/** The single consumer class of one operation. */
export function capabilityConsumerClassFor(
  operation: RuntimeOperationId,
): CapabilityConsumerClass {
  return capabilityConsumerMap[operation].class;
}

export type CapabilityMapIssue = {
  readonly operation: string;
  readonly problem: string;
};

/**
 * Runtime re-check of the registry invariants. Accepts any map so tests can
 * feed a deliberately broken copy and prove the validator rejects it.
 */
export function validateCapabilityConsumerMap(
  map: Readonly<Record<string, CapabilityConsumerEntry | undefined>>,
): readonly CapabilityMapIssue[] {
  const issues: CapabilityMapIssue[] = [];
  const known = new Set<string>(runtimeOperationIds);

  for (const id of runtimeOperationIds) {
    const entry = map[id];
    if (entry === undefined) {
      issues.push({ operation: id, problem: 'missing_consumer_classification' });
      continue;
    }
    if (entry.id !== id) {
      issues.push({ operation: id, problem: 'entry_id_mismatch' });
    }
    if (!capabilityConsumerClasses.includes(entry.class)) {
      issues.push({ operation: id, problem: 'unknown_consumer_class' });
    }
    if (entry.class === 'unsupported') {
      if (entry.consumers.length > 0) {
        issues.push({ operation: id, problem: 'unsupported_operation_names_a_consumer' });
      }
    } else if (entry.consumers.length === 0) {
      issues.push({ operation: id, problem: 'classified_operation_without_consumer' });
    }
    for (const consumer of entry.consumers) {
      if (consumer.name.trim() === '') {
        issues.push({ operation: id, problem: 'consumer_without_name' });
      }
      if (consumer.source.trim() === '') {
        issues.push({ operation: id, problem: 'consumer_without_source' });
      }
      if (!/:\d+$/u.test(consumer.location)) {
        issues.push({ operation: id, problem: 'consumer_location_without_line' });
      }
      if (!capabilityConsumerKinds.includes(consumer.kind)) {
        issues.push({ operation: id, problem: 'unknown_consumer_kind' });
      }
    }
  }

  for (const id of Object.keys(map)) {
    if (!known.has(id)) {
      issues.push({ operation: id, problem: 'unknown_operation_id' });
    }
  }

  for (const id of runtimeWriteOperationIds) {
    const entry = map[id];
    if (entry !== undefined && entry.class !== 'effect_write') {
      issues.push({ operation: id, problem: 'write_operation_not_classified_as_effect' });
    }
  }

  return issues;
}

/**
 * Every compose tool must exist and point at a known operation id. Accepts
 * any map so tests can feed a deliberately broken copy. The expected tool
 * set is the prompt manifest's tool surface, so a removed tool mapping is
 * detected as well as a broken one.
 */
export function validateToolOperationMap(
  toolMap: Readonly<Record<string, string | undefined>>,
  expectedTools: readonly string[] = toolNames,
): readonly CapabilityMapIssue[] {
  const issues: CapabilityMapIssue[] = [];
  for (const tool of expectedTools) {
    if (toolMap[tool] === undefined) {
      issues.push({ operation: tool, problem: 'tool_without_operation' });
    }
  }
  for (const [tool, operation] of Object.entries(toolMap)) {
    if (operation === undefined) {
      issues.push({ operation: tool, problem: 'tool_without_operation' });
      continue;
    }
    if (!(runtimeOperationIds as readonly string[]).includes(operation)) {
      issues.push({ operation: tool, problem: 'tool_maps_to_unknown_operation' });
    }
  }
  return issues;
}
