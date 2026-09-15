import { describe, expect, it } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { auditProjectionPromptOwnership } from '../src/audit/prompt-audit';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import { createDynamicExtractionSchema } from '../src/runtime/extraction-schemas';
import { nodePromptManifest } from '../src/runtime/prompt-manifest';
import {
  measureBundle,
  summarizeBundleDelta,
} from '../src/runtime/prompt-loader';
import {
  projectExtraction,
} from '../src/runtime/extraction-projection';
import {
  checkReplyNarrativeClaims,
  projectOperationalFailure,
  projectReply,
  projectSupportHandoffEvidence,
  resolveComposedReply,
} from '../src/runtime/reply-evidence-projector';

function emptyPlan() {
  return createEmptyPlan({
    planId: 'plan-s10',
    channel: 'terminal',
    externalUserId: 'user-s10',
  });
}

function fullManifest() {
  return buildRuntimeCapabilityManifest({
    configured: true,
    environment: 'production',
    allowCustomerWrites: true,
    featureFlags: {
      faq: true,
      invitedEventLookup: true,
      purchaseInformation: true,
      rsvp: true,
      providerPlanning: true,
      providerSearch: true,
      providerQuoteRequests: true,
      phoneAuthentication: true,
      emailOtp: true,
      humanTakeover: true,
    },
  });
}

describe('S10 extraction projection owns schema and text', () => {
  it('feeds the same projection into schema and textual allowed actions', () => {
    const projection = projectExtraction({
      plan: emptyPlan(),
      manifest: fullManifest(),
      requestedDomain: 'purchase',
      candidateOperations: ['purchase.orders.read', 'purchase.gift_detail.read'],
      allowedActionIntents: ['responder_invitacion', 'buscar_proveedores'],
    });
    const schema = createDynamicExtractionSchema({
      allowedActionIntents: projection.allowedActionIntents,
      capabilities: projection.profile,
    });
    const shapeKeys = Object.keys(schema.shape);
    expect(shapeKeys).toContain('requestedOperation');
    for (const operation of projection.allowedOperations) {
      expect(projection.textualAllowedActions).toContain(operation);
    }
    expect(projection.schemaPropertyCount).toBe(shapeKeys.length);
  });

  it('omits inactive lane state from the profile', () => {
    const projection = projectExtraction({
      plan: emptyPlan(),
      manifest: fullManifest(),
      requestedDomain: null,
      candidateOperations: [],
      allowedActionIntents: ['buscar_proveedores'],
    });
    expect(projection.profile.providerOperations).toBe(false);
    expect(projection.profile.providerSelection).toBe(false);
    expect(projection.profile.providerInspection).toBe(false);
    expect(projection.profile.close).toBe(false);
    expect(projection.profile.pause).toBe(false);
    expect(projection.allowedOperations).toEqual([]);
  });

  it('filters intents by manifest availability', () => {
    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      environment: 'production',
      allowCustomerWrites: true,
      featureFlags: { rsvp: false, providerPlanning: true },
    });
    const projection = projectExtraction({
      plan: emptyPlan(),
      manifest,
      requestedDomain: 'rsvp',
      candidateOperations: ['rsvp.response.write'],
      allowedActionIntents: ['responder_invitacion', 'buscar_proveedores'],
    });
    expect(projection.allowedActionIntents).not.toContain('responder_invitacion');
    expect(projection.profile.rsvp).toBe(false);
  });
});

