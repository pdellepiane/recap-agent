import path from 'node:path';

import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import { normalizeInboundImage } from '../src/core/inbound-image';
import type { AgentRuntime, ComposeReplyRequest, ComposeReplyResult, ExtractRequest, ExtractionResult, OpenAiTransportMetrics } from '../src/runtime/contracts';
import type { ImageFileStore } from '../src/runtime/image-file-store';
import { ImageFileUploadError } from '../src/runtime/image-file-store';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { AgentService, isImageFileAccessFailure } from '../src/runtime/agent-service';
import { OpenAiAgentRuntime, ProviderImageAccessError } from '../src/runtime/openai-agent-runtime';
import { ModelComposedFailureError } from '../src/runtime/model-composition';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import { createEmptyPlan, mergePlan } from '../src/core/plan';

/**
 * R3: inaccessible images degrade to a typed unavailable-evidence retry;
 * every other provider failure propagates untouched. The reproduced 400
 * download shape comes from the live artifact
 * (eval-2026-09-11T18-13-10-185Z-31697069,
 * `400 Error while downloading file. Upstream status code: 404.`) rebuilt
 * here through the installed SDK's own error factory, never a guessed
 * generic Error.
 */
const DOWNLOAD_DIAGNOSTIC = 'Error while downloading file. Upstream status code: 404.';

function reproducedDownloadFailure(): Error {
  return OpenAI.APIError.generate(
    400,
    { error: { message: DOWNLOAD_DIAGNOSTIC, type: 'invalid_request_error', param: null, code: null } },
    undefined,
    new Headers(),
  );
}

function errorJson(status: number, message: string): string {
  return JSON.stringify({ error: { message, type: 'invalid_request_error', param: null, code: null } });
}

function boundaryClient(status: number, message: string): OpenAI {
  const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
  Reflect.set(client, 'fetch', async () => new Response(errorJson(status, message), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-r3' },
  }));
  return client;
}

function boundaryRuntime(client: OpenAI): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: {
      loadNodeBundle: async () => ({
        id: 'test-bundle', filePaths: [], instructions: 'Responde en español.', allowedTools: [],
      }),
      loadModuleFilesBundle: async () => ({
        id: 'test-bundle', filePaths: [], instructions: 'Responde en español.', allowedTools: [],
        fileBytes: [],
      }),
    } as never,
    providerGateway: {} as never,
    openAIClient: client,
  });
}

const IMAGE_URL = 'https://example.com/media/expired-receipt.png';

function boundaryRequest(options?: { withImage?: boolean }): ComposeReplyRequest {
  const withImage = options?.withImage ?? true;
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: 'Es mi comprobante',
    messageContext: localTurnMessageContext('not_configured'),
    plan: mergePlan(
      createEmptyPlan({ planId: 'r3-boundary', channel: 'whatsapp', externalUserId: 'u' }),
      { current_node: 'resolver_consultas_informativas' },
    ),
    extraction: {
      actionIntent: null, informationRequests: [], phoneConfirmation: null, intentConfidence: 1,
      ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] },
      eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null,
      location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [],
      assumptions: [], conversationSummary: 'Comprobante por URL.', selectedProviderHints: [],
      pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null,
      providerFitCriteria: null, providerQueryIntents: [], providerPlanOperations: [],
      providerExplanationRequest: null, providerDetailRequest: null,
    },
    missingFields: [], searchReady: false, providerResults: [], errorMessage: null,
    promptBundleId: 'test-bundle', promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    imageEvidence: { status: 'available', reason: null, captionPresent: true, source: 'url', refStored: true },
    ...(withImage ? { imageUrlAttachments: [{ url: IMAGE_URL, messageId: 'wamid.r3' }] } : {}),
  };
}

