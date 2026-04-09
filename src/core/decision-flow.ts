import type { DecisionNode } from './decision-nodes';
import { getActiveNeed, type PersistedPlan } from './plan';

export function resolveResumeNode(plan: PersistedPlan): DecisionNode {
  if (plan.current_node === 'guardar_cerrar_temporalmente') {
    return 'entrevista';
  }

  const activeNeed = getActiveNeed(plan);

  if (activeNeed?.selected_provider_id) {
    return 'usuario_elige_proveedor';
  }

  if ((activeNeed?.recommended_provider_ids ?? []).length > 0) {
    return 'recomendar';
  }

  if ((plan.missing_fields ?? []).length > 0) {
    return 'entrevista';
  }

  return 'entrevista';
}
