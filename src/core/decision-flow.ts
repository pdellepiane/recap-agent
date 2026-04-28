import type { DecisionNode } from './decision-nodes';
import { isDecisionNode } from './decision-nodes';
import { getActiveNeed, type PersistedPlan } from './plan';

const LEAD_CLOSE_RESUME_NODE: DecisionNode = 'crear_lead_cerrar';

export function resolveResumeNode(plan: PersistedPlan): DecisionNode {
  if (plan.lifecycle_state === 'finished') {
    return 'necesidad_cubierta';
  }

  if (isDecisionNode(plan.current_node) && plan.current_node === LEAD_CLOSE_RESUME_NODE) {
    return LEAD_CLOSE_RESUME_NODE;
  }

  if (plan.current_node === 'guardar_cerrar_temporalmente') {
    return 'entrevista';
  }

  const activeNeed = getActiveNeed(plan);

  if (activeNeed?.selected_provider_id) {
    return 'seguir_refinando_guardar_plan';
  }

  if ((activeNeed?.recommended_provider_ids ?? []).length > 0) {
    return 'recomendar';
  }

  if ((plan.missing_fields ?? []).length > 0) {
    return 'entrevista';
  }

  return 'entrevista';
}