describe('R3 provider error boundary', () => {
  it('normalizes the reproduced 400 download failure to a typed image-access error', async () => {
    const runtime = boundaryRuntime(boundaryClient(400, DOWNLOAD_DIAGNOSTIC));
    const failure = await runtime.composeReply(boundaryRequest()).then(
      () => { throw new Error('expected composeReply to throw'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ProviderImageAccessError);
    const typed = failure as ProviderImageAccessError;
    expect(typed.status).toBe(400);
    expect(typed.providerCode).toBeNull();
    expect(typed.providerType).toBe('invalid_request_error');
    // The failed attempt transport rides the typed error for totals.
    expect(typed.failedTransport?.observedRequestCount).toBeGreaterThan(0);
    // The SDK cause keeps the actual reproduced shape: BadRequestError
    // constructor with `.name` 'Error', so name predicates miss it.
    const cause = (typed as unknown as { cause?: unknown }).cause as object;
    expect(cause.constructor.name).toBe('BadRequestError');
    expect((cause as { name: string }).name).toBe('Error');
  });

  it('never normalizes a generic 400 without the download diagnostic', async () => {
    const runtime = boundaryRuntime(boundaryClient(400, 'Invalid request: unknown parameter foo.'));
    const failure = await runtime.composeReply(boundaryRequest()).then(
      () => { throw new Error('expected composeReply to throw'); },
      (error: unknown) => error,
    );
    expect(failure).not.toBeInstanceOf(ProviderImageAccessError);
    expect((failure as { status?: unknown }).status).toBe(400);
  });

  it.each([
    { status: 401, message: 'Incorrect API key provided.' },
    { status: 403, message: 'Request not allowed.' },
    { status: 429, message: 'Rate limit reached.' },
    { status: 500, message: 'The server had an error.' },
  ])('never normalizes status $status as image unavailability', async ({ status, message }) => {
    const runtime = boundaryRuntime(boundaryClient(status, message));
    const failure = await runtime.composeReply(boundaryRequest()).then(
      () => { throw new Error('expected composeReply to throw'); },
      (error: unknown) => error,
    );
    expect(failure).not.toBeInstanceOf(ProviderImageAccessError);
  });

  it('never normalizes a timeout as image unavailability', async () => {
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    Reflect.set(client, 'fetch', async () => {
      throw new OpenAI.APIConnectionTimeoutError({ message: 'Request timed out.' });
    });
    const failure = await boundaryRuntime(client).composeReply(boundaryRequest()).then(
      () => { throw new Error('expected composeReply to throw'); },
      (error: unknown) => error,
    );
    expect(failure).not.toBeInstanceOf(ProviderImageAccessError);
  });

  it('never normalizes the download diagnostic on a call without image content', async () => {
    const runtime = boundaryRuntime(boundaryClient(400, DOWNLOAD_DIAGNOSTIC));
    const failure = await runtime.composeReply(boundaryRequest({ withImage: false })).then(
      () => { throw new Error('expected composeReply to throw'); },
      (error: unknown) => error,
    );
    expect(failure).not.toBeInstanceOf(ProviderImageAccessError);
  });
});

describe('R3 image-access failure predicate', () => {
  it('recognizes the reproduced SDK 400 download shape', () => {
    expect(isImageFileAccessFailure(reproducedDownloadFailure())).toBe(true);
  });

  it('recognizes the typed boundary error', () => {
    expect(isImageFileAccessFailure(new ProviderImageAccessError('400 download', {
      status: 400, providerCode: null, providerParam: null,
      providerType: 'invalid_request_error', failedTransport: null,
    }))).toBe(true);
  });

  it.each([
    ['generic 400', Object.assign(new Error('Invalid request: bad schema.'), { status: 400 })],
    ['auth 401', Object.assign(new Error('bad key'), { status: 401 })],
    ['auth 403', Object.assign(new Error('forbidden'), { status: 403 })],
    ['rate limit 429', Object.assign(new Error('slow down'), { status: 429 })],
    ['outage 500', Object.assign(new Error('server error'), { status: 500 })],
    ['timeout', new Error('Request timed out.')],
    ['schema failure', new ModelComposedFailureError('model_error')],
  ])('never diagnoses %s as image unavailability', (_label, error) => {
    expect(isImageFileAccessFailure(error)).toBe(false);
  });
});

const JPEG_MINIMAL = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]).toString('base64');
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

class R3StubRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];
  public attempts = 0;
  public extractCalls = 0;
  public failures: unknown[] = [];
  public scripted: Partial<ExtractionResult> = {};
  public nullRetryUsage = false;

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractCalls += 1;
    return {
      actionIntent: null, informationRequests: [], intentConfidence: 1, eventType: null,
      vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null,
      budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [],
      conversationSummary: `Caption recibida: ${request.userMessage}`,
      selectedProviderHints: [], selectedProviderReferences: [], closeAction: null,
      pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null,
      providerFitCriteria: {
        eventType: null, needCategory: null, location: null, budgetAmount: null,
        budgetCurrency: null, mustHave: [], shouldAvoid: [], rankingNotes: 'Sin criterios.',
      },
      providerQueryIntents: [], providerPlanOperations: [], providerExplanationRequest: null,
      providerDetailRequest: null,
      ...this.scripted,
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.attempts += 1;
    const failure = this.failures[this.attempts - 1];
    if (failure !== undefined) throw failure as Error;
    this.composeRequests.push(request);
    const text = `caption:${request.userMessage}`;
    return {
      text,
      structuredMessage: { type: 'generic', paragraphs_es: [text] },
      tokenUsage: this.nullRetryUsage ? null : { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      openAiCall: {
        responseId: 'resp-r3', requestId: 'req-r3', model: 'gpt-test', attemptCount: 1,
        requestMetrics: {
          instructionBytes: 1, inputBytes: 1, toolCount: 0, schemaPropertyCount: 1,
          transport: {
            observedRequestCount: 1, totalPayloadBytes: 10, instructionBytes: 1,
            inputBytes: 1, toolBytes: 0, outputSchemaBytes: 1, requests: [],
          },
        },
      },
    };
  }
}

