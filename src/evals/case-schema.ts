import { z } from 'zod';

import { decisionNodeSchema } from '../core/decision-nodes';
import { eventTypeSchema } from '../core/event-type';
import { actionIntentValues, planSchema } from '../core/plan';
import type { PlanSnapshot } from '../core/plan';
import { providerSummarySchema } from '../core/provider';
import { providerCategorySchema } from '../core/provider-category';
import {
  providerDetailRequestSchema,
  providerExplanationRequestSchema,
  providerPlanOperationSchema,
  providerQueryIntentSchema,
  providerReferenceSchema,
} from '../runtime/extraction-schemas';
import { closeActionSchema } from '../runtime/close-flow-schemas';
import { extractedInformationRequestSchema } from '../core/information';

const outputOriginEvidenceSchema = z.object({
  status: z.enum(['verified', 'mismatch', 'missing', 'generation_failed']),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  deliveredSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  transformationVersion: z.string().nullable(),
  mismatchFields: z.array(z.string()),
});
export type OutputOriginEvidence = z.infer<typeof outputOriginEvidenceSchema>;

/**
 * F2 typed silence observation for semantic judging.
 *
 * Records how an empty candidate was observed BEFORE any blanket empty-text
 * rejection: a validated silence path (established, model-selected, or
 * image-only with a successful ref save), deliverable speech, or a hard
 * failure (generation failure, origin mismatch, missing turn, empty send,
 * unknown suppression, unpersisted image). The semantic judge receives the
 * observed disposition, never a pretend assistant sentence.
 */
export const silenceObservationSchema = z.object({
  route: z.enum(['speech', 'silence', 'failure']),
  path: z.enum(['established', 'model_selected', 'image_only']).nullable(),
  reason: z.string().min(1).max(512),
  dispositionAction: z.string().max(64).nullable(),
  dispositionReason: z.string().max(256).nullable(),
  deliveredNull: z.boolean(),
  originStatus: z.string().max(32).nullable(),
  imageRefSaved: z.boolean(),
}).strict();
export type SilenceObservation = z.infer<typeof silenceObservationSchema>;

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const scalarVariableSchema = z.union([z.string(), z.number(), z.boolean()]);

export const evalTargetModeSchema = z.enum(['offline', 'live_lambda']);
export type EvalTargetMode = z.infer<typeof evalTargetModeSchema>;

