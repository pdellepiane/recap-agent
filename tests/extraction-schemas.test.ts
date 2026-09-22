import { describe, expect, it } from 'vitest';

import {
  closeActionSchema,
  closeFlowResultSchema,
} from '../src/runtime/close-flow-schemas';
import {
  createDynamicExtractionSchema,
  extractionSchema,
  providerExplanationRequestSchema,
  providerPlanOperationSchema,
  providerQueryIntentSchema,
} from '../src/runtime/extraction-schemas';
import type { ExtractionCapabilityProfile } from '../src/runtime/extraction-schemas';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import {
  deriveEstablishedExtractionDomain,
  projectExtraction,
} from '../src/runtime/extraction-projection';
import { actionIntentValues } from '../src/core/plan';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

const fitCriteria = {
  eventType: 'boda',
  needCategory: 'catering',
  location: 'Lima',
  budgetAmount: null,
  budgetCurrency: null,
  mustHave: ['estaciones'],
  shouldAvoid: [],
  rankingNotes: 'Priorizar proveedores con estaciones para boda.',
} as const;

describe('structured extraction schemas', () => {
  it.each([
    {
      name: 'conversation only',
      capabilities: capabilityProfile(),
      present: [],
      absent: [
        'informationRequests', 'eventType', 'contactEmail', 'providerPlanOperations',
        'selectedProviderReferences', 'providerExplanationRequest', 'closeAction',
        'pauseRequested',
      ],
    },
    {
      name: 'initial planning and information',
      capabilities: capabilityProfile({
        information: true,
        providerPlanning: true,
        contact: true,
      }),
       present: ['informationRequests', 'phoneConfirmation', 'eventType', 'providerQueryIntents', 'contactEmail'],
      absent: [
        'providerPlanOperations', 'selectedProviderReferences',
        'providerExplanationRequest', 'closeAction', 'pauseRequested',
      ],
    },
    {
      name: 'active plan before shortlist',
      capabilities: capabilityProfile({
        information: true,
        providerPlanning: true,
        providerOperations: true,
        contact: true,
        close: true,
        pause: true,
      }),
      present: [
         'informationRequests', 'phoneConfirmation', 'eventType', 'providerPlanOperations', 'contactEmail',
        'closeAction', 'pauseRequested',
      ],
      absent: [
        'selectedProviderReferences', 'providerExplanationRequest',
        'providerDetailRequest',
      ],
    },
    {
      name: 'shortlist selection and inspection',
      capabilities: capabilityProfile({
        information: true,
        providerPlanning: true,
        providerOperations: true,
        providerSelection: true,
        providerInspection: true,
        contact: true,
        close: true,
        pause: true,
      }),
      present: [
         'informationRequests', 'phoneConfirmation', 'eventType', 'providerPlanOperations',
        'selectedProviderReferences', 'providerExplanationRequest',
        'providerDetailRequest', 'contactEmail', 'closeAction', 'pauseRequested',
      ],
      absent: [],
    },
  ])('includes complete relevant fields and excludes irrelevant fields for $name', ({
    capabilities,
    present,
    absent,
  }) => {
    const schema = createDynamicExtractionSchema({
      allowedActionIntents: actionIntentValues,
      capabilities,
    });
    const properties = Object.keys(schema.shape);

    expect(properties).toEqual(expect.arrayContaining([
      'actionIntent',
      'intentConfidence',
      'ambiguity',
      'assumptions',
      'conversationSummary',
      ...present,
    ]));
    for (const property of absent) {
      expect(properties).not.toContain(property);
    }
  });

  it('parses provider query intents with canonical fields', () => {
    const parsed = providerQueryIntentSchema.parse({
      category: 'Catering',
      label: 'Catering para boda',
      priority: 1,
      queries: [
        {
          id: 'catering',
          label: 'Catering para boda',
          category: 'Catering',
          queryStrings: ['Catering para boda en Lima con estaciones'],
          mustHave: ['estaciones'],
          shouldAvoid: [],
          maxSelections: 1,
          allowCrossCategory: false,
        },
      ],
      preferences: ['estaciones'],
      hardConstraints: [],
      missingFields: [],
      retrievalReady: true,
      fitCriteria,
    });

    expect(parsed.category).toBe('Catering');
    expect(parsed.retrievalReady).toBe(true);
  });

  it('parses provider query intents with capped query slots', () => {
    const parsed = providerQueryIntentSchema.parse({
      category: 'Catering',
      label: 'Catering para boda',
      priority: 1,
      queries: [
        {
          id: 'sushi',
          label: 'sushi',
          category: 'Catering',
          queryStrings: ['catering con sushi en Lima'],
          mustHave: ['sushi'],
          shouldAvoid: [],
          maxSelections: 1,
          allowCrossCategory: false,
        },
        {
          id: 'torta',
          label: 'torta para novios',
          category: 'Catering',
          queryStrings: ['torta para novios en Lima'],
          mustHave: ['torta para novios'],
          shouldAvoid: [],
          maxSelections: 1,
          allowCrossCategory: false,
        },
      ],
      preferences: ['sushi', 'torta para novios'],
      hardConstraints: [],
      missingFields: [],
      retrievalReady: true,
      fitCriteria,
    });

    expect(parsed.queries.map((query) => query.label)).toEqual([
      'sushi',
      'torta para novios',
    ]);
  });

  it('rejects malformed provider operations', () => {
    expect(() =>
      providerPlanOperationSchema.parse({
        type: 'delete_need',
        category: 'categoría inventada',
        preferences: [],
        hardConstraints: [],
        queryIntent: null,
        rerunSearch: false,
        provider: null,
        removeProvider: null,
        addProvider: null,
      }),
    ).toThrow();
  });

  it('defaults structured extraction arrays without legacy aliases', () => {
    const parsed = extractionSchema.parse({
      actionIntent: 'elicitar_necesidades',
      informationRequests: [],
      intentConfidence: 0.95,
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
      eventType: 'boda',
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      location: 'Lima',
      budgetSignal: null,
      guestRange: '51-100',
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Boda en Lima.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: fitCriteria,
    });

    expect(parsed.providerQueryIntents).toEqual([]);
    expect(parsed.providerPlanOperations).toEqual([]);
    expect(parsed.providerExplanationRequest).toBeNull();
    expect(parsed.providerDetailRequest).toBeNull();
    expect(parsed.phoneConfirmation).toBeNull();
    expect(parsed.selectedProviderReferences).toEqual([]);
    expect(parsed.closeAction).toBeNull();
  });

  it('accepts only the typed phone confirmation outcomes', () => {
    const parsed = extractionSchema.parse({
      actionIntent: null,
      informationRequests: [],
      phoneConfirmation: 'yes',
      intentConfidence: null,
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
      eventType: null,
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      location: null,
      budgetSignal: null,
      guestRange: null,
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: '',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: fitCriteria,
    });

    expect(parsed.phoneConfirmation).toBe('yes');
    expect(() => extractionSchema.parse({
      ...parsed,
      phoneConfirmation: 'maybe',
    })).toThrow();
  });

  it('parses all-needs provider explanation requests', () => {
    const parsed = providerExplanationRequestSchema.parse({
      scope: 'all_needs',
      primaryProvider: {
        providerId: null,
        providerTitle: null,
        category: null,
        hint: null,
      },
      comparedProviders: [],
      category: null,
      categories: [],
      question: 'Justifica todas las recomendaciones del plan.',
    });

    expect(parsed.scope).toBe('all_needs');
    expect(parsed.categories).toEqual([]);
  });

  it('parses structured selected provider references and close actions', () => {
    const parsed = extractionSchema.parse({
      actionIntent: 'cerrar',
      informationRequests: [],
      intentConfidence: 0.95,
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
      eventType: 'boda',
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: 'Fotografía y video',
      location: 'Lima',
      budgetSignal: null,
      guestRange: '51-100',
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Boda en Lima.',
      selectedProviderHints: [],
      selectedProviderReferences: [
        {
          providerId: 109,
          providerTitle: 'Filomena Studio',
          category: 'Fotografía y video',
          hint: null,
        },
      ],
      closeAction: {
        type: 'defer_need',
        category: 'Catering',
      },
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: fitCriteria,
    });

    expect(parsed.selectedProviderReferences[0]?.providerId).toBe(109);
    expect(parsed.closeAction).toEqual({
      type: 'defer_need',
      category: 'Catering',
      reason: null,
    });
  });

  it('rejects malformed close actions', () => {
    expect(() =>
      closeActionSchema.parse({
        type: 'defer_need',
        category: 'not-a-category',
      }),
    ).toThrow();
  });

  it('accepts non-defer close actions with incidental categories', () => {
    const parsed = closeActionSchema.parse({
      type: 'request_contact',
      category: 'Catering',
      reason: null,
    });

    expect(parsed).toEqual({
      type: 'request_contact',
      category: 'Catering',
      reason: null,
    });
  });

  it('parses typed close flow results', () => {
    const parsed = closeFlowResultSchema.parse({
      status: 'missing_contact',
      missingFields: ['full_name', 'phone'],
    });

    expect(parsed.status).toBe('missing_contact');
    if (parsed.status === 'missing_contact') {
      expect(parsed.missingFields).toEqual(['full_name', 'phone']);
    }
  });

  it('defaults missing and unknown rsvpDecisionSource to plan_state (safe)', () => {
    const base = {
      actionIntent: 'responder_invitacion' as const,
      informationRequests: [],
      intentConfidence: 0.98,
      ambiguity: { status: 'clear' as const, clarificationQuestion: null, interpretations: [] },
      eventType: null,
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      location: null,
      budgetSignal: null,
      guestRange: null,
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'RSVP',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: fitCriteria,
      rsvpAction: 'attending' as const,
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
    };
    const missing = extractionSchema.parse({ ...base });
    expect(missing.rsvpDecisionSource).toBe('plan_state');
    const unknown = extractionSchema.parse({ ...base, rsvpDecisionSource: 'unknown_source' as unknown as string });
    expect(unknown.rsvpDecisionSource).toBe('plan_state');
    const current = extractionSchema.parse({ ...base, rsvpDecisionSource: 'current_message' });
    expect(current.rsvpDecisionSource).toBe('current_message');
    const planState = extractionSchema.parse({ ...base, rsvpDecisionSource: 'plan_state' });
    expect(planState.rsvpDecisionSource).toBe('plan_state');
  });

  it('exposes rsvpDecisionSource only when rsvp capability is enabled', () => {
    const withoutRsvp = createDynamicExtractionSchema({
      allowedActionIntents: ['solicitar_humano'],
      capabilities: capabilityProfile(),
    });
    expect(withoutRsvp.keyof().options).not.toContain('rsvpDecisionSource');
    const withRsvp = createDynamicExtractionSchema({
      allowedActionIntents: ['solicitar_humano', 'responder_invitacion'],
      capabilities: { ...capabilityProfile(), rsvp: true },
    });
    expect(withRsvp.keyof().options).toEqual(expect.arrayContaining(['rsvpDecisionSource']));
  });

  it('derives the established lane from typed plan state', () => {
    const fresh = createEmptyPlan({ planId: 'p-l3-fresh', channel: 'whatsapp', externalUserId: 'u' });
    expect(deriveEstablishedExtractionDomain(fresh)).toBeNull();

    const purchase = mergePlan(fresh, {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: null,
        pending_requests: [{
          requestId: 'information-1',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pago.',
          orderId: null,
          aspects: ['payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        }],
        selection_candidates: [],
      },
    });
    expect(deriveEstablishedExtractionDomain(purchase)).toBe('purchase');

    const support = mergePlan(fresh, {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: null,
        pending_requests: [{
          requestId: 'information-1',
          kind: 'faq',
          query: '¿Cuánto demora un retiro?',
        }],
        selection_candidates: [],
      },
    });
    expect(deriveEstablishedExtractionDomain(support)).toBe('support');

    const rsvp = mergePlan(fresh, { current_node: 'responder_invitacion' });
    expect(deriveEstablishedExtractionDomain(rsvp)).toBe('rsvp');
  });

  it('narrows established purchase/support/RSVP profiles to non-planning fields', () => {
    const manifest = buildRuntimeCapabilityManifest({});
    const fresh = createEmptyPlan({ planId: 'p-l3-prof', channel: 'whatsapp', externalUserId: 'u' });
    const purchase = mergePlan(fresh, {
      current_node: 'resolver_consultas_informativas',
      information_state: {
        resume_node: null,
        pending_requests: [{
          requestId: 'information-1',
          kind: 'purchase',
          resource: 'orders',
          query: 'Estado del pago.',
          orderId: null,
          aspects: ['payment_status'],
          sensitiveFields: [],
          authAction: 'none',
        }],
        selection_candidates: [],
      },
    });
    const projected = projectExtraction({
      plan: purchase,
      manifest,
      requestedDomain: 'purchase',
      candidateOperations: [],
      allowedActionIntents: actionIntentValues,
    });
    const properties = Object.keys(
      createDynamicExtractionSchema({
        allowedActionIntents: projected.allowedActionIntents,
        capabilities: projected.profile,
      }).shape,
    );

    for (const field of [
      'eventType', 'vendorCategory', 'providerQueryIntents',
      'providerPlanOperations', 'selectedProviderReferences',
      'closeAction', 'pauseRequested',
    ]) {
      expect(properties).not.toContain(field);
    }
    expect(properties).toEqual(expect.arrayContaining([
      'informationRequests', 'supportAct', 'requestedOperation', 'contactEmail',
    ]));

    const rsvpPlan = mergePlan(fresh, { current_node: 'responder_invitacion' });
    const rsvpProjected = projectExtraction({
      plan: rsvpPlan,
      manifest,
      requestedDomain: 'rsvp',
      candidateOperations: [],
      allowedActionIntents: actionIntentValues,
    });
    const rsvpProperties = Object.keys(
      createDynamicExtractionSchema({
        allowedActionIntents: rsvpProjected.allowedActionIntents,
        capabilities: rsvpProjected.profile,
      }).shape,
    );
    expect(rsvpProperties).toEqual(expect.arrayContaining(['rsvpAction', 'rsvpParty']));
    expect(rsvpProperties).not.toContain('providerQueryIntents');
  });
});

function capabilityProfile(
  overrides: Partial<ExtractionCapabilityProfile> = {},
): ExtractionCapabilityProfile {
  return {
    information: false,
    rsvp: false,
    providerPlanning: false,
    providerOperations: false,
    providerSelection: false,
    providerInspection: false,
    contact: false,
    close: false,
    pause: false,
    ...overrides,
  };
}

describe('source discovery request contract', () => {
  it('accepts purchase_discovery as a request-only resource', async () => {
    const schemas = await import('../src/runtime/extraction-schemas');
    const core = await import('../src/core/information');
    const parsed = schemas.openAiInformationRequestSchema.safeParse({
      kind: 'purchase',
      query: '¿Cuándo llega mi regalo?',
      eventHint: null,
      resource: 'purchase_discovery',
      orderId: null,
      amount: null,
      aspects: ['summary', 'shipping'],
      sensitiveFields: [],
      authAction: null,
      hostWithdrawal: null,
    });
    expect(parsed.success).toBe(true);

    const pending = core.pendingInformationRequestSchema.safeParse({
      requestId: 'information-1',
      kind: 'purchase',
      resource: 'purchase_discovery',
      query: '¿Cuándo llega mi regalo?',
      orderId: null,
      aspects: ['summary'],
      sensitiveFields: [],
      authAction: 'none',
    });
    expect(pending.success).toBe(true);

    // Backend/result PurchaseResource stays the two real sources: discovery
    // is request-only and never a backend partition.
    expect(core.purchaseResourceValues).toEqual(['orders', 'gift_purchases']);
    expect(
      (core.purchaseResourceValues as readonly string[]).includes('purchase_discovery'),
    ).toBe(false);
    expect(core.purchaseRequestResourceValues).toEqual(
      ['orders', 'gift_purchases', 'purchase_discovery'],
    );
  });

  it('registers purchase.read as a generic read that grants no new access', async () => {
    const manifestModule = await import('../src/runtime/capability-manifest');
    expect(
      (manifestModule.runtimeOperationIds as readonly string[]).includes('purchase.read'),
    ).toBe(true);
    const manifest = manifestModule.buildRuntimeCapabilityManifest();
    const read = (manifest as unknown as Record<string, { available: boolean }>)['purchase.read'];
    expect(read?.available).toBe(true);
    // purchase.read mirrors the existing purchase-information flag: disabling
    // purchase reads disables the generic operation identically.
    const disabled = manifestModule.buildRuntimeCapabilityManifest({
      featureFlags: { purchaseInformation: false },
    });
    const disabledMap = disabled as unknown as Record<string, { available: boolean }>;
    expect(disabledMap['purchase.read']?.available).toBe(false);
    expect(disabledMap['purchase.orders.read']?.available).toBe(false);
    expect(disabledMap['purchase.gift_detail.read']?.available).toBe(false);
    expect(
      (manifestModule.runtimeRequestedOperationIds as readonly string[]).includes('purchase.read'),
    ).toBe(true);
    expect(manifestModule.isServableInformationRead('purchase.read')).toBe(true);
  });

  it('keeps requestedOperation and resource in agreement', async () => {
    const schemas = await import('../src/runtime/extraction-schemas');
    const purchaseRequest = (
      resource: 'orders' | 'gift_purchases' | 'purchase_discovery',
    ) => ({
      kind: 'purchase' as const,
      hostWithdrawal: null,
      resource,
    });
    // Agreeing pairs pass through untouched.
    expect(
      schemas.normalizeRequestedOperation('purchase.read', [purchaseRequest('purchase_discovery')], null),
    ).toBe('purchase.read');
    expect(
      schemas.normalizeRequestedOperation('purchase.orders.read', [purchaseRequest('orders')], null),
    ).toBe('purchase.orders.read');
    expect(
      schemas.normalizeRequestedOperation('purchase.read', [purchaseRequest('orders')], null),
    ).toBe('purchase.read');
    // A specific operation contradicting the subject-based resource is
    // repaired toward the resource instead of rerouting the read.
    expect(
      schemas.normalizeRequestedOperation('purchase.orders.read', [purchaseRequest('gift_purchases')], null),
    ).toBe('purchase.gift_detail.read');
    expect(
      schemas.normalizeRequestedOperation('purchase.gift_detail.read', [purchaseRequest('orders')], null),
    ).toBe('purchase.orders.read');
    // Non-purchase operations and turns without purchase requests are untouched.
    expect(schemas.normalizeRequestedOperation('faq.read', [purchaseRequest('orders')], null)).toBe('faq.read');
    expect(schemas.normalizeRequestedOperation('purchase.orders.read', [], null)).toBe('purchase.orders.read');
    expect(schemas.isPurchaseOperationResourceAgreement('purchase.read', 'purchase_discovery')).toBe(true);
    expect(schemas.isPurchaseOperationResourceAgreement('purchase.orders.read', 'gift_purchases')).toBe(false);
  });

  it('writes the subject-based source contract into the extractor prompts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const information = fs.readFileSync(
      path.resolve(process.cwd(), 'prompts/extractors/information.txt'),
      'utf8',
    );
    expect(information).toContain('purchase_discovery');
    expect(information).toContain('purchase.read');
    // Subject-based ownership: established shop orders/carts read orders,
    // established gift purchases read gift_purchases, unknown ownership
    // reads purchase_discovery. Aspects never select the backend partition.
    expect(information).not.toContain('gift_purchases` para pago');
    expect(information).not.toMatch(/“estado de mi pedido”\s*→\s*`?orders/);
    const boundary = fs.readFileSync(
      path.resolve(process.cwd(), 'prompts/extractors/capability_boundary.txt'),
      'utf8',
    );
    expect(boundary).toContain('purchase.read');
  });
});
