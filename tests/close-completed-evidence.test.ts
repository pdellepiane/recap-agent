import path from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { AgentService } from '../src/runtime/agent-service';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import type { AgentRuntime } from '../src/runtime/contracts';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const provider = {
  id: 90,
  title: 'Carlos Schult',
  category: 'Fotografía y video' as const,
  location: 'Lima',
  priceLevel: null,
  reason: 'primera',
  serviceHighlights: [],
  termsHighlights: [],
};

function createRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-5.6-luna',
    extractorModel: 'gpt-5.6-luna',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: {} as never,
    providerGateway: {} as never,
  });
}

function baseExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    phoneConfirmation: null,
    intentConfidence: 0.95,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
    eventType: 'baby_shower',
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
    providerFitCriteria: null,
    providerQueryIntents: [],
    providerPlanOperations: [],
    providerExplanationRequest: null,
    providerDetailRequest: null,
    ...overrides,
  };
}

function plan(overrides: {
  lifecycle_state: 'active' | 'finished';
  current_node: 'necesidad_cubierta' | 'crear_lead_cerrar' | 'entrevista';
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}) {
  return mergePlan(
    createEmptyPlan({ planId: 'close-evidence', channel: 'whatsapp', externalUserId: 'evidence-user' }),
    {
      lifecycle_state: overrides.lifecycle_state,
      current_node: overrides.current_node,
      event_type: 'boda',
      active_need_category: 'Fotografía y video',
      vendor_category: 'Fotografía y video',
      contact_name: overrides.contact_name === undefined ? 'Carolina' : overrides.contact_name,
      contact_email: overrides.contact_email === undefined ? 'carolina@example.com' : overrides.contact_email,
      contact_phone: overrides.contact_phone === undefined ? '51900000302' : overrides.contact_phone,
      provider_needs: [{
        category: 'Fotografía y video',
        status: 'selected',
        preferences: [],
        hard_constraints: [],
        missing_fields: [],
        recommended_provider_ids: [90],
        recommended_providers: [provider],
        selected_provider_ids: [90],
        selected_provider_hints: [],
      }],
    },
  );
}