const providerDetailSchema = providerSummarySchema.extend({
  description: z.string().nullish(),
  eventTypes: z.array(z.string()).default([]),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const extractionResultSchema = z.object({
  actionIntent: z.enum(actionIntentValues).nullable(),
  informationRequests: z.array(extractedInformationRequestSchema).default([]),
  phoneConfirmation: z.enum(['yes', 'no', 'unclear']).nullable().default(null),
  intentConfidence: z.number().min(0).max(1).nullable(),
  eventType: eventTypeSchema.nullable(),
  vendorCategory: providerCategorySchema.nullable(),
  vendorCategories: z.array(providerCategorySchema),
  activeNeedCategory: providerCategorySchema.nullable(),
  location: z.string().nullable(),
  budgetSignal: z.string().nullable(),
  guestRange: z.enum(['1-20', '21-50', '51-100', '101-200', '201+', 'unknown']).nullable(),
  preferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  conversationSummary: z.string(),
  selectedProviderHints: z.array(z.string()).default([]),
  selectedProviderReferences: z.array(providerReferenceSchema).default([]),
  closeAction: closeActionSchema.nullable().default(null),
  pauseRequested: z.boolean(),
  contactName: z.string().nullable().default(null),
  contactEmail: z.string().nullable().default(null),
  contactPhone: z.string().nullable().default(null),
  providerQueryIntents: z.array(providerQueryIntentSchema).default([]),
  providerPlanOperations: z.array(providerPlanOperationSchema).default([]),
  providerExplanationRequest: providerExplanationRequestSchema.nullable().default(null),
  providerDetailRequest: providerDetailRequestSchema.nullable().default(null),
});

const toolOutputTraceSchema = z.object({
  tool: z.string(),
  output: z.string(),
});

const toolInputTraceSchema = z.object({
  tool: z.string(),
  input: z.string(),
});

const contactFieldPresenceSchema = z.object({
  name: z.boolean(),
  email: z.boolean(),
  phone: z.boolean(),
});

const openAiTransportRequestSchema = z.object({
  sequence: z.number().int().nonnegative(),
  stage: z.enum(['classifier', 'extraction', 'reply', 'image', 'knowledge_retrieval', 'provider_vector_search', 'unknown']),
  requestId: z.string().nullable(),
  responseId: z.string().nullable(),
  statusCode: z.number().int().nullable(),
  succeeded: z.boolean().nullable(),
  totalPayloadBytes: z.number().int().nonnegative().nullable(),
  instructionBytes: z.number().int().nonnegative().nullable(),
  inputBytes: z.number().int().nonnegative().nullable(),
  toolBytes: z.number().int().nonnegative().nullable(),
  outputSchemaBytes: z.number().int().nonnegative().nullable(),
  requestBodySha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
});
const openAiCallSchema = z.object({
  responseId: z.string().nullable(),
  requestId: z.string().nullable(),
  model: z.string(),
  attemptCount: z.number().int().positive(),
  requestMetrics: z.object({
    instructionBytes: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
    toolCount: z.number().int().nonnegative(),
    schemaPropertyCount: z.number().int().nonnegative(),
    transport: z.object({
      observedRequestCount: z.number().int().nonnegative(),
      totalPayloadBytes: z.number().int().nonnegative().nullable(),
      instructionBytes: z.number().int().nonnegative().nullable(),
      inputBytes: z.number().int().nonnegative().nullable(),
      toolBytes: z.number().int().nonnegative().nullable(),
      outputSchemaBytes: z.number().int().nonnegative().nullable(),
      requests: z.array(openAiTransportRequestSchema).default([]),
    }).optional(),
  }),
});

export const turnTraceSchema = z.object({
  turn_coordination: z.object({
    wait_ms: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
  }).optional(),
  trace_id: z.string(),
  conversation_id: z.string().nullable(),
  plan_id: z.string(),
  previous_node: decisionNodeSchema,
  next_node: decisionNodeSchema,
  node_path: z.array(decisionNodeSchema),
  intent: z.string().nullable(),
  missing_fields: z.array(z.string()),
  search_ready: z.boolean(),
  prompt_bundle_id: z.string(),
  prompt_file_paths: z.array(z.string()),
  tools_considered: z.array(z.string()),
  tools_called: z.array(z.string()),
  tool_inputs: z.array(toolInputTraceSchema).default([]),
  tool_outputs: z.array(toolOutputTraceSchema),
  provider_results: z.array(providerSummarySchema),
  search_strategy: z.string().default('none'),
  close_action_summary: z.object({
    type: z.enum(closeActionSchema.shape.type.options).nullable(),
    category: z.string().nullable(),
    reason_preview: z.string().nullable(),
  }).default({
    type: null,
    category: null,
    reason_preview: null,
  }),
  selection_resolution_summary: z.object({
    selected_provider_references: z.array(z.object({
      provider_id: z.number().int().positive().nullable(),
      category: z.string().nullable(),
      has_title: z.boolean(),
      has_hint: z.boolean(),
    })),
    selected_provider_hints_count: z.number().int().nonnegative(),
    provider_plan_operation_types: z.array(z.string()),
    provider_plan_operation_categories: z.array(z.string()),
  }).default({
    selected_provider_references: [],
    selected_provider_hints_count: 0,
    provider_plan_operation_types: [],
    provider_plan_operation_categories: [],
  }),
  contact_validation_summary: z.object({
    status: z.enum(['not_provided', 'valid', 'invalid']),
    field: z.enum(['phone', 'email']).nullable(),
    reason_preview: z.string().nullable(),
    extraction_contact_fields_present: contactFieldPresenceSchema,
    plan_contact_fields_present: contactFieldPresenceSchema,
  }).default({
    status: 'not_provided',
    field: null,
    reason_preview: null,
    extraction_contact_fields_present: { name: false, email: false, phone: false },
    plan_contact_fields_present: { name: false, email: false, phone: false },
  }),
  provider_candidate_audit: z.array(z.object({
    provider_id: z.number().int().positive(),
    category: z.string().nullable(),
    location: z.string().nullable(),
    retrieval_source: z.string().nullable(),
    retrieval_score: z.number().nullable(),
    fit_score: z.number().nullable(),
  })).default([]),
  information_execution_summary: z.array(z.object({
    requestId: z.string(),
    kind: z.enum(['faq', 'associated_event', 'purchase']),
    status: z.enum(['completed', 'needs_input', 'failed']),
    source: z.enum(['knowledge_base', 'associated_event_api', 'agent_api']),
    outcomeCode: z.enum([
      'completed_with_results',
      'completed_without_results',
      'awaiting_authentication',
      'not_configured',
      'not_found',
      'unauthorized',
      'route_unavailable',
      'invalid_response',
      'request_failed',
    ]),
    retryable: z.boolean().nullable(),
    queryHash: z.string().regex(/^[a-f0-9]{64}$/u),
    evidence: z.array(z.object({
      fileId: z.string(),
      filename: z.string(),
      score: z.number(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
      /**
       * Packet O5 typed purchase fact. Optional so older artifacts and
       * unit probes without a backend read still parse; absent means
       * unknown, never a demand for a named datum.
       */
      purchaseFact: z.object({
        eventLabel: z.string().nullable(),
        total: z.number().nullable(),
        currency: z.string().nullable(),
        currencySymbol: z.string().nullable(),
        paymentMethod: z.string().nullable(),
        paymentStatus: z.string().nullable(),
        shippingStatus: z.string().nullable().optional(),
        eventDate: z.string().nullable(),
        createdAt: z.string().nullable(),
        referencePresent: z.boolean(),
        dedication: z.object({
          message: z.string().nullable(),
          sendPhysical: z.boolean().nullable(),
          physicalStatus: z.string().nullable(),
        }).nullable().optional(),
        items: z.array(z.object({
          name: z.string().nullable(),
          quantity: z.number().nullable(),
          amount: z.number().nullable(),
          rowTotal: z.number().nullable(),
          fulfillment: z.string().nullable(),
        })).optional(),
      }).optional(),
    })),
    resultCount: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    openAiTransport: z.object({
      observedRequestCount: z.number().int().nonnegative(),
      totalPayloadBytes: z.number().int().nonnegative().nullable(),
      instructionBytes: z.number().int().nonnegative().nullable(),
      inputBytes: z.number().int().nonnegative().nullable(),
      toolBytes: z.number().int().nonnegative().nullable(),
      outputSchemaBytes: z.number().int().nonnegative().nullable(),
      requests: z.array(openAiTransportRequestSchema).default([]),
    }).optional(),
    accessMethod: z.enum(['authenticated_account', 'trusted_phone_guest', 'trusted_phone_purchase', 'trusted_phone_event_purchase']).nullable().optional(),
    resource: z.enum(['orders', 'gift_purchases']).optional(),
    coverage: z.enum(['complete', 'partial', 'inconsistent']).nullable().optional(),
    eventDetailCount: z.number().int().nonnegative().optional(),
  })).default([]),
  finish_plan_summary: z.object({
    status: z.enum(['success', 'partial', 'failed']).nullable(),
    eventDate: z.string().nullable(),
    confirmedCount: z.number().int().nonnegative(),
    pendingProviderIds: z.array(z.number().int()),
    errorKind: z.string().nullable(),
  }).nullable().default(null),
  provider_quote_receipts: z.array(z.object({
    providerId: z.number().int(),
    eventDate: z.string(),
    resultStatus: z.enum(['confirmed', 'failed', 'unresolved']),
    attempt: z.number().int().nonnegative(),
  })).default([]),
  openai_calls: z.object({
    classifier: openAiCallSchema.nullable(),
    extraction: openAiCallSchema.nullable(),
    reply: openAiCallSchema.nullable(),
  }).optional(),
  recommendation_funnel: z.object({
    available_candidates: z.number().int().nonnegative(),
    context_candidates: z.number().int().nonnegative(),
    context_candidate_ids: z.array(z.number().int().nonnegative()),
    presentation_limit: z.number().int().positive(),
  }).default({
    available_candidates: 0,
    context_candidates: 0,
    context_candidate_ids: [],
    presentation_limit: 5,
  }),
  plan_persisted: z.boolean(),
  plan_persist_reason: z.string().nullable(),
  timing_ms: z.object({
    total: z.number().nonnegative(),
    load_plan: z.number().nonnegative(),
    response_classification: z.number().nonnegative().optional(),
    prepare_working_plan: z.number().nonnegative(),
    extraction: z.number().nonnegative(),
    apply_extraction: z.number().nonnegative(),
    compute_sufficiency: z.number().nonnegative(),
    provider_search: z.number().nonnegative(),
    provider_enrichment: z.number().nonnegative(),
    prompt_bundle_load: z.number().nonnegative(),
    compose_reply: z.number().nonnegative(),
    save_plan: z.number().nonnegative(),
  }).passthrough(),
  token_usage: z.object({
    classifier: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
      cache_write_input_tokens: z.number().nonnegative().optional(),
    }).nullable().optional(),
    extraction: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
      cache_write_input_tokens: z.number().nonnegative().optional(),
    }).nullable(),
    reply: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
      cache_write_input_tokens: z.number().nonnegative().optional(),
    }).nullable(),
    total: z.object({
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      cached_input_tokens: z.number().nonnegative().optional(),
      cache_write_input_tokens: z.number().nonnegative().optional(),
    }).nullable(),
  }),
  response_classifier: z.object({
    mode: z.enum(['observe', 'enforce']),
    classifier_profile: z.enum(['general', 'campaign_reply']).optional(),
    action: z.enum([
      'respond',
      'suppress_acknowledgement',
      'suppress_reaction',
      'suppress_automated_response',
    ]),
    reason: z.string(),
    would_suppress: z.boolean(),
    context_source: z.enum(['agent_api', 'local_plan']),
    has_prior_outbound_message: z.boolean(),
    fallback_used: z.boolean(),
    conversation_health: z.enum(['progressing', 'uncertain', 'stalled', 'frustrated']),
    health_reason: z.enum([
      'normal_progress',
      'repeated_question',
      'repeated_correction',
      'unresolved_error',
      'circular_conversation',
      'explicit_frustration',
      'insufficient_context',
    ]),
    human_help_response: z.enum(['not_applicable', 'accept', 'decline', 'unclear']),
    campaign_reply_kind: z.enum([
      'not_applicable',
      'rsvp_decision',
      'declines_campaign_offer',
      'acknowledgement_only',
      'reaction_only',
      'question_or_request',
      'other_actionable',
      'unclear',
    ]).optional(),
    automation_confidence: z.enum(['not_automated', 'uncertain', 'high']),
    automation_pattern: z.enum([
      'none',
      'generic_corporate_reception',
      'interactive_menu',
      'away_or_hours_notice',
      'routing_or_queue',
      'automated_confirmation',
      'repeated_template',
      'explicit_virtual_assistant',
    ]),
    automation_scope: z.enum([
      'current_sender',
      'quoted_or_discussed',
      'none_or_uncertain',
    ]),
    prompt_bundle_id: z.string().nullable(),
    prompt_file_paths: z.array(z.string()),
  }).optional(),
}).passthrough();

