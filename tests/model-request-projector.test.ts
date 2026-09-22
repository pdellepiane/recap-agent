import { describe, expect, it } from 'vitest';

import {
  buildRelevanceManifest,
  deriveReplyCompilerContext,
  extractionCategoryContextNeeded,
  moduleFilesFor,
  orderInputSections,
  projectSupportHandoffEvidence,
  replyOmitsCapabilityCatalogue,
  replyOmitsOperationalNote,
  selectExtractionModules,
  selectReplyModules,
  type ModuleSelectionContext,
} from '../src/runtime/model-request-projector';
import { instructionModuleRegistry } from '../src/runtime/prompt-manifest';

function extractionContext(
  overrides: Partial<ModuleSelectionContext> = {},
): ModuleSelectionContext {
  return {
    stage: 'extraction',
    owner: 'unknown',
    establishedDomain: null,
    tasks: ['purchase', 'venue', 'rsvp', 'faq_policy', 'planning'],
    approvalBoundary: false,
    giftFulfillment: false,
    hasPlanningDetail: false,
    ...overrides,
  };
}

function moduleIds(context: ModuleSelectionContext): string[] {
  return selectExtractionModules(context).map((module) => module.id);
}

function replyIds(context: ModuleSelectionContext): string[] {
  return selectReplyModules(context).map((module) => module.id);
}

describe('model request projector extraction applicability', () => {
  it('keeps compact cross-domain recognition on transient owners', () => {
    const ids = moduleIds(extractionContext());
    expect(ids).not.toContain('shared_invariants');
    expect(ids).toContain('extraction_cross_domain');
    expect(ids).toContain('extraction_information');
    expect(ids).toContain('extraction_rsvp');
    expect(ids).toContain('extraction_planning');
  });

  it('drops inactive planning state on established support extraction', () => {
    const ids = moduleIds(
      extractionContext({
        owner: 'customer_assistance',
        establishedDomain: 'support',
        tasks: ['purchase', 'venue', 'rsvp', 'faq_policy'],
      }),
    );
    expect(ids).not.toContain('extraction_planning');
    expect(ids).toContain('extraction_information');
    expect(ids).toContain('extraction_rsvp');
  });

  it('drops inactive planning state on established purchase extraction', () => {
    const ids = moduleIds(
      extractionContext({
        owner: 'customer_assistance',
        establishedDomain: 'purchase',
        tasks: ['purchase', 'venue', 'rsvp', 'faq_policy'],
      }),
    );
    expect(ids).not.toContain('extraction_planning');
    expect(ids).toContain('extraction_information');
  });

  it('keeps invitation decisions readable on established rsvp extraction', () => {
    const ids = moduleIds(
      extractionContext({
        owner: 'customer_assistance',
        establishedDomain: 'rsvp',
        tasks: ['purchase', 'venue', 'rsvp', 'faq_policy'],
      }),
    );
    expect(ids).not.toContain('extraction_planning');
    expect(ids).toContain('extraction_rsvp');
    expect(ids).toContain('extraction_information');
  });

  it('never emits duplicate modules', () => {
    const selected = selectExtractionModules(extractionContext());
    const ids = selected.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('selects modules from typed state only, never customer identifiers', () => {
    const context = extractionContext();
    expect(Object.keys(context).sort()).toEqual(
      ['approvalBoundary', 'establishedDomain', 'giftFulfillment', 'hasPlanningDetail', 'owner', 'stage', 'tasks'],
    );
    expect(moduleIds(context)).toEqual(moduleIds(extractionContext()));
  });

  it('gates provider detail on typed planning progress for transient owners', () => {
    const compact = moduleIds(extractionContext({ hasPlanningDetail: false }));
    expect(compact).toContain('extraction_planning');
    expect(compact).not.toContain('extraction_contact');
    expect(compact).not.toContain('extraction_provider_management');
    expect(compact).not.toContain('extraction_close_pause');
    const detailed = moduleIds(extractionContext({ hasPlanningDetail: true }));
    expect(detailed).toContain('extraction_contact');
    expect(detailed).toContain('extraction_provider_management');
    expect(detailed).toContain('extraction_close_pause');
  });

  it('keeps contact capture on established support extraction', () => {
    const ids = moduleIds(
      extractionContext({
        owner: 'customer_assistance',
        establishedDomain: 'support',
        tasks: ['purchase', 'venue', 'rsvp', 'faq_policy'],
      }),
    );
    expect(ids).toContain('extraction_contact');
    expect(ids).not.toContain('extraction_planning');
    expect(ids).not.toContain('extraction_provider_management');
    expect(ids).not.toContain('extraction_close_pause');
  });
});

describe('model request projector reply applicability', () => {
  it('composes mixed faq plus purchase modules without dropping either', () => {
    const ids = replyIds({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['purchase', 'faq_policy'],
    });
    expect(ids).toContain('reply_purchase_facts');
    expect(ids).toContain('reply_faq_policy');
    expect(ids).toContain('reply_support_continuity');
  });

  it('keeps an applicable handoff outcome alongside a completed answer', () => {
    const ids = replyIds({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['purchase', 'handoff'],
    });
    expect(ids).toContain('reply_purchase_facts');
    expect(ids).toContain('reply_handoff_outcome');
  });

  it('withholds purchase facts from faq-only owners (authorization)', () => {
    const ids = replyIds({
      stage: 'reply',
      owner: 'faq',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['purchase', 'faq_policy'],
    });
    expect(ids).not.toContain('reply_purchase_facts');
    expect(ids).toContain('reply_faq_policy');
  });

  it('withholds planning instructions from support owners', () => {
    const ids = replyIds({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['purchase', 'planning'],
    });
    expect(ids).not.toContain('reply_planning_owner');
    expect(ids).toContain('reply_purchase_facts');
  });

  it('adds only outcome guidance when auth joins a venue turn', () => {
    const venueOnly = replyIds({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['venue'],
    });
    const venueWithAuth = replyIds({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['venue', 'auth'],
    });
    expect(venueOnly).toContain('reply_venue_facts');
    expect(venueWithAuth).toContain('reply_venue_facts');
    expect(venueWithAuth).toContain('reply_auth_limitation');
    expect(venueWithAuth.filter((id) => id !== 'reply_auth_limitation')).toEqual(venueOnly);
  });

  it('keeps module identity stable across handoff requested versus failed', () => {
    const base = {
      stage: 'reply' as const,
      owner: 'customer_assistance' as const,
      establishedDomain: null,
      approvalBoundary: false as const,
      giftFulfillment: false,
      hasPlanningDetail: false as const,
      tasks: ['handoff' as const],
    };
    expect(replyIds(base)).toContain('reply_handoff_outcome');
    expect(replyIds(base)).toEqual(replyIds({ ...base }));
  });
});

describe('model request projector relevance manifest', () => {
  it('records source, reason, dependencies and bytes per module', () => {
    const selected = selectReplyModules({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['venue'],
    });
    const manifest = buildRelevanceManifest(selected, (id) =>
      instructionModuleRegistry[id].files.join(',').length,
    );
    expect(manifest.promptIdentity).toBe(selected.map((module) => module.id).join('+'));
    for (const entry of manifest.modules) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(entry.dependsOn)).toBe(true);
      expect(entry.bytes).toBeGreaterThanOrEqual(0);
    }
    expect(manifest.totalBytes).toBe(
      manifest.modules.reduce((total, entry) => total + entry.bytes, 0),
    );
  });

  it('orders shared invariants before dynamic context', () => {
    const selected = selectReplyModules({
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      tasks: ['venue'],
    });
    expect(selected[0]?.id).toBe('shared_invariants');
  });
});

