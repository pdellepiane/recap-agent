import type { DecisionNode } from '../core/decision-nodes';
import type { ExtractionCapabilityProfile } from './extraction-schemas';
import type { PlanOwner } from '../core/plan';
import { ownerLabels } from '../core/plan';

export const conversationSharedPromptFiles = [
  'shared/base_system.txt',
  'shared/agent_personality.txt',
  'shared/domain_scope.txt',
  'shared/domain_knowledge.txt',
  'shared/output_style.txt',
  'shared/flow_discipline.txt',
  'shared/question_strategy.txt',
  'shared/common_anti_patterns.txt',
] as const;

const conversationCorePromptFiles = [
  'shared/base_system.txt',
  'shared/agent_personality.txt',
  'shared/output_style.txt',
  'shared/common_anti_patterns.txt',
] as const;

const conversationPlanningPromptFiles = [
  'shared/domain_scope.txt',
  'shared/domain_knowledge.txt',
  'shared/flow_discipline.txt',
] as const;

const planningNodes = new Set<DecisionNode>([
  'existe_plan_guardado',
  'reset_plan',
  'entrevista',
  'elicitacion_necesidades',
  'minimos_para_buscar',
  'aclarar_pedir_faltante',
  'usuario_responde',
  'buscar_proveedores',
  'busqueda_exitosa',
  'hay_resultados',
  'recomendar',
  'refinar_criterios',
  'usuario_elige_proveedor',
  'anadir_a_proveedores_recomendados',
  'seguir_refinando_guardar_plan',
  'continua',
  'accion_final_exitosa',
  'necesidad_cubierta',
  'crear_lead_cerrar',
  'guardar_seleccion_reintentar_luego',
  'guardar_cerrar_temporalmente',
  'reintentar',
]);

const questionStrategyNodes = new Set<DecisionNode>([
  'entrevista',
  'elicitacion_necesidades',
  'minimos_para_buscar',
  'aclarar_pedir_faltante',
  'usuario_responde',
  'refinar_criterios',
]);

export { ownerLabels };
export type { PlanOwner };

/**
 * L4 owner-to-node map. Planning owns the event-provider interview and
 * close flow; General information (FAQ) owns public information answers;
 * Customer operations owns invitation responses plus person-specific
 * purchase, RSVP, auth and support work. The informative node is shared:
 * it belongs to FAQ only when general information is the primary task,
 * otherwise the Customer operations snapshot serves it.
 */
export const ownerNodeSets: Record<PlanOwner, readonly DecisionNode[]> = {
  planning: [
    'existe_plan_guardado',
    'reset_plan',
    'entrevista',
    'elicitacion_necesidades',
    'minimos_para_buscar',
    'aclarar_pedir_faltante',
    'usuario_responde',
    'buscar_proveedores',
    'busqueda_exitosa',
    'hay_resultados',
    'recomendar',
    'refinar_criterios',
    'usuario_elige_proveedor',
    'anadir_a_proveedores_recomendados',
    'seguir_refinando_guardar_plan',
    'continua',
    'accion_final_exitosa',
    'necesidad_cubierta',
    'crear_lead_cerrar',
    'guardar_seleccion_reintentar_luego',
    'guardar_cerrar_temporalmente',
    'reintentar',
  ],
  faq: ['resolver_consultas_informativas'],
  customer_assistance: ['responder_invitacion', 'resolver_consultas_informativas'],
};

export function ownerForNode(node: DecisionNode, primaryTask: PlanOwner | null = null): PlanOwner {
  if (node === 'responder_invitacion') {
    return 'customer_assistance';
  }
  if (node === 'resolver_consultas_informativas') {
    return primaryTask ?? 'faq';
  }
  if (
    node === 'contacto_inicial' ||
    node === 'deteccion_intencion' ||
    node === 'ofrecer_agente_humano' ||
    node === 'solicitar_agente_humano' ||
    node === 'informar_error_reintento'
  ) {
    return 'planning';
  }
  return ownerNodeSets.planning.includes(node) ? 'planning' : 'planning';
}