describe('S10 reply evidence projector', () => {
  it('excludes providers and tools on clarification but keeps the reply model', () => {
    const projected = projectReply({
      continuity: { disposition: 'extract_action', providerToolsAllowed: false, suppressClosure: true },
      capabilityOutcome: { status: 'needs_input', operation: 'purchase.orders.read', reason: 'enabled', requiredInput: ['orderId'], allowedNext: 'clarify' },
      verifiedFacts: ['pending order 118'],
      allowedNextSteps: ['pedir numero de pedido'],
      providerResultCount: 3,
    });
    expect(projected.providersExcluded).toBe(true);
    expect(projected.providerTools).toEqual([]);
    expect(projected.requiresReplyModel).toBe(true);
    expect(projected.disposition).toBe('composed');
  });

  it('composes acknowledgement from facts with no provider tools or model bypass', () => {
    const projected = projectReply({
      continuity: { disposition: 'acknowledge_without_interview', providerToolsAllowed: false, suppressClosure: false },
      capabilityOutcome: null,
      verifiedFacts: ['attendance attending preserved'],
      allowedNextSteps: [],
      providerResultCount: 2,
      acknowledgeRelationshipOnce: true,
    });
    expect(projected.providerTools).toEqual([]);
    expect(projected.providersExcluded).toBe(true);
    expect(projected.requiresReplyModel).toBe(true);
    expect(projected.disposition).toBe('composed');
  });

  it('composes complete capability outcomes from facts instead of fixed text', () => {
    for (const status of ['unsupported', 'already_completed', 'blocked', 'unavailable'] as const) {
      const projected = projectReply({
        continuity: { disposition: 'suppress_closure', providerToolsAllowed: false, suppressClosure: true },
        capabilityOutcome: { status, operation: 'confirmation_document.send', reason: 'not_implemented', requiredInput: [], allowedNext: 'handoff_once' },
        handoffOutcome: 'handoff_requested',
        verifiedFacts: [],
        allowedNextSteps: ['apoyo humano solicitado'],
        providerResultCount: 0,
      });
      expect(projected.requiresReplyModel).toBe(true);
      expect(projected.disposition).toBe('composed');
      expect(projected.providerTools).toEqual([]);
    }
  });

  it('resolves invalid structure to operational failure, never canned prose', () => {
    const claims = checkReplyNarrativeClaims(
      [{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: false, operationAllowed: true }],
    );
    expect(claims).toBe('fallback');
    const resolved = resolveComposedReply({
      disposition: 'composed',
      modelText: 'Listo, ya quedo confirmado.',
      claims,
    });
    expect(resolved.disposition).toBe('operational_failure');
    expect(resolved.text).toBeNull();
  });

  it('passes model text through for grounded claims without substitution', () => {
    expect(checkReplyNarrativeClaims(
      [{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: true, operationAllowed: true }],
    )).toBe('ok');
    const resolved = resolveComposedReply({
      disposition: 'composed',
      modelText: 'Listo, ya quedo confirmado.',
      claims: 'ok',
    });
    expect(resolved.disposition).toBe('composed');
    expect(resolved.text).toBe('Listo, ya quedo confirmado.');
  });

  it('projects operational failure explicitly instead of silent suppression', () => {
    const projected = projectOperationalFailure({ verifiedFacts: ['handoff unknown'] });
    expect(projected.disposition).toBe('operational_failure');
    expect(projected.requiresReplyModel).toBe(false);
    expect(projected.providersExcluded).toBe(true);
  });

  it('accepts grounded narrative claims structurally', () => {
    expect(checkReplyNarrativeClaims(
      [{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: true, operationAllowed: true }],
    )).toBe('ok');
    expect(checkReplyNarrativeClaims(
      [{ operation: 'provider.quote.write', claimsSuccess: true, receiptPresent: true, operationAllowed: false }],
    )).toBe('fallback');
  });

  it('projects handoff evidence distinctly per gateway result', () => {
    const requested = projectSupportHandoffEvidence({
      result: { status: 'success', message: 'Requested.' },
      phonePresent: true,
      confirmedReceipt: true,
    });
    expect(requested.handoffOutcome).toBe('handoff_requested');
    expect(requested.identityAvailable).toBe(true);
    expect(requested.effectConfirmed).toBe(true);
    expect(requested.receiptPresent).toBe(true);
    expect(requested.requiresReplyModel).toBe(true);
    const failed = projectSupportHandoffEvidence({
      result: { status: 'failed', error: 'unavailable', retryable: false },
      phonePresent: true,
      confirmedReceipt: false,
    });
    expect(failed.handoffOutcome).toBe('handoff_failed');
    expect(failed.effectConfirmed).toBe(false);
    expect(failed.operationalNote).toContain('unavailable');
    const unknown = projectSupportHandoffEvidence({
      result: { status: 'failed', error: 'timeout', retryable: true, outcome: 'unknown' },
      phonePresent: true,
      confirmedReceipt: false,
    });
    expect(unknown.handoffOutcome).toBe('handoff_unknown');
    expect(unknown.effectConfirmed).toBe(false);
    const skipped = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'missing_phone_number', message: 'Missing.' },
      phonePresent: false,
      confirmedReceipt: false,
    });
    expect(skipped.handoffOutcome).toBeNull();
    expect(skipped.identityAvailable).toBe(false);
    expect(skipped.operationalNote).toContain('missing_phone_number');
  });

  it('never projects a success claim from missing identity or a failed handoff', () => {
    for (const evidence of [
      projectSupportHandoffEvidence({
        result: { status: 'skipped', reason: 'missing_phone_number', message: 'Missing.' },
        phonePresent: false,
        confirmedReceipt: false,
      }),
      projectSupportHandoffEvidence({
        result: { status: 'skipped', reason: 'not_configured', message: 'Disabled.' },
        phonePresent: true,
        confirmedReceipt: false,
      }),
      projectSupportHandoffEvidence({
        result: { status: 'failed', error: 'boom', retryable: false },
        phonePresent: true,
        confirmedReceipt: false,
      }),
      projectSupportHandoffEvidence({
        result: { status: 'failed', error: 'timeout', retryable: true, outcome: 'unknown' },
        phonePresent: true,
        confirmedReceipt: false,
      }),
    ]) {
      expect(evidence.handoffOutcome).not.toBe('handoff_requested');
      expect(evidence.effectConfirmed).toBe(false);
      expect(evidence.receiptPresent).toBe(false);
      expect(evidence.requiresReplyModel).toBe(true);
    }
  });
});