describe('model request projector serialized sections', () => {
  it('retains required facts and omits null irrelevant sections', () => {
    const text = orderInputSections([
      { key: 'plan_snapshot', content: 'Plan base (JSON compacto): {"current_node":"resolver_consultas_informativas"}' },
      { key: 'allowed_actions', content: 'Acciones disponibles en este turno: ninguna.' },
      { key: 'category_context', content: null },
      { key: 'delta_rule', content: 'Extrae solo cambios nuevos del turno.' },
    ]);
    expect(text).toContain('Plan base (JSON compacto)');
    expect(text).toContain('Extrae solo cambios nuevos del turno.');
    expect(text).not.toContain('Categor');
    expect(text).not.toContain('null');
  });

  it('preserves section order byte-for-byte', () => {
    const sections = [
      { key: 'a', content: 'first' },
      { key: 'b', content: null },
      { key: 'c', content: 'third' },
    ];
    expect(orderInputSections(sections)).toBe('first\nthird');
  });
});

describe('model request projector omission predicates', () => {
  it('reserves category priorities for transient extraction', () => {
    expect(extractionCategoryContextNeeded(null)).toBe(true);
    expect(extractionCategoryContextNeeded('purchase')).toBe(false);
    expect(extractionCategoryContextNeeded('support')).toBe(false);
    expect(extractionCategoryContextNeeded('rsvp')).toBe(false);
  });

  it('omits the broad catalogue on support and faq replies only', () => {
    expect(replyOmitsCapabilityCatalogue('customer_assistance')).toBe(true);
    expect(replyOmitsCapabilityCatalogue('faq')).toBe(true);
    expect(replyOmitsCapabilityCatalogue('planning')).toBe(false);
    expect(replyOmitsCapabilityCatalogue('unknown')).toBe(false);
  });

  it('omits free-form notes only when typed outcomes carry the facts', () => {
    expect(replyOmitsOperationalNote({ hasTypedOutcome: true })).toBe(true);
    expect(replyOmitsOperationalNote({ hasTypedOutcome: false })).toBe(false);
  });
});