export function conversationPromptFilesForNode(node: DecisionNode): readonly string[] {
  return [
    ...conversationCorePromptFiles,
    ...(planningNodes.has(node) ? conversationPlanningPromptFiles : []),
    ...(questionStrategyNodes.has(node) ? ['shared/question_strategy.txt'] : []),
  ];
}

export function promptRuleIdForFile(relativePath: string): string {
  return `prompt.${relativePath
    .replace(/\.(txt|md)$/u, '')
    .replaceAll('/', '.')}`;
}

export const extractorPromptFiles = [
  'extractors/base_system.txt',
  'extractors/planning.txt',
  'extractors/information.txt',
  'extractors/rsvp.txt',
  'extractors/provider_management.txt',
  'extractors/contact.txt',
  'extractors/close_pause.txt',
  'extractors/capability_boundary.txt',
] as const;

export const responseClassifierPromptFiles = {
  general: ['nodes/deteccion_intencion/response_classifier.txt'],
  campaign_reply: ['nodes/deteccion_intencion/response_classifier_campaign.txt'],
} as const;

export function extractorPromptFilesForCapabilities(
  capabilities: ExtractionCapabilityProfile,
): readonly string[] {
  return [
    'extractors/base_system.txt',
    ...(capabilities.providerPlanning ? ['extractors/planning.txt'] : []),
    ...(capabilities.information
      ? ['extractors/information.txt']
      : []),
    ...(capabilities.rsvp ? ['extractors/rsvp.txt'] : []),
    ...(capabilities.providerOperations ||
      capabilities.providerSelection ||
      capabilities.providerInspection
      ? ['extractors/provider_management.txt']
      : []),
    ...(capabilities.contact ? ['extractors/contact.txt'] : []),
    ...(capabilities.close || capabilities.pause
      ? ['extractors/close_pause.txt']
      : []),
    ...(capabilities.capabilityBoundary === true
      ? ['extractors/capability_boundary.txt']
      : []),
  ];
}

export const toolNames = [
  'list_categories',
  'get_category_by_slug',
  'list_locations',
  'search_providers_from_plan',
  'search_providers_by_keyword',
  'search_providers_by_category_location',
  'search_providers_by_query_intent',
  'get_relevant_providers',
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
  'finish_plan',
] as const;

export type ToolName = (typeof toolNames)[number];

export type NodePromptConfig = {
  files: readonly string[];
  allowedTools: readonly ToolName[];
};

function buildNodeFiles(node: DecisionNode): readonly string[] {
  return [
    `nodes/${node}/system.txt`,
    `nodes/${node}/response_contract.txt`,
    `nodes/${node}/tool_policy.txt`,
  ];
}

