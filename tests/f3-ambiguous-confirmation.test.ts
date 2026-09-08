import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { AgentService } from '../src/runtime/agent-service';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import type { AgentRuntime, ExtractionResult } from '../src/runtime/contracts';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

const AMBIGUOUS_QUESTION = '¿Qué proveedor o acción estás confirmando?';

function planningExtraction(
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    supportAct: null,
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: null,
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: 0.9,
    ambiguity: { status: 'ambiguous', clarificationQuestion: null, interpretations: [] },
    eventType: 'boda',
    vendorCategory: null,
    vendorCategories: [],
    activeNeedCategory: 'Fotografía y video',
    location: 'Lima',
    budgetSignal: null,
    guestRange: '51-100',
    preferences: ['estilo natural'],
    hardConstraints: [],
    assumptions: [],
    conversationSummary: 'Shortlist de fotografia.',
    selectedProviderHints: [],
    selectedProviderReferences: [],
    closeAction: null,
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
  } as unknown as ExtractionResult;
}

function seedPlanningPlan(planId: string) {
  return mergePlan(
    createEmptyPlan({ planId, channel: 'whatsapp', externalUserId: 'u-f3d' }),
    {
      current_node: 'recomendar',
      event_type: 'boda',
      location: 'Lima',
      guest_range: '51-100',
      active_need_category: 'Fotografía y video',
      vendor_category: 'Fotografía y video',
      provider_needs: [
        {
          category: 'Fotografía y video',
          status: 'shortlisted',
          preferences: ['estilo natural'],
          hard_constraints: [],
          missing_fields: [],
          recommended_provider_ids: [90, 91],
          recommended_providers: [
            {
              id: 90,
              title: 'Carlos Schult',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: null,
              reason: 'primera opción presentada',
              serviceHighlights: [],
              termsHighlights: [],
            },
            {
              id: 91,
              title: 'Fotografía Alternativa',
              category: 'Fotografía y video',
              location: 'Lima',
              priceLevel: null,
              reason: 'segunda opción presentada',
              serviceHighlights: [],
              termsHighlights: [],
            },
          ],
          selected_provider_ids: [],
          selected_provider_hints: [],
        },
      ],
      selected_provider_ids: [],
    },
  );
}

async function runPlanningTurn(extraction: ExtractionResult, text = 'Sí confirmo.') {
  const store = new InMemoryPlanStore();
  await store.save({ plan: seedPlanningPlan('p-f3d'), reason: 'seed' });
  const gateway = {
    async logMessage(input: unknown) {
      void input;
      return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success', messages: [] };
    },
    async requestHumanTakeover() {
      return { status: 'success', message: 'Requested.' };
    },
    async authByPhone() {
      return { status: 'failed', error: 'Unused.', retryable: false };
    },
    async updatePhone() {
      return { status: 'success' };
    },
    async getGuestEventsByPhone() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
    async getEventDetail() {
      return { status: 'not_found', error: 'not', retryable: false };
    },
  } as unknown as AgentConversationGateway;
  const service = new AgentService({
    planStore: store,
    runtime: {
      async extract(): Promise<ExtractionResult> {
        return extraction;
      },
      async composeReply() {
        return {
          text: 'Gracias por confirmarlo. Avanzamos con fotografia y video.',
          structuredMessage: {
            type: 'generic',
            paragraphs_es: ['Gracias por confirmarlo. Avanzamos con fotografia y video.'],
          },
        };
      },
    } as unknown as AgentRuntime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'u-f3d',
    text,
    messageId: 'm-f3d-1',
    receivedAt: '2026-09-04T15:01:00.000Z',
  });
}

describe('F3d bare confirmation over a multi-option shortlist', () => {
  it('asks which provider or action is confirmed instead of assuming it', async () => {
    const result = await runPlanningTurn(planningExtraction());
    const text = result.outbound.text ?? '';
    expect(text).toContain(AMBIGUOUS_QUESTION);
  });

  it('keeps asking when the confirmation intent has no grounded reference', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'confirmar_proveedor',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      }),
    );
    const text = result.outbound.text ?? '';
    expect(text).toContain(AMBIGUOUS_QUESTION);
  });

  it('does not ask when the user names a shortlisted provider', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: 'confirmar_proveedor',
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        selectedProviderHints: ['Carlos Schult'],
      }),
      'Sí, confirmo a Carlos Schult.',
    );
    const text = result.outbound.text ?? '';
    expect(text).not.toContain(AMBIGUOUS_QUESTION);
  });

  it('asks on a bare confirmation even when the extractor marks it clear', async () => {
    const result = await runPlanningTurn(
      planningExtraction({
        actionIntent: null,
        ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
        eventType: null,
        activeNeedCategory: null,
        location: null,
        guestRange: null,
        preferences: [],
      }),
    );
    const text = result.outbound.text ?? '';
    expect(text).toContain(AMBIGUOUS_QUESTION);
  });
});