const cliPerfSummarySchema = z.object({
  trace_id: z.string(),
  conversation_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  runtime_latency_ms: z.number().nonnegative(),
  extraction_latency_ms: z.number().nonnegative(),
  compose_latency_ms: z.number().nonnegative(),
  tools_called_count: z.number().int().nonnegative(),
  provider_results_count: z.number().int().nonnegative(),
  recommendation_context_candidates: z.number().int().nonnegative().default(0),
  recommendation_presentation_limit: z.number().int().positive().default(5),
  response_classifier_action: z.string().nullable().optional(),
  response_classifier_would_suppress: z.boolean().nullable().optional(),
  conversation_health_status: z.string().nullable().optional(),
  conversation_health_reason: z.string().nullable().optional(),
  human_help_response: z.string().nullable().optional(),
  total_tokens: z.number().nonnegative().nullable(),
  cached_input_tokens: z.number().nonnegative().nullable(),
  cache_hit_rate: z.number().min(0).max(1).nullable(),
  extraction_to_compose_ratio: z.number().nonnegative().nullable(),
  captured_at: z.string(),
  persisted: z.boolean().default(true),
  storage_target: z.string().nullable().default(null),
});

export const backendFixtureInputSchema = z.object({
  scenario: z.string().trim().min(1).max(128),
}).strict();

