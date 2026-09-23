import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import { normalizeInboundImage } from '../src/core/inbound-image';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import { ImageFileUploadError } from '../src/runtime/image-file-store';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import type { PurchaseInformation } from '../src/core/information';
import type { ImageFileStore } from '../src/runtime/image-file-store';
import type {
  AgentConversationMessage,
  AgentConversationGateway,
  AgentGatewayResult,
  AgentPhonePurchaseLookupResult,
} from '../src/runtime/agent-conversation-gateway';
import type {
  MessageResponseClassifier,
  MessageResponseClassifierResult,
} from '../src/runtime/message-response-classifier';
import { AgentService } from '../src/runtime/agent-service';
import { ModelComposedFailureError } from '../src/runtime/model-composition';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import {
  buildNativeModelInput,
  toResponsesWireImageItem,
} from '../src/runtime/openai-agent-runtime';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { unavailableCustomerContext } from './customer-context-test-utils';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_MINIMAL = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]).toString('base64');

class ImageStubRuntime implements AgentRuntime {
  public extractCalls = 0;
  public lastExtractRequest: ExtractRequest | null = null;
  public readonly composeRequests: ComposeReplyRequest[] = [];
  public scripted: Partial<ExtractionResult> = {};
  public extractFailure: unknown = null;
  public composeFailure: unknown = null;
  public failComposeTimes = 0;
  public pendingOutcome: 'answered' | 'needs_input' | 'unchanged' | null = null;
  private composeFailuresSeen = 0;

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractCalls += 1;
    this.lastExtractRequest = request;
    if (this.extractFailure !== null) throw this.extractFailure as Error;
    return {
      actionIntent: null,
      informationRequests: [],
      intentConfidence: 1,
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
      conversationSummary: `Caption recibida: ${request.userMessage}`,
      selectedProviderHints: [],
      selectedProviderReferences: [],
      closeAction: null,
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: {
        eventType: null,
        needCategory: null,
        location: null,
        budgetAmount: null,
        budgetCurrency: null,
        mustHave: [],
        shouldAvoid: [],
        rankingNotes: 'Sin criterios.',
      },
      providerQueryIntents: [],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
      ...this.scripted,
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    if (this.composeFailure !== null && this.composeFailuresSeen < this.failComposeTimes) {
      this.composeFailuresSeen += 1;
      throw this.composeFailure as Error;
    }
    this.composeRequests.push(request);
    const text = `caption:${request.userMessage}`;
    return {
      text,
      structuredMessage: {
        type: 'generic',
        paragraphs_es: [text],
        ...(this.pendingOutcome ? { pending_task_outcome: this.pendingOutcome } : {}),
      },
    };
  }
}

function serviceWith(
  runtime: ImageStubRuntime,
  gateway?: AgentConversationGateway,
  responseClassifier?: MessageResponseClassifier,
): {
  service: AgentService;
  planStore: InMemoryPlanStore;
  imageStore: StubImageFileStore;
} {
  const planStore = new InMemoryPlanStore();
  const imageStore = new StubImageFileStore();
  const service = new AgentService({
    planStore,
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    ...(gateway ? { agentConversationGateway: gateway } : {}),
    ...(responseClassifier ? { responseClassifier } : {}),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    imageFileStore: imageStore,
  });
  return { service, planStore, imageStore };
}

class StubImageFileStore implements ImageFileStore {
  public uploads = 0;
  public deletions: string[] = [];
  public failUpload: unknown = null;

  async uploadImage(input: { bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }): Promise<{
    fileId: string;
    expiresAt: string;
    byteLength: number;
  }> {
    this.uploads += 1;
    if (this.failUpload !== null) throw this.failUpload as Error;
    return {
      fileId: 'file-test-image-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      byteLength: input.bytes.length,
    };
  }

  async deleteImage(fileId: string): Promise<void> {
    this.deletions.push(fileId);
  }
}

function inboundWithImage(
  image: NormalizedInboundMessage['image'],
  text: string,
  receivedAt = '2026-09-08T14:30:00Z',
): NormalizedInboundMessage {
  return {
    channel: 'whatsapp',
    externalUserId: 'whatsapp:+51987654321',
    text,
    messageId: 'wamid.HBgLNTE5ODc2NTQzMjE',
    receivedAt,
    contactPhone: '+51987654321',
    image,
  };
}

function textTurn(text: string, messageId: string, receivedAt: string): NormalizedInboundMessage {
  return {
    channel: 'whatsapp',
    externalUserId: 'whatsapp:+51987654321',
    text,
    messageId,
    receivedAt,
    contactPhone: '+51987654321',
  };
}

