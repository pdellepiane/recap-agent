import type { DecisionNode } from '../core/decision-nodes';
import type { ActionIntent, PersistedPlan } from '../core/plan';
import type { ProviderSummary } from '../core/provider';
import type { ToolName } from './prompt-manifest';

export type PlanCapabilities = {
  hasActivePlan: boolean;
  hasSearchReadyNeed: boolean;
  hasShortlist: boolean;
  hasSelection: boolean;
  hasCompleteContact: boolean;
  canClose: boolean;
  canPause: boolean;
  canFinish: boolean;
};

export type DynamicAgentPolicy = {
  capabilities: PlanCapabilities;
  allowedActionIntents: readonly ActionIntent[];
  allowedNextNodes: readonly DecisionNode[];
};

const baseActionIntents = [
  'elicitar_necesidades',
  'buscar_proveedores',
  'solicitar_humano',
  'responder_invitacion',
] as const satisfies readonly ActionIntent[];

const baseNextNodes = [
  'contacto_inicial',
  'deteccion_intencion',
  'existe_plan_guardado',
  'entrevista',
  'elicitacion_necesidades',
  'minimos_para_buscar',
  'aclarar_pedir_faltante',
  'usuario_responde',
  'ofrecer_agente_humano',
  'solicitar_agente_humano',
  'informar_error_reintento',
  'reintentar',
  'resolver_consultas_informativas',
  'responder_invitacion',
] as const satisfies readonly DecisionNode[];

export function derivePlanCapabilities(plan: PersistedPlan): PlanCapabilities {
  const activeNeeds = plan.provider_needs.filter((need) => need.status !== 'deferred');
  const hasActivePlan = plan.lifecycle_state === 'active' && plan.provider_needs.length > 0;
  const hasSearchReadyNeed = activeNeeds.some(
    (need) => need.status === 'search_ready' || need.missing_fields.length === 0,
  );
  const hasShortlist = activeNeeds.some(
    (need) =>
      need.status === 'shortlisted' ||
      need.status === 'selected' ||
      need.recommended_provider_ids.length > 0 ||
      need.recommended_providers.length > 0,
  );
  const hasSelection = activeNeeds.some(
    (need) => need.selected_provider_ids.length > 0,
  );
  const hasCompleteContact = Boolean(
    plan.contact_name?.trim() &&
    plan.contact_email?.trim() &&
    plan.contact_phone?.trim(),
  );
  const canClose = hasActivePlan;
  const canPause = hasActivePlan;

  return {
    hasActivePlan,
    hasSearchReadyNeed,
    hasShortlist,
    hasSelection,
    hasCompleteContact,
    canClose,
    canPause,
    canFinish: canClose && hasSelection && hasCompleteContact,
  };
}

export function deriveDynamicAgentPolicy(plan: PersistedPlan): DynamicAgentPolicy {
  const capabilities = derivePlanCapabilities(plan);
  const allowedActionIntents: ActionIntent[] = [...baseActionIntents];
  const allowedNextNodes: DecisionNode[] = [...baseNextNodes];

  if (capabilities.hasActivePlan) {
    allowedActionIntents.push(
      'modificar_plan_proveedores',
      'retomar_plan',
      'refinar_busqueda',
    );
    allowedNextNodes.push(
      'buscar_proveedores',
      'busqueda_exitosa',
      'hay_resultados',
      'refinar_criterios',
      'seguir_refinando_guardar_plan',
      'continua',
    );
  }

  if (capabilities.hasSearchReadyNeed) {
    allowedNextNodes.push('buscar_proveedores', 'busqueda_exitosa', 'hay_resultados', 'recomendar');
  }

  if (capabilities.hasShortlist) {
    allowedActionIntents.push(
      'ver_opciones',
      'confirmar_proveedor',
      'explicar_recomendacion',
      'detallar_proveedor',
    );
    allowedNextNodes.push(
      'recomendar',
      'usuario_elige_proveedor',
      'anadir_a_proveedores_recomendados',
      'accion_final_exitosa',
    );
  }

  if (capabilities.hasSelection) {
    allowedNextNodes.push('necesidad_cubierta');
  }

  if (capabilities.canClose) {
    allowedActionIntents.push('cerrar');
    allowedNextNodes.push('crear_lead_cerrar');
  }

  if (capabilities.canPause) {
    allowedActionIntents.push('pausar');
    allowedNextNodes.push(
      'guardar_seleccion_reintentar_luego',
      'guardar_cerrar_temporalmente',
    );
  }

  return {
    capabilities,
    allowedActionIntents: Array.from(new Set(allowedActionIntents)),
    allowedNextNodes: Array.from(new Set(allowedNextNodes)),
  };
}

export function resolveDynamicTools(args: {
  plan: PersistedPlan;
  maximumTools: readonly ToolName[];
  searchReady: boolean;
  providerResults: readonly ProviderSummary[];
}): ToolName[] {
  const capabilities = derivePlanCapabilities(args.plan);
  const hasKnownProvider =
    args.providerResults.length > 0 ||
    args.plan.provider_needs.some((need) => need.recommended_providers.length > 0);
  const searchTools = new Set<ToolName>([
    'search_providers_from_plan',
    'search_providers_by_keyword',
    'search_providers_by_category_location',
    'search_providers_by_query_intent',
    'get_relevant_providers',
  ]);
  const providerInspectionTools = new Set<ToolName>([
    'get_provider_detail',
    'get_provider_detail_and_track_view',
    'get_related_providers',
    'list_provider_reviews',
  ]);

  return args.maximumTools.filter((toolName) => {
    if (searchTools.has(toolName)) {
      return capabilities.hasActivePlan && args.searchReady;
    }
    if (providerInspectionTools.has(toolName)) {
      return hasKnownProvider;
    }
    if (toolName === 'add_vendor_to_event_favorites') {
      return capabilities.hasShortlist || capabilities.hasSelection;
    }
    if (toolName === 'create_quote_request' || toolName === 'finish_plan') {
      return capabilities.canFinish;
    }
    if (toolName === 'create_provider_review') {
      return capabilities.hasSelection || args.plan.lifecycle_state === 'finished';
    }
    return true;
  });
}
