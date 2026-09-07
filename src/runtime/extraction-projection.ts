import type { ActionIntent, PersistedPlan } from '../core/plan';
import {
  type RuntimeCapabilityManifest,
  type RuntimeOperationId,
} from './capability-manifest';
import { derivePlanCapabilities } from './dynamic-agent-policy';
import { createDynamicExtractionSchema, type ExtractionCapabilityProfile } from './extraction-schemas';
import { projectExtractionOperations } from './turn-capability-policy';

/**
 * S10 single owner of extraction projection.
 *
 * The same capability projection feeds the extractor schema and the textual
 * allowed actions. Inactive lane state never enters the profile, so its
 * schema fields and prompt files stay omitted for that turn.
 */

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

function profileFromManifestAndPlan(
  plan: PersistedPlan,
  manifest: RuntimeCapabilityManifest,
): ExtractionCapabilityProfile {
  const lane = derivePlanCapabilities(plan);
  const information =
    manifestAvailable(manifest, 'faq.read') ||
    manifestAvailable(manifest, 'event.association.read') ||
    manifestAvailable(manifest, 'event.detail.read') ||
    manifestAvailable(manifest, 'purchase.orders.read') ||
    manifestAvailable(manifest, 'purchase.gift_detail.read');
  const rsvp =
    manifestAvailable(manifest, 'rsvp.state.read') ||
    manifestAvailable(manifest, 'rsvp.response.write');
  const providerPlanning = manifestAvailable(manifest, 'provider.plan');
  const providerSearch = manifestAvailable(manifest, 'provider.search');
  return {
    information,
    rsvp,
    providerPlanning,
    providerOperations: providerPlanning && lane.hasActivePlan,
    providerSelection: providerSearch && lane.hasShortlist,
    providerInspection: providerSearch && lane.hasShortlist,
    contact: information || lane.canClose,
    close: lane.canClose && manifestAvailable(manifest, 'provider.quote.write'),
    pause: lane.canPause && providerPlanning,
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
  const allowedActionIntents = input.allowedActionIntents.filter((intent) =>
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
  });
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