function readEvidence(input: string): {
  plan: Record<string, unknown>;
  turn_state: Record<string, unknown>;
  provider_candidates: Array<Record<string, unknown>>;
  [key: string]: unknown;
} {
  const marker = 'Evidencia canónica del turno (JSON): ';
  const json = input.slice(input.indexOf(marker) + marker.length).split('\n\n')[0];
  return JSON.parse(json ?? '{}') as {
    plan: Record<string, unknown>;
    turn_state: Record<string, unknown>;
    provider_candidates: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

function composeInput(request: ComposeReplyRequest): string {
  const runtime = createRuntime() as unknown as {
    composeConversationInput: (
      replyRequest: ComposeReplyRequest,
      funnel: { available_candidates: number; context_candidates: number; context_candidate_ids: number[]; presentation_limit: number },
    ) => string;
  };
  return runtime.composeConversationInput(request, {
    available_candidates: 0,
    context_candidates: 0,
    context_candidate_ids: [],
    presentation_limit: 0,
  });
}

function request(overrides: Partial<ComposeReplyRequest> = {}): ComposeReplyRequest {
  return {
    currentNode: 'necesidad_cubierta',
    previousNode: 'necesidad_cubierta',
    userMessage: 'Confirma otra vez el envío de esa misma solicitud, por favor.',
    messageContext: localTurnMessageContext('not_configured'),
    plan: plan({ lifecycle_state: 'finished', current_node: 'necesidad_cubierta' }),
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: true,
    providerResults: [provider],
    errorMessage: null,
    promptBundleId: 'bundle-close',
    promptFilePaths: ['nodes/necesidad_cubierta/response_contract.txt'],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  };
}

describe('completed close evidence', () => {
  it('distinguishes an existing completion from a new authorized receipt', () => {
    const existingInput = composeInput(request());
    const existing = readEvidence(existingInput);
    expect(existing.turn_state).toMatchObject({
      close_already_sent: true,
      close_submission_performed_this_turn: false,
    });
    expect(existing.plan['provider_needs']).toEqual([
      expect.objectContaining({ selected_provider_ids: [90], selected_provider_titles: ['Carlos Schult'] }),
    ]);
    expect(existing).not.toHaveProperty('finish_plan');
    expect(existing.turn_state).not.toHaveProperty('finish_plan');

    const authorized = readEvidence(composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      userMessage: 'Confirmo el envío para el 2026-10-18.',
      plan: plan({ lifecycle_state: 'active', current_node: 'crear_lead_cerrar' }),
      extraction: baseExtraction({
        actionIntent: 'cerrar',
        closeAction: { type: 'proceed_confirmed', category: null, reason: null },
      }),
    })));
    expect(authorized.turn_state['close_ready_to_dispatch']).toBe(true);
    expect(authorized.turn_state).not.toHaveProperty('close_already_sent');
    expect(authorized.turn_state).not.toHaveProperty('close_submission_performed_this_turn');

    const unrelated = readEvidence(composeInput(request({
      currentNode: 'entrevista',
      previousNode: 'entrevista',
      userMessage: 'Quiero revisar las opciones para mi evento.',
      plan: plan({ lifecycle_state: 'active', current_node: 'entrevista' }),
      extraction: baseExtraction({ actionIntent: 'ver_opciones' }),
    })));
    expect(unrelated.turn_state).not.toHaveProperty('close_already_sent');
    expect(unrelated.turn_state).not.toHaveProperty('close_submission_performed_this_turn');
    expect(unrelated).not.toHaveProperty('close_submission_receipt');
    expect(composeInput(request({
      currentNode: 'entrevista',
      previousNode: 'entrevista',
      userMessage: 'Quiero revisar las opciones para mi evento.',
      plan: plan({ lifecycle_state: 'active', current_node: 'entrevista' }),
      extraction: baseExtraction({ actionIntent: 'ver_opciones' }),
    }))).toBe(composeInput(request({
      currentNode: 'entrevista',
      previousNode: 'entrevista',
      userMessage: 'Quiero revisar las opciones para mi evento.',
      plan: plan({ lifecycle_state: 'active', current_node: 'entrevista' }),
      extraction: baseExtraction({ actionIntent: 'ver_opciones' }),
    })));
  });

  it('guides completed retries toward the existing outcome rather than a new send', () => {
    const bundle = readFileSync(
      path.resolve(process.cwd(), 'prompts', 'nodes', 'necesidad_cubierta', 'response_contract.txt'),
      'utf8',
    );
    expect(bundle).toContain('close_submission_performed_this_turn');
    expect(bundle).toContain('confirma ese resultado como un estado existente');
    expect(bundle).toContain('no anuncies ni ejecutes un envío nuevo');
  });

  it('projects actual close effects before reply delivery', () => {
    const input = composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      userMessage: 'Confirmo el envío para el 2026-10-18.',
      plan: plan({ lifecycle_state: 'active', current_node: 'crear_lead_cerrar' }),
      extraction: baseExtraction({
        actionIntent: 'cerrar',
        closeAction: { type: 'proceed_confirmed', category: null, reason: null },
      }),
      toolUsage: {
        considered: ['finish_plan'],
        called: ['finish_plan'],
        inputs: [],
        outputs: [{
          tool: 'finish_plan',
          output: JSON.stringify({
            status: 'partial',
            eventDate: '2026-10-18',
            effects: [{
              providerId: 90,
              category: 'Fotografía y video',
              status: 'confirmed',
              eventDate: '2026-10-18',
              receiptId: 'quote-90',
              attemptCount: 1,
            }, {
              providerId: 91,
              category: 'Catering',
              status: 'failed',
              eventDate: '2026-10-18',
              receiptId: null,
              attemptCount: 1,
            }],
          }),
        }],
      },
    }));
    const evidence = readEvidence(input);
    expect(evidence.close_submission_receipt).toEqual({
      status: 'partial',
      eventDate: '2026-10-18',
      providers: [{
        providerId: 90,
        category: 'Fotografía y video',
        status: 'confirmed',
        eventDate: '2026-10-18',
        receiptId: 'quote-90',
        attemptCount: 1,
      }, {
        providerId: 91,
        category: 'Catering',
        status: 'failed',
        eventDate: '2026-10-18',
        receiptId: null,
        attemptCount: 1,
      }],
      error: null,
    });
  });

  it('projects only the missing contact fields on an incomplete close', () => {
    const evidence = readEvidence(composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      plan: plan({
        lifecycle_state: 'active',
        current_node: 'crear_lead_cerrar',
        contact_email: null,
        contact_phone: null,
      }),
    })));
    expect(evidence.turn_state).toMatchObject({
      close_contact_missing_fields: ['contact_email', 'contact_phone'],
      close_unresolved_provider_needs: [],
    });
  });

  it('projects unresolved provider choices as IDs rather than a question', () => {
    const seeded = plan({ lifecycle_state: 'active', current_node: 'crear_lead_cerrar' });
    seeded.provider_needs.push({
      category: 'Catering',
      status: 'shortlisted',
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      recommended_provider_ids: [101],
      recommended_providers: [],
      selected_provider_ids: [],
      selected_provider_hints: [],
    });
    const evidence = readEvidence(composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      plan: seeded,
    })));
    expect(evidence.turn_state).toMatchObject({
      close_unresolved_provider_needs: [{ category: 'Catering', candidate_provider_ids: [] }],
    });
  });
});

