import type { EvalTurnResult } from './case-schema';

export type TurnClass =
  | 'recommendation'
  | 'factual_faq'
  | 'conversational_orchestration'
  | 'action_confirmation';

export type GroundingAssessment = {
  turnClass: TurnClass;
  groundingRequired: boolean;
  grounded: boolean | null;
  providerCount: number;
  verifiedProviderCount: number;
  unsupportedProviderIds: number[];
  attributeMismatches: number;
};

export function assessGrounding(turn: EvalTurnResult): GroundingAssessment {
  const turnClass = classifyTurn(turn);
  if (turnClass === 'recommendation') {
    const evidenceById = new Map(
      turn.trace.provider_candidate_audit.map((entry) => [entry.provider_id, entry]),
    );
    const unsupportedProviderIds: number[] = [];
    let verifiedProviderCount = 0;
    let attributeMismatches = 0;
    for (const provider of turn.trace.provider_results) {
      const evidence = evidenceById.get(provider.id);
      if (!evidence) {
        unsupportedProviderIds.push(provider.id);
        continue;
      }
      const categoryMatches =
        !provider.category || !evidence.category || provider.category === evidence.category;
      const locationMatches =
        !provider.location || !evidence.location || provider.location === evidence.location;
      if (!categoryMatches || !locationMatches) {
        attributeMismatches += 1;
        continue;
      }
      verifiedProviderCount += 1;
    }
    return {
      turnClass,
      groundingRequired: true,
      grounded:
        turn.trace.provider_results.length > 0 &&
        verifiedProviderCount === turn.trace.provider_results.length,
      providerCount: turn.trace.provider_results.length,
      verifiedProviderCount,
      unsupportedProviderIds,
      attributeMismatches,
    };
  }

  if (turnClass === 'factual_faq') {
    const faq = turn.trace.faq_resolution_summary;
    return {
      turnClass,
      groundingRequired: true,
      grounded: faq.file_search_called && faq.file_search_output_count > 0,
      providerCount: 0,
      verifiedProviderCount: 0,
      unsupportedProviderIds: [],
      attributeMismatches: 0,
    };
  }

  return {
    turnClass,
    groundingRequired: false,
    grounded: null,
    providerCount: 0,
    verifiedProviderCount: 0,
    unsupportedProviderIds: [],
    attributeMismatches: 0,
  };
}

function classifyTurn(turn: EvalTurnResult): TurnClass {
  if (
    turn.trace.provider_results.length > 0 ||
    turn.trace.next_node === 'recomendar'
  ) {
    return 'recommendation';
  }
  if (turn.trace.faq_resolution_summary.is_faq_turn) {
    return 'factual_faq';
  }
  if (
    turn.trace.next_node === 'crear_lead_cerrar' ||
    turn.trace.next_node === 'accion_final_exitosa' ||
    turn.trace.close_action_summary.type !== null
  ) {
    return 'action_confirmation';
  }
  return 'conversational_orchestration';
}