class R3StubImageStore implements ImageFileStore {
  public uploads = 0;
  public deletions: string[] = [];
  public failUpload: unknown = null;

  async uploadImage(input: { bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }) {
    this.uploads += 1;
    if (this.failUpload !== null) throw this.failUpload as Error;
    return {
      fileId: 'file-r3-image-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      byteLength: input.bytes.length,
    };
  }

  async deleteImage(fileId: string): Promise<void> {
    this.deletions.push(fileId);
  }
}

function serviceWith(runtime: R3StubRuntime): {
  service: AgentService; planStore: InMemoryPlanStore; imageStore: R3StubImageStore;
} {
  const planStore = new InMemoryPlanStore();
  const imageStore = new R3StubImageStore();
  const service = new AgentService({
    planStore,
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    imageFileStore: imageStore,
  });
  return { service, planStore, imageStore };
}

function inboundWithImage(image: NormalizedInboundMessage['image'], text: string, messageId = 'wamid.r3img1'): NormalizedInboundMessage {
  return {
    channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321', text, messageId,
    receivedAt: '2026-09-08T14:30:00Z', contactPhone: '+51987654321', image,
  };
}

function failedTransportFixture(): OpenAiTransportMetrics {
  return {
    observedRequestCount: 1, totalPayloadBytes: 100, instructionBytes: 10, inputBytes: 90,
    toolBytes: 0, outputSchemaBytes: 5,
    requests: [{
      sequence: 0, stage: 'reply', requestId: 'req-fail', responseId: null,
      statusCode: 400, succeeded: false, totalPayloadBytes: 100, instructionBytes: 10,
      inputBytes: 90, toolBytes: 0, outputSchemaBytes: 5, requestBodySha256: null,
    }],
  };
}