describe('R5 authoritative close projection', () => {
  function closePlanWithDeferredCatering() {
    const seeded = plan({ lifecycle_state: 'active', current_node: 'crear_lead_cerrar' });
    seeded.provider_needs.push({
      category: 'Catering',
      status: 'deferred',
      preferences: [],
      hard_constraints: [],
      missing_fields: [],
      recommended_provider_ids: [109],
      recommended_providers: [{
        id: 109,
        title: 'EDO Sushi Bar',
        category: 'Catering',
        location: 'Lima',
        priceLevel: 'high',
        reason: 'opción catering',
        serviceHighlights: [],
        termsHighlights: [],
      }],
      selected_provider_ids: [],
      selected_provider_hints: [],
    });
    return seeded;
  }

  it('keeps the saved phone out of the missing list after a name/email delta and drops raw contact nulls', () => {
    const evidence = readEvidence(composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      userMessage: 'Soy Carolina Mendoza, mi correo es carolina.m@example.com',
      plan: plan({ lifecycle_state: 'active', current_node: 'crear_lead_cerrar' }),
      extraction: baseExtraction({
        actionIntent: 'cerrar',
        contactName: 'Carolina Mendoza',
        contactEmail: 'carolina.m@example.com',
        contactPhone: null,
      }),
    })));
    expect(evidence.turn_state).toMatchObject({
      close_contact_missing_fields: [],
      close_contact_complete: true,
      contact_phone_already_provided: true,
    });
    const extraction = evidence['extraction'] as Record<string, unknown>;
    expect(extraction).not.toHaveProperty('contact');
    expect(JSON.stringify(evidence)).not.toContain('"phone":null');
    const contact = evidence.plan['contact'] as Record<string, unknown>;
    expect(contact).toMatchObject({ phone: '51900000302', complete: true, missing_fields: [] });
  });

  it('foregrounds the selected photo need and never the deferred catering cards', () => {
    const seeded = closePlanWithDeferredCatering();
    seeded.active_need_category = 'Catering' as never;
    const evidence = readEvidence(composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      userMessage: 'Quiero cerrar con el fotógrafo, el catering lo veo después',
      plan: seeded,
      extraction: baseExtraction({
        actionIntent: 'cerrar',
        closeAction: { type: 'confirm_close', category: null, reason: null },
      }),
    })));
    expect(evidence.turn_state['focus_need_category']).toBe('Fotografía y video');
    expect(evidence.turn_state).toMatchObject({
      close_selected_providers: [{ category: 'Fotografía y video', provider_ids: [90] }],
      close_deferred_categories: ['Catering'],
      close_unresolved_provider_needs: [],
      close_event_date_available: false,
      close_pending_intention: 'confirm_close',
    });
    expect(evidence.turn_state['close_remaining_blockers']).toContain('missing_event_date');
    const planSnapshot = evidence.plan;
    expect(planSnapshot).not.toHaveProperty('selected_provider_ids');
    expect(planSnapshot).not.toHaveProperty('recommended_provider_ids');
    expect(JSON.stringify(evidence)).not.toContain('EDO');
    expect(evidence.provider_candidates.map((candidate) => candidate['id'])).toEqual([90]);
  });

  it('exposes a user-backed date with no remaining blockers once dated and authorized', () => {
    const evidence = readEvidence(composeInput(request({
      currentNode: 'crear_lead_cerrar',
      previousNode: 'crear_lead_cerrar',
      userMessage: 'Confirmo el envío para el 2026-10-18.',
      plan: plan({ lifecycle_state: 'active', current_node: 'crear_lead_cerrar' }),
      extraction: baseExtraction({
        actionIntent: 'cerrar',
        closeAction: { type: 'proceed_confirmed', category: null, reason: null },
      }),
    })));
    expect(evidence.turn_state).toMatchObject({
      close_event_date_available: true,
      close_pending_intention: 'proceed_confirmed',
      close_remaining_blockers: [],
      close_ready_to_dispatch: true,
    });
  });
});

class SentinelRuntime implements AgentRuntime {
  constructor(private readonly paragraphs: string[]) {}

  async extract(): Promise<ExtractionResult> {
    return baseExtraction();
  }

  async composeReply(): Promise<ComposeReplyResult> {
    return {
      text: '',
      structuredMessage: { type: 'generic', paragraphs_es: [...this.paragraphs] },
    };
  }
}

class CountingExtractionRuntime implements AgentRuntime {
  public extractionCalls = 0;
  public composeRequests: ComposeReplyRequest[] = [];

