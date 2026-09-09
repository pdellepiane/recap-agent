import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import {
  applyDocumentedTransportTransforms,
  assertModelOrigin,
  composeModelReply,
  ModelOriginViolationError,
} from '../src/runtime/model-composition';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const SENTINEL_A = [
  'Tomo nota del faro verde que parpadea dos veces sobre tu consulta.',
  'Mantengo el hilo abierto con el ancla azul en su lugar.',
];
const SENTINEL_B = [
  'Registro el puente amarillo de siete tablones que mencionas.',
];

class SentinelRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(private readonly paragraphs: string[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      actionIntent: null,
      informationRequests: [],
      phoneConfirmation: null,
      intentConfidence: 0.98,
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
      conversationSummary: 'Consulta informativa.',
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
      supportAct: { kind: 'defer_submission', topic: 'unknown', detail: 'unknown' },
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: '',
      structuredMessage: { type: 'generic', paragraphs_es: [...this.paragraphs] },
    };
  }
}

const nullKnowledgeGateway: KnowledgeRetrievalGateway = {
  async search() {
    throw new Error('no knowledge lookups on the support acknowledgment path');
  },
};

function createOriginService(runtime: AgentRuntime): AgentService {
  return new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: nullKnowledgeGateway,
      providerGateway: undefined,
      agentGateway: undefined,
    } as unknown as ConstructorParameters<typeof InformationOrchestrator>[0]),
  });
}

async function runSupportTurn(paragraphs: string[]) {
  const service = createOriginService(new SentinelRuntime(paragraphs));
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'origin-user',
    contactPhone: '+51900000302',
    text: 'Lo voy a enviar luego',
    messageId: `origin-${paragraphs.length}`,
    receivedAt: new Date().toISOString(),
  });
}

describe('model output origin (R01)', () => {
  it.each([
    ['first sentinel response', SENTINEL_A],
    ['second sentinel response', SENTINEL_B],
  ])('delivers %s verbatim through the migrated support path', async (_label, paragraphs) => {
    const response = await runSupportTurn(paragraphs);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe(paragraphs.join('\n\n'));
    expect(response.trace.prompt_file_paths).toContain(
      'nodes/resolver_consultas_informativas/support_continuity.txt',
    );
  });

  it('fails when post-generation code replaces the model paragraphs', async () => {
    const runtime = new SentinelRuntime(SENTINEL_A);
    const reply = await composeModelReply(runtime, {
      currentNode: 'resolver_consultas_informativas',
      previousNode: 'contacto_inicial',
      userMessage: 'Lo voy a enviar luego',
      messageContext: undefined,
      plan: mergePlan(createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'u' }), {}),
      extraction: await runtime.extract(undefined as unknown as ExtractRequest),
      missingFields: [],
      searchReady: false,
      providerResults: [],
      errorMessage: null,
      promptBundleId: 'test',
      promptFilePaths: [],
      toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    });
    expect(reply.origin?.modelParagraphs).toEqual(SENTINEL_A);
    const replaced = {
      ...reply,
      structuredMessage: { type: 'generic' as const, paragraphs_es: ['Texto fijo de respaldo.'] },
    };
    expect(() =>
      assertModelOrigin({ origin: reply.origin, reply: replaced, deliveredText: 'Texto fijo de respaldo.' }),
    ).toThrow(ModelOriginViolationError);
  });

  it('fails when a canned question is appended after generation', () => {
    expect(() =>
      assertModelOrigin({
        origin: { modelParagraphs: SENTINEL_B, bundleId: 'test' },
        reply: {
          text: '',
          structuredMessage: { type: 'generic', paragraphs_es: [...SENTINEL_B] },
        },
        deliveredText: `${SENTINEL_B[0]}\n\n¿Qué proveedor o acción estás confirmando?`,
      }),
    ).toThrow(ModelOriginViolationError);
  });

  it('passes unmigrated paths without a receipt through unchecked', () => {
    expect(() =>
      assertModelOrigin({
        origin: null,
        reply: { text: 'cualquier texto heredado' },
        deliveredText: 'cualquier texto heredado',
      }),
    ).not.toThrow();
  });

  it('applies only documented transport transforms and keeps final punctuation', () => {
    expect(applyDocumentedTransportTransforms('Hola.  filecite turn1 file 2  ¿Cómo vas?.')).toBe(
      'Hola. ¿Cómo vas?.',
    );
    expect(applyDocumentedTransportTransforms('Tu asistencia sigue confirmada.')).toBe(
      'Tu asistencia sigue confirmada.',
    );
  });
});