function handoffGateway(result: AgentGatewayResult): AgentConversationGateway {
  return {
    requestHumanTakeover: async () => result,
  } as unknown as AgentConversationGateway;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('S17 image turns', () => {
  it('persists an image-only turn silently when no task is outstanding', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, ''));

    expect(image.status).toBe('available');
    // No generation and no inspection stage: extraction runs once for
    // task evidence, the owner composes zero replies.
    expect(runtime.extractCalls).toBe(1);
    expect(runtime.composeRequests).toHaveLength(0);
    // Typed silence carries a reason, never assistant text.
    expect(response.outbound.text).toBeNull();
    expect(response.outbound.delivery).toMatchObject({
      action: 'suppress',
      reason: 'image_only_no_outstanding_task',
    });
    // The reference persists before the ack: reload sees it (cold-start safe).
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
    expect(reloaded?.image_attachments[0]).toMatchObject({ kind: 'file', fileId: 'file-test-image-1' });
    expect(response.trace.plan_persist_reason).toBe('image_file_silence');
    const traceJson = JSON.stringify(response.trace);
    expect(traceJson).not.toContain(JPEG_MINIMAL);
    expect(traceJson).not.toContain('base64,');
    expect(traceJson).not.toContain('file-test-image-1');
    expect(traceJson).toContain('silent_persisted');
  });

  it('persists an image-only empty-text turn silently despite synthetic ambiguity', async () => {
    const runtime = new ImageStubRuntime();
    runtime.scripted = {
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Quieres hacer una consulta o planificar un evento?',
        interpretations: ['consulta', 'planificacion'],
        candidateOperations: [],
        questionKey: null,
      },
    };
    const { service, planStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, ''));

    // Same-turn synthetic ambiguity on empty text is not an outstanding
    // task: no generation, typed silence, reference persisted, and no
    // pending question stashed for a later turn.
    expect(runtime.composeRequests).toHaveLength(0);
    expect(response.outbound.text).toBeNull();
    expect(response.outbound.delivery).toMatchObject({
      action: 'suppress',
      reason: 'image_only_no_outstanding_task',
    });
    expect(response.trace.plan_persist_reason).toBe('image_file_silence');
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
    expect(reloaded?.owner_pending_question).toBeNull();
  });

  it('preserves the caption with the image in a single owner turn', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    expect(image.status).toBe('available');
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.userMessage).toBe('Cuanto dice aqui?');
    expect(request?.imageFileAttachments).toHaveLength(1);
    expect(request?.imageEvidence).toMatchObject({
      status: 'available',
      source: 'file',
      captionPresent: true,
      refStored: true,
    });
    expect(response.outbound.text).toBe('caption:Cuanto dice aqui?');
    expect(response.outbound.outputOrigin).toMatchObject({
      status: 'verified',
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    });
  });

  it('reports image_too_large as unavailable evidence without inspecting', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage({ status: 'unavailable', reason: 'image_too_large', mimeType: 'image/jpeg' }, ''),
    );

    expect(runtime.extractCalls).toBe(0);
    expect(response.outbound.text).toBe('caption:');
    expect(runtime.composeRequests.at(-1)?.imageEvidence).toMatchObject({
      status: 'unavailable',
      reason: 'image_too_large',
      captionPresent: false,
    });
    // No fake human intent, confidence, or planning projection on media errors.
    expect(runtime.composeRequests.at(-1)?.extraction).toMatchObject({
      actionIntent: null,
      intentConfidence: null,
      vendorCategories: [],
      activeNeedCategory: null,
      providerFitCriteria: null,
    });
  });

  it('reports media_unavailable as unavailable evidence without inspecting', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage({ status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/jpeg' }, ''),
    );

    expect(response.outbound.text).toBe('caption:');
    expect(runtime.composeRequests.at(-1)?.imageEvidence).toMatchObject({
      status: 'unavailable',
      reason: 'media_unavailable',
      captionPresent: false,
    });
    // No fake human intent, confidence, or planning projection on media errors.
    expect(runtime.composeRequests.at(-1)?.extraction).toMatchObject({
      actionIntent: null,
      intentConfidence: null,
      vendorCategories: [],
      activeNeedCategory: null,
      providerFitCriteria: null,
    });
  });

  it('answers the caption through the model pipeline without appending a fallback', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage(
        { status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/jpeg' },
        'Mi pedido sigue pendiente?',
      ),
    );

    expect(runtime.extractCalls).toBe(0);
    expect(response.outbound.text).toBe('caption:Mi pedido sigue pendiente?');
    expect(runtime.composeRequests.at(-1)?.imageEvidence).toMatchObject({
      status: 'unavailable',
      reason: 'media_unavailable',
      captionPresent: true,
    });
  });

  it('keeps an unavailable-image caption in the image fallback evidence path', async () => {
    const runtime = new ImageStubRuntime();
    const gateway = {
      ...handoffGateway({ status: 'skipped', reason: 'disabled', message: 'disabled' }),
      async getRecentMessages() {
        return {
          status: 'success' as const,
          messages: [{
            id: 1,
            direction: 'outbound' as const,
            source: 'frontend_followup',
            body: 'Te ayudamos con tu evento.',
            status: 'sent',
            sentAt: '2026-09-08T14:29:00Z',
            createdAt: '2026-09-08T14:29:00Z',
          }],
        };
      },
      async logMessage() {
        return { status: 'success' as const, message: null };
      },
    } as unknown as AgentConversationGateway;
    const { service } = serviceWith(runtime, gateway);
    const response = await service.handleTurn(inboundWithImage(
      { status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/jpeg' },
      'Hola',
    ));

    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(runtime.extractCalls).toBe(0);
    expect(runtime.composeRequests.at(-1)?.currentNode).toBe('resolver_consultas_informativas');
    expect(runtime.composeRequests.at(-1)?.imageEvidence).toMatchObject({
      status: 'unavailable',
      reason: 'media_unavailable',
      captionPresent: true,
    });
  });

  it('treats mismatched bytes as unavailable instead of inspecting', async () => {
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/jpeg' });
    expect(image.status).toBe('unavailable');
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(inboundWithImage(image, ''));

    expect(response.outbound.text).toBe('caption:');
    expect(runtime.composeRequests.at(-1)?.imageEvidence?.reason).toBe('media_unavailable');
  });

  it('routes an action caption through the owner with the persisted file instead of human help', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime, handoffGateway({ status: 'success', message: 'ok' }));
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Confirma mi pago con este voucher'));

    // No separate inspection/handoff flow: the established owner sees the
    // persisted file together with task evidence and decides.
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageFileAttachments).toHaveLength(1);
    expect(response.outbound.text).toBe('caption:Confirma mi pago con este voucher');
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('keeps the file ref when the owner answers without human registration', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(
      runtime,
      handoffGateway({ status: 'failed', error: 'boom', retryable: false }),
    );
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Confirma mi pago'));

    expect(response.outbound.text).toBe('caption:Confirma mi pago');
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('continues a persisted outstanding request on an image-only turn instead of silencing', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    // Earlier question persisted by a previous invocation: a pending faq
    // request waits for evidence the image can supply.
    const seed = createEmptyPlan({
      planId: 'seed-question',
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
    });
    await planStore.save({
      plan: mergePlan(seed, {
        information_state: {
          resume_node: null,
          pending_requests: [{ kind: 'faq', query: 'Que monto ves ahi?', requestId: 'information-1' }],
          selection_candidates: [],
          last_completed_request: null,
        },
      }),
      reason: 'test-seed',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, '', '2026-09-08T14:30:10Z'));

    // Empty text does not suppress a task-fulfilling image: the owner runs
    // with the persisted file projected natively.
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageFileAttachments).toEqual([
      { fileId: 'file-test-image-1', messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('answers an image-only turn from model-extracted task evidence, not receipt keywords', async () => {
    const runtime = new ImageStubRuntime();
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que dice el comprobante?' }],
    };
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, ''));

    expect(runtime.composeRequests).toHaveLength(1);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('reloads a silently persisted image for a later text question in another invocation', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    const first = await service.handleTurn(inboundWithImage(image, '', '2026-09-08T14:30:00Z'));

    // First invocation persists silently with no generation.
    expect(first.outbound.delivery.action).toBe('suppress');
    expect(runtime.composeRequests).toHaveLength(0);

    // Ten seconds later a text-only invocation references the persisted
    // image through structured extraction evidence (never keywords).
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.HBgLNTE5ODc2NTQzMjE'] },
    };
    const second = await service.handleTurn(
      textTurn('Que monto ves ahi?', 'wamid.followup1', '2026-09-08T14:30:10Z'),
    );

    expect(second.outbound.delivery.action).toBe('send');
    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments).toEqual([
      { fileId: 'file-test-image-1', messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });

  it('carries the single stored image when prior_single linkage arrives without message ids', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    await service.handleTurn(inboundWithImage(image, '', '2026-09-08T14:30:00Z'));

    // Structured single-prior linkage without visible message ids still
    // carries the one usable stored image (deterministic single-candidate
    // carry, never message wording).
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: [] },
    };
    const second = await service.handleTurn(
      textTurn('Que monto ves ahi?', 'wamid.followup2', '2026-09-08T14:30:10Z'),
    );

    expect(second.outbound.delivery.action).toBe('send');
    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments).toEqual([
      { fileId: 'file-test-image-1', messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
  });

  it('projects nothing for prior_single without linkage when several images are stored', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    await service.handleTurn(
      inboundWithImage(normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' }), '', '2026-09-08T14:30:00Z'),
    );
    const secondImage = inboundWithImage(
      normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' }),
      '',
      '2026-09-08T14:30:05Z',
    );
    secondImage.messageId = 'wamid.secondimage2';
    await service.handleTurn(secondImage);
    const stored = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect((stored?.image_attachments ?? []).length).toBeGreaterThanOrEqual(2);

    // Ambiguous linkage with several candidates stays ambiguous: no recent
    // image rides the follow-up.
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: [] },
    };
    await service.handleTurn(textTurn('Que monto ves ahi?', 'wamid.followup3', '2026-09-08T14:30:10Z'));

    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments ?? []).toEqual([]);
  });

  it('clears an unrelated image from projected context without deleting its ref', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    await service.handleTurn(inboundWithImage(image, '', '2026-09-08T14:30:00Z'));

    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Cual es el horario?' }],
      imageReference: { status: 'none', referencedMessageIds: [] },
    };
    await service.handleTurn(textTurn('Cual es el horario?', 'wamid.faq1', '2026-09-08T14:30:10Z'));

    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments ?? []).toEqual([]);
    // Projection cleared, reference retained for a later linked question.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });

  it('maps a provider file-access 404 to unavailable evidence with both attempts recorded', async () => {
    const runtime = new ImageStubRuntime();
    runtime.composeFailure = Object.assign(new Error('file not found'), {
      name: 'NotFoundError',
      status: 404,
    });
    runtime.failComposeTimes = 1;
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Es mi comprobante'));

    // The failed file-access attempt is retained, never dropped; the model
    // answers from the remaining evidence with the ref still persisted.
    const request = runtime.composeRequests[0];
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'image_unavailable' });
    expect(request?.imageFileAttachments ?? []).toEqual([]);
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('reply_failed_file_access');
    expect(outputs).toContain('fallback_reply_received');
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('propagates a reply credential failure instead of relabeling it as image unavailability', async () => {
    const runtime = new ImageStubRuntime();
    runtime.composeFailure = Object.assign(new Error('bad key'), {
      name: 'AuthenticationError',
      status: 401,
    });
    runtime.failComposeTimes = 10;
    const { service, imageStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    await expect(service.handleTurn(inboundWithImage(image, 'Es mi comprobante'))).rejects.toThrow('bad key');
    // No unavailable-evidence fallback was composed for a credential failure.
    expect(runtime.composeRequests).toHaveLength(0);
    // The fresh upload is cleaned up; no false durable success persists.
    expect(imageStore.deletions).toEqual(['file-test-image-1']);
  });

  it('propagates an extraction credential failure without composing', async () => {
    const runtime = new ImageStubRuntime();
    runtime.extractFailure = Object.assign(new Error('bad key'), {
      name: 'AuthenticationError',
      status: 401,
    });
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    await expect(service.handleTurn(inboundWithImage(image, 'Es mi comprobante'))).rejects.toThrow('bad key');
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('propagates a generic model failure without an image_unavailable fallback', async () => {
    const runtime = new ImageStubRuntime();
    runtime.composeFailure = new ModelComposedFailureError('model_error');
    runtime.failComposeTimes = 10;
    const { service, planStore, imageStore } = serviceWith(runtime);
    const seed = createEmptyPlan({
      planId: 'seed-pending-model-failure',
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
    });
    await planStore.save({
      plan: mergePlan(seed, {
        owner_pending_question: 'Que monto ves ahi?',
        open_questions: ['Que monto ves ahi?'],
      }),
      reason: 'test-seed',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    // A generic composition failure keeps its actual classification: no
    // unavailable-evidence retry is composed for it.
    await expect(
      service.handleTurn(inboundWithImage(image, 'Es mi comprobante', '2026-09-08T14:30:10Z')),
    ).rejects.toThrow();
    expect(runtime.composeRequests).toHaveLength(0);
    // The fresh upload is cleaned up; no false durable success persists.
    expect(imageStore.deletions).toEqual(['file-test-image-1']);
    // The pending question is never marked answered by a failed turn.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Que monto ves ahi?');
    expect(reloaded?.open_questions).toContain('Que monto ves ahi?');
    expect(reloaded?.image_attachments ?? []).toHaveLength(0);
  });

  it('propagates a retryable transport upload failure without composing', async () => {
    const runtime = new ImageStubRuntime();
    const { service, imageStore } = serviceWith(runtime);
    imageStore.failUpload = new ImageFileUploadError('Image file upload failed.', {
      retryable: true,
      causeName: 'APIConnectionError',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    await expect(service.handleTurn(inboundWithImage(image, 'Hola'))).rejects.toThrow(
      'Image file upload failed.',
    );
    expect(imageStore.uploads).toBe(1);
    expect(runtime.extractCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('propagates an upload credential failure instead of unavailable evidence', async () => {
    const runtime = new ImageStubRuntime();
    const { service, imageStore } = serviceWith(runtime);
    imageStore.failUpload = new ImageFileUploadError('bad key', {
      retryable: false,
      causeName: 'AuthenticationError',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    await expect(service.handleTurn(inboundWithImage(image, 'Hola'))).rejects.toThrow('bad key');
    expect(runtime.composeRequests).toHaveLength(0);
  });
});

/**
 * Model-selected thanks suppression in enforce mode: only gracias-like
 * closings suppress, every other text responds. No keyword routing in
 * production code; the stub stands in for the owner/extraction decision.
 */
class ThanksSuppressingClassifier implements MessageResponseClassifier {
  readonly mode = 'enforce' as const;

  async classify(args: {
    inboundText: string;
    plan: PersistedPlan;
    messages: AgentConversationMessage[];
    contextSource: 'agent_api' | 'local_plan';
  }): Promise<MessageResponseClassifierResult> {
    const suppress = /gracias/iu.test(args.inboundText);
    return {
      trace: {
        mode: 'enforce',
        classifier_profile: 'general',
        action: suppress ? 'suppress_acknowledgement' : 'respond',
        reason: suppress ? 'acknowledgement' : 'requires_response',
        would_suppress: suppress,
        context_source: args.contextSource,
        has_prior_outbound_message: args.messages.some((message) => message.direction === 'outbound'),
        fallback_used: false,
        conversation_health: 'progressing',
        health_reason: 'normal_progress',
        human_help_response: 'not_applicable',
        campaign_reply_kind: suppress ? 'acknowledgement_only' : 'not_applicable',
        automation_confidence: 'not_automated',
        automation_pattern: 'none',
        automation_scope: 'none_or_uncertain',
        prompt_bundle_id: null,
        prompt_file_paths: [],
      },
      tokenUsage: null,
    };
  }
}

describe('Inbound continuity sequences', () => {
  it('shares one continuity projection across text plus image in the same invocation', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    // One answer uses both parts: no greeting-only reply, no second
    // image-description answer.
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.userMessage).toBe('Cuanto dice aqui?');
    expect(request?.imageFileAttachments).toHaveLength(1);
    expect(request?.continuity).toMatchObject({
      pendingQuestion: null,
      pendingTask: null,
      hasPendingInformation: false,
      hasCompletedInformation: false,
      hasPriorOutbound: false,
    });
    expect(response.outbound.delivery).toMatchObject({ action: 'send' });
    expect(response.outbound.text).toBe('caption:Cuanto dice aqui?');
  });

  it('answers the question, persists the image silently, then answers the follow-up: two answers', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore, imageStore } = serviceWith(runtime);
    const first = await service.handleTurn(
      textTurn('Tienen local en Miraflores?', 'wamid.q1', '2026-09-08T14:29:50Z'),
    );
    expect(first.outbound.delivery.action).toBe('send');
    expect(first.outbound.text).not.toBeNull();
    expect(runtime.composeRequests).toHaveLength(1);

    // The supplemental image over the answered thread persists silently: no
    // repeated explanation, no second answer for the same thread.
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const second = await service.handleTurn(
      inboundWithImage(image, '', '2026-09-08T14:30:00Z'),
    );
    expect(second.outbound.text).toBeNull();
    expect(second.outbound.delivery).toMatchObject({
      action: 'suppress',
      reason: 'image_only_no_outstanding_task',
    });
    expect(runtime.composeRequests).toHaveLength(1);
    expect(imageStore.uploads).toBe(1);

    // The follow-up question is answered from the persisted pixels: the
    // image is not lost and the follow-up is not suppressed to force a
    // single answer across the conversation.
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.HBgLNTE5ODc2NTQzMjE'] },
    };
    const third = await service.handleTurn(
      textTurn('Que monto ves ahi?', 'wamid.followup1', '2026-09-08T14:30:10Z'),
    );
    expect(third.outbound.delivery.action).toBe('send');
    expect(third.outbound.text).not.toBeNull();
    expect(runtime.composeRequests).toHaveLength(2);
    expect(runtime.composeRequests[1]?.imageFileAttachments).toEqual([
      { fileId: 'file-test-image-1', messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    // Follow-up turns share the same minimum projection shape: the pending
    // faq being answered is visible as typed state on that turn.
    expect(runtime.composeRequests[1]?.continuity).toMatchObject({
      hasPendingInformation: true,
    });

    // The reference survives the full chain for later turns.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });

  it('reuses a duplicate image delivery without a second upload', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore, imageStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const first = await service.handleTurn(
      inboundWithImage(image, '', '2026-09-08T14:30:00Z'),
    );
    expect(first.outbound.delivery).toMatchObject({ action: 'suppress' });

    // Same bytes and same message delivered again: no re-upload, still
    // silent on the answered thread, single stored reference.
    const second = await service.handleTurn(
      inboundWithImage(image, '', '2026-09-08T14:30:00Z'),
    );
    expect(second.outbound.delivery).toMatchObject({ action: 'suppress' });
    expect(imageStore.uploads).toBe(1);
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });

  it('answers a persisted owner question when the fulfilling image arrives', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    const seed = createEmptyPlan({
      planId: 'seed-pending-question',
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
    });
    await planStore.save({
      plan: mergePlan(seed, {
        owner_pending_question: 'Que monto ves ahi?',
        open_questions: ['Que monto ves ahi?'],
      }),
      reason: 'test-seed',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(
      inboundWithImage(image, '', '2026-09-08T14:30:10Z'),
    );

    // The pending question travels on the shared projection and the image
    // answers it: one reply, pixels attached, reference stored.
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.continuity).toMatchObject({
      pendingQuestion: 'Que monto ves ahi?',
    });
    expect(runtime.composeRequests[0]?.imageFileAttachments).toHaveLength(1);
    expect(response.outbound.delivery.action).toBe('send');
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });

  it('keeps a generation failure distinct and preserves the pending question', async () => {
    const runtime = new ImageStubRuntime();
    runtime.composeFailure = new Error('boom');
    runtime.failComposeTimes = 1;
    const { service, planStore, imageStore } = serviceWith(runtime);
    const seed = createEmptyPlan({
      planId: 'seed-pending-failure',
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
    });
    await planStore.save({
      plan: mergePlan(seed, {
        owner_pending_question: 'Que monto ves ahi?',
        open_questions: ['Que monto ves ahi?'],
      }),
      reason: 'test-seed',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    // A failed turn throws instead of degrading to silence or a false
    // success: failures stay distinct from suppressions.
    await expect(
      service.handleTurn(inboundWithImage(image, 'Es mi comprobante', '2026-09-08T14:30:10Z')),
    ).rejects.toThrow('boom');
    expect(imageStore.deletions).toEqual(['file-test-image-1']);
    // The pending question is never marked answered by a failed turn.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Que monto ves ahi?');
    expect(reloaded?.open_questions).toContain('Que monto ves ahi?');
    expect(reloaded?.image_attachments ?? []).toHaveLength(0);
  });

  it('keeps a suppressed thanks distinct from a failure and preserves the pending question', async () => {
    const runtime = new ImageStubRuntime();
    const classifier = new ThanksSuppressingClassifier();
    const { service, planStore } = serviceWith(runtime, undefined, classifier);
    const seed = createEmptyPlan({
      planId: 'seed-pending-suppress',
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
    });
    await planStore.save({
      plan: mergePlan(seed, {
        owner_pending_question: 'Que monto ves ahi?',
        open_questions: ['Que monto ves ahi?'],
      }),
      reason: 'test-seed',
    });

    // Thanks with no task is legitimate silence: typed suppress, no text,
    // zero generations.
    const thanks = await service.handleTurn(
      textTurn('Gracias', 'wamid.thanks1', '2026-09-08T14:30:10Z'),
    );
    expect(thanks.outbound.text).toBeNull();
    expect(thanks.outbound.delivery).toMatchObject({
      action: 'suppress',
      reason: 'suppress_acknowledgement',
    });
    expect(runtime.composeRequests).toHaveLength(0);
    // The suppressed turn never marks the pending question answered.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Que monto ves ahi?');
    expect(reloaded?.open_questions).toContain('Que monto ves ahi?');
  });

  it('answers an explicit repeat request instead of suppressing it as a duplicate', async () => {
    const runtime = new ImageStubRuntime();
    const classifier = new ThanksSuppressingClassifier();
    const { service } = serviceWith(runtime, undefined, classifier);
    const first = await service.handleTurn(
      textTurn('Tienen local en Miraflores?', 'wamid.q1', '2026-09-08T14:29:50Z'),
    );
    expect(first.outbound.delivery.action).toBe('send');

    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const second = await service.handleTurn(
      inboundWithImage(image, '', '2026-09-08T14:30:00Z'),
    );
    expect(second.outbound.delivery).toMatchObject({ action: 'suppress' });

    // An intentional requested repetition is not duplicate delivery: the
    // explicit request is answered, never suppressed for the prior answer.
    const third = await service.handleTurn(
      textTurn('Me lo puedes repetir por favor?', 'wamid.repeat1', '2026-09-08T14:30:10Z'),
    );
    expect(third.outbound.delivery.action).toBe('send');
    expect(third.outbound.text).not.toBeNull();
    expect(runtime.composeRequests).toHaveLength(2);
  });
});

describe('R2 question needs image continuity chain', () => {
  it('preserves the receipt question across turns and answers it when the image arrives', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore, imageStore } = serviceWith(runtime);

    // Turn 1 (cold): the receipt question needs later evidence. The normal
    // path preserves the unresolved user question for its later image.
    runtime.scripted = {
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Quieres el estado o que revise el comprobante?',
        interpretations: [],
        candidateOperations: [],
        questionKey: 'status_or_proof_review',
      },
    };
    const first = await service.handleTurn(
      textTurn('Confirma el monto de mi comprobante', 'wamid.receiptq', '2026-09-08T14:29:50Z'),
    );
    expect(first.outbound.delivery.action).toBe('send');
    const afterQuestion = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(afterQuestion?.owner_pending_question).toBe('Confirma el monto de mi comprobante');

    // Turn 2: the image-only turn finds the pending question and answers it
    // from the pixels instead of persisting silently.
    runtime.scripted = {};
    runtime.pendingOutcome = 'answered';
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const second = await service.handleTurn(
      inboundWithImage(image, '', '2026-09-08T14:30:00Z'),
    );
    expect(second.outbound.delivery.action).toBe('send');
    expect(imageStore.uploads).toBe(1);
    expect(runtime.composeRequests).toHaveLength(2);
    expect(runtime.composeRequests[1]?.continuity).toMatchObject({
      pendingQuestion: 'Confirma el monto de mi comprobante',
    });
    expect(runtime.composeRequests[1]?.pendingQuestionRef).toBe('Confirma el monto de mi comprobante');
    expect(runtime.composeRequests[1]?.imageFileAttachments).toHaveLength(1);

    // The answered question clears and the latest response is recorded; the
    // reference survives for later turns.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBeNull();
    expect(reloaded?.last_outbound_context?.message_id).toBe('wamid.HBgLNTE5ODc2NTQzMjE');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });
});

describe('Unavailable media record checks', () => {
  function boundaryRuntime(): OpenAiAgentRuntime {
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

  function typedBoundary(runtime: OpenAiAgentRuntime): {
    buildRecordCheckFacts: (request: unknown) => {
      record_checks?: { image_check?: unknown; purchase_records?: unknown };
    };
    ambiguityAnsweredByProjectedEvidence: (request: unknown) => boolean;
  } {
    return runtime as unknown as {
      buildRecordCheckFacts: (request: unknown) => {
        record_checks?: { image_check?: unknown; purchase_records?: unknown };
      };
      ambiguityAnsweredByProjectedEvidence: (request: unknown) => boolean;
    };
  }

  const unavailableImage = {
    status: 'unavailable',
    reason: 'media_unavailable',
    captionPresent: false,
  };

  function completedEmptyPurchase(): Record<string, unknown> {
    return {
      requestId: 'information-1',
      kind: 'purchase',
      status: 'completed',
      resource: 'orders',
      purchases: [],
      needsSelection: false,
      accessMethod: 'trusted_phone_purchase',
      coverage: 'complete',
    };
  }

  function failedPhonePurchase(): Record<string, unknown> {
    return {
      requestId: 'information-1',
      kind: 'purchase',
      status: 'failed',
      retryable: false,
      accessMethod: 'trusted_phone_purchase',
      failureKind: 'not_found',
      message: 'No se encontró la compra.',
    };
  }

  it('omits purchase-record evidence entirely when no purchase read was attempted', () => {
    const checks = typedBoundary(boundaryRuntime()).buildRecordCheckFacts({
      imageEvidence: unavailableImage,
      informationResults: [],
    });
    expect(checks.record_checks?.image_check).toMatchObject({
      outcome: 'unavailable',
      reason: 'media_unavailable',
    });
    expect(checks.record_checks ?? {}).not.toHaveProperty('purchase_records');
  });

  it('omits purchase-record evidence when only unrelated reads ran', () => {
    const checks = typedBoundary(boundaryRuntime()).buildRecordCheckFacts({
      imageEvidence: unavailableImage,
      informationResults: [
        {
          requestId: 'information-1',
          kind: 'faq',
          status: 'completed',
          evidence: [],
        },
      ],
    });
    expect(checks.record_checks ?? {}).not.toHaveProperty('purchase_records');
  });

  it('carries an attempted empty read as an empty outcome, never an absence claim', () => {
    const checks = typedBoundary(boundaryRuntime()).buildRecordCheckFacts({
      imageEvidence: unavailableImage,
      informationResults: [completedEmptyPurchase()],
    });
    expect(checks.record_checks?.purchase_records).toMatchObject({
      lookups_attempted: 1,
      results_returned: 0,
      outcomes: [
        {
          status: 'completed',
          access_method: 'trusted_phone_purchase',
          result_count: 0,
          failure_kind: null,
        },
      ],
    });
  });

  it('carries a failed read as unavailable with its real outcome and provenance', () => {
    const checks = typedBoundary(boundaryRuntime()).buildRecordCheckFacts({
      imageEvidence: unavailableImage,
      informationResults: [failedPhonePurchase()],
    });
    expect(checks.record_checks?.purchase_records).toMatchObject({
      lookups_attempted: 1,
      results_returned: 0,
      outcomes: [
        {
          status: 'failed',
          access_method: 'trusted_phone_purchase',
          result_count: 0,
          failure_kind: 'not_found',
        },
      ],
    });
  });

  it('projects no record checks when the image is available', () => {
    const checks = typedBoundary(boundaryRuntime()).buildRecordCheckFacts({
      imageEvidence: { status: 'available' },
      informationResults: [completedEmptyPurchase()],
    });
    expect(checks).toEqual({});
  });
});

describe('Approval ambiguity stays model-owned', () => {
  it('preserves extracted ambiguity for the reply model after an empty read', async () => {
    const runtime = new ImageStubRuntime();
    const planStore = new InMemoryPlanStore();
    const seed = createEmptyPlan({
      planId: 'p-t5-boundary',
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
    });
    await planStore.save({
      plan: mergePlan(seed, {
        contact_phone: '+51987654321',
        contact_phone_extension: '+51',
        contact_phone_number: '987654321',
        image_attachments: [
          {
            kind: 'file',
            fileId: 'file-test-image-1',
            expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
            mimeType: 'image/jpeg',
            byteLength: 1024,
            contentDigest: 'digest-t5',
            messageId: 'wamid.receipt1',
            receivedAt: new Date().toISOString(),
          },
        ],
      }),
      reason: 'seed',
    });
    runtime.scripted = {
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Quieres el estado o que revise el comprobante?',
        interpretations: ['revisar aprobación', 'revisar comprobante'],
        candidateOperations: [],
        questionKey: 'status_or_proof_review',
      },
      informationRequests: [
        {
          kind: 'purchase',
          resource: 'orders',
          query: 'Con ese monto, ¿puedes asegurar que la tienda ya aprobó el pago?',
          orderId: null,
          authAction: 'none',
        },
      ],
    };
    const executed: Array<{ requests?: Array<{ kind?: string }> }> = [];
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
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      informationOrchestrator: {
        prepareCustomerContext: unavailableCustomerContext,
        async execute(input: { requests?: Array<{ kind?: string }> }) {
          executed.push(input);
          return {
            results: [
              {
                requestId: 'information-1',
                kind: 'purchase',
                status: 'completed',
                resource: 'orders',
                purchases: [],
                needsSelection: false,
                accessMethod: 'trusted_phone_purchase',
                coverage: 'complete',
              },
            ],
            summaries: [],
          };
        },
      } as never,
      capabilityManifest: buildRuntimeCapabilityManifest({ configured: true }),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubImageFileStore(),
    });
    const response = await service.handleTurn(
      textTurn(
        'Con ese monto, ¿puedes asegurar que la tienda ya aprobó el pago?',
        'wamid.t5boundary',
        '2026-09-08T14:35:00Z',
      ),
    );
    expect(response.outbound.delivery.action).toBe('send');
    // The record was read instead of skipped for clarification.
    expect(executed).toHaveLength(1);
    // The runtime keeps the extractor's uncertainty intact; the reply model
    // receives both interpretations and the actual empty read outcome.
    const composed = runtime.composeRequests.at(-1);
    expect(composed?.extraction.ambiguity?.status).toBe('ambiguous');
    expect(composed?.extraction.ambiguity?.interpretations).toEqual([
      'revisar aprobación',
      'revisar comprobante',
    ]);
    // E4 narrow scope: the performed read stays an empty outcome. The twin
    // proves the boundary answer synthesizes no completed purchase, approves
    // no payment, and marks only the read that actually ran.
    const boundaryResults = (composed as unknown as {
      informationResults?: Array<{
        kind?: string;
        status?: string;
        purchases?: unknown[];
        paymentStatus?: string | null;
      }>;
    })?.informationResults ?? [];
    expect(boundaryResults).toHaveLength(1);
    expect(boundaryResults[0]?.kind).toBe('purchase');
    expect(boundaryResults[0]?.status).toBe('completed');
    expect(boundaryResults[0]?.purchases ?? []).toHaveLength(0);
    expect(boundaryResults[0]?.paymentStatus ?? null).toBeNull();
  });
});

describe('Native extraction attachments (decision call sees the current image)', () => {
  const RECEIPT_URL = 'https://example.com/media/receipt-native.png';

  it('passes the already-uploaded file ref into the single extraction call', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Es mi comprobante'));

    // One decision call and no inspection stage: the retired entrypoint
    // no longer exists, so native attachments below are the proof.
    expect(runtime.extractCalls).toBe(1);
    expect(runtime.lastExtractRequest?.userMessage).toBe('Es mi comprobante');
    expect(runtime.lastExtractRequest?.imageFileAttachments).toEqual([
      { fileId: 'file-test-image-1', messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    expect(runtime.lastExtractRequest?.imageUrlAttachments).toEqual([]);
    // The owner still answers from the same turn with the ref projected.
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageFileAttachments).toHaveLength(1);
    expect(response.outbound.delivery.action).toBe('send');
  });

  it('passes the backend URL into the single extraction call on URL turns', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage(
        { status: 'available', source: 'url', url: RECEIPT_URL, mimeType: null },
        'Es mi comprobante',
      ),
    );

    expect(runtime.extractCalls).toBe(1);
    expect(runtime.lastExtractRequest?.imageUrlAttachments).toEqual([
      { url: RECEIPT_URL, messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    expect(runtime.lastExtractRequest?.imageFileAttachments).toEqual([]);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageUrlAttachments).toEqual([
      { url: RECEIPT_URL, messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    expect(response.outbound.delivery.action).toBe('send');
  });

  it('carries no native attachments on text-only turns', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    await service.handleTurn(
      textTurn('¿Cuál es el horario?', 'wamid.txtnative1', '2026-09-08T14:31:00Z'),
    );

    expect(runtime.extractCalls).toBe(1);
    expect(runtime.lastExtractRequest?.imageFileAttachments ?? []).toEqual([]);
    expect(runtime.lastExtractRequest?.imageUrlAttachments ?? []).toEqual([]);
  });
});

describe('B receipt discovery answers a captionless receipt from real state', () => {
  const RECEIPT_ORDER_ID = 'ORD-RECEIPT-1';
  const RECEIPT_GIFT_ID = 'GIFT-RECEIPT-7';
  const RECEIPT_TOTAL = 340.44;

  function receiptOrderRecord(): PurchaseInformation {
    return {
      orderId: RECEIPT_ORDER_ID,
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: RECEIPT_TOTAL,
      paymentMethod: 'transfer',
      currency: 'PEN',
      eventName: 'Evento Sintetico',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-10 10:00:00',
      items: [],
    };
  }

  function receiptGiftRecord(): PurchaseInformation {
    return {
      orderId: RECEIPT_GIFT_ID,
      paymentStatus: 'approved',
      shippingStatus: null,
      grandTotal: RECEIPT_TOTAL,
      paymentMethod: 'transfer',
      currency: 'PEN',
      eventName: 'Otro Evento Sintetico',
      eventDate: null,
      eventUrl: null,
      createdAt: '2026-09-09 10:00:00',
      items: [],
    };
  }

  class ReceiptDiscoveryGateway {
    public guestOrdersCalls = 0;
    public guestGiftCalls = 0;
    public guestGiftOrderIds: Array<string | null> = [];
    public takeoverCalls = 0;

    async getGuestOrdersByPhone(): Promise<AgentPhonePurchaseLookupResult> {
      this.guestOrdersCalls += 1;
      return {
        status: 'success',
        resource: 'orders',
        orderPartitions: { pending: [receiptOrderRecord()], completed: [] },
        purchases: [receiptOrderRecord()],
      };
    }

    async getGuestGiftPurchasesByPhone(input: {
      orderId: string | null;
    }): Promise<AgentPhonePurchaseLookupResult> {
      this.guestGiftCalls += 1;
      this.guestGiftOrderIds.push(input?.orderId ?? null);
      return {
        status: 'success',
        resource: 'gift_purchases',
        orderPartitions: { pending: [], completed: [receiptGiftRecord()] },
        purchases: [receiptGiftRecord()],
      };
    }

    async requestHumanTakeover(): Promise<AgentGatewayResult> {
      this.takeoverCalls += 1;
      return { status: 'skipped', reason: 'disabled', message: 'disabled' };
    }
  }

  function receiptExtraction(): Partial<ExtractionResult> {
    return {
      supportAct: {
        kind: 'provide_detail',
        eventReference: null,
        personReference: null,
      },
      informationRequests: [{
        kind: 'purchase',
        resource: 'purchase_discovery',
        query: 'Estado del pago del comprobante.',
        orderId: null,
        authAction: 'none',
      }],
      ambiguity: {
        status: 'clear',
        clarificationQuestion: null,
        interpretations: [],
        candidateOperations: [],
        questionKey: null,
      },
    };
  }

  function receiptService(runtime: ImageStubRuntime, gateway: ReceiptDiscoveryGateway): {
    service: AgentService;
    planStore: InMemoryPlanStore;
  } {
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: gateway as unknown as AgentConversationGateway,
      capabilityManifest: buildRuntimeCapabilityManifest({ configured: true }),
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubImageFileStore(),
    });
    return { service, planStore };
  }

  function realReplyRuntime(): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {
        async searchProviders(): Promise<never> {
          throw new Error('no network in test');
        },
      } as never,
    });
  }

  it('passes the image-only gate, reads orders plus gift_purchases, and projects native media with both records', async () => {
    const runtime = new ImageStubRuntime();
    runtime.scripted = receiptExtraction();
    const gateway = new ReceiptDiscoveryGateway();
    const { service } = receiptService(runtime, gateway);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    const response = await service.handleTurn(inboundWithImage(image, ''));

    // The receipt-derived purchase request passes the image-only gate: the
    // turn answers instead of persisting silently.
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).not.toBeNull();
    expect(runtime.extractCalls).toBe(1);
    expect(runtime.lastExtractRequest?.customerContext?.purchases.map((purchase) => purchase.orderId)).toEqual(
      expect.arrayContaining([RECEIPT_ORDER_ID, RECEIPT_GIFT_ID]),
    );
    // Profile preparation reads both authorized roots before extraction.
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBeGreaterThanOrEqual(1);
    expect(gateway.guestGiftOrderIds[0]).toBeNull();
    // A single final reply carries the native image plus both records.
    expect(runtime.composeRequests).toHaveLength(1);
    const composed = runtime.composeRequests[0];
    expect(composed).toBeDefined();
    if (!composed) throw new Error('expected one composed reply');
    expect(composed.imageFileAttachments).toEqual([
      { fileId: 'file-test-image-1', messageId: 'wamid.HBgLNTE5ODc2NTQzMjE' },
    ]);
    const purchaseResults = (composed.informationResults ?? []).filter(
      (result): result is Extract<NonNullable<typeof result>, { kind: 'purchase'; status: 'completed' }> =>
        result.kind === 'purchase' && result.status === 'completed',
    );
    // Contract revision (purchase_discovery): receipt assistance expands to
    // one merged discovery result with per-source coverage instead of one
    // result per source.
    expect(purchaseResults).toHaveLength(1);
    const discovery = purchaseResults[0];
    expect(discovery?.resource).toBe('purchase_discovery');
    expect(discovery?.purchases.map((purchase) => purchase.orderId)).toContain(RECEIPT_ORDER_ID);
    expect(discovery?.purchases.map((purchase) => purchase.orderId)).toContain(RECEIPT_GIFT_ID);
    expect(discovery?.sourceCoverage?.map((entry) => entry.source).sort()).toEqual([
      'gift_purchases',
      'orders',
    ]);
    for (const result of purchaseResults) {
      expect(['complete', 'partial']).toContain(result.coverage ?? 'complete');
    }
    // Canonical profile keeps both records with visible amount and status.
    const customerContext = composed.customerContext;
    expect(customerContext).not.toBeNull();
    const profileIds = [
      ...(customerContext?.purchases.map((entry) => entry.orderId) ?? []),
    ];
    expect(profileIds).toContain(RECEIPT_ORDER_ID);
    expect(profileIds).toContain(RECEIPT_GIFT_ID);
    expect(JSON.stringify(customerContext)).toContain(String(RECEIPT_TOTAL));
    // Zero mutations: no handoff, no receipt, no payment effect.
    expect(gateway.takeoverCalls).toBe(0);
    expect(response.plan.human_help_receipt ?? null).toBeNull();
    // The mocked Spanish sentence is not proof: run the real request
    // builder over the actual final input and expose native media plus
    // both authorized-source results there.
    const spec = await realReplyRuntime().buildReplyRequestSpec(composed);
    expect(spec.input).toContain(RECEIPT_ORDER_ID);
    expect(spec.input).toContain(RECEIPT_GIFT_ID);
    expect(spec.input).toContain(String(RECEIPT_TOTAL));
    expect(spec.input).toContain('coverage');
    const finalInput = buildNativeModelInput(
      spec.input,
      composed.imageUrlAttachments ?? [],
      composed.imageFileAttachments ?? [],
    );
    if (typeof finalInput === 'string') throw new Error('expected native model input with the receipt image');
    const wireItems = finalInput.flatMap((message) => message.content.map(toResponsesWireImageItem));
    expect(wireItems.filter((item) => item['type'] === 'input_image')).toEqual([
      { type: 'input_image', file_id: 'file-test-image-1', detail: 'auto' },
    ]);
    expect(wireItems.filter((item) => item['type'] === 'input_text').map((item) => item['text']).join('\n'))
      .toContain(RECEIPT_GIFT_ID);
  });

  it('does not let a completed prior payment question suppress a new receipt-derived check', async () => {
    const runtime = new ImageStubRuntime();
    runtime.scripted = receiptExtraction();
    const gateway = new ReceiptDiscoveryGateway();
    const { service, planStore } = receiptService(runtime, gateway);
    await planStore.save({
      plan: mergePlan(
        createEmptyPlan({
          planId: 'receipt-prior',
          channel: 'whatsapp',
          externalUserId: 'whatsapp:+51987654321',
        }),
        {
          current_node: 'resolver_consultas_informativas',
          information_state: {
            resume_node: null,
            pending_requests: [],
            selection_candidates: [],
            last_completed_request: {
              kind: 'purchase',
              resource: 'orders',
              query: '¿Cuál es el estado de mi pago?',
              orderId: null,
              authAction: 'none',
            },
          },
        },
      ),
      reason: 'test-seed',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });

    const response = await service.handleTurn(inboundWithImage(image, ''));

    expect(response.outbound.delivery.action).toBe('send');
    expect(gateway.guestOrdersCalls).toBe(1);
    expect(gateway.guestGiftCalls).toBeGreaterThanOrEqual(1);
    expect(runtime.composeRequests).toHaveLength(1);
    expect(gateway.takeoverCalls).toBe(0);
  });
});
