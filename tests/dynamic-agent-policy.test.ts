import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan, type ProviderNeed } from '../src/core/plan';
import {
  deriveDynamicAgentPolicy,
  resolveDynamicTools,
} from '../src/runtime/dynamic-agent-policy';
import { createDynamicExtractionSchema } from '../src/runtime/extraction-schemas';
import type { ExtractionCapabilityProfile } from '../src/runtime/extraction-schemas';

function extractionCapabilities(
  overrides: Partial<ExtractionCapabilityProfile> = {},
): ExtractionCapabilityProfile {
  return {
    information: true,
    rsvp: true,
    providerPlanning: true,
    providerOperations: false,
    providerSelection: false,
    providerInspection: false,
    contact: true,
    close: false,
    pause: false,
    ...overrides,
  };
}

function createNeed(overrides: Partial<ProviderNeed> = {}): ProviderNeed {
  return {
    category: 'Fotografía y video',
    status: 'identified',
    preferences: [],
    hard_constraints: [],
    missing_fields: ['location'],
    recommended_provider_ids: [],
    recommended_providers: [],
    sub_query_results: [],
    selected_provider_ids: [],
    selected_provider_hints: [],
    ...overrides,
  };
}

function createPlan() {
  return createEmptyPlan({
    planId: 'plan-dynamic-policy',
    channel: 'terminal',
    externalUserId: 'user-dynamic-policy',
  });
}

describe('dynamic agent policy', () => {
  it('does not expose close or pause intents before a provider plan exists', () => {
    const plan = createPlan();
    const policy = deriveDynamicAgentPolicy(plan);

    expect(policy.allowedActionIntents).toContain('buscar_proveedores');
    expect(policy.allowedActionIntents).toContain('reset_plan');
    expect(policy.allowedActionIntents).not.toContain('cerrar');
    expect(policy.allowedActionIntents).not.toContain('pausar');
    expect(policy.allowedNextNodes).not.toContain('crear_lead_cerrar');
    expect(policy.allowedNextNodes).not.toContain('guardar_cerrar_temporalmente');
  });

  it('exposes reset as a structured action in every plan lifecycle state', () => {
    const states = [
      createPlan(),
      mergePlan(createPlan(), {
        current_node: 'entrevista',
        event_type: 'boda',
      }),
      mergePlan(createPlan(), {
        current_node: 'recomendar',
        provider_needs: [createNeed({
          status: 'shortlisted',
          recommended_provider_ids: [42],
        })],
      }),
      mergePlan(createPlan(), {
        current_node: 'necesidad_cubierta',
        lifecycle_state: 'finished',
      }),
    ];

    for (const plan of states) {
      const policy = deriveDynamicAgentPolicy(plan);
      const schema = createDynamicExtractionSchema({
        allowedActionIntents: policy.allowedActionIntents,
        capabilities: extractionCapabilities(),
      });

      expect(policy.allowedActionIntents).toContain('reset_plan');
      expect(policy.allowedNextNodes).toContain('reset_plan');
      expect(schema.shape.actionIntent.safeParse('reset_plan').success).toBe(true);
    }
  });

  it('exposes plan actions only after structured plan evidence exists', () => {
    const plan = mergePlan(createPlan(), {
      provider_needs: [createNeed()],
    });
    const policy = deriveDynamicAgentPolicy(plan);

    expect(policy.allowedActionIntents).toContain('cerrar');
    expect(policy.allowedActionIntents).toContain('pausar');
    expect(policy.allowedActionIntents).toContain('modificar_plan_proveedores');
    expect(policy.allowedActionIntents).not.toContain('confirmar_proveedor');
  });

  it('exposes shortlist actions only when recommendations exist', () => {
    const plan = mergePlan(createPlan(), {
      provider_needs: [
        createNeed({
          status: 'shortlisted',
          recommended_provider_ids: [42],
        }),
      ],
    });
    const policy = deriveDynamicAgentPolicy(plan);

    expect(policy.allowedActionIntents).toContain('confirmar_proveedor');
    expect(policy.allowedActionIntents).toContain('detallar_proveedor');
    expect(policy.allowedNextNodes).toContain('usuario_elige_proveedor');
  });

  it('builds an extraction schema that makes unavailable actions impossible', () => {
    const policy = deriveDynamicAgentPolicy(createPlan());
    const schema = createDynamicExtractionSchema({
      allowedActionIntents: policy.allowedActionIntents,
      capabilities: extractionCapabilities(),
    });

    expect(schema.shape.actionIntent.safeParse('cerrar').success).toBe(false);
    expect(schema.shape.actionIntent.safeParse('buscar_proveedores').success).toBe(true);
    expect(schema.shape.pauseRequested).toBeUndefined();
    expect(schema.shape.closeAction).toBeUndefined();
  });

  it('keeps FAQ and merged FAQ-plus-user-action extraction available in every plan state', () => {
    const policy = deriveDynamicAgentPolicy(createPlan());
    const schema = createDynamicExtractionSchema({
      allowedActionIntents: policy.allowedActionIntents,
      capabilities: extractionCapabilities(),
    });
    const parsed = schema.parse({
      actionIntent: 'buscar_proveedores',
      informationRequests: [
        {
          kind: 'faq',
          query: '¿Cómo funciona la lista de regalos?',
          eventHint: null,
          resource: null,
          orderId: null,
          aspects: [],
          sensitiveFields: [],
          authAction: null,
        },
      ],
      intentConfidence: 0.96,
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
      },
      eventType: 'boda',
      vendorCategory: 'Catering',
      vendorCategories: ['Catering'],
      activeNeedCategory: 'Catering',
      location: 'Lima',
      budgetSignal: null,
      guestRange: '51-100',
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Pregunta por la lista y busca catering para una boda.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: {
        eventType: 'boda',
        needCategory: 'catering',
        location: 'Lima',
        budgetAmount: null,
        budgetCurrency: null,
        mustHave: [],
        shouldAvoid: [],
        rankingNotes: 'Priorizar opciones adecuadas para una boda en Lima.',
      },
    });

    expect(parsed.informationRequests).toHaveLength(1);
    expect(parsed.actionIntent).toBe('buscar_proveedores');
    expect(policy.allowedNextNodes).toContain('resolver_consultas_informativas');
  });

  it('filters tools by current plan prerequisites', () => {
    const maximumTools = [
      'search_providers_from_plan',
      'get_provider_detail',
      'finish_plan',
    ] as const;
    const emptyPlan = createPlan();

    expect(resolveDynamicTools({
      plan: emptyPlan,
      maximumTools,
      searchReady: true,
      providerResults: [],
    })).toEqual([]);

    const readyPlan = mergePlan(emptyPlan, {
      contact_name: 'Sandra López',
      contact_email: 'sandra@example.com',
      contact_phone: '+51999999999',
      provider_needs: [
        createNeed({
          status: 'selected',
          missing_fields: [],
          recommended_provider_ids: [42],
          selected_provider_ids: [42],
        }),
      ],
    });

    expect(resolveDynamicTools({
      plan: readyPlan,
      maximumTools,
      searchReady: true,
      providerResults: [],
    })).toEqual(['search_providers_from_plan', 'finish_plan']);
  });
});
