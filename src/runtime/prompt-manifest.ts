import type { DecisionNode } from '../core/decision-nodes';

export const conversationSharedPromptFiles = [
  'shared/base_system.txt',
  'shared/domain_scope.txt',
  'shared/output_style.txt',
  'shared/flow_discipline.txt',
  'shared/question_strategy.txt',
  'shared/common_anti_patterns.txt',
] as const;

export const extractorPromptFiles = [
  'extractors/system.txt',
  'extractors/field_definitions.txt',
  'extractors/conflict_resolution.txt',
  'extractors/normalization_rules.txt',
  'extractors/examples.md',
] as const;

export const toolNames = [
  'list_categories',
  'list_locations',
  'search_providers',
  'get_provider_detail',
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
    `nodes/${node}/transition_policy.txt`,
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
    allowedTools: [],
  },
  entrevista: {
    files: buildNodeFiles('entrevista'),
    allowedTools: ['list_categories', 'list_locations'],
  },
  minimos_para_buscar: {
    files: buildNodeFiles('minimos_para_buscar'),
    allowedTools: [],
  },
  aclarar_pedir_faltante: {
    files: buildNodeFiles('aclarar_pedir_faltante'),
    allowedTools: ['list_categories', 'list_locations'],
  },
  usuario_responde: {
    files: buildNodeFiles('usuario_responde'),
    allowedTools: [],
  },
  buscar_proveedores: {
    files: buildNodeFiles('buscar_proveedores'),
    allowedTools: ['search_providers'],
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
    allowedTools: ['get_provider_detail'],
  },
  refinar_criterios: {
    files: buildNodeFiles('refinar_criterios'),
    allowedTools: ['list_categories', 'list_locations'],
  },
  usuario_elige_proveedor: {
    files: buildNodeFiles('usuario_elige_proveedor'),
    allowedTools: ['get_provider_detail'],
  },
  anadir_a_proveedores_recomendados: {
    files: buildNodeFiles('anadir_a_proveedores_recomendados'),
    allowedTools: [],
  },
  seguir_refinando_guardar_plan: {
    files: buildNodeFiles('seguir_refinando_guardar_plan'),
    allowedTools: [],
  },
  continua: {
    files: buildNodeFiles('continua'),
    allowedTools: [],
  },
  accion_final_exitosa: {
    files: buildNodeFiles('accion_final_exitosa'),
    allowedTools: [],
  },
  necesidad_cubierta: {
    files: buildNodeFiles('necesidad_cubierta'),
    allowedTools: [],
  },
  crear_lead_cerrar: {
    files: buildNodeFiles('crear_lead_cerrar'),
    allowedTools: [],
  },
  guardar_seleccion_reintentar_luego: {
    files: buildNodeFiles('guardar_seleccion_reintentar_luego'),
    allowedTools: [],
  },
  guardar_cerrar_temporalmente: {
    files: buildNodeFiles('guardar_cerrar_temporalmente'),
    allowedTools: [],
  },
  informar_error_reintento: {
    files: buildNodeFiles('informar_error_reintento'),
    allowedTools: [],
  },
  reintentar: {
    files: buildNodeFiles('reintentar'),
    allowedTools: [],
  },
};