  constructor(
    private readonly extraction: ExtractionResult,
    public readonly replyText: string,
  ) {}

  async extract(): Promise<ExtractionResult> {
    this.extractionCalls += 1;
    return this.extraction;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: this.replyText };
  }
}

const nullKnowledgeGateway: KnowledgeRetrievalGateway = {
  async search() {
    throw new Error('no knowledge lookups on completed close path');
  },
};

async function runCompletedClose(paragraphs: string[]) {
  const planStore = new InMemoryPlanStore();
  await planStore.save({ plan: plan({ lifecycle_state: 'finished', current_node: 'necesidad_cubierta' }), reason: 'seed' });
  const service = new AgentService({
    planStore,
    runtime: new SentinelRuntime(paragraphs),
    providerGateway: {} as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: nullKnowledgeGateway,
      providerGateway: undefined,
      agentGateway: undefined,
    } as unknown as ConstructorParameters<typeof InformationOrchestrator>[0]),
  });
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'evidence-user',
    contactPhone: '+51900000302',
    text: 'Confirma otra vez el envío de esa misma solicitud, por favor.',
    messageId: `completed-close-${paragraphs.length}`,
    receivedAt: new Date().toISOString(),
  });
}

describe('completed close output origin', () => {
  it.each([
    ['first sentinel response', ['Tomo nota del faro verde.', 'Mantengo el hilo abierto.']],
    ['second sentinel response', ['Registro el puente amarillo de siete tablones.']],
  ])('delivers the %s verbatim through the finished-plan branch', async (_label, paragraphs) => {
    const response = await runCompletedClose(paragraphs);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe(paragraphs.join('\n\n'));
    expect(response.trace.next_node).toBe('necesidad_cubierta');
    expect(response.trace.prompt_file_paths).toContain(
      'nodes/necesidad_cubierta/response_contract.txt',
    );
  });
});

describe('completed plan intent routing', () => {
  it('keeps a finished plan when confirmation repeats the completed outcome', async () => {
    const runtime = new CountingExtractionRuntime(
      baseExtraction({
        actionIntent: 'confirmar_proveedor',
        requestedOperation: 'provider.quote.write',
      }),
      'La solicitud ya fue enviada y el proveedor seleccionado es Carlos Schult.',
    );
    const planStore = new InMemoryPlanStore();
    const finishedPlan = plan({ lifecycle_state: 'finished', current_node: 'necesidad_cubierta' });
    await planStore.save({ plan: finishedPlan, reason: 'seed' });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: nullKnowledgeGateway,
        providerGateway: undefined,
        agentGateway: undefined,
      } as unknown as ConstructorParameters<typeof InformationOrchestrator>[0]),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'evidence-user',
      contactPhone: '+51900000302',
      text: 'Confirma otra vez el envío de esa misma solicitud, por favor.',
      messageId: 'completed-confirmation',
      receivedAt: new Date().toISOString(),
    });

    expect(runtime.extractionCalls).toBe(1);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.outbound.text).toBe(runtime.replyText);
    expect(response.plan.plan_id).toBe(finishedPlan.plan_id);
    expect(response.plan.lifecycle_state).toBe('finished');
    expect(response.plan.provider_needs[0]?.selected_provider_ids).toEqual([90]);
    expect(response.trace.prompt_bundle_id).not.toBe('deterministic:capability_clarification');
    expect(response.trace.previous_node).not.toBe('contacto_inicial');
    expect(response.trace.node_path).not.toContain('contacto_inicial');
    expect(response.trace.tools_called).not.toContain('finish_plan');
  });

  it('still resets a finished plan for reset_plan', async () => {
    const runtime = new CountingExtractionRuntime(
      baseExtraction({ actionIntent: 'reset_plan' }),
      'Comencemos un plan nuevo.',
    );
    const planStore = new InMemoryPlanStore();
    const finishedPlan = plan({ lifecycle_state: 'finished', current_node: 'necesidad_cubierta' });
    await planStore.save({ plan: finishedPlan, reason: 'seed' });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: nullKnowledgeGateway,
        providerGateway: undefined,
        agentGateway: undefined,
      } as unknown as ConstructorParameters<typeof InformationOrchestrator>[0]),
    });

    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'evidence-user',
      contactPhone: '+51900000302',
      text: 'Quiero empezar de nuevo.',
      messageId: 'completed-reset',
      receivedAt: new Date().toISOString(),
    });

    expect(response.plan.plan_id).not.toBe(finishedPlan.plan_id);
    expect(response.plan.lifecycle_state).toBe('active');
    expect(response.trace.next_node).toBe('reset_plan');
  });
});
