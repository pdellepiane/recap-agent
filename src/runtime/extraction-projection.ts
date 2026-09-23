import type { ActionIntent, PersistedPlan } from '../core/plan';
import {
  type RuntimeCapabilityManifest,
  type RuntimeOperationId,
} from './capability-manifest';
import { baseActionIntents, derivePlanCapabilities } from './dynamic-agent-policy';
import { createDynamicExtractionSchema, type ExtractionCapabilityProfile } from './extraction-schemas';
import { projectExtractionOperations } from './turn-capability-policy';

/**
 * S10 single owner of extraction projection.
 *
 * The same capability projection feeds the extractor schema and the textual
 * allowed actions. Inactive lane state never enters the profile, so its
 * schema fields and prompt files stay omitted for that turn.
 *
 * L3 established-lane narrowing: once typed plan state shows an established
 * purchase/support lane (information node with pending or completed
 * information work) or an established RSVP lane (invitation node or active
 * RSVP state), planning-only fields stay omitted from the profile. The
 * domain is derived from structured plan state only, never from message
 * keywords. Information and RSVP stays expressible in both lanes so
 * cross-domain continuations keep working; only planning/selection/close
 * fields narrow.
 */

export type EstablishedExtractionDomain = 'purchase' | 'support' | 'rsvp' | null;

export type ExtractionProjectionInput = {
  readonly plan: PersistedPlan;
  readonly manifest: RuntimeCapabilityManifest;
  readonly requestedDomain: string | null;
  readonly candidateOperations: readonly RuntimeOperationId[];
  readonly allowedActionIntents: readonly ActionIntent[];
};

export type ExtractionProjection = {
  readonly profile: ExtractionCapabilityProfile;
  readonly allowedActionIntents: readonly ActionIntent[];
  readonly allowedOperations: readonly RuntimeOperationId[];
  readonly textualAllowedActions: string;
  readonly schemaPropertyCount: number;
};

function manifestAvailable(
  manifest: RuntimeCapabilityManifest,
  operation: RuntimeOperationId,
): boolean {
  return manifest[operation].available === true;
}

/**
 * L3: established lane derived from typed plan state only. An information
 * lane with pending or completed information work is an established
 * purchase lane when a purchase/associated-event request is present and an
 * established support lane otherwise (faq, policy and follow-up turns).
 * An invitation node or active RSVP state is an established RSVP lane.
 * Anything else is transient: the full profile stays available so the
 * model can express a new planning, information or RSVP turn.
 */
export function deriveEstablishedExtractionDomain(
  plan: PersistedPlan,
): EstablishedExtractionDomain {
  const pending = plan.information_state.pending_requests ?? [];
  const lastCompleted = plan.information_state.last_completed_request ?? null;
  const hasRsvpState =
    plan.rsvp_state.status !== 'none' || plan.rsvp_state.pending_action != null;
  if (plan.current_node === 'responder_invitacion' || (plan.current_node !== 'resolver_consultas_informativas' && hasRsvpState)) {
    return 'rsvp';
  }
  const hasInformationWork =
    plan.current_node === 'resolver_consultas_informativas' ||
    pending.length > 0 ||
    lastCompleted != null;
  if (!hasInformationWork) {
    return null;
  }
  const hasPurchaseWork =
    pending.some(
      (request) => request.kind === 'purchase' || request.kind === 'associated_event',
    ) ||
    lastCompleted?.kind === 'purchase' ||
    lastCompleted?.kind === 'associated_event';
  return hasPurchaseWork ? 'purchase' : 'support';
}