export const nodePromptManifest: Record<DecisionNode, NodePromptConfig> = {
  contacto_inicial: {
    files: buildNodeFiles('contacto_inicial'),
    allowedTools: [],
  },
  deteccion_intencion: {
    files: buildNodeFiles('deteccion_intencion'),
    allowedTools: [],
  },
  existe_plan_guardado: {
    files: buildNodeFiles('existe_plan_guardado'),
    allowedTools: [
      'get_event_vendor_context',
      'list_event_favorite_providers',
      'list_user_events_vendor_context',
    ],
  },
  reset_plan: {
    files: buildNodeFiles('reset_plan'),
    allowedTools: [],
  },
  entrevista: {
    files: buildNodeFiles('entrevista'),
    allowedTools: ['list_categories', 'get_category_by_slug', 'list_locations'],
  },
  elicitacion_necesidades: {
    files: buildNodeFiles('elicitacion_necesidades'),
    allowedTools: ['get_provider_detail', 'list_provider_reviews'],
  },
  minimos_para_buscar: {
    files: buildNodeFiles('minimos_para_buscar'),
    allowedTools: [],
  },
  aclarar_pedir_faltante: {
    files: buildNodeFiles('aclarar_pedir_faltante'),
    allowedTools: ['list_categories', 'get_category_by_slug', 'list_locations'],
  },
  usuario_responde: {
    files: buildNodeFiles('usuario_responde'),
    allowedTools: [],
  },
  buscar_proveedores: {
    files: buildNodeFiles('buscar_proveedores'),
    allowedTools: [
      'search_providers_from_plan',
      'search_providers_by_keyword',
      'search_providers_by_category_location',
      'get_relevant_providers',
    ],
  },
  busqueda_exitosa: {
    files: buildNodeFiles('busqueda_exitosa'),
    allowedTools: [],
  },
  hay_resultados: {
    files: buildNodeFiles('hay_resultados'),
    allowedTools: [],
  },
  recomendar: {
    files: buildNodeFiles('recomendar'),
    allowedTools: [
      'get_provider_detail',
      'get_related_providers',
      'list_provider_reviews',
    ],
  },
  refinar_criterios: {
    files: buildNodeFiles('refinar_criterios'),
    allowedTools: ['list_categories', 'get_category_by_slug', 'list_locations'],
  },
  usuario_elige_proveedor: {
    files: buildNodeFiles('usuario_elige_proveedor'),
    allowedTools: ['get_provider_detail', 'get_provider_detail_and_track_view'],
  },
  anadir_a_proveedores_recomendados: {
    files: buildNodeFiles('anadir_a_proveedores_recomendados'),
    allowedTools: ['add_vendor_to_event_favorites'],
  },
  seguir_refinando_guardar_plan: {
    files: buildNodeFiles('seguir_refinando_guardar_plan'),
    allowedTools: ['get_provider_detail'],
  },
  continua: {
    files: buildNodeFiles('continua'),
    allowedTools: [],
  },
  accion_final_exitosa: {
    files: buildNodeFiles('accion_final_exitosa'),
    allowedTools: ['create_provider_review'],
  },
  necesidad_cubierta: {
    files: buildNodeFiles('necesidad_cubierta'),
    allowedTools: [],
  },
  crear_lead_cerrar: {
    files: buildNodeFiles('crear_lead_cerrar'),
    allowedTools: ['finish_plan'],
  },
  guardar_seleccion_reintentar_luego: {
    files: buildNodeFiles('guardar_seleccion_reintentar_luego'),
    allowedTools: [],
  },
  guardar_cerrar_temporalmente: {
    files: buildNodeFiles('guardar_cerrar_temporalmente'),
    allowedTools: [],
  },
  ofrecer_agente_humano: {
    files: buildNodeFiles('ofrecer_agente_humano'),
    allowedTools: [],
  },
  solicitar_agente_humano: {
    files: buildNodeFiles('solicitar_agente_humano'),
    allowedTools: [],
  },
  informar_error_reintento: {
    files: buildNodeFiles('informar_error_reintento'),
    allowedTools: [],
  },
  reintentar: {
    files: buildNodeFiles('reintentar'),
    allowedTools: [
      'search_providers_from_plan',
      'search_providers_by_keyword',
      'search_providers_by_category_location',
      'get_relevant_providers',
    ],
  },
  resolver_consultas_informativas: {
    files: buildNodeFiles('resolver_consultas_informativas'),
    allowedTools: [],
  },
  responder_invitacion: {
    files: buildNodeFiles('responder_invitacion'),
    allowedTools: [],
  },
};

/**
 * G1 composable instruction-module registry. Each module maps to exact
 * tracked prompt files (or no files for evidence-only modules) plus the
 * typed stages, owners and task kinds that may include it. Applicability
 * logic lives in model-request-projector.ts; this registry stays data.
 * prompt-loader.ts remains text-load/cache only.
 */
