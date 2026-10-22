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
  resolveSupportHandoffSkipCause,
} from '../src/runtime/reply-evidence-projector';
import {
  buildHandoffDedupeKey,
  decideHumanHelpAttempt,
  type HandoffPersistedRecord,
} from '../src/runtime/human-help-policy';

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

  it('excludes inactive lanes and unavailable intents from the projection', () => {
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

    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      environment: 'production',
      allowCustomerWrites: true,
      featureFlags: { rsvp: false, providerPlanning: true },
    });
    const filtered = projectExtraction({
      plan: emptyPlan(),
      manifest,
      requestedDomain: 'rsvp',
      candidateOperations: ['rsvp.response.write'],
      allowedActionIntents: ['responder_invitacion', 'buscar_proveedores'],
    });
    expect(filtered.allowedActionIntents).not.toContain('responder_invitacion');
    expect(filtered.profile.rsvp).toBe(false);
  });
});

describe('S10 reply evidence projector', () => {
  it('composes clarification, acknowledgement, and complete outcomes from facts without provider tools', () => {
    const clarified = projectReply({
      continuity: { disposition: 'extract_action', providerToolsAllowed: false, suppressClosure: true },
      capabilityOutcome: { status: 'needs_input', operation: 'purchase.orders.read', reason: 'enabled', requiredInput: ['orderId'], allowedNext: 'clarify' },
      verifiedFacts: ['pending order 118'],
      allowedNextSteps: ['pedir numero de pedido'],
      providerResultCount: 3,
    });
    expect(clarified.providersExcluded).toBe(true);
    expect(clarified.providerTools).toEqual([]);
    expect(clarified.requiresReplyModel).toBe(true);
    expect(clarified.disposition).toBe('composed');

    const acknowledged = projectReply({
      continuity: { disposition: 'acknowledge_without_interview', providerToolsAllowed: false, suppressClosure: false },
      capabilityOutcome: null,
      verifiedFacts: ['attendance attending preserved'],
      allowedNextSteps: [],
      providerResultCount: 2,
      acknowledgeRelationshipOnce: true,
    });
    expect(acknowledged.providerTools).toEqual([]);
    expect(acknowledged.providersExcluded).toBe(true);
    expect(acknowledged.requiresReplyModel).toBe(true);
    expect(acknowledged.disposition).toBe('composed');

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

  it('resolves composed replies from narrative claim checks without canned prose', () => {
    const claims = checkReplyNarrativeClaims(
      [{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: false, operationAllowed: true }],
    );
    expect(claims).toBe('fallback');
    const failed = resolveComposedReply({
      disposition: 'composed',
      modelText: 'Listo, ya quedo confirmado.',
      claims,
    });
    expect(failed.disposition).toBe('operational_failure');
    expect(failed.text).toBeNull();

    expect(checkReplyNarrativeClaims(
      [{ operation: 'rsvp.response.write', claimsSuccess: true, receiptPresent: true, operationAllowed: true }],
    )).toBe('ok');
    expect(checkReplyNarrativeClaims(
      [{ operation: 'provider.quote.write', claimsSuccess: true, receiptPresent: true, operationAllowed: false }],
    )).toBe('fallback');
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

  it('projects handoff evidence distinctly per gateway result, never a success claim', () => {
    const requested = projectSupportHandoffEvidence({
      result: { status: 'success', message: 'Requested.' },
      phonePresent: true,
      confirmedReceipt: true,
      skipCause: null,
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
      skipCause: null,
    });
    expect(failed.handoffOutcome).toBe('handoff_failed');
    expect(failed.effectConfirmed).toBe(false);
    expect(failed.operationalNote).toContain('unavailable');
    const unknown = projectSupportHandoffEvidence({
      result: { status: 'failed', error: 'timeout', retryable: true, outcome: 'unknown' },
      phonePresent: true,
      confirmedReceipt: false,
      skipCause: null,
    });
    expect(unknown.handoffOutcome).toBe('handoff_unknown');
    expect(unknown.effectConfirmed).toBe(false);
    const skipped = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'missing_phone_number', message: 'Missing.' },
      phonePresent: false,
      confirmedReceipt: false,
      skipCause: null,
    });
    expect(skipped.handoffOutcome).toBe('handoff_skipped_missing_phone');
    expect(skipped.identityAvailable).toBe(false);
    expect(skipped.operationalNote).toContain('missing_phone_number');
    const skippedUnavailable = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'not_configured', message: 'Disabled.' },
      phonePresent: true,
      confirmedReceipt: false,
      skipCause: null,
    });
    expect(skippedUnavailable.handoffOutcome).toBe('handoff_skipped_unavailable');
    // No non-requested outcome claims success, confirmation, or a receipt.
    for (const evidence of [failed, unknown, skipped, skippedUnavailable]) {
      expect(evidence.handoffOutcome).not.toBe('handoff_requested');
      expect(evidence.effectConfirmed).toBe(false);
      expect(evidence.receiptPresent).toBe(false);
      expect(evidence.requiresReplyModel).toBe(true);
    }
  });

  it('keeps the real prior outcome when a failed takeover is not retried', () => {
    const prior: HandoffPersistedRecord = {
      dedupeKey: buildHandoffDedupeKey('plan-s10', 'protected_request'),
      inboundId: 'inbound-1',
      phone: '+51900000407',
      outcome: 'handoff_failed',
      requested: false,
      softPaused: false,
      updatedAt: '2026-10-21T00:00:00.000Z',
    };
    const decision = decideHumanHelpAttempt({
      conversationId: 'plan-s10',
      inboundId: 'inbound-2',
      scope: 'protected_request',
      trustedPhone: '+51900000407',
      gatewayCapable: true,
      prior,
      explicitRetry: false,
    });
    expect(decision.action).toBe('skip_duplicate');
    expect(decision.reason).toBe('failed_no_auto_retry');

    const evidence = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'not_configured', message: decision.reason },
      phonePresent: true,
      confirmedReceipt: false,
      skipCause: resolveSupportHandoffSkipCause({
        decision,
        priorOutcome: prior.outcome,
      }),
    });

    // The failed attempt stays failed, and the value says the turn sent no
    // request: it never collapses into an unavailable capability the guest
    // never had, and it never reads as a fresh attempt either.
    expect(evidence.handoffOutcome).toBe('handoff_failed_not_retried');
    expect(evidence.handoffOutcome).not.toBe('handoff_skipped_unavailable');
    expect(evidence.handoffOutcome).not.toBe('handoff_failed');
    expect(evidence.operationalNote).toContain('Takeover requests sent this turn: 0');
    expect(evidence.effectConfirmed).toBe(false);
    expect(evidence.receiptPresent).toBe(false);
    expect(evidence.requiresReplyModel).toBe(true);
  });

  it('keeps an unknown takeover outcome unknown when it is not retried', () => {
    const prior: HandoffPersistedRecord = {
      dedupeKey: buildHandoffDedupeKey('plan-s10', 'protected_request'),
      inboundId: 'inbound-1',
      phone: '+51900000408',
      outcome: 'outcome_unknown',
      requested: false,
      softPaused: false,
      updatedAt: '2026-10-21T00:00:00.000Z',
    };
    const decision = decideHumanHelpAttempt({
      conversationId: 'plan-s10',
      inboundId: 'inbound-2',
      scope: 'protected_request',
      trustedPhone: '+51900000408',
      gatewayCapable: true,
      prior,
      explicitRetry: false,
    });
    expect(decision.action).toBe('skip_unknown_unretried');
    expect(decision.reason).toBe('unknown_stays_unretried');

    const evidence = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'not_configured', message: decision.reason },
      phonePresent: true,
      confirmedReceipt: false,
      skipCause: resolveSupportHandoffSkipCause({
        decision,
        priorOutcome: prior.outcome,
      }),
    });

    expect(evidence.handoffOutcome).toBe('handoff_unknown_not_retried');
    expect(evidence.handoffOutcome).not.toBe('handoff_skipped_unavailable');
    expect(evidence.handoffOutcome).not.toBe('handoff_unknown');
    expect(evidence.operationalNote).toContain('Takeover requests sent this turn: 0');
    expect(evidence.effectConfirmed).toBe(false);
    expect(evidence.receiptPresent).toBe(false);
  });

  it('reserves the skipped outcomes for a missing phone and an unavailable capability', () => {
    const unavailableDecision = decideHumanHelpAttempt({
      conversationId: 'plan-s10',
      inboundId: 'inbound-1',
      scope: 'protected_request',
      trustedPhone: '+51900000407',
      gatewayCapable: false,
      prior: null,
      explicitRetry: false,
    });
    expect(unavailableDecision.action).toBe('skip_unavailable');
    const unavailable = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'not_configured', message: unavailableDecision.reason },
      phonePresent: true,
      confirmedReceipt: false,
      skipCause: resolveSupportHandoffSkipCause({
        decision: unavailableDecision,
        priorOutcome: null,
      }),
    });
    expect(unavailable.handoffOutcome).toBe('handoff_skipped_unavailable');

    const missingPhoneDecision = decideHumanHelpAttempt({
      conversationId: 'plan-s10',
      inboundId: 'inbound-1',
      scope: 'protected_request',
      trustedPhone: null,
      gatewayCapable: true,
      prior: null,
      explicitRetry: false,
    });
    expect(missingPhoneDecision.action).toBe('skip_no_phone');
    const missingPhone = projectSupportHandoffEvidence({
      result: { status: 'skipped', reason: 'missing_phone_number', message: missingPhoneDecision.reason },
      phonePresent: false,
      confirmedReceipt: false,
      skipCause: resolveSupportHandoffSkipCause({
        decision: missingPhoneDecision,
        priorOutcome: null,
      }),
    });
    expect(missingPhone.handoffOutcome).toBe('handoff_skipped_missing_phone');
  });
});

describe('S10 bundle identity and byte deltas', () => {
  it('measures bundle identity once and reports changed request deltas', () => {
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
    const stable = summarizeBundleDelta(first, second);
    expect(stable.grew).toBe(false);
    expect(stable.serializedDelta).toBe(0);

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
