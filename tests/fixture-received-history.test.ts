import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExtractedInformationRequest } from '../src/core/information';
import { AgentService } from '../src/runtime/agent-service';
import type {
  AgentConversationGateway,
  AgentConversationMessage,
} from '../src/runtime/agent-conversation-gateway';
import {
  FixtureAgentConversationGateway,
  buildFixturePhoneLookupKeys,
} from '../src/runtime/eval-fixture-gateway';
import {
  DynamoEvalFixtureStateStore,
  InMemoryEvalFixtureStateStore,
} from '../src/runtime/eval-fixture-state';
import type { FixtureLoggedMessage } from '../src/runtime/eval-fixture-state';
import { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import type { KnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
const renderers = {
  terminal_whatsapp: new WhatsAppMessageRenderer(),
  whatsapp: new WhatsAppMessageRenderer(),
};

const IMAGE_PHONE = '+51987654321';

type SendCommand = { input: Record<string, unknown> };

function mockDynamoQuery(items: Record<string, unknown>[]): {
  store: DynamoEvalFixtureStateStore;
  send: (command: SendCommand) => Promise<{ Items: Record<string, unknown>[]; LastEvaluatedKey: undefined }>;
} {
  const store = new DynamoEvalFixtureStateStore('fixture-table', { region: 'us-east-1' });
  const send = vi.fn(async (command: SendCommand) => {
    void command;
    return { Items: items, LastEvaluatedKey: undefined };
  });
  (store as unknown as { documentClient: { send: typeof send } }).documentClient.send = send;
  return { store, send };
}

function loggedRow(overrides: Partial<FixtureLoggedMessage> & { body: string }): Record<string, unknown> {
  const phone = '+51987654321';
  return {
    runId: 'run-f1',
    caseId: 'case-dynamo',
    scenario: 'image-clean-world',
    conversationKey: 'test-conversation',
    phone,
    phoneKeys: buildFixturePhoneLookupKeys(phone),
    direction: 'inbound',
    whatsappMessageId: null,
    sentAt: null,
    delivery: 'received',
    seq: 1,
    recordedAt: '2026-09-23T12:00:00.000Z',
    ttl: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

async function historyGateway(
  store: InMemoryEvalFixtureStateStore | DynamoEvalFixtureStateStore,
  runId: string,
  caseId: string,
  conversationKey = 'test-conversation',
): Promise<FixtureAgentConversationGateway> {
  return FixtureAgentConversationGateway.create('image-clean-world', undefined, {
    stateStore: store,
    runId,
    caseId,
    conversationKey,
  });
}

class LifecycleRuntime implements AgentRuntime {
  public readonly extractRequests: ExtractRequest[] = [];
  public readonly composeRequests: ComposeReplyRequest[] = [];
  private extractionIndex = 0;

  constructor(private readonly extractions: ExtractionResult[]) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractRequests.push(request);
    const next = this.extractions[this.extractionIndex] ?? this.extractions[this.extractions.length - 1];
    this.extractionIndex += 1;
    if (!next) {
      throw new Error('Missing extraction fixture.');
    }
    return next;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta informativa.' };
  }
}

class FakeKnowledgeGateway implements KnowledgeRetrievalGateway {
  async search(): Promise<{ status: 'success'; evidence: Array<{ fileId: string; filename: string; score: number; text: string }> }> {
    return {
      status: 'success',
      evidence: [{ fileId: 'faq-1', filename: 'faq.md', score: 0.9, text: 'La lista de regalos es opcional.' }],
    };
  }
}

function extraction(informationRequests: ExtractedInformationRequest[]): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests,
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
  } as unknown as ExtractionResult;
}

function providerGateway(): { gateway: ProviderGateway } {
  const gateway = {
    listCategories: async () => [],
    searchProviders: async () => ({ providers: [] }),
  } as unknown as ProviderGateway;
  return { gateway };
}

describe('fixture received history preservation (Finding 1)', () => {
  it('preserves received and sent through the public Dynamo read path; unverified/suppressed/failed stay excluded', async () => {
    const items = [
      loggedRow({ body: 'pregunta real', direction: 'inbound', delivery: 'received', seq: 1, whatsappMessageId: 'wamid-real' }),
      loggedRow({ body: 'respuesta enviada', direction: 'outbound', delivery: 'sent', seq: 2, whatsappMessageId: 'wamid-sent' }),
      loggedRow({ body: 'respuesta no verificada', direction: 'outbound', delivery: 'unverified', seq: 3 }),
      loggedRow({ body: 'respuesta suprimida', direction: 'outbound', delivery: 'suppressed', seq: 4 }),
      loggedRow({ body: 'respuesta fallida', direction: 'outbound', delivery: 'failed', seq: 5 }),
    ];
    const { store } = mockDynamoQuery(items);
    const gateway = await historyGateway(store, 'run-f1', 'case-dynamo');
    const read = await gateway.getRecentMessages(IMAGE_PHONE);
    expect(read.status).toBe('success');
    if (read.status === 'success') {
      expect(read.messages.map((message) => message.body)).toEqual([
        'pregunta real',
        'respuesta enviada',
      ]);
      expect(read.messages.map((message) => message.direction)).toEqual(['inbound', 'outbound']);
    }
    const stored = await store.listMessages('run-f1', 'case-dynamo', 'test-conversation');
    expect(stored.map((entry) => entry.delivery)).toEqual([
      'received',
      'sent',
      'unverified',
      'suppressed',
      'failed',
    ]);
  });

  it('produces equivalent histories from in-memory and Dynamo-backed stores', async () => {
    const memory = new InMemoryEvalFixtureStateStore();
    const first = await historyGateway(memory, 'run-f1', 'case-equiv');
    await first.logMessage({
      phoneNumber: IMAGE_PHONE,
      body: 'Cuanto dice ahi?',
      direction: 'inbound',
      whatsappMessageId: 'wamid-first',
      sentAt: '2026-09-12T00:00:00-05:00',
    });
    await first.recordOutboundReceipt({
      phoneNumber: IMAGE_PHONE,
      body: 'El comprobante muestra S/ 149.90.',
      deliveryAction: 'sent',
    });
    const memoryHistory = await first.getRecentMessages(IMAGE_PHONE);
    expect(memoryHistory.status).toBe('success');

    const stored = await memory.listMessages('run-f1', 'case-equiv', 'test-conversation');
    const items = stored.map((entry) => ({ ...entry }) as unknown as Record<string, unknown>);
    const { store: dynamo } = mockDynamoQuery(items);
    const second = await historyGateway(dynamo, 'run-f1', 'case-equiv');
    const dynamoHistory = await second.getRecentMessages(IMAGE_PHONE);
    expect(dynamoHistory.status).toBe('success');
    if (memoryHistory.status === 'success' && dynamoHistory.status === 'success') {
      expect(dynamoHistory.messages.map((message) => message.body)).toEqual(
        memoryHistory.messages.map((message) => message.body),
      );
      expect(dynamoHistory.messages.map((message) => message.direction)).toEqual(
        memoryHistory.messages.map((message) => message.direction),
      );
    }
  });

  it('enters prior inbound and outbound into the next turn; the current inbound appears once', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const first = await historyGateway(store, 'run-f1', 'case-next-turn');
    await first.logMessage({
      phoneNumber: IMAGE_PHONE,
      body: 'Primera pregunta',
      direction: 'inbound',
      whatsappMessageId: 'wamid-1',
    });
    await first.recordOutboundReceipt({
      phoneNumber: IMAGE_PHONE,
      body: 'Primera respuesta',
      deliveryAction: 'sent',
      whatsappMessageId: 'outbound:turn-0',
    });

    const second = await historyGateway(store, 'run-f1', 'case-next-turn');
    const beforeCurrent = await second.getRecentMessages(IMAGE_PHONE);
    expect(beforeCurrent.status).toBe('success');
    if (beforeCurrent.status === 'success') {
      expect(beforeCurrent.messages.map((message) => message.body)).toEqual([
        'Primera pregunta',
        'Primera respuesta',
      ]);
    }

    await second.logMessage({
      phoneNumber: IMAGE_PHONE,
      body: 'Segunda pregunta',
      direction: 'inbound',
      whatsappMessageId: 'wamid-2',
    });
    const afterCurrent = await second.getRecentMessages(IMAGE_PHONE);
    expect(afterCurrent.status).toBe('success');
    if (afterCurrent.status === 'success') {
      const bodies = afterCurrent.messages.map((message) => message.body);
      expect(bodies).toEqual(['Primera pregunta', 'Primera respuesta', 'Segunda pregunta']);
      expect(bodies.filter((body) => body === 'Segunda pregunta')).toHaveLength(1);
    }
  });

  it('collapses duplicate message IDs and isolates run/case/conversation/phone', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await historyGateway(store, 'run-f1', 'case-dupe-iso');
    await gateway.logMessage({
      phoneNumber: IMAGE_PHONE,
      body: 'Cuanto dice ahi?',
      direction: 'inbound',
      whatsappMessageId: 'wamid-same',
    });
    await gateway.logMessage({
      phoneNumber: IMAGE_PHONE,
      body: 'Cuanto dice ahi?',
      direction: 'inbound',
      whatsappMessageId: 'wamid-same',
    });
    const deduped = await gateway.getRecentMessages(IMAGE_PHONE);
    expect(deduped.status).toBe('success');
    if (deduped.status === 'success') {
      expect(deduped.messages).toHaveLength(1);
    }

    const items = [
      loggedRow({ body: 'mensaje correcto', delivery: 'received', seq: 1, whatsappMessageId: 'wamid-ok' }),
      loggedRow({ body: 'mensaje correcto', delivery: 'received', seq: 2, whatsappMessageId: 'wamid-ok' }),
      loggedRow({ body: 'otro run', delivery: 'received', seq: 3, runId: 'run-other' }),
      loggedRow({ body: 'otro caso', delivery: 'received', seq: 4, caseId: 'case-other' }),
      loggedRow({ body: 'otra conversacion', delivery: 'received', seq: 5, conversationKey: 'other-conv' }),
      loggedRow({
        body: 'otro telefono',
        delivery: 'received',
        seq: 6,
        phone: '+51900000000',
        phoneKeys: buildFixturePhoneLookupKeys('+51900000000'),
      }),
    ];
    const { store: dynamo } = mockDynamoQuery(items);
    const isolated = await historyGateway(dynamo, 'run-f1', 'case-dynamo');
    const read = await isolated.getRecentMessages(IMAGE_PHONE);
    expect(read.status).toBe('success');
    if (read.status === 'success') {
      expect(read.messages.map((message) => message.body)).toEqual(['mensaje correcto']);
    }
  });

  it('carries the three-turn support-detail lifecycle into serialized extractor and reply inputs', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = await FixtureAgentConversationGateway.create('image-clean-world', undefined, {
      stateStore: store,
      runId: 'run-support',
      caseId: 'case-support-detail',
      conversationKey: 'conv-support',
    });
    const runtime = new LifecycleRuntime([
      extraction([{ kind: 'faq', query: 'Problema de tarjeta de un invitado.' }]),
      {
        ...extraction([]),
        supportAct: { kind: 'provide_detail', personReference: 'Roger Abanto', eventReference: null },
      } as unknown as ExtractionResult,
      {
        ...extraction([]),
        supportAct: { kind: 'provide_detail', personReference: null, eventReference: 'Baby Shower Catalina' },
      } as unknown as ExtractionResult,
    ]);
    const provider = providerGateway().gateway;
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: provider,
      promptLoader,
      renderers,
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: new FakeKnowledgeGateway() as unknown as KnowledgeRetrievalGateway,
        providerGateway: provider,
        agentGateway: gateway as unknown as AgentConversationGateway,
      }),
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
    });
    const base = {
      channel: 'whatsapp',
      externalUserId: 'support-detail-lifecycle-user',
      contactPhone: IMAGE_PHONE,
      receivedAt: new Date().toISOString(),
    } as const;

    await service.handleTurn({ ...base, text: '¿Hay problemas con tarjetas de crédito?', messageId: 'support-lifecycle-1' });
    await gateway.recordOutboundReceipt({
      phoneNumber: IMAGE_PHONE,
      body: 'Respuesta informativa.',
      deliveryAction: 'sent',
      whatsappMessageId: 'outbound:turn-0',
    });
    await service.handleTurn({ ...base, text: 'El nombre es Roger Abanto', messageId: 'support-lifecycle-2' });
    await gateway.recordOutboundReceipt({
      phoneNumber: IMAGE_PHONE,
      body: 'Respuesta informativa.',
      deliveryAction: 'sent',
      whatsappMessageId: 'outbound:turn-1',
    });
    await service.handleTurn({ ...base, text: 'Y el evento es Baby Shower Catalina', messageId: 'support-lifecycle-3' });

    expect(runtime.extractRequests).toHaveLength(3);
    const thirdExtraction = runtime.extractRequests[2];
    expect(thirdExtraction).toBeDefined();
    const historyBodies = thirdExtraction?.messageContext.recentMessages.map((message: AgentConversationMessage) => message.body) ?? [];
    expect(historyBodies).toContain('¿Hay problemas con tarjetas de crédito?');
    expect(historyBodies).toContain('El nombre es Roger Abanto');
    expect(historyBodies.filter((body: string) => body === 'Y el evento es Baby Shower Catalina')).toHaveLength(0);

    const realRuntime = new OpenAiAgentRuntime({
      apiKey: 'offline-test-key',
      replyModel: 'gpt-6-luna',
      extractorModel: 'gpt-6-luna',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader,
      providerGateway: {} as never,
    });
    if (thirdExtraction) {
      const extractSpec = await realRuntime.buildExtractionRequestSpec(thirdExtraction);
      expect(extractSpec.input).toContain('¿Hay problemas con tarjetas de crédito?');
      expect(extractSpec.input).toContain('Roger Abanto');
    }
    const thirdCompose = runtime.composeRequests[2];
    expect(thirdCompose).toBeDefined();
    if (thirdCompose) {
      const replySpec = await realRuntime.buildReplyRequestSpec(thirdCompose);
      expect(replySpec.input).toContain('¿Hay problemas con tarjetas de crédito?');
      expect(replySpec.input).toContain('Roger Abanto');
    }
  });
});