const turnImageDataSchema = z.object({
  data: z.string().min(1),
  mime_type: z.string().min(1).max(128),
}).strict();

const turnImageErrorSchema = z.object({
  error: z.enum(['image_too_large', 'media_unavailable']),
  mime_type: z.string().min(1).max(128),
}).strict();

const turnImageRedactedSchema = z.object({
  redacted: z.literal(true),
  mime_type: z.string().min(1).max(128).optional(),
  byte_length: z.number().int().nonnegative().optional(),
  url_host_redacted: z.string().max(256).optional(),
  url_bytes: z.number().int().nonnegative().optional(),
}).strict();

const turnImageUrlSchema = z.object({
  url: z.string().min(1).max(2048),
}).strict();

export const turnImageInputSchema = z.union([
  turnImageDataSchema,
  turnImageUrlSchema,
  turnImageErrorSchema,
  turnImageRedactedSchema,
]);
export type TurnImageInput = z.infer<typeof turnImageInputSchema>;

const turnInputSchema = z.object({
  text: z.string(),
  channel: z.string().optional(),
  externalUserId: z.string().optional(),
  receivedAt: z.string().optional(),
  sessionId: z.string().optional(),
  contactPhone: z.string().nullable().optional(),
  backendFixture: backendFixtureInputSchema.optional(),
  image: turnImageInputSchema.optional(),
}).superRefine((value, context) => {
  if (value.text.length === 0 && !value.image) {
    context.addIssue({
      code: 'custom',
      path: ['text'],
      message: 'A non-empty text or an image is required.',
    });
  }
});

const turnOutcomeSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([
    z.object({
      value: inner,
    }),
    z.object({
      error: z.string().min(1),
    }),
  ]);

const marketplaceCategorySchema = z.object({
  id: z.number().nullable(),
  name: z.string(),
  slug: z.string().nullable(),
  color: z.string().nullable(),
  eventTypes: z.array(z.string()).default([]),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const marketplaceLocationSchema = z.object({
  cityId: z.number().nullable(),
  countryId: z.number().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const providerReviewSchema = z.object({
  id: z.number().nullable(),
  name: z.string().nullable(),
  rating: z.number().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string().nullable(),
  raw: z.record(z.string(), jsonValueSchema).default({}),
});

const providerGatewayFixtureSchema = z.object({
  listCategories: z.array(marketplaceCategorySchema).optional(),
  categoriesBySlug: z.record(z.string(), marketplaceCategorySchema.nullable()).optional(),
  listLocations: z.array(marketplaceLocationSchema).optional(),
  searchProvidersByTurn: z.array(turnOutcomeSchema(z.object({ providers: z.array(providerSummarySchema) }))).optional(),
  searchProvidersByKeyword: turnOutcomeSchema(z.object({ providers: z.array(providerSummarySchema) })).optional(),
  searchProvidersByCategoryLocation: turnOutcomeSchema(
    z.object({ providers: z.array(providerSummarySchema) }),
  ).optional(),
  searchProvidersByQueryIntentByTurn: z.array(turnOutcomeSchema(z.object({ providers: z.array(providerSummarySchema) }))).optional(),
  relevantProviders: z.array(providerSummarySchema).optional(),
  providerDetailsById: z.record(z.string(), turnOutcomeSchema(providerDetailSchema.nullable())).optional(),
  relatedProvidersById: z.record(z.string(), z.array(providerSummarySchema)).optional(),
  reviewsById: z.record(z.string(), z.array(providerReviewSchema)).optional(),
});

const offlineFixtureSchema = z.object({
  extractionsByTurn: z.array(extractionResultSchema).optional(),
  repliesByTurn: z.array(z.string()).optional(),
  providerGateway: providerGatewayFixtureSchema.optional(),
});

const planFieldExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('plan_field_equals'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  severity: z.enum(['hard', 'soft']).default('hard'),
  turnIndex: z.number().int().nonnegative().optional(),
});

const planFieldSubsetExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('plan_field_subset'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  severity: z.enum(['hard', 'soft']).default('hard'),
  turnIndex: z.number().int().nonnegative().optional(),
});

const nodeTransitionExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('node_transition'),
  from: decisionNodeSchema.optional(),
  to: decisionNodeSchema.optional(),
  allowed: z.array(z.object({ from: decisionNodeSchema.optional(), to: decisionNodeSchema.optional() })).optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const nodePathContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('node_path_contains'),
  requiredNodes: z.array(decisionNodeSchema).min(1),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const providerMatchSchema = z.object({
  id: z.number().optional(),
  slug: z.string().optional(),
  category: z.string().optional(),
  titleContains: z.string().optional(),
  detailUrlContains: z.string().optional(),
});

const providerResultsContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('provider_results_contains'),
  providers: z.array(providerMatchSchema).min(1),
  turnIndex: z.number().int().nonnegative().optional(),
  matchMode: z.enum(['all', 'any']).default('all'),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const providerResultCountExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('provider_result_count'),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const traceFieldEqualsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trace_field_equals'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const traceFieldSubsetExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trace_field_subset'),
  path: z.string().min(1),
  expected: jsonValueSchema,
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const traceFieldNumberExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trace_field_number'),
  path: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const toolUsageExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('tool_usage'),
  mustCall: z.array(z.string()).default([]),
  mustNotCall: z.array(z.string()).default([]),
  maxTotalCalls: z.number().int().positive().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const textContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('text_contains'),
  allOf: z.array(z.string()).default([]),
  anyOf: z.array(z.string()).default([]),
  regex: z.array(z.string()).default([]),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const textNotContainsExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('text_not_contains'),
  phrases: z.array(z.string()).min(1),
  turnIndex: z.number().int().nonnegative().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const textSemanticExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('text_semantic'),
  rubric: z.string().min(1),
  minScore: z.number().min(0).max(1).default(0.7),
  turnIndex: z.number().int().nonnegative().optional(),
  judgeModel: z.string().optional(),
  requireJudge: z.boolean().default(false),
  severity: z.enum(['hard', 'soft']).default('soft'),
});

const trajectoryInvariantExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('trajectory_invariants'),
  noRepeatedQuestion: z.boolean().optional(),
  noCategoryReask: z.boolean().optional(),
  preservePriorSelection: z.boolean().optional(),
  noResolvedAmbiguityReopened: z.boolean().optional(),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const budgetConstraintExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('budget_constraints'),
  maxTurns: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().nonnegative().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  severity: z.enum(['hard', 'soft']).default('soft'),
});

const tokenUsagePresentExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('token_usage_present'),
  turnIndex: z.number().int().nonnegative().optional(),
  allTurns: z.boolean().default(false),
  requireExtraction: z.boolean().default(true),
  requireReply: z.boolean().default(true),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

const fixtureEffectCountExpectationSchema = z.object({
  id: z.string().optional(),
  type: z.literal('fixture_effect_count'),
  operation: z.enum([
    'otp.request',
    'otp.verify',
    'rsvp.write',
    'handoff.write',
    'provider.quote.write',
    'provider.favorite.write',
    'provider.review.write',
  ]),
  turnIndex: z.number().int().nonnegative().optional(),
  expectedAttempts: z.number().int().nonnegative(),
  expectedSuccesses: z.number().int().nonnegative(),
  expectedReplays: z.number().int().nonnegative().default(0),
  severity: z.enum(['hard', 'soft']).default('hard'),
});

export const expectationSchema = z.discriminatedUnion('type', [
  nodeTransitionExpectationSchema,
  nodePathContainsExpectationSchema,
  planFieldExpectationSchema,
  planFieldSubsetExpectationSchema,
  providerResultsContainsExpectationSchema,
  providerResultCountExpectationSchema,
  traceFieldEqualsExpectationSchema,
  traceFieldSubsetExpectationSchema,
  traceFieldNumberExpectationSchema,
  toolUsageExpectationSchema,
  textContainsExpectationSchema,
  textNotContainsExpectationSchema,
  textSemanticExpectationSchema,
  trajectoryInvariantExpectationSchema,
  budgetConstraintExpectationSchema,
  tokenUsagePresentExpectationSchema,
  fixtureEffectCountExpectationSchema,
]);
export type EvalExpectation = z.infer<typeof expectationSchema>;

const scorerSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('expectation_pass_rate'),
    expectationIds: z.array(z.string()).optional(),
    weight: z.number().positive().default(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal('budget_efficiency'),
    weight: z.number().positive().default(0.5),
    targetLatencyMs: z.number().int().positive().optional(),
    targetToolCalls: z.number().int().nonnegative().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('text_semantic'),
    weight: z.number().positive().default(0.5),
    rubric: z.string().min(1),
    turnIndex: z.number().int().nonnegative().optional(),
    judgeModel: z.string().optional(),
  }),
]);
export type EvalScorerConfig = z.infer<typeof scorerSchema>;

const rsvpIsolationSetupSchema = z.object({
  guestId: z.number().int().positive().default(584353),
  eventName: z.string().min(1).default('Otra celebración prueba'),
  phone: z.string().min(1).default('+51973296571'),
  targetState: z.enum(['attending', 'declining', 'pending']),
  /**
   * Packet O1: known restorable prior state. Real-backend setup requires a
   * decided restorable prior (explicit here or a fresh same-guest/same-event
   * backend read); fixture-backed setup preserves the explicit value and
   * otherwise reads the declared fixture world. Never inferred from prose.
   */
  priorState: z.enum(['attending', 'declining', 'pending']).nullable().optional(),
  /**
   * Packet O1: fixture scenario backing this isolation. Present (directly or
   * resolved from the case backendFixture) routes setup/teardown through the
   * fixture gateway with zero real HTTP writes; absent routes through the
   * real backend with verified write and verified restoration.
   */
  fixtureScenario: z.string().trim().min(1).max(128).nullable().optional(),
}).strict();

const rsvpIsolationTeardownSchema = z.object({
  guestId: z.number().int().positive().default(584353),
  eventName: z.string().min(1).default('Otra celebración prueba'),
  phone: z.string().min(1).default('+51973296571'),
  restore: z.boolean().default(true),
}).strict();

const rsvpIsolationHooksSchema = z.object({
  setup: rsvpIsolationSetupSchema.optional(),
  teardown: rsvpIsolationTeardownSchema.optional(),
}).strict();

const budgetSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().nonnegative().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  estimatedPromptTokensPerTurn: z.number().int().positive().optional(),
  estimatedCompletionTokensPerTurn: z.number().int().positive().optional(),
});

