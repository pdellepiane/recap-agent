import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { AgentService } from '../src/runtime/agent-service';
import { closeActionSchema } from '../src/runtime/close-flow-schemas';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractionResult } from '../src/runtime/contracts';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = { terminal_whatsapp: new WhatsAppMessageRenderer() };

class ScriptedRuntime implements AgentRuntime {
  constructor(private readonly extractions: ExtractionResult[]) {}
  private index = 0;
  async extract(): Promise<ExtractionResult> {
    const next = this.extractions[this.index] ?? this.extractions[this.extractions.length - 1];
    this.index += 1;
    if (!next) throw new Error('Missing extraction fixture.');
    return next;
  }
  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    void request;
    return { text: 'Respuesta compuesta.' };
  }
}

class QuietKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<never> {
    throw new Error('no kb');
  }
}

class RecordingAgentGateway {
  async logMessage() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async getRecentMessages() {
    return { status: 'skipped' as const, reason: 'disabled' as const, message: 'disabled' };
  }
  async requestHumanTakeover() {
    return { status: 'success' as const, message: 'ok' };
  }
  async getGuestOrdersByPhone() {
    return { status: 'not_found' as const, resource: 'orders' as const, orderId: null };
  }
  async getGuestGiftPurchasesByPhone() {
    return { status: 'not_found' as const, resource: 'gift_purchases' as const, orderId: null };
  }
  async authByPhone() {
    return { status: 'failed' as const, error: 'disabled', retryable: false as const };
  }
  async updatePhone() {
    return { status: 'success' as const };
  }
}

function scriptedProviderGateway() {
  return {
    async requestUserLoginCode() {
      return { status: 'sent' as const };
    },
    async verifyUserLoginCode() {
      return { status: 'authenticated' as const, token: 't', tokenExpiresAt: new Date().toISOString() };
    },
  } as unknown as ProviderGateway;
}

function baseExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    phoneConfirmation: null,
    intentConfidence: 0.9,
    ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
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
    conversationSummary: 'Resumen.',
    selectedProviderHints: [],
    selectedProviderReferences: [],
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
  } as ExtractionResult;
}

function seedClosedPlan(planStore: InMemoryPlanStore) {
  const seed = mergePlan(
    createEmptyPlan({ planId: 'close-proceed', channel: 'whatsapp', externalUserId: 'close-user' }),
    {
      current_node: 'crear_lead_cerrar',
      event_type: 'boda',
      location: 'Lima',
      active_need_category: 'Fotografía y video',
      vendor_category: 'Fotografía y video',
      contact_name: 'Carolina',
      contact_email: 'carolina@example.com',
      contact_phone: '51900000302',
      provider_needs: [
        {
          category: 'Fotografía y video',
          status: 'selected',
          preferences: [],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [90],
          recommended_providers: [
            {
              id: 90,
              title: 'Carlos Schult',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: null,
              reason: 'primera',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
          selected_provider_ids: [90],
          selected_provider_hints: [],
        },
      ],
    } as never,
  );
  return planStore.save({ plan: seed, reason: 'seed' });
}

describe('proceed_confirmed close state', () => {
  it('schema accepts the confirmed-proceed discriminant', () => {
    const parsed = closeActionSchema.parse({ type: 'proceed_confirmed', category: null, reason: null });
    expect(parsed.type).toBe('proceed_confirmed');
  });

  it('explicit confirmation stays in close handling without reopening auth or contact', async () => {
    const planStore = new InMemoryPlanStore();
    await seedClosedPlan(planStore);
    const extraction = baseExtraction({
      actionIntent: 'cerrar',
      closeAction: { type: 'proceed_confirmed', category: null, reason: null },
    });
    const agentGateway = new RecordingAgentGateway();
    const service = new AgentService({
      planStore,
      runtime: new ScriptedRuntime([extraction]),
      providerGateway: scriptedProviderGateway(),
      promptLoader,
      renderers,
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: new QuietKnowledgeGateway(),
        providerGateway: scriptedProviderGateway(),
        agentGateway: agentGateway as never,
      }),
      agentConversationGateway: agentGateway as never,
    });
    const res = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'close-user',
      contactPhone: '+51900000302',
      text: 'Confirmo: envía la solicitud de cotización a Carlos Schult y cierra el plan.',
      messageId: 'close-proceed-1',
      receivedAt: new Date().toISOString(),
    });
    expect(res.plan.current_node).toBe('crear_lead_cerrar');
    expect(res.trace.close_action_summary).toEqual({
      type: 'proceed_confirmed',
      category: null,
      reason_preview: null,
    });
    expect(res.trace.tools_called ?? []).not.toContain('request_user_login_code');
    expect(res.trace.tools_called ?? []).not.toContain('verify_user_login_code');
    expect(res.trace.tools_called ?? []).not.toContain('request_human_takeover');
    expect(res.trace.tools_called ?? []).not.toContain('search_providers_from_plan');
  });
});