describe('S10 bundle identity and byte deltas', () => {
  it('records identity and bytes once with no growth on re-measure', () => {
    const first = measureBundle({
      bundleId: 'abc123',
      instructions: '## nodes/uno/system.txt\nHola',
      input: '{"a":1}',
      schemaPropertyCount: 4,
      toolCount: 0,
    });
    const second = measureBundle({
      bundleId: 'abc123',
      instructions: '## nodes/uno/system.txt\nHola',
      input: '{"a":1}',
      schemaPropertyCount: 4,
      toolCount: 0,
    });
    expect(first).toEqual(second);
    const delta = summarizeBundleDelta(first, second);
    expect(delta.grew).toBe(false);
    expect(delta.serializedDelta).toBe(0);
  });

  it('reports changed request deltas', () => {
    const before = measureBundle({
      bundleId: 'abc123',
      instructions: 'Hola',
      input: '{"a":1}',
      schemaPropertyCount: 4,
      toolCount: 0,
    });
    const after = measureBundle({
      bundleId: 'abc123',
      instructions: 'Hola mundo extendido',
      input: '{"a":1,"b":2}',
      schemaPropertyCount: 6,
      toolCount: 2,
    });
    const delta = summarizeBundleDelta(before, after);
    expect(delta.grew).toBe(true);
    expect(delta.instructionDelta).toBeGreaterThan(0);
    expect(delta.inputDelta).toBeGreaterThan(0);
    expect(delta.schemaDelta).toBe(2);
    expect(delta.toolDelta).toBe(2);
  });
});

describe('S10 prompt ownership audits', () => {
  it('keeps acknowledgement and clarification nodes free of provider search tools', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const ackNodes = ['continua', 'guardar_cerrar_temporalmente', 'responder_invitacion'] as const;
    const providerSearchTools = [
      'search_providers_from_plan',
      'search_providers_by_keyword',
      'search_providers_by_category_location',
      'get_relevant_providers',
    ];
    for (const node of ackNodes) {
      const allowed = nodePromptManifest[node].allowedTools;
      for (const tool of providerSearchTools) {
        expect(allowed).not.toContain(tool);
      }
      const system = await fs.readFile(
        path.resolve(process.cwd(), `prompts/nodes/${node}/system.txt`),
        'utf8',
      );
      expect(system.length).toBeGreaterThan(0);
    }
    const clarification = nodePromptManifest['aclarar_pedir_faltante'].allowedTools;
    for (const tool of providerSearchTools) {
      expect(clarification).not.toContain(tool);
    }
  });

  it('eliminates prose rules replaced by typed outcomes from shared prompts', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const flow = await fs.readFile(
      path.resolve(process.cwd(), 'prompts/shared/flow_discipline.txt'),
      'utf8',
    );
    const scope = await fs.readFile(
      path.resolve(process.cwd(), 'prompts/shared/domain_scope.txt'),
      'utf8',
    );
    expect(auditProjectionPromptOwnership({
      sharedFlowDiscipline: flow,
      sharedDomainScope: scope,
    })).toEqual([]);
  });

  it('keeps node-specific guidance in its exact-node Spanish file', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const clarificationSystem = await fs.readFile(
      path.resolve(process.cwd(), 'prompts/nodes/aclarar_pedir_faltante/system.txt'),
      'utf8',
    );
    expect(clarificationSystem).toContain('No recomiendes todavía en este nodo');
    const recommendSystem = await fs.readFile(
      path.resolve(process.cwd(), 'prompts/nodes/recomendar/system.txt'),
      'utf8',
    );
    expect(recommendSystem).toContain('Usa primero los resultados ya presentes en el contexto');
  });
});