function typedDownloadFailure(): ProviderImageAccessError {
  return new ProviderImageAccessError(`400 ${DOWNLOAD_DIAGNOSTIC}`, {
    status: 400, providerCode: null, providerParam: null,
    providerType: 'invalid_request_error', failedTransport: failedTransportFixture(),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('R3 current-URL download failure', () => {
  it('answers from other evidence with both attempts in totals', async () => {
    const runtime = new R3StubRuntime();
    runtime.failures = [typedDownloadFailure()];
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    // Useful model-written response, no HTTP 500 from the lost image.
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).not.toBeNull();
    // Exactly one retry with zero attachments and unavailable evidence;
    // no repeat extraction.
    expect(runtime.attempts).toBe(2);
    expect(runtime.extractCalls).toBe(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const retry = runtime.composeRequests[0];
    expect(retry?.imageFileAttachments ?? []).toEqual([]);
    expect(retry?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'image_unavailable' });
    // Both attempts stay recorded; the failed ref persists.
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('reply_failed_file_access');
    expect(outputs).toContain('fallback_reply_received');
    expect(response.plan.image_attachments).toHaveLength(1);
    expect(response.trace.plan_persist_reason).toBe('image_file_unavailable');
    // Totals keep both attempts, never success-only numbers.
    const call = response.trace.openai_calls.reply;
    expect(call?.attemptCount).toBe(2);
    expect(call?.requestMetrics.transport?.observedRequestCount).toBe(2);
    // The failed attempt never yields token usage: the retry usage is
    // partial evidence, never a complete accounting or a zero label.
    const outputsPartial = JSON.stringify(response.trace.tool_outputs);
    expect(outputsPartial).toContain('\\"token_usage\\": \\"partial\\"');
    expect(response.trace.token_usage.reply?.total_tokens).toBe(15);
  });

  it('handles the raw reproduced SDK shape without the typed wrapper', async () => {
    const runtime = new R3StubRuntime();
    runtime.failures = [reproducedDownloadFailure()];
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    expect(response.outbound.delivery.action).toBe('send');
    expect(runtime.attempts).toBe(2);
    expect(runtime.composeRequests[0]?.imageEvidence).toMatchObject({ status: 'unavailable' });
    expect(response.trace.plan_persist_reason).toBe('image_file_unavailable');
  });

  it('keeps a generation failure when the retry also fails', async () => {
    const runtime = new R3StubRuntime();
    runtime.failures = [typedDownloadFailure(), new Error('server error')];
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    await expect(service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'))).rejects.toThrow('server error');
    expect(runtime.attempts).toBe(2);
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('records unavailable usage when the retry carries no token usage', async () => {
    const runtime = new R3StubRuntime();
    runtime.nullRetryUsage = true;
    runtime.failures = [typedDownloadFailure()];
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    expect(response.outbound.delivery.action).toBe('send');
    expect(runtime.attempts).toBe(2);
    expect(runtime.composeRequests[0]?.imageEvidence).toMatchObject({ status: 'unavailable' });
    // Missing usage is recorded as unavailable, never zero and never a
    // complete accounting.
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('\\"token_usage\\": \\"unavailable\\"');
    expect(response.trace.token_usage.reply).toBeNull();
    expect(response.trace.openai_calls.reply?.attemptCount).toBe(2);
  });
});

describe('R3 retained-file access failure on a text follow-up', () => {
  it('retries once with zero attachments and unavailable evidence', async () => {
    const runtime = new R3StubRuntime();
    const { service, planStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    const first = await service.handleTurn(inboundWithImage(image, ''));
    expect(first.outbound.delivery.action).toBe('suppress');
    expect(runtime.composeRequests).toHaveLength(0);

    // The stored file expired provider-side: the next compose carries the
    // retained ref and fails with a file-access 404.
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.r3img1'] },
    };
    runtime.failures = [Object.assign(new Error('file not found'), { status: 404 })];
    const second = await service.handleTurn({
      channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321',
      text: 'Que monto ves ahi?', messageId: 'wamid.followup1',
      receivedAt: '2026-09-08T14:30:10Z', contactPhone: '+51987654321',
    });

    expect(second.outbound.delivery.action).toBe('send');
    expect(second.outbound.text).not.toBeNull();
    // Failed attempt plus one retry, no repeat extraction, no repeated effect.
    expect(runtime.attempts).toBe(2);
    expect(runtime.extractCalls).toBe(2);
    expect(runtime.composeRequests).toHaveLength(1);
    const retry = runtime.composeRequests[0];
    expect(retry?.imageFileAttachments ?? []).toEqual([]);
    expect(retry?.imageUrlAttachments ?? []).toEqual([]);
    expect(retry?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'image_unavailable' });
    const outputs = JSON.stringify(second.trace.tool_outputs);
    expect(outputs).toContain('reply_failed_file_access');
    expect(outputs).toContain('fallback_reply_received');
    expect(second.trace.plan_persist_reason).toBe('image_file_unavailable');
    // The reference is retained, never deleted or promised as available.
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.image_attachments).toHaveLength(1);
  });
});

describe('R3 unrelated failures never become image diagnoses', () => {
  it.each([
    ['generic 400', Object.assign(new Error('Invalid request: bad schema.'), { status: 400 })],
    ['auth 401', Object.assign(new Error('bad key'), { status: 401 })],
    ['auth 403', Object.assign(new Error('forbidden'), { status: 403 })],
    ['rate limit 429', Object.assign(new Error('slow down'), { status: 429 })],
    ['outage 500', Object.assign(new Error('server error'), { status: 500 })],
    ['timeout', new Error('Request timed out.')],
    ['model composition', new ModelComposedFailureError('model_error')],
  ])('propagates %s without an unavailable fallback', async (_label, failure) => {
    const runtime = new R3StubRuntime();
    runtime.failures = [failure, failure, failure];
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    await expect(service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'))).rejects.toThrow();
    // Exactly one attempt: no mislabeled unavailable retry was composed.
    expect(runtime.attempts).toBe(1);
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('never relabels a persistence failure as image unavailability', async () => {
    const runtime = new R3StubRuntime();
    const planStore = new InMemoryPlanStore();
    planStore.save = async () => {
      throw new Error('plan persistence down');
    };
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new R3StubImageStore(),
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    await expect(service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'))).rejects.toThrow('plan persistence down');
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageEvidence).toMatchObject({ status: 'available' });
  });
});

describe('R3 current-image upload classification', () => {
  it('propagates a retryable transport upload failure instead of bad-input evidence', async () => {
    const runtime = new R3StubRuntime();
    const { service, imageStore } = serviceWith(runtime);
    imageStore.failUpload = new ImageFileUploadError('Image file upload failed.', {
      retryable: true,
      causeName: 'APIConnectionError',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    await expect(service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'))).rejects.toThrow(
      'Image file upload failed.',
    );
    // No unavailable-evidence fallback was composed for a transport failure.
    expect(imageStore.uploads).toBe(1);
    expect(runtime.extractCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('degrades malformed-media upload failure to unavailable evidence', async () => {
    const runtime = new R3StubRuntime();
    const { service, imageStore } = serviceWith(runtime);
    imageStore.failUpload = new ImageFileUploadError('Empty image bytes.', {
      retryable: false,
      causeName: 'validation',
    });
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    expect(response.outbound.delivery.action).toBe('send');
    expect(imageStore.uploads).toBe(1);
    expect(response.plan.image_attachments ?? []).toEqual([]);
    const request = runtime.composeRequests[0];
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable' });
    expect(request?.imageFileAttachments ?? []).toEqual([]);
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('upload_failed');
    expect(outputs).not.toContain('upload_failed_retryable');
  });
});

describe('R3 invalid local image', () => {
  it('enters the unavailable evidence path before vision without claiming a Files upload', async () => {
    const runtime = new R3StubRuntime();
    const { service, imageStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: '!!!not-base64!!!', mime_type: 'image/png' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).not.toBeNull();
    // No upload was attempted and no file reference was stored.
    expect(imageStore.uploads).toBe(0);
    expect(response.plan.image_attachments ?? []).toEqual([]);
    const request = runtime.composeRequests[0];
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable' });
    expect(request?.imageFileAttachments ?? []).toEqual([]);
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).not.toContain('file-test-image-1');
    expect(outputs).not.toContain('file-r3-image-1');
  });
});

describe('R3 support-acknowledgment image recovery', () => {
  function supportAckRuntime(): R3StubRuntime {
    const runtime = new R3StubRuntime();
    runtime.scripted = {
      // Non-receipt acknowledgment tuple: receipt tasks execute discovery
      // reads instead of acknowledging, so recovery coverage uses a tuple
      // that stays on the acknowledgment path.
      supportAct: {
        kind: 'provide_detail',
        topic: 'mailbox_capacity',
        detail: 'mailbox_full',
        eventReference: null,
        personReference: null,
      },
    };
    return runtime;
  }

  it('retries an image-download 404 once without the attachment and keeps support facts', async () => {
    const runtime = supportAckRuntime();
    runtime.failures = [typedDownloadFailure()];
    const { service, imageStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Mi bandeja está llena, te mando captura'));

    // A delivered model-authored reply, never the blank failure delivery.
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).not.toBeNull();
    // Failed attempt plus exactly one retry: no repeat extraction, no
    // repeat upload, no doubled effects.
    expect(runtime.attempts).toBe(2);
    expect(runtime.extractCalls).toBe(1);
    expect(imageStore.uploads).toBe(1);
    expect(runtime.composeRequests).toHaveLength(1);
    const retry = runtime.composeRequests[0];
    expect(retry?.imageFileAttachments ?? []).toEqual([]);
    expect(retry?.imageUrlAttachments ?? []).toEqual([]);
    expect(retry?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'image_unavailable' });
    // The retry carries the original user text and the support facts.
    expect(retry?.userMessage).toBe('Mi bandeja está llena, te mando captura');
    expect(response.plan.conversation_summary).toContain('buzón');
    // This stayed the acknowledgment path, not the information executor.
    expect(response.trace.operational_note).toContain('acknowledged from scoped evidence');
    // Both attempts stay recorded with the failed attempt in totals.
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('reply_failed_file_access');
    expect(outputs).toContain('fallback_reply_received');
    expect(outputs).toContain('\\"token_usage\\": \\"partial\\"');
    expect(response.trace.plan_persist_reason).toBe('image_file_unavailable');
    expect(response.trace.openai_calls.reply?.attemptCount).toBe(2);
  });

  it('keeps a generic compose failure on the real failure path without an unavailable retry', async () => {
    const runtime = supportAckRuntime();
    runtime.failures = [new Error('server error')];
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Mi bandeja está llena, te mando captura'));

    // Explicit delivery failure, never fake silence and never an
    // unavailable-image diagnosis of a generic outage.
    expect(response.outbound.delivery.action).toBe('failure');
    expect(response.outbound.text).toBeNull();
    expect(runtime.attempts).toBe(1);
    expect(runtime.composeRequests).toHaveLength(0);
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).not.toContain('reply_failed_file_access');
    expect(outputs).not.toContain('fallback_reply_received');
    expect(response.trace.plan_persist_reason).toBe('support_continuity_acknowledgment');
  });
});