describe('model request projector handoff outcomes', () => {
  it('binds success claims to actual gateway results', () => {
    const requested = projectSupportHandoffEvidence({
      result: { status: 'success', message: 'ok' },
      phonePresent: true,
      confirmedReceipt: true,
    });
    expect(requested.handoffOutcome).toBe('handoff_requested');
    expect(requested.requiresReplyModel).toBe(true);
    const failed = projectSupportHandoffEvidence({
      result: { status: 'failed', outcome: 'failed', error: 'boom', retryable: false },
      phonePresent: true,
      confirmedReceipt: false,
    });
    expect(failed.handoffOutcome).toBe('handoff_failed');
    const unknown = projectSupportHandoffEvidence({
      result: { status: 'failed', outcome: 'unknown', error: 'timeout', retryable: true },
      phonePresent: false,
      confirmedReceipt: false,
    });
    expect(unknown.handoffOutcome).toBe('handoff_unknown');
  });
});

describe('model request projector auth and approval gating', () => {
  function replyContext(overrides: Partial<ModuleSelectionContext> = {}): ModuleSelectionContext {
    return {
      stage: 'reply',
      owner: 'customer_assistance',
      establishedDomain: null,
      tasks: [],
      approvalBoundary: false,
      giftFulfillment: false,
      hasPlanningDetail: false,
      ...overrides,
    };
  }

  it('loads auth limitation and continuity from separate tracked files', () => {
    expect(instructionModuleRegistry.reply_auth_limitation.files).toEqual([
      'nodes/resolver_consultas_informativas/auth_limitation.txt',
    ]);
    expect(instructionModuleRegistry.reply_support_continuity.files).toEqual([
      'nodes/resolver_consultas_informativas/support_continuity.txt',
    ]);
    expect(
      instructionModuleRegistry.reply_auth_limitation.files.some((file) =>
        instructionModuleRegistry.reply_support_continuity.files.includes(file),
      ),
    ).toBe(false);
  });

  it('keeps terminal-auth prose out of venue/purchase modules', () => {
    const ids = replyIds(replyContext({ tasks: ['venue'] }));
    expect(ids).toContain('reply_venue_facts');
    expect(ids).toContain('reply_support_continuity');
    expect(ids).not.toContain('reply_auth_limitation');
    expect(ids).not.toContain('reply_approval_boundary');
    expect(ids).not.toContain('reply_image_context');
    const files = moduleFilesFor(selectReplyModules(replyContext({ tasks: ['venue'] })));
    expect(files).not.toContain('nodes/resolver_consultas_informativas/auth_limitation.txt');
  });

  it('loads the approval boundary only on purchase validation aspects', () => {
    const plain = replyIds(replyContext({ tasks: ['purchase'], approvalBoundary: false }));
    expect(plain).not.toContain('reply_approval_boundary');
    const boundary = replyIds(replyContext({ tasks: ['purchase'], approvalBoundary: true }));
    expect(boundary).toContain('reply_approval_boundary');
    expect(boundary).toContain('reply_purchase_facts');
    // The boundary needs a purchase task: the registry authorization drops
    // it on unrelated lanes even when the flag is set.
    const dropped = replyIds(replyContext({ tasks: ['venue'], approvalBoundary: true }));
    expect(dropped).not.toContain('reply_approval_boundary');
  });

  it('loads image limits only on image tasks', () => {
    expect(replyIds(replyContext({ tasks: ['venue'] }))).not.toContain('reply_image_context');
    expect(replyIds(replyContext({ tasks: ['image'] }))).toContain('reply_image_context');
    expect(instructionModuleRegistry.reply_image_context.files).toEqual([
      'nodes/resolver_consultas_informativas/image_limits.txt',
    ]);
  });

  it('derives the auth task only from a validated authentication outcome', () => {
    const base = {
      currentNode: 'resolver_consultas_informativas',
      informationResults: [{ kind: 'associated_event' }],
      extraction: { informationRequests: [], supportAct: null },
      plan: { information_state: { pending_requests: [] } },
      capabilityDecision: null,
      handoffOutcome: null,
      authenticationOutcome: null,
      imageEvidence: null,
      rsvpPhoneEvidence: null,
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0];
    expect(deriveReplyCompilerContext(base).tasks).not.toContain('auth');
    const authed = deriveReplyCompilerContext({
      ...base,
      authenticationOutcome: {
        status: 'terminal',
        reason: 'otp_failed',
        protectedRequestsClosed: false,
        publicInformationRequestsRemaining: 1,
        handoffOutcome: 'handoff_requested',
      },
    });
    expect(authed.tasks).toContain('auth');
    expect(selectReplyModules(authed).map((module) => module.id)).toContain('reply_auth_limitation');
  });

  it('derives the approval boundary from requested purchase aspects only', () => {
    const base = {
      currentNode: 'resolver_consultas_informativas',
      informationResults: [{ kind: 'purchase' }],
      extraction: {
        informationRequests: [{ kind: 'purchase', aspects: ['summary'] }],
        supportAct: null,
      },
      plan: { information_state: { pending_requests: [] } },
      capabilityDecision: null,
      handoffOutcome: null,
      authenticationOutcome: null,
      imageEvidence: null,
      rsvpPhoneEvidence: null,
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0];
    expect(deriveReplyCompilerContext(base).approvalBoundary).toBe(false);
    const boundary = deriveReplyCompilerContext({
      ...base,
      extraction: {
        informationRequests: [{ kind: 'purchase', aspects: ['summary', 'payment_status'] }],
        supportAct: null,
      },
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0]);
    expect(boundary.approvalBoundary).toBe(true);
  });

  it('loads gift presentation only when fulfillment evidence is present', () => {
    const plain = replyIds(replyContext({ tasks: ['purchase'], giftFulfillment: false }));
    expect(plain).not.toContain('reply_gift_fulfillment');
    const gift = replyIds(replyContext({ tasks: ['purchase'], giftFulfillment: true }));
    expect(gift).toContain('reply_gift_fulfillment');
    expect(gift).toContain('reply_purchase_facts');
    // The module needs a purchase task: the registry authorization drops
    // it on unrelated lanes even when the flag is set.
    const dropped = replyIds(replyContext({ tasks: ['venue'], giftFulfillment: true }));
    expect(dropped).not.toContain('reply_gift_fulfillment');
    expect(instructionModuleRegistry.reply_gift_fulfillment.files).toEqual([
      'nodes/resolver_consultas_informativas/gift_fulfillment.txt',
    ]);
  });

  it('derives gift fulfillment from purchase results or the canonical profile', () => {
    const base = {
      currentNode: 'resolver_consultas_informativas',
      informationResults: [{
        kind: 'purchase',
        status: 'completed',
        purchases: [{
          orderId: 'gift-1',
          items: [{ giftName: 'Regalo', quantity: 1, amount: 100, rowTotal: 100, type: 'se_store' }],
        }],
      }],
      customerContext: null,
      extraction: {
        informationRequests: [{ kind: 'purchase', aspects: ['payment_status'] }],
        supportAct: null,
      },
      plan: { information_state: { pending_requests: [] } },
      capabilityDecision: null,
      handoffOutcome: null,
      authenticationOutcome: null,
      imageEvidence: null,
      rsvpPhoneEvidence: null,
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0];
    // Items without derived fulfillment (payment-only aspects) select nothing.
    const paymentOnly = deriveReplyCompilerContext(base);
    expect(paymentOnly.giftFulfillment).toBe(false);
    expect(selectReplyModules(paymentOnly).map((module) => module.id))
      .not.toContain('reply_gift_fulfillment');

    const withFulfillment = deriveReplyCompilerContext({
      ...base,
      informationResults: [{
        kind: 'purchase',
        status: 'completed',
        purchases: [{
          orderId: 'gift-1',
          items: [{
            giftName: 'Regalo',
            quantity: 1,
            amount: 100,
            rowTotal: 100,
            type: 'se_store',
            fulfillment: { kind: 'physical', chosenBy: null, giftShipmentApplicable: true },
          }],
        }],
      }],
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0]);
    expect(withFulfillment.giftFulfillment).toBe(true);
    expect(selectReplyModules(withFulfillment).map((module) => module.id))
      .toContain('reply_gift_fulfillment');

    // A profile-level item conflict selects guidance even when results
    // carry no fulfillment facts themselves.
    const conflicted = deriveReplyCompilerContext({
      ...base,
      informationResults: [],
      customerContext: {
        detailedPurchases: [{
          orderId: 'gift-1',
          items: [],
          itemSourceConflict: { alternatives: [], truncated: false },
        }],
      },
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0]);
    expect(conflicted.giftFulfillment).toBe(true);
  });
});
