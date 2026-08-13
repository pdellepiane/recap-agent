import type { DecisionNode } from '../core/decision-nodes';
import type { ExtractionCapabilityProfile } from './extraction-schemas';

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
  'extractors/provider_management.txt',
  'extractors/contact.txt',
  'extractors/close_pause.txt',
] as const;

export function extractorPromptFilesForCapabilities(
  capabilities: ExtractionCapabilityProfile,
): readonly string[] {
  return [
    'extractors/base_system.txt',
    ...(capabilities.providerPlanning ? ['extractors/planning.txt'] : []),
    ...(capabilities.information ? ['extractors/information.txt'] : []),
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