export const evalCaseSchema = z.object({
  concurrentFirstTwoTurns: z.boolean().optional(),
  id: z.string().min(1),
  suite: z.string().min(1),
  version: z.union([z.string().min(1), z.number().int().positive()]),
  description: z.string().min(1),
  template: z.string().optional(),
  imports: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']).default('p2'),
  status: z.enum(['active', 'draft', 'skip']).default('active'),
  targetModes: z.array(evalTargetModeSchema).min(1),
  variables: z.record(z.string(), scalarVariableSchema).default({}),
  inputs: z.array(turnInputSchema).min(1),
  seedPlan: planSchema.partial().optional(),
  fixtures: z.object({
    offline: offlineFixtureSchema.optional(),
  }).optional(),
  configOverrides: z.object({
    replyModel: z.string().optional(),
    extractorModel: z.string().optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
    promptBundleLabel: z.string().optional(),
    env: z.record(z.string(), scalarVariableSchema).default({}),
    liveLambda: z.object({
      functionUrl: z.string().url().optional(),
      channel: z.string().optional(),
    }).optional(),
  }).optional(),
  expectations: z.array(expectationSchema).default([]),
  scorers: z.array(scorerSchema).default([]),
  /**
   * Packet E1 judge-only image ground truth. Manually verified text read
   * from the fixture image pixels, bound to the sha256 digest of the exact
   * input image data the case sends. This block feeds the semantic-judge
   * context only (see resolveJudgeOnlyImageGroundTruth in runner.ts); it is
   * never loaded into runtime model input, never leaks expected answers to
   * the candidate, and performs no OCR or vision call. A read-only amount
   * recorded here is read accuracy, never backend payment approval.
   */
  judgeGroundTruth: z.object({
    imageDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    verifiedText: z.string().min(1),
    verifiedAmount: z.string().nullable().default(null),
    verifiedAt: z.string().min(1),
    boundInputTurn: z.number().int().nonnegative(),
  }).optional(),
  budget: budgetSchema.optional(),
  rsvpIsolation: rsvpIsolationHooksSchema.optional(),
  backendFixture: backendFixtureInputSchema.optional(),
  notes: z.array(z.string()).default([]),
}).strict();
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type RsvpIsolationHooks = z.infer<typeof rsvpIsolationHooksSchema>;

export const evalSuiteManifestSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  caseIds: z.array(z.string()).min(1),
  tags: z.array(z.string()).default([]),
});
export type EvalSuiteManifest = z.infer<typeof evalSuiteManifestSchema>;

/**
 * Packet O0 manifest hook. Every config/case pair executed in a run carries
 * the digest identity recorded in `src/evals/run-manifest.ts`; this schema
 * names the reference without changing any result envelope.
 */
export const evalRunManifestReferenceSchema = z.object({
  runId: z.string().min(1),
  manifestPath: z.string().min(1),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  configLabel: z.string().min(1),
  caseId: z.string().min(1),
  pairId: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type EvalRunManifestReference = z.infer<typeof evalRunManifestReferenceSchema>;

export const evalRunConfigSchema = z.object({
  run_id: z.string().min(1).optional(),
  label: z.string().min(1),
  target: evalTargetModeSchema,
  replyModel: z.string().optional(),
  extractorModel: z.string().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  promptBundleLabel: z.string().optional(),
  notes: z.array(z.string()).default([]),
  environmentOverrides: z.record(z.string(), scalarVariableSchema).default({}),
  liveLambda: z.object({
    functionUrl: z.string().url().optional(),
    channel: z.string().default('terminal_whatsapp_eval'),
  }).optional(),
});
export type EvalRunConfig = z.infer<typeof evalRunConfigSchema>;

export const evalMatrixSchema = z.object({
  configs: z.array(evalRunConfigSchema).min(1),
});
export type EvalMatrix = z.infer<typeof evalMatrixSchema>;

export const lambdaTurnResponseSchema = z.object({
  message: z.string().nullable(),
  message_original_sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable().optional(),
  message_redaction_applied: z.boolean().optional(),
  output_origin: outputOriginEvidenceSchema.optional(),
  delivery: z.object({
    action: z.enum(['send', 'suppress', 'failure']),
    reason: z.string(),
  }).optional(),
  conversation_id: z.string().nullable(),
  plan_id: z.string(),
  current_node: decisionNodeSchema,
  trace: turnTraceSchema,
  plan: planSchema.optional(),
  perf: cliPerfSummarySchema.nullable().optional(),
});

export const evalTurnResultSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  input: turnInputSchema,
  outputText: z.string(),
  deliveredText: z.string().nullable().optional(),
  delivery: z.object({
    action: z.enum(['send', 'suppress', 'failure']),
    reason: z.string(),
  }).optional(),
  outputOrigin: outputOriginEvidenceSchema.optional(),
  /**
   * S1 wire identity for the S3 silence seam. The live target records the
   * inbound message_id it actually sent; downstream silence validation binds
   * saved attachment refs to this invocation instead of a fixture-supplied
   * claim. Absent for offline turns (no wire identity).
   */
  observedMessageId: z.string().trim().min(1).max(256).optional(),
  currentNode: z.string(),
  trace: turnTraceSchema,
  perf: cliPerfSummarySchema.nullable().optional(),
  plan: planSchema,
  latencyMs: z.number().nonnegative(),
});
export type EvalTurnResult = z.infer<typeof evalTurnResultSchema>;

const evalArtifactPlanSummarySchema = z.object({
  current_node: z.string(),
  lifecycle_state: z.string(),
  event_type: z.string().nullable(),
  vendor_category: z.string().nullable(),
  active_need_category: z.string().nullable(),
  location: z.string().nullable(),
  budget_signal: z.string().nullable(),
  guest_range: z.string().nullable(),
  provider_needs: z.array(z.object({
    category: z.string(),
    status: z.string(),
    recommended_provider_ids: z.array(z.number()),
    selected_provider_ids: z.array(z.number()),
  })),
  selected_provider_ids: z.array(z.number()),
  missing_fields: z.array(z.string()),
});