function profileFromManifestAndPlan(
  plan: PersistedPlan,
  manifest: RuntimeCapabilityManifest,
): ExtractionCapabilityProfile {
  const lane = derivePlanCapabilities(plan);
  const established = deriveEstablishedExtractionDomain(plan);
  const laneNarrowed = established !== null;
  const information =
    manifestAvailable(manifest, 'faq.read') ||
    manifestAvailable(manifest, 'event.association.read') ||
    manifestAvailable(manifest, 'event.detail.read') ||
    manifestAvailable(manifest, 'purchase.orders.read') ||
    manifestAvailable(manifest, 'purchase.gift_detail.read');
  const rsvp =
    manifestAvailable(manifest, 'rsvp.state.read') ||
    manifestAvailable(manifest, 'rsvp.response.write');
  const providerPlanning =
    !laneNarrowed && manifestAvailable(manifest, 'provider.plan');
  const providerSearch = manifestAvailable(manifest, 'provider.search');
  return {
    information,
    rsvp,
    providerPlanning,
    providerOperations: !laneNarrowed && providerPlanning && lane.hasActivePlan,
    providerSelection: !laneNarrowed && providerSearch && lane.hasShortlist,
    providerInspection: !laneNarrowed && providerSearch && lane.hasShortlist,
    contact: information || lane.canClose,
    close: !laneNarrowed && lane.canClose && manifestAvailable(manifest, 'provider.quote.write'),
    pause: !laneNarrowed && lane.canPause && providerPlanning,
    capabilityBoundary: true,
  };
}

function intentAllowedByManifest(
  intent: ActionIntent,
  manifest: RuntimeCapabilityManifest,
  hasActivePlan: boolean,
  hasShortlist: boolean,
  canClose: boolean,
  canPause: boolean,
): boolean {
  switch (intent) {
    case 'responder_invitacion':
      return manifestAvailable(manifest, 'rsvp.state.read') ||
        manifestAvailable(manifest, 'rsvp.response.write');
    case 'solicitar_humano':
      return true;
    case 'reset_plan':
    case 'elicitar_necesidades':
    case 'buscar_proveedores':
      return manifestAvailable(manifest, 'provider.plan');
    case 'retomar_plan':
    case 'modificar_plan_proveedores':
    case 'refinar_busqueda':
      return manifestAvailable(manifest, 'provider.plan') && hasActivePlan;
    case 'ver_opciones':
    case 'confirmar_proveedor':
    case 'explicar_recomendacion':
    case 'detallar_proveedor':
      return manifestAvailable(manifest, 'provider.search') && hasShortlist;
    case 'cerrar':
      return manifestAvailable(manifest, 'provider.quote.write') && canClose;
    case 'pausar':
      return manifestAvailable(manifest, 'provider.plan') && canPause;
  }
}

export function projectExtraction(input: ExtractionProjectionInput): ExtractionProjection {
  const profile = profileFromManifestAndPlan(input.plan, input.manifest);
  const lane = derivePlanCapabilities(input.plan);
  // L3: established lanes use exactly the static base intents. Planning
  // progress (active plan, shortlist, close readiness) must not change the
  // emitted request: the intents stay byte-stable while the lane holds, and
  // cross-domain pivots stay expressible as intent-only signals whose
  // details the owning lane elicits next turn.
  const established = deriveEstablishedExtractionDomain(input.plan);
  const laneIntents = established === null
    ? input.allowedActionIntents
    : input.allowedActionIntents.filter((intent) =>
      (baseActionIntents as readonly ActionIntent[]).includes(intent),
    );
  const allowedActionIntents = laneIntents.filter((intent) =>
    intentAllowedByManifest(
      intent,
      input.manifest,
      lane.hasActivePlan,
      lane.hasShortlist,
      lane.canClose,
      lane.canPause,
    ),
  );
  const allowedOperations = projectExtractionOperations({
    requestedDomain: input.requestedDomain,
    candidateOperations: input.candidateOperations,
  }).filter((operation) =>
    operation !== 'purchase.orders.read' && operation !== 'purchase.gift_detail.read',
  );
  const schemaPropertyCount = Object.keys(
    createDynamicExtractionSchema({ allowedActionIntents, capabilities: profile }).shape,
  ).length;
  const textualAllowedActions =
    `Acciones disponibles en este turno: ${allowedActionIntents.join(', ') || 'ninguna'}. ` +
    `Operaciones del dominio: ${allowedOperations.join(', ') || 'ninguna'}.`;
  return {
    profile,
    allowedActionIntents,
    allowedOperations,
    textualAllowedActions,
    schemaPropertyCount,
  };
}