export const instructionModuleIds = [
  'shared_invariants',
  'extraction_cross_domain',
  'extraction_information',
  'extraction_rsvp',
  'extraction_planning',
  'extraction_contact',
  'extraction_provider_management',
  'extraction_close_pause',
  'reply_planning_owner',
  'reply_purchase_facts',
  'reply_venue_facts',
  'reply_rsvp_facts',
  'reply_faq_policy',
  'reply_handoff_outcome',
  'reply_auth_limitation',
  'reply_image_context',
  'reply_approval_boundary',
  'reply_support_continuity',
  'reply_wait_followup',
  'reply_gift_fulfillment',
] as const;

export type InstructionModuleId = (typeof instructionModuleIds)[number];

export type InstructionModuleStage = 'extraction' | 'reply';

export type InstructionModuleOwner = 'planning' | 'faq' | 'customer_assistance' | 'unknown';

export type InstructionModuleTask =
  | 'purchase'
  | 'venue'
  | 'rsvp'
  | 'faq_policy'
  | 'handoff'
  | 'auth'
  | 'image'
  | 'planning'
  | 'wait_followup';

export type InstructionModuleMetadata = {
  /** Exact tracked prompt files; empty means evidence-only (facts, no prose). */
  readonly files: readonly string[];
  readonly stages: readonly InstructionModuleStage[];
  readonly owners: readonly InstructionModuleOwner[];
  readonly tasks: readonly InstructionModuleTask[];
  /** Exact production consumer of this module. */
  readonly consumer: string;
};