const evalArtifactAuthEvidenceSchema = z.object({
  status: z.string(),
  auth_method: z.string().nullable(),
  awaiting_phone_confirmation: z.boolean(),
  phone_confirmation: z.enum(['awaiting', 'not_awaiting']),
  contact_fields_present: contactFieldPresenceSchema,
});

export const evalArtifactTurnResultSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  input: turnInputSchema,
  outputText: z.string(),
  deliveredText: z.string().nullable().optional(),
  delivery: z.object({
    action: z.enum(['send', 'suppress', 'failure']),
    reason: z.string(),
  }).optional(),
  outputOrigin: outputOriginEvidenceSchema.optional(),
  currentNode: z.string(),
  trace: turnTraceSchema,
  perf: cliPerfSummarySchema.nullable().optional(),
  plan_summary: evalArtifactPlanSummarySchema,
  auth_evidence: evalArtifactAuthEvidenceSchema,
  latencyMs: z.number().nonnegative(),
});
export type EvalArtifactTurnResult = z.infer<typeof evalArtifactTurnResultSchema>;

export const expectationResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  passed: z.boolean(),
  severity: z.enum(['hard', 'soft']),
  score: z.number().min(0).max(1),
  message: z.string(),
});
export type ExpectationResult = z.infer<typeof expectationResultSchema>;

export const scorerResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  skipped: z.boolean().default(false),
  message: z.string(),
});
export type ScorerResult = z.infer<typeof scorerResultSchema>;

const benchmarkMetricsSchema = z.object({
  turn_count: z.number().int().nonnegative(),
  avg_latency_ms: z.number().nonnegative(),
  p95_latency_ms: z.number().nonnegative(),
  tool_calls_total: z.number().int().nonnegative(),
  unique_tools_called: z.number().int().nonnegative(),
  tool_call_rate_per_turn: z.number().nonnegative(),
  tool_precision: z.number().min(0).max(1),
  tool_recall: z.number().min(0).max(1),
  tool_f1: z.number().min(0).max(1),
  branch_coverage: z.number().min(0).max(1),
  state_expectation_pass_rate: z.number().min(0).max(1),
  trajectory_expectation_pass_rate: z.number().min(0).max(1),
  plan_persistence_rate: z.number().min(0).max(1),
  total_tokens: z.number().int().nonnegative(),
  cache_hit_rate: z.number().min(0).max(1),
  /**
   * Packet O3 honest token accounting. Cached/input tokens aggregate by
   * summed counts with separate cache writes and uncached tokens; ratios
   * are always ratio-of-sums, never averages of per-turn percentages.
   * Missing usage is unknown (usage_known=false), never counted as zero.
   */
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  cache_write_input_tokens: z.number().int().nonnegative().optional(),
  uncached_input_tokens: z.number().int().nonnegative().optional(),
  usage_known: z.boolean().optional(),
});
export type BenchmarkMetrics = z.infer<typeof benchmarkMetricsSchema>;

/**
 * Packet O2/O3 per-case pipeline timing. Runtime turn latency stays a
 * distinct field (EvalTurnResult.latencyMs); these stages cover the whole
 * execution pipeline: admission queue wait, setup, turns, snapshot,
 * teardown, judge wait/API, and report write. All wall-clock milliseconds.
 */
export const caseTimingSchema = z.object({
  queueWaitMs: z.number().nonnegative(),
  setupMs: z.number().nonnegative(),
  turnMs: z.number().nonnegative(),
  snapshotMs: z.number().nonnegative(),
  teardownMs: z.number().nonnegative(),
  judgeWaitMs: z.number().nonnegative(),
  judgeApiMs: z.number().nonnegative(),
  reportWriteMs: z.number().nonnegative(),
  makespanMs: z.number().nonnegative(),
});
export type CaseTiming = z.infer<typeof caseTimingSchema>;

/**
 * Packet O3 per-case judge accounting: model call count, runner-owned
 * retry count, observed rate limits, and SDK/provider usage. Missing usage
 * is unknown (tokensUnknown=true), never zero.
 */
export const caseJudgeMetricsSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  rateLimitCount: z.number().int().nonnegative(),
  tokensUnknown: z.boolean(),
  openaiSdk: z.string().nullable(),
  judgeModels: z.array(z.string()),
});
export type CaseJudgeMetrics = z.infer<typeof caseJudgeMetricsSchema>;

export const evalResultSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  suite: z.string(),
  target: evalTargetModeSchema,
  configLabel: z.string(),
  /**
   * Packet O1 lane admission (no parallel execution yet; the runner stays
   * serial). Proven fully isolated fixture cases admit to `parallel`; every
   * other case enters the serial `external` lane. Unknown fails closed to
   * external. Dropped from redacted artifacts; in-memory reports keep it.
   */
  lane: z.enum(['parallel', 'external']).optional(),
  status: z.enum(['passed', 'failed', 'errored', 'skipped']),
  hardGatePassed: z.boolean(),
  /**
   * Packet O5: one primary reason per failure. Scores stay diagnostic;
   * present only on failed/errored results, null-free omission otherwise.
   */
  primaryFailureReason: z.enum([
    'product_effect_identity',
    'product_fact_completeness',
    'unnecessary_interaction',
    'evaluator_defect',
    'infrastructure_error',
  ]).optional(),
  finalScore: z.number().min(0).max(1),
  totalLatencyMs: z.number().nonnegative(),
  totalToolCalls: z.number().int().nonnegative(),
  nodeTransitions: z.array(z.string()),
  planDiffSummary: z.array(z.string()),
  artifactPaths: z.object({
    caseResult: z.string(),
  }),
  expectationResults: z.array(expectationResultSchema),
  scorerResults: z.array(scorerResultSchema),
  benchmarkMetrics: benchmarkMetricsSchema.optional(),
  timing: caseTimingSchema.optional(),
  judgeMetrics: caseJudgeMetricsSchema.optional(),
  /**
   * Packet O2 uncertain execution. An aborted HTTP request does not prove
   * Lambda stopped: the case is marked uncertain, never silently retried or
   * restored over a possibly active mutation.
   */
  executionUncertain: z.boolean().optional(),
  turns: z.array(evalTurnResultSchema),
  startedAt: z.string(),
  completedAt: z.string(),
});
export type EvalResult = z.infer<typeof evalResultSchema>;