export const instructionModuleRegistry: Record<InstructionModuleId, InstructionModuleMetadata> = {
  shared_invariants: {
    files: [
      'shared/base_system.txt',
      'shared/agent_personality.txt',
      'shared/output_style.txt',
      'shared/common_anti_patterns.txt',
    ],
    stages: ['extraction', 'reply'],
    owners: ['planning', 'faq', 'customer_assistance', 'unknown'],
    tasks: ['purchase', 'venue', 'rsvp', 'faq_policy', 'handoff', 'auth', 'image', 'planning'],
    consumer: 'openai-agent-runtime extract/composeReply (every model call)',
  },
  extraction_cross_domain: {
    files: ['extractors/base_system.txt', 'extractors/capability_boundary.txt'],
    stages: ['extraction'],
    owners: ['planning', 'faq', 'customer_assistance', 'unknown'],
    tasks: ['purchase', 'venue', 'rsvp', 'faq_policy', 'handoff', 'auth', 'image', 'planning'],
    consumer: 'openai-agent-runtime extract (all lanes)',
  },
  extraction_information: {
    files: ['extractors/information.txt', 'nodes/resolver_consultas_informativas/auth_control.txt'],
    stages: ['extraction'],
    owners: ['faq', 'customer_assistance', 'unknown'],
    tasks: ['purchase', 'venue', 'faq_policy', 'auth', 'image'],
    consumer: 'openai-agent-runtime extract (unknown + information lanes; auth_control carries extraction-decision guidance only)',
  },
  extraction_rsvp: {
    files: ['extractors/rsvp.txt'],
    stages: ['extraction'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['rsvp', 'venue'],
    consumer: 'openai-agent-runtime extract (unknown + RSVP lanes)',
  },
  extraction_planning: {
    files: ['extractors/planning.txt'],
    stages: ['extraction'],
    owners: ['planning', 'unknown'],
    tasks: ['planning'],
    consumer: 'openai-agent-runtime extract (unknown owner + planning lanes only; compact recognition)',
  },
  extraction_contact: {
    files: ['extractors/contact.txt'],
    stages: ['extraction'],
    owners: ['planning', 'faq', 'customer_assistance', 'unknown'],
    tasks: ['purchase', 'venue', 'faq_policy', 'planning'],
    consumer: 'openai-agent-runtime extract (established support lanes + transient turns with planning detail only)',
  },
  extraction_provider_management: {
    files: ['extractors/provider_management.txt'],
    stages: ['extraction'],
    owners: ['planning', 'unknown'],
    tasks: ['planning'],
    consumer: 'openai-agent-runtime extract (transient turns with active plan or shortlist only)',
  },
  extraction_close_pause: {
    files: ['extractors/close_pause.txt'],
    stages: ['extraction'],
    owners: ['planning', 'unknown'],
    tasks: ['planning'],
    consumer: 'openai-agent-runtime extract (transient turns with active plan or shortlist only)',
  },
  reply_planning_owner: {
    files: [
      'shared/domain_scope.txt',
      'shared/domain_knowledge.txt',
      'shared/flow_discipline.txt',
      'shared/question_strategy.txt',
    ],
    stages: ['reply'],
    owners: ['planning'],
    tasks: ['planning'],
    consumer: 'openai-agent-runtime composeReply (planning nodes only)',
  },
  reply_purchase_facts: {
    files: [],
    stages: ['reply'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['purchase'],
    consumer: 'openai-agent-runtime composeReply (purchase evidence, no prose)',
  },
  reply_venue_facts: {
    files: [],
    stages: ['reply'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['venue'],
    consumer: 'openai-agent-runtime composeReply (venue evidence, no prose)',
  },
  reply_rsvp_facts: {
    files: [],
    stages: ['reply'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['rsvp'],
    consumer: 'openai-agent-runtime composeReply (RSVP evidence, no prose)',
  },
  reply_faq_policy: {
    files: [],
    stages: ['reply'],
    owners: ['faq', 'customer_assistance', 'unknown'],
    tasks: ['faq_policy'],
    consumer: 'knowledge retrieval projection (source-backed policy facts only)',
  },
  reply_handoff_outcome: {
    files: [
      'nodes/solicitar_agente_humano/system.txt',
      'nodes/solicitar_agente_humano/response_contract.txt',
    ],
    stages: ['reply'],
    owners: ['faq', 'customer_assistance', 'unknown', 'planning'],
    tasks: ['handoff'],
    consumer: 'agent-service handoff paths (actual outcome only)',
  },
  reply_auth_limitation: {
    files: ['nodes/resolver_consultas_informativas/auth_limitation.txt'],
    stages: ['reply'],
    owners: ['faq', 'customer_assistance', 'unknown', 'planning'],
    tasks: ['auth'],
    consumer: 'agent-service auth terminal paths (validated terminal/declined/scoped-miss outcome only; never venue/purchase reads)',
  },
  reply_image_context: {
    files: ['nodes/resolver_consultas_informativas/image_limits.txt'],
    stages: ['reply'],
    owners: ['faq', 'customer_assistance', 'unknown', 'planning'],
    tasks: ['image'],
    consumer: 'openai-agent-runtime composeReply (native image evidence plus resend/URL/description limits, no inspection prose)',
  },
  reply_approval_boundary: {
    files: ['nodes/resolver_consultas_informativas/approval_limits.txt'],
    stages: ['reply'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['purchase'],
    consumer: 'openai-agent-runtime composeReply (purchase validation/payment-status boundary only; receipt never proves approval)',
  },
  reply_support_continuity: {
    files: ['nodes/resolver_consultas_informativas/support_continuity.txt'],
    stages: ['reply'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['purchase', 'venue', 'rsvp', 'faq_policy', 'handoff', 'auth', 'image'],
    consumer: 'agent-service support continuity (pending task + prior answer only; never auth outcomes)',
  },
  reply_wait_followup: {
    files: ['nodes/resolver_consultas_informativas/wait_followup.txt'],
    stages: ['reply'],
    owners: ['planning', 'faq', 'customer_assistance', 'unknown'],
    tasks: ['wait_followup'],
    consumer: 'openai-agent-runtime composeReply (waited turn behind a fresh prior reply; extend only with new information, never resend)',
  },
  reply_gift_fulfillment: {
    files: ['nodes/resolver_consultas_informativas/gift_fulfillment.txt'],
    stages: ['reply'],
    owners: ['customer_assistance', 'unknown'],
    tasks: ['purchase'],
    consumer: 'openai-agent-runtime composeReply (purchase turns with gift fulfillment evidence only; natural business meaning, no internal code citations)',
  },
};