const evalAggregateSummarySchema = z.object({
  key: z.string(),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  erroredCases: z.number().int().nonnegative(),
  skippedCases: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(1),
  averageLatencyMs: z.number().nonnegative(),
});
export type EvalAggregateSummary = z.infer<typeof evalAggregateSummarySchema>;

const flakyCandidateSchema = z.object({
  caseId: z.string(),
  suite: z.string(),
  statuses: z.array(z.string()),
  configLabels: z.array(z.string()),
  targets: z.array(evalTargetModeSchema),
});
export type EvalFlakyCandidate = z.infer<typeof flakyCandidateSchema>;

const benchmarkSummarySchema = z.object({
  avg_tool_precision: z.number().min(0).max(1),
  avg_tool_recall: z.number().min(0).max(1),
  avg_tool_f1: z.number().min(0).max(1),
  avg_branch_coverage: z.number().min(0).max(1),
  avg_state_expectation_pass_rate: z.number().min(0).max(1),
  avg_trajectory_expectation_pass_rate: z.number().min(0).max(1),
  avg_plan_persistence_rate: z.number().min(0).max(1),
  avg_cache_hit_rate: z.number().min(0).max(1),
  total_tokens: z.number().int().nonnegative(),
  /** Packet O3: summed token accounting (never averaged percentages). */
  total_input_tokens: z.number().int().nonnegative().optional(),
  total_cached_input_tokens: z.number().int().nonnegative().optional(),
  total_cache_write_input_tokens: z.number().int().nonnegative().optional(),
  total_uncached_input_tokens: z.number().int().nonnegative().optional(),
});
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>;

export const evalArtifactResultSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  suite: z.string(),
  target: evalTargetModeSchema,
  configLabel: z.string(),
  status: z.enum(['passed', 'failed', 'errored', 'skipped']),
  hardGatePassed: z.boolean(),
  /** Packet O5 primary failure reason; omitted on passed/skipped results. */
  primaryFailureReason: z.enum([
    'product_effect_identity',
    'product_fact_completeness',
    'unnecessary_interaction',
    'evaluator_defect',
    'infrastructure_error',
  ]).optional(),
  finalScore: z.number().min(0).max(1),
  totalLatencyMs: z.number().nonnegative(),
  totalToolCalls: z.number().int().nonnegative(),
  nodeTransitions: z.array(z.string()),
  planDiffSummary: z.array(z.string()),
  artifactPaths: z.object({
    caseResult: z.string(),
  }),
  expectationResults: z.array(expectationResultSchema),
  scorerResults: z.array(scorerResultSchema),
  benchmarkMetrics: benchmarkMetricsSchema.optional(),
  timing: caseTimingSchema.optional(),
  judgeMetrics: caseJudgeMetricsSchema.optional(),
  turns: z.array(evalArtifactTurnResultSchema),
  startedAt: z.string(),
  completedAt: z.string(),
});

export const evalReportSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  erroredCases: z.number().int().nonnegative(),
  skippedCases: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(1),
  averageLatencyMs: z.number().nonnegative(),
  suiteSummaries: z.array(evalAggregateSummarySchema),
  configSummaries: z.array(evalAggregateSummarySchema),
  targetSummaries: z.array(evalAggregateSummarySchema),
  flakyCandidates: z.array(flakyCandidateSchema),
  benchmarkSummary: benchmarkSummarySchema.optional(),
  /**
   * Packet O2 completion. A SIGINT/deadline/contamination stop produces an
   * incomplete red report with the reason explicit; a diagnostic resume is
   * labeled diagnostic and can never authorize promotion as a clean gate.
   */
  completion: z.object({
    complete: z.boolean(),
    reason: z.string().nullable(),
    resumeMode: z.enum(['full', 'diagnostic']),
  }).optional(),
  /** Packet O2/O3 run-level timing and judge accounting. */
  timingSummary: z.object({
    makespanMs: z.number().nonnegative(),
  }).passthrough().optional(),
  judgeSummary: z.object({
    modelCalls: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    rateLimitCount: z.number().int().nonnegative(),
  }).passthrough().optional(),
  results: z.array(evalArtifactResultSchema),
});
export type EvalArtifactResult = z.infer<typeof evalArtifactResultSchema>;
export type EvalReport = z.infer<typeof evalReportSchema>;

export type PartialPlanSeed = z.infer<ReturnType<typeof planSchema.partial>>;
export type EvalTurnTrace = z.infer<typeof turnTraceSchema>;
export type LambdaTurnResponse = z.infer<typeof lambdaTurnResponseSchema>;
export type OfflineFixture = z.infer<typeof offlineFixtureSchema>;
export type EvalPlanSnapshot = PlanSnapshot;
