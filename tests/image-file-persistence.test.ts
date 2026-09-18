import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';

import type { NormalizedInboundMessage } from '../src/core/messages';
import {
  IMAGE_FILE_EXPIRY_SECONDS,
  MAX_IMAGE_ATTACHMENTS_JSON_BYTES,
  MAX_IMAGE_ATTACHMENT_REFS,
  appendImageAttachmentRef,
  contentDigestForBytes,
  findReusableFileRef,
  imageAttachmentsJsonBytes,
  imageFileFingerprint,
  isFileRefActive,
  pruneExpiredFileRefs,
  redactFileIdForLog,
  selectActiveImageAttachmentRefs,
  type FileAttachmentRef,
  type ImageAttachmentRef,
} from '../src/core/image-attachments';
import {
  decodeValidatedBase64Bytes,
  inboundImageSchema,
  normalizeInboundImage,
} from '../src/core/inbound-image';
import {
  ImageFileUploadError,
  OpenAiImageFileStore,
  type ImageFileStore,
} from '../src/runtime/image-file-store';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
import {
  buildImageAttachmentIndexForExtraction,
  buildNativeFileImageItems,
  resolveProjectedImageFileAttachments,
  toResponsesWireImageItem,
} from '../src/runtime/openai-agent-runtime';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import {
  MAX_LAST_OUTBOUND_TEXT_BYTES,
  buildLastOutboundContext,
  createEmptyPlan,
  mergePlan,
  normalizeRawPlan,
  planSchema,
  truncateTextToUtf8Bytes,
} from '../src/core/plan';
import { deriveDynamicAgentPolicy, type DynamicAgentPolicy } from '../src/runtime/dynamic-agent-policy';
import { genericMessageSchema, welcomeMessageSchema } from '../src/runtime/structured-message';
import type {
  AgentConversationGateway,
  AgentConversationMessage,
} from '../src/runtime/agent-conversation-gateway';
import { createDynamicExtractionSchema } from '../src/runtime/extraction-schemas';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';
import { AgentService } from '../src/runtime/agent-service';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PAST = '2020-01-01T00:00:00.000Z';
const NOW = Date.now();

function fileRef(overrides: Partial<FileAttachmentRef> = {}): FileAttachmentRef {
  return {
    kind: 'file',
    fileId: 'file-abc123',
    expiresAt: FUTURE,
    mimeType: 'image/png',
    byteLength: 70,
    contentDigest: 'd'.repeat(64),
    messageId: 'wamid.file1',
    receivedAt: '2026-09-08T14:30:00Z',
    ...overrides,
  };
}

function urlRef(url: string, messageId: string, receivedAt: string): ImageAttachmentRef {
  return { kind: 'url', url, messageId, receivedAt };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('file/url attachment union', () => {
  it('parses file refs and normalizes legacy url-only refs', () => {
    expect(appendImageAttachmentRef([], fileRef())).toHaveLength(1);
    // Legacy stored shape without kind still parses as url.
    expect(appendImageAttachmentRef([], {
      url: 'https://example.com/a.png',
      messageId: 'm1',
      receivedAt: '2026-09-08T14:30:00Z',
    })).toEqual([{
      kind: 'url',
      url: 'https://example.com/a.png',
      messageId: 'm1',
      receivedAt: '2026-09-08T14:30:00Z',
    }]);
    // Caller-supplied file IDs from another conversation are never stored
    // raw: append keeps only schema-valid refs with linkage.
    expect(appendImageAttachmentRef([], { kind: 'file', fileId: 'x' })).toHaveLength(0);
  });

  it('dedupes duplicate delivery but keeps distinct message linkage for reused files', () => {
    let refs: ImageAttachmentRef[] = [];
    refs = appendImageAttachmentRef(refs, fileRef());
    refs = appendImageAttachmentRef(refs, fileRef());
    expect(refs).toHaveLength(1);
    refs = appendImageAttachmentRef(refs, fileRef({ messageId: 'wamid.file2' }));
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((ref) => ref.messageId)).size).toBe(2);
  });

  it('caps refs and keeps serialized refs within budget', () => {
    let refs: ImageAttachmentRef[] = [];
    for (let index = 0; index < MAX_IMAGE_ATTACHMENT_REFS + 3; index += 1) {
      refs = appendImageAttachmentRef(
        refs,
        fileRef({ fileId: `file-${index}`, messageId: `m${index}`, contentDigest: `${index}`.padStart(64, '0') }),
      );
    }
    expect(refs).toHaveLength(MAX_IMAGE_ATTACHMENT_REFS);
    expect(imageAttachmentsJsonBytes(refs)).toBeLessThan(MAX_IMAGE_ATTACHMENTS_JSON_BYTES);
  });

  it('reuses active digests, never expired files', () => {
    const refs = [fileRef({ contentDigest: 'a'.repeat(64) }), fileRef({
      fileId: 'file-old',
      messageId: 'm-old',
      contentDigest: 'b'.repeat(64),
      expiresAt: PAST,
    })];
    expect(findReusableFileRef(refs, 'a'.repeat(64), NOW)?.fileId).toBe('file-abc123');
    expect(findReusableFileRef(refs, 'b'.repeat(64), NOW)).toBeNull();
    expect(isFileRefActive(refs[0], NOW)).toBe(true);
    expect(isFileRefActive(refs[1], NOW)).toBe(false);
    expect(pruneExpiredFileRefs(refs, NOW)).toHaveLength(1);
  });

  it('projects at most two active refs, most recent first', () => {
    const refs: ImageAttachmentRef[] = [
      urlRef('https://example.com/0.png', 'm0', '2026-09-08T14:30:00Z'),
      fileRef({ messageId: 'm1', receivedAt: '2026-09-08T14:31:00Z', contentDigest: '1'.repeat(64) }),
      fileRef({ messageId: 'm2', receivedAt: '2026-09-08T14:32:00Z', contentDigest: '2'.repeat(64), expiresAt: PAST }),
    ];
    const projected = selectActiveImageAttachmentRefs(refs, NOW);
    expect(projected).toHaveLength(2);
    expect(projected.map((ref) => ref.messageId)).toEqual(['m1', 'm0']);
  });

  it('redacts file IDs to scoped fingerprints', () => {
    expect(redactFileIdForLog('file-abc123')).not.toContain('file-abc123');
    expect(redactFileIdForLog('file-abc123')).toContain(imageFileFingerprint('file-abc123').slice(0, 8));
    expect(contentDigestForBytes(Buffer.from([1, 2, 3]))).toHaveLength(64);
  });
});

describe('validated base64 decode', () => {
  it('decodes available base64 in memory only', () => {
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    const bytes = decodeValidatedBase64Bytes(image);
    expect(bytes).not.toBeNull();
    expect(bytes?.length).toBeGreaterThan(0);
  });

  it('returns null for unavailable and url images', () => {
    expect(decodeValidatedBase64Bytes({ status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/png' })).toBeNull();
    expect(decodeValidatedBase64Bytes({ status: 'available', source: 'url', url: 'https://example.com/a.png', mimeType: null })).toBeNull();
  });

  it('rejects caller-supplied file IDs on the wire schema', () => {
    expect(inboundImageSchema.safeParse({ fileId: 'file-abc', mime_type: 'image/png' }).success).toBe(false);
    expect(inboundImageSchema.safeParse({ data: PNG_1X1, mime_type: 'image/png', fileId: 'file-abc' }).success).toBe(false);
  });
});

describe('Files adapter', () => {
  function storeWith(clientFiles: { create: (...args: unknown[]) => Promise<unknown>; delete: (...args: unknown[]) => Promise<unknown> }): {
    store: OpenAiImageFileStore;
    seen: Array<Record<string, unknown>>;
  } {
    const seen: Array<Record<string, unknown>> = [];
    const client = {
      files: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          return clientFiles.create(params);
        },
        delete: async (fileId: string) => clientFiles.delete(fileId),
      },
    };
    return { store: new OpenAiImageFileStore(client as unknown as OpenAI), seen };
  }

  it('uploads with purpose vision and a one-day expiry', async () => {
    const { store, seen } = storeWith({
      create: async () => ({ id: 'file-new', created_at: 1750000000, bytes: 3 }),
      delete: async () => ({}),
    });
    const result = await store.uploadImage({ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' });
    expect(IMAGE_FILE_EXPIRY_SECONDS).toBe(86_400);
    expect(seen[0]?.purpose).toBe('vision');
    expect(seen[0]?.expires_after).toEqual({ anchor: 'created_at', seconds: 86_400 });
    expect(result.fileId).toBe('file-new');
    expect(result.expiresAt).toBe(new Date((1750000000 + 86_400) * 1000).toISOString());
    expect(result.byteLength).toBe(3);
  });

  it('honors the recorded expiry of older references instead of assuming deletion', async () => {
    // A pre-existing five-day reference stays active until its own recorded
    // expiry: the one-day retention applies to new uploads only, and expiry
    // bounds media availability, never stored facts.
    const createdAtMs = Date.now() - 4 * 24 * 3600 * 1000;
    const oldFiveDayRef: FileAttachmentRef = {
      kind: 'file',
      fileId: 'file-legacy',
      expiresAt: new Date(createdAtMs + 5 * 24 * 3600 * 1000).toISOString(),
      mimeType: 'image/png',
      byteLength: 10,
      contentDigest: 'c'.repeat(64),
      messageId: 'm-legacy',
      receivedAt: new Date(createdAtMs).toISOString(),
    };
    expect(isFileRefActive(oldFiveDayRef, Date.now())).toBe(true);
    expect(findReusableFileRef([oldFiveDayRef], 'c'.repeat(64), Date.now())?.fileId).toBe('file-legacy');
  });

  it('retains the provider-returned expiry instead of recomputing it', async () => {
    const { store } = storeWith({
      create: async () => ({
        id: 'file-returned',
        created_at: 1750000000,
        expires_at: 1750000000 + 100_000,
        bytes: 3,
      }),
      delete: async () => ({}),
    });
    const result = await store.uploadImage({ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' });
    expect(result.expiresAt).toBe(new Date((1750000000 + 100_000) * 1000).toISOString());
  });

  it('rejects invalid provider responses without inventing a successful upload', async () => {
    for (const invalid of [
      { id: '', created_at: 1750000000, bytes: 3 },
      { id: 'file-bad-time', created_at: Number.NaN, bytes: 3 },
      { id: 'file-bad-size', created_at: 1750000000, bytes: 0 },
      { id: 'file-bad-expiry', created_at: 1750000000, expires_at: 1750000000 - 10, bytes: 3 },
    ]) {
      const { store } = storeWith({
        create: async () => invalid,
        delete: async () => ({}),
      });
      const failure = await store
        .uploadImage({ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ImageFileUploadError);
      expect((failure as ImageFileUploadError).retryable).toBe(false);
      expect((failure as ImageFileUploadError).causeName).toBe('validation');
    }
  });

  it('classifies retryable transport failures and non-retryable auth failures', async () => {
    const { store } = storeWith({
      create: async () => {
        throw new OpenAI.RateLimitError(429, undefined, 'slow down', new Headers());
      },
      delete: async () => ({}),
    });
    const failure = await store.uploadImage({ bytes: Buffer.from([1]), mimeType: 'image/png' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ImageFileUploadError);
    expect((failure as ImageFileUploadError).retryable).toBe(true);

    const { store: authStore } = storeWith({
      create: async () => {
        throw new OpenAI.AuthenticationError(401, undefined, 'bad key', new Headers());
      },
      delete: async () => ({}),
    });
    const authFailure = await authStore.uploadImage({ bytes: Buffer.from([1]), mimeType: 'image/png' }).catch((error: unknown) => error);
    expect((authFailure as ImageFileUploadError).retryable).toBe(false);
  });

  it('rejects empty bytes without a network call', async () => {
    const { store, seen } = storeWith({
      create: async () => ({ id: 'file-x', created_at: 1, bytes: 1 }),
      delete: async () => ({}),
    });
    await expect(store.uploadImage({ bytes: Buffer.alloc(0), mimeType: 'image/png' })).rejects.toBeInstanceOf(ImageFileUploadError);
    expect(seen).toHaveLength(0);
  });
});

describe('file-ID reply content', () => {
  it('builds SDK file-ID items and mirrors the Responses file_id wire shape', () => {
    const items = buildNativeFileImageItems([{ fileId: 'file-abc123', messageId: 'm1' }]);
    expect(items).toEqual([{ type: 'input_image', image: { id: 'file-abc123' }, detail: 'auto' }]);
    expect(toResponsesWireImageItem(items[0])).toEqual({ type: 'input_image', file_id: 'file-abc123', detail: 'auto' });
  });

  it('lets the caller cap explicit file projection at two', () => {
    const explicit = [0, 1, 2].map((index) => ({ fileId: `file-${index}`, messageId: `m${index}` }));
    expect(resolveProjectedImageFileAttachments({ explicit })).toHaveLength(2);
    expect(resolveProjectedImageFileAttachments({ explicit: undefined })).toEqual([]);
    expect(resolveProjectedImageFileAttachments({ explicit: [] })).toEqual([]);
  });

  it('serializes file IDs through the installed SDK as input_image.file_id', async () => {
    const wireBodies: string[] = [];
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    Reflect.set(client, 'fetch', async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') wireBodies.push(init.body);
      return new Response(JSON.stringify({
        id: 'resp_img_file_1',
        object: 'response',
        created_at: 1750000000,
        model: 'gpt-test',
        status: 'completed',
        output: [{
          type: 'message',
          id: 'msg_1',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: '{"type":"generic","paragraphs_es":["Veo el comprobante."]}', annotations: [] }],
        }],
        usage: { input_tokens: 120, output_tokens: 12, total_tokens: 132 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-sdk-file' },
      });
    });
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: {
        loadNodeBundle: async () => ({
          id: 'test-bundle',
          filePaths: [],
          instructions: 'Responde en español con un mensaje genérico.',
          allowedTools: [],
        }),
        loadModuleFilesBundle: async () => ({
          id: 'test-bundle',
          filePaths: [],
          instructions: 'Responde en español con un mensaje genérico.',
          allowedTools: [],
          fileBytes: [],
        }),
      } as never,
      providerGateway: {} as never,
      openAIClient: client,
    });
    const plan = mergePlan(
      createEmptyPlan({ planId: 'sdk-file', channel: 'whatsapp', externalUserId: 'u' }),
      {
        current_node: 'resolver_consultas_informativas',
        image_attachments: [fileRef()],
      },
    );
    const baseExtraction: ExtractionResult = {
      actionIntent: null,
      informationRequests: [],
      phoneConfirmation: null,
      intentConfidence: 1,
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
      conversationSummary: 'Comprobante por archivo.',
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
    };
    await runtime.composeReply({
      currentNode: 'resolver_consultas_informativas',
      previousNode: 'resolver_consultas_informativas',
      userMessage: 'Es mi comprobante',
      messageContext: localTurnMessageContext('not_configured'),
      plan,
      extraction: baseExtraction,
      missingFields: [],
      searchReady: false,
      providerResults: [],
      errorMessage: null,
      promptBundleId: 'test-bundle',
      promptFilePaths: [],
      toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
      imageEvidence: { status: 'available', reason: null, captionPresent: true, source: 'file', refStored: true },
      imageFileAttachments: [{ fileId: 'file-abc123', messageId: 'wamid.file1' }],
    });

    expect(wireBodies.length).toBeGreaterThan(0);
    const bodies = wireBodies.map((body) => JSON.parse(body) as Record<string, unknown>);
    const imageItems = bodies.flatMap((body) => {
      const input = body['input'];
      if (!Array.isArray(input)) return [];
      return input.flatMap((entry) => {
        const record = entry as { content?: unknown[] };
        return Array.isArray(record.content) ? record.content : [];
      });
    }).filter((item) => (item as { type?: string }).type === 'input_image');
    // Actual installed-SDK serialization evidence: file_id, not a mirror.
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0]).toMatchObject({ type: 'input_image', file_id: 'file-abc123', detail: 'auto' });
    for (const body of wireBodies) {
      expect(body.split('file-abc123').length - 1).toBe(1);
    }
  });
});

class StubFileStore implements ImageFileStore {
  public uploads = 0;
  public deletions: string[] = [];
  public failUpload: Error | null = null;
  public nextFileId = 'file-live-1';

  async uploadImage(input: { bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }): Promise<{
    fileId: string;
    expiresAt: string;
    byteLength: number;
  }> {
    this.uploads += 1;
    if (this.failUpload !== null) throw this.failUpload;
    const fileId = this.nextFileId;
    return { fileId, expiresAt: FUTURE, byteLength: input.bytes.length };
  }

  async deleteImage(fileId: string): Promise<void> {
    this.deletions.push(fileId);
  }
}

function baseExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    actionIntent: null,
    informationRequests: [],
    phoneConfirmation: null,
    intentConfidence: 1,
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
    conversationSummary: 'stub',
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
    imageReference: { status: 'none', referencedMessageIds: [] },
    ...overrides,
  };
}

class OwnerStubRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];
  public scripted: Partial<ExtractionResult> = {};
  public pendingOutcome: 'answered' | 'needs_input' | 'unchanged' | null = null;

  async extract(): Promise<ExtractionResult> {
    return baseExtraction(this.scripted);
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    const text = `owner:${request.userMessage}`;
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

function fileService(runtime: OwnerStubRuntime, store: StubFileStore): { service: AgentService; planStore: InMemoryPlanStore } {
  const planStore = new InMemoryPlanStore();
  const service = new AgentService({
    planStore,
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    imageFileStore: store,
  });
  return { service, planStore };
}

function inboundWithBase64(data: string, mimeType: string, text: string, messageId: string): NormalizedInboundMessage {
  const image = normalizeInboundImage({ data, mime_type: mimeType });
  if (image.status !== 'available' || image.source !== 'base64') {
    throw new Error('fixture base64 must normalize to available base64');
  }
  return {
    channel: 'whatsapp',
    externalUserId: 'whatsapp:+51987654321',
    text,
    messageId,
    receivedAt: '2026-09-08T14:30:00Z',
    contactPhone: '+51987654321',
    image,
  };
}

describe('base64 production wiring', () => {
  it('uploads once, persists the ref before the ack, and projects the file natively', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service } = fileService(runtime, store);
    const response = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Cuanto dice aqui?', 'wamid.cap1'));

    expect(store.uploads).toBe(1);
    const refs = response.plan.image_attachments;
    expect(refs).toHaveLength(1);
    const ref = refs[0];
    expect(ref?.kind).toBe('file');
    if (ref?.kind !== 'file') throw new Error('expected file ref');
    expect(ref.fileId).toBe('file-live-1');
    expect(Date.parse(ref.expiresAt)).toBeGreaterThan(Date.now());
    expect(ref.mimeType).toBe('image/png');
    expect(ref.byteLength).toBeGreaterThan(0);
    expect(ref.contentDigest).toHaveLength(64);
    expect(ref.messageId).toBe('wamid.cap1');
    const request = runtime.composeRequests[0];
    expect(request?.userMessage).toBe('Cuanto dice aqui?');
    expect(request?.imageFileAttachments).toEqual([{ fileId: 'file-live-1', messageId: 'wamid.cap1' }]);
    expect(request?.imageEvidence).toMatchObject({ status: 'available', source: 'file', refStored: true });
    expect(response.outbound.text).toBe('owner:Cuanto dice aqui?');
    const traceJson = JSON.stringify(response.trace);
    expect(traceJson).not.toContain(PNG_1X1);
    expect(traceJson).not.toContain('file-live-1');
    expect(traceJson).toContain(imageFileFingerprint('file-live-1').slice(0, 8));
    expect(JSON.stringify(response.plan)).not.toContain(PNG_1X1);
  });

  it('reuses the persisted ref on duplicate delivery without re-uploading', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service } = fileService(runtime, store);
    await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Cuanto dice aqui?', 'wamid.dupe'));
    const second = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Cuanto dice aqui?', 'wamid.dupe'));
    expect(store.uploads).toBe(1);
    expect(second.plan.image_attachments).toHaveLength(1);
  });

  it('shares one file for identical bytes with distinct message linkage and original expiry', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service } = fileService(runtime, store);
    await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Primera', 'wamid.r1'));
    store.nextFileId = 'file-live-2';
    const second = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Segunda', 'wamid.r2'));
    expect(store.uploads).toBe(1);
    expect(second.plan.image_attachments).toHaveLength(2);
    const ids = second.plan.image_attachments.map((ref) => ref.kind === 'file' ? ref.fileId : null);
    expect(ids).toEqual(['file-live-1', 'file-live-1']);
    const expiries = second.plan.image_attachments.map((ref) => ref.kind === 'file' ? ref.expiresAt : null);
    expect(expiries[0]).toBe(expiries[1]);
  });

  it('propagates a retryable transport upload failure instead of bad-input evidence', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    store.failUpload = new ImageFileUploadError('boom', { retryable: true, causeName: 'APIConnectionError' });
    const { service } = fileService(runtime, store);
    await expect(
      service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Cuanto dice aqui?', 'wamid.up1')),
    ).rejects.toThrow('boom');
    // No unavailable-evidence fallback was composed for a transport failure.
    expect(runtime.composeRequests).toHaveLength(0);
    expect(store.uploads).toBe(1);
  });

  it('degrades a malformed-media upload failure to unavailable evidence without false success', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    store.failUpload = new ImageFileUploadError('empty bytes', { retryable: false, causeName: 'validation' });
    const { service } = fileService(runtime, store);
    const response = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Cuanto dice aqui?', 'wamid.up1b'));

    expect(response.plan.image_attachments).toHaveLength(0);
    const request = runtime.composeRequests[0];
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'upload_failed' });
    expect(request?.imageFileAttachments).toBeUndefined();
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('upload_failed');
  });

  it('never relabels a non-upload failure as an unreadable image', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    store.failUpload = new Error('auth misconfigured');
    const { service } = fileService(runtime, store);
    await expect(
      service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Hola', 'wamid.up2')),
    ).rejects.toThrow('auth misconfigured');
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('deletes the new upload and fails retryably when the save fails', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
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
      imageFileStore: store,
    });
    await expect(
      service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Hola', 'wamid.save1')),
    ).rejects.toThrow('plan persistence down');
    expect(store.deletions).toEqual(['file-live-1']);
  });
});

describe('follow-up image relevance', () => {  async function seedImage(): Promise<{ service: AgentService; runtime: OwnerStubRuntime; store: StubFileStore }> {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service } = fileService(runtime, store);
    await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', '', 'wamid.seed1'));
    return { service, runtime, store };
  }

  function textTurn(text: string, messageId: string): NormalizedInboundMessage {
    return {
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
      text,
      messageId,
      receivedAt: '2026-09-08T14:35:00Z',
      contactPhone: '+51987654321',
    };
  }

  it('omits pixels on unrelated turns without structured linkage', async () => {
    const { service, runtime } = await seedImage();
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Cual es el horario?' }],
      imageReference: { status: 'none', referencedMessageIds: [] },
    };
    await service.handleTurn(textTurn('Cual es el horario?', 'wamid.faq1'));
    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments ?? []).toEqual([]);
    expect(request?.imageUrlAttachments ?? []).toEqual([]);
    expect(request?.imageEvidence).toBeUndefined();
  });

  it('projects the linked file when the extractor references a prior image', async () => {
    const { service, runtime } = await seedImage();
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.seed1'] },
    };
    await service.handleTurn(textTurn('Que monto ves ahi?', 'wamid.q1'));
    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments).toEqual([{ fileId: 'file-live-1', messageId: 'wamid.seed1' }]);
    expect(request?.imageEvidence).toMatchObject({ status: 'available', source: 'file' });
  });

  it('reloads the persisted ref after a cold start without re-uploading', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service } = fileService(runtime, store);
    const first = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', 'Que dice?', 'wamid.cold1'));
    expect(store.uploads).toBe(1);

    // Cold start: the plan crosses a JSON boundary into a fresh store/service.
    const snapshot = JSON.parse(JSON.stringify(first.plan)) as typeof first.plan;
    expect(JSON.stringify(snapshot)).not.toContain(PNG_1X1);
    const coldPlanStore = new InMemoryPlanStore();
    await coldPlanStore.save({ plan: snapshot, reason: 'test-cold-start' });
    const coldRuntime = new OwnerStubRuntime();
    const coldImageStore = new StubFileStore();
    const coldService = new AgentService({
      planStore: coldPlanStore,
      runtime: coldRuntime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: coldImageStore,
    });
    coldRuntime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que monto ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.cold1'] },
    };
    const second = await coldService.handleTurn(textTurn('Que monto ves ahi?', 'wamid.cold2'));
    expect(coldImageStore.uploads).toBe(0);
    const request = coldRuntime.composeRequests.at(-1);
    expect(request?.imageFileAttachments).toEqual([{ fileId: 'file-live-1', messageId: 'wamid.cold1' }]);
    expect(request?.imageEvidence).toMatchObject({ status: 'available', source: 'file' });
    expect(JSON.stringify(second.plan)).not.toContain(PNG_1X1);
  });

  it('reports expiry instead of pixels when the referenced file expired', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const planStore = new InMemoryPlanStore();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await planStore.save({
      plan: mergePlan(empty, { image_attachments: [fileRef({ expiresAt: PAST, messageId: 'wamid.old1' })] }),
      reason: 'test-seed',
    });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: store,
    });
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que ves ahi?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.old1'] },
    };
    await service.handleTurn(textTurn('Que ves ahi?', 'wamid.q2'));
    const request = runtime.composeRequests.at(-1);
    expect(request?.imageFileAttachments ?? []).toEqual([]);
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'image_expired' });
  });
});

describe('extraction minimum disclosure for image linkage', () => {
  const capabilities = {
    information: true,
    rsvp: false,
    providerPlanning: false,
    providerOperations: false,
    providerSelection: false,
    providerInspection: false,
    contact: false,
    close: false,
    pause: false,
  };

  it('omits imageReference from the schema while no refs are stored', () => {
    const withoutRefs = createDynamicExtractionSchema({
      allowedActionIntents: ['pausar'],
      capabilities,
      includeImageReference: false,
    });
    expect(Object.keys(withoutRefs.shape)).not.toContain('imageReference');
    const withRefs = createDynamicExtractionSchema({
      allowedActionIntents: ['pausar'],
      capabilities,
      includeImageReference: true,
    });
    expect(Object.keys(withRefs.shape)).toContain('imageReference');
  });

  it('loads image-linkage guidance only when refs are stored', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const plain = await loader.loadExtractorBundle(capabilities);
    expect(plain.filePaths).not.toContain('extractors/image_reference.txt');
    const withImages = await loader.loadExtractorBundle(capabilities, { includeImageReference: true });
    expect(withImages.filePaths).toContain('extractors/image_reference.txt');
    expect(withImages.instructions).toContain('prior_uncertain');
  });
});

describe('inbound continuity wire and plan shape', () => {
  it('keeps the existing text plus optional image wire shape with no batch fields', () => {
    const message: NormalizedInboundMessage = {
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
      text: 'Cuanto dice ahi?',
      messageId: 'wamid.wire1',
      receivedAt: '2026-09-08T14:30:00Z',
      contactPhone: '+51987654321',
    };
    const keys = Object.keys(message);
    for (const forbidden of ['package', 'parts', 'batchId', 'batch_id', 'batch']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(typeof message.text).toBe('string');
  });

  it('carries no batch fields on the persisted plan and keeps attachment linkage across a transfer', () => {
    for (const forbidden of ['batch', 'batchId', 'batch_id', 'package', 'parts']) {
      expect(Object.keys(planSchema.shape)).not.toContain(forbidden);
    }
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    const seeded = mergePlan(empty, { image_attachments: [fileRef()] });
    // Transfer: the plan crosses a JSON boundary with legacy junk attached.
    const raw = JSON.parse(JSON.stringify(seeded)) as Record<string, unknown>;
    const refs = raw.image_attachments as Record<string, unknown>[];
    refs[0] = { ...refs[0], bytes: 'deadbeef', description: 'old description', storeKey: 'legacy' };
    const parsed = planSchema.safeParse(normalizeRawPlan(raw));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.image_attachments).toHaveLength(1);
    expect(parsed.data.image_attachments[0]).toMatchObject({
      kind: 'file',
      fileId: 'file-abc123',
      messageId: 'wamid.file1',
    });
    expect(JSON.stringify(parsed.data.image_attachments[0])).not.toContain('deadbeef');
    expect(JSON.stringify(parsed.data.image_attachments[0])).not.toContain('old description');
  });
});

describe('R2 latest-response fallback record', () => {
  it('bounds text to 4096 UTF-8 bytes at a character boundary', () => {
    const emoji = '😀'.repeat(2000);
    expect(Buffer.byteLength(emoji, 'utf8')).toBe(8000);
    const bounded = truncateTextToUtf8Bytes(emoji, MAX_LAST_OUTBOUND_TEXT_BYTES);
    expect(bounded.truncated).toBe(true);
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(MAX_LAST_OUTBOUND_TEXT_BYTES);
    expect(bounded.text).not.toContain('�');
    expect(Array.from(bounded.text)).toHaveLength(1024);
    const short = truncateTextToUtf8Bytes('hola', MAX_LAST_OUTBOUND_TEXT_BYTES);
    expect(short).toEqual({ text: 'hola', truncated: false });
  });

  it('builds constructed records from successful text only', () => {
    const record = buildLastOutboundContext({
      messageId: 'wamid.q1',
      text: 'Respuesta útil.',
      recordedAt: '2026-09-08T14:35:00.000Z',
    });
    expect(record).toMatchObject({
      message_id: 'wamid.q1',
      text: 'Respuesta útil.',
      text_truncated: false,
      delivery_evidence: 'constructed',
    });
    expect(buildLastOutboundContext({ messageId: 'wamid.q1', text: '', recordedAt: '2026-09-08T14:35:00.000Z' })).toBeNull();
    expect(buildLastOutboundContext({ messageId: '  ', text: 'x', recordedAt: '2026-09-08T14:35:00.000Z' })).toBeNull();
  });

  it('fails closed on smuggled media keys and re-truncates over-long text', () => {
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    const smuggled = {
      ...empty,
      last_outbound_context: {
        message_id: 'wamid.q1',
        text: 'ok',
        recorded_at: '2026-09-08T14:35:00.000Z',
        delivery_evidence: 'constructed',
        bytes: 'deadbeef',
        url: 'https://example.com/x.png',
      },
    };
    const dropped = planSchema.safeParse(normalizeRawPlan(smuggled));
    expect(dropped.success).toBe(true);
    if (!dropped.success) return;
    expect(dropped.data.last_outbound_context).toBeNull();

    const overLong = {
      ...empty,
      last_outbound_context: {
        message_id: 'wamid.q1',
        text: '😀'.repeat(2000),
        text_truncated: false,
        recorded_at: '2026-09-08T14:35:00.000Z',
        delivery_evidence: 'constructed',
      },
    };
    const repaired = planSchema.safeParse(normalizeRawPlan(overLong));
    expect(repaired.success).toBe(true);
    if (!repaired.success) return;
    expect(repaired.data.last_outbound_context?.text_truncated).toBe(true);
    expect(Buffer.byteLength(repaired.data.last_outbound_context?.text ?? '', 'utf8'))
      .toBeLessThanOrEqual(MAX_LAST_OUTBOUND_TEXT_BYTES);

    // Over the character budget entirely: fail closed to null, never a
    // truncated excerpt masquerading as an answer.
    const wayOverLong = {
      ...empty,
      last_outbound_context: {
        message_id: 'wamid.q1',
        text: 'a'.repeat(9000),
        text_truncated: false,
        recorded_at: '2026-09-08T14:35:00.000Z',
        delivery_evidence: 'constructed',
      },
    };
    const droppedLong = planSchema.safeParse(normalizeRawPlan(wayOverLong));
    expect(droppedLong.success).toBe(true);
    if (!droppedLong.success) return;
    expect(droppedLong.data.last_outbound_context).toBeNull();
  });

  it('preserves the record across unrelated merges and clears it explicitly', () => {
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    const record = buildLastOutboundContext({
      messageId: 'wamid.q1',
      text: 'Respuesta útil.',
      recordedAt: '2026-09-08T14:35:00.000Z',
    });
    const withRecord = mergePlan(empty, { last_outbound_context: record });
    expect(withRecord.last_outbound_context?.text).toBe('Respuesta útil.');
    const merged = mergePlan(withRecord, { contact_name: 'Ana' });
    expect(merged.last_outbound_context?.text).toBe('Respuesta útil.');
    const cleared = mergePlan(merged, { last_outbound_context: null });
    expect(cleared.last_outbound_context).toBeNull();
  });
});

describe('R2 extractor image index', () => {
  const refs = [
    urlRef('https://example.com/old.png', 'wamid.old', '2026-09-08T14:28:00Z'),
    fileRef({ messageId: 'wamid.cur', receivedAt: '2026-09-08T14:30:00Z' }),
  ];

  it('projects linkage, receive time, status and relation without raw media', () => {
    const index = buildImageAttachmentIndexForExtraction({
      attachments: refs,
      currentMessageId: 'wamid.cur',
      nowMs: NOW,
    });
    expect(index).toEqual([
      { message_id: 'wamid.old', received_at: '2026-09-08T14:28:00Z', status: 'active', relation: 'prior' },
      { message_id: 'wamid.cur', received_at: '2026-09-08T14:30:00Z', status: 'active', relation: 'current' },
    ]);
    const serialized = JSON.stringify(index);
    expect(serialized).not.toContain('file-abc123');
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('bytes');
  });

  it('marks expired files and caps the index', () => {
    const index = buildImageAttachmentIndexForExtraction({
      attachments: [fileRef({ messageId: 'wamid.old1', expiresAt: PAST }), ...refs],
      currentMessageId: null,
      nowMs: NOW,
      limit: 2,
    });
    expect(index).toHaveLength(2);
    expect(index.every((entry) => entry.relation === 'prior')).toBe(true);
  });

  it('marks an expired current file as expired, never as available', () => {
    const index = buildImageAttachmentIndexForExtraction({
      attachments: [fileRef({ messageId: 'wamid.cur', expiresAt: PAST })],
      currentMessageId: 'wamid.cur',
      nowMs: NOW,
    });
    expect(index).toEqual([
      { message_id: 'wamid.cur', received_at: '2026-09-08T14:30:00Z', status: 'expired', relation: 'current' },
    ]);
  });
});

describe('R2 extractor input projection', () => {
  const projectionRefs = [
    urlRef('https://example.com/old.png', 'wamid.old', '2026-09-08T14:28:00Z'),
    fileRef({ messageId: 'wamid.cur', receivedAt: '2026-09-08T14:30:00Z' }),
  ];

  function extractorRuntime(): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'test-reply',
      extractorModel: 'test-extractor',
      replyProviderLimit: 3,
      presentationProviderLimit: 3,
      providerDetailLookupLimit: 1,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as unknown as ProviderGateway,
    });
  }

  function extractorInput(planRefs: typeof projectionRefs, currentMessageId: string | null): string {
    const runtime = extractorRuntime();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    const plan = mergePlan(empty, { image_attachments: planRefs });
    const policy = deriveDynamicAgentPolicy(plan);
    return (runtime as unknown as {
      composeExtractorInput(request: {
        userMessage: string;
        plan: typeof plan;
        messageContext: ReturnType<typeof localTurnMessageContext>;
        currentMessageId: string | null;
      }, policy: DynamicAgentPolicy): string;
    }).composeExtractorInput(
      { userMessage: 'Que ves ahi?', plan, messageContext: localTurnMessageContext('missing_phone_number'), currentMessageId },
      policy,
    );
  }

  it('exposes current-image status and the bounded index without raw media', () => {
    const input = extractorInput(projectionRefs, 'wamid.cur');
    expect(input).toContain('Imagen actual: disponible.');
    expect(input).toContain('"relation":"current"');
    expect(input).toContain('"relation":"prior"');
    expect(input).not.toContain('file-abc123');
    expect(input).not.toContain('https://example.com/old.png');
  });

  it('reports no current image on text-only follow-ups while keeping priors visible', () => {
    const input = extractorInput(projectionRefs, 'wamid.followup');
    expect(input).toContain('Imagen actual: no disponible.');
    expect(input).toContain('"relation":"prior"');
    expect(input).not.toContain('"relation":"current"');
  });

  it('stays byte-identical on imageless turns', () => {
    const input = extractorInput([], null);
    expect(input).not.toContain('Imagen actual');
    expect(input).not.toContain('Índice de imágenes');
  });
});

describe('R2 fresh image plus question schema', () => {
  function outputSchemaFor(node: 'contacto_inicial' | 'resolver_consultas_informativas', image: boolean): unknown {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'test-reply',
      extractorModel: 'test-extractor',
      replyProviderLimit: 3,
      presentationProviderLimit: 3,
      providerDetailLookupLimit: 1,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as unknown as ProviderGateway,
    });
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    return (runtime as unknown as {
      resolveOutputSchema(request: {
        currentNode: string;
        extraction: { ambiguity: { status: 'clear' } };
        plan: typeof empty;
        messageContext: ReturnType<typeof localTurnMessageContext>;
        imageEvidence?: { status: 'available' };
      }): unknown;
    }).resolveOutputSchema({
      currentNode: node,
      extraction: { ambiguity: { status: 'clear' } },
      plan: empty,
      messageContext: localTurnMessageContext('missing_phone_number'),
      ...(image ? { imageEvidence: { status: 'available' } } : {}),
    });
  }

  it('uses the generic owner schema for a fresh image question, not the welcome schema', () => {
    expect(outputSchemaFor('contacto_inicial', true)).toBe(genericMessageSchema);
    expect(outputSchemaFor('contacto_inicial', false)).toBe(welcomeMessageSchema);
    expect(outputSchemaFor('resolver_consultas_informativas', true)).toBe(genericMessageSchema);
  });

  it('exposes pending_task_outcome only on turns carrying a pending question', () => {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'test-reply',
      extractorModel: 'test-extractor',
      replyProviderLimit: 3,
      presentationProviderLimit: 3,
      providerDetailLookupLimit: 1,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as unknown as ProviderGateway,
    });
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    const pending = mergePlan(empty, { owner_pending_question: 'Que monto ves ahi?' });
    const shapeOf = (schema: unknown): string[] =>
      Object.keys((schema as { shape: Record<string, unknown> }).shape);
    const base = (runtime as unknown as {
      resolveOutputSchema(request: {
        currentNode: string;
        extraction: { ambiguity: { status: 'clear' } };
        plan: typeof empty;
        messageContext: ReturnType<typeof localTurnMessageContext>;
      }): unknown;
    });
    const unrelated = base.resolveOutputSchema({
      currentNode: 'resolver_consultas_informativas',
      extraction: { ambiguity: { status: 'clear' } },
      plan: empty,
      messageContext: localTurnMessageContext('missing_phone_number'),
    });
    const carrying = base.resolveOutputSchema({
      currentNode: 'resolver_consultas_informativas',
      extraction: { ambiguity: { status: 'clear' } },
      plan: pending,
      messageContext: localTurnMessageContext('missing_phone_number'),
    });
    expect(shapeOf(unrelated)).not.toContain('pending_task_outcome');
    expect(shapeOf(carrying)).toContain('pending_task_outcome');
    expect(unrelated).toBe(genericMessageSchema);
    expect(carrying).not.toBe(genericMessageSchema);
  });
});

describe('R2 owner reply continuity through production turns', () => {
  function faqTurn(text: string, messageId: string): NormalizedInboundMessage {
    return {
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
      text,
      messageId,
      receivedAt: '2026-09-08T14:35:00Z',
      contactPhone: '+51987654321',
    };
  }

  it('records the latest successful rendered response with constructed provenance', async () => {
    const runtime = new OwnerStubRuntime();
    const { service, planStore } = fileService(runtime, new StubFileStore());
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Cual es el horario?' }] };
    const response = await service.handleTurn(faqTurn('Cual es el horario?', 'wamid.faq1'));
    expect(response.outbound.delivery.action).toBe('send');
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.last_outbound_context).toMatchObject({
      message_id: 'wamid.faq1',
      text_truncated: false,
      delivery_evidence: 'constructed',
    });
    expect(reloaded?.last_outbound_context?.text).toContain('owner:Cual es el horario?');
    expect(JSON.stringify(reloaded?.last_outbound_context)).not.toContain('base64');
  });

  it('silent image persistence records nothing but preserves an earlier record', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service, planStore } = fileService(runtime, store);
    const first = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', '', 'wamid.silent1'));
    expect(first.outbound.delivery).toMatchObject({ action: 'suppress' });
    const afterSilent = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(afterSilent?.last_outbound_context).toBeNull();

    // A later answered turn records; a supplemental image over the answered
    // thread stays silent (merely completed work is not outstanding) while
    // the earlier record is preserved for continuity.
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Cual es el horario?' }] };
    await service.handleTurn(faqTurn('Cual es el horario?', 'wamid.faq2'));
    const answered = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(answered?.last_outbound_context?.message_id).toBe('wamid.faq2');
    // Close the pending faq deterministically: the thread is answered, so a
    // supplemental image must persist silently instead of repeating status.
    await planStore.save({
      plan: mergePlan(answered!, {
        information_state: {
          ...answered!.information_state,
          pending_requests: [],
          last_completed_request: { kind: 'faq', query: 'Cual es el horario?' },
        },
        owner_pending_question: null,
      }),
      reason: 'test-close-thread',
    });
    runtime.scripted = {};
    const silent = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', '', 'wamid.silent2'));
    expect(silent.outbound.delivery).toMatchObject({ action: 'suppress' });
    const preserved = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(preserved?.last_outbound_context?.message_id).toBe('wamid.faq2');
  });

  it('a failed turn records nothing and keeps pending state', async () => {
    const failing = new OwnerStubRuntime();
    const failingService = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime: {
        extract: () => failing.extract(),
        composeReply: async () => { throw new Error('reply failed'); },
      } as unknown as AgentRuntime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    failing.scripted = { informationRequests: [{ kind: 'faq', query: 'Cual es el horario?' }] };
    const seed = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await failingService['dependencies'].planStore.save({
      plan: mergePlan(seed, { owner_pending_question: 'Que monto ves ahi?' }),
      reason: 'test-seed',
    });
    await expect(failingService.handleTurn(faqTurn('Cual es el horario?', 'wamid.fail1'))).rejects.toThrow();
    const reloaded = await failingService['dependencies'].planStore.getByExternalUser(
      'whatsapp', 'whatsapp:+51987654321',
    );
    expect(reloaded?.last_outbound_context).toBeNull();
    expect(reloaded?.owner_pending_question).toBe('Que monto ves ahi?');
  });

  it('a prior_single without linkage carries the single stored image', async () => {
    const runtime = new OwnerStubRuntime();
    const store = new StubFileStore();
    const { service } = fileService(runtime, store);
    await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', '', 'wamid.seed1'));
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Cual es el horario?' }],
      imageReference: { status: 'prior_single', referencedMessageIds: [] },
    };
    await service.handleTurn(faqTurn('Cual es el horario?', 'wamid.faq3'));
    const request = runtime.composeRequests.at(-1);
    // Deterministic single-candidate carry: the one usable stored image
    // must be the referenced prior. Several stored refs stay ambiguous and
    // project nothing (covered in s17-image-turn).
    expect(request?.imageFileAttachments).toEqual([
      { fileId: 'file-live-1', messageId: 'wamid.seed1' },
    ]);
    expect(request?.imageUrlAttachments ?? []).toEqual([]);
  });

  it('a prior_uncertain projects at most two native images', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await planStore.save({
      plan: mergePlan(empty, {
        image_attachments: [
          urlRef('https://example.com/0.png', 'wamid.u0', '2026-09-08T14:28:00Z'),
          urlRef('https://example.com/1.png', 'wamid.u1', '2026-09-08T14:29:00Z'),
          urlRef('https://example.com/2.png', 'wamid.u2', '2026-09-08T14:30:00Z'),
        ],
      }),
      reason: 'test-seed',
    });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = {
      informationRequests: [{ kind: 'faq', query: 'Que ves ahi?' }],
      imageReference: { status: 'prior_uncertain', referencedMessageIds: [] },
    };
    await service.handleTurn(faqTurn('Que ves ahi?', 'wamid.q4'));
    const request = runtime.composeRequests.at(-1);
    const total = (request?.imageUrlAttachments?.length ?? 0) + (request?.imageFileAttachments?.length ?? 0);
    expect(total).toBeLessThanOrEqual(2);
    expect(total).toBeGreaterThan(0);
  });

  it('stashes the unresolved question on an image-seeking clarification', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await planStore.save({
      plan: mergePlan(empty, { current_node: 'resolver_consultas_informativas' }),
      reason: 'test-seed',
    });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = {
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Quieres el estado o que revise el comprobante?',
        interpretations: [],
        candidateOperations: [],
        questionKey: 'status_or_proof_review',
      },
    };
    const response = await service.handleTurn(faqTurn('Confirma el monto de mi comprobante', 'wamid.q5'));
    expect(response.outbound.delivery.action).toBe('send');
    const request = runtime.composeRequests.at(-1);
    expect(request?.continuity).toBeDefined();
    expect(request?.imageUrlAttachments ?? []).toEqual([]);
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Confirma el monto de mi comprobante');
    expect(reloaded?.last_outbound_context?.message_id).toBe('wamid.q5');
  });

  it('stashes the evidence-seeking question on a cold normal-path turn', async () => {
    const runtime = new OwnerStubRuntime();
    const { service, planStore } = fileService(runtime, new StubFileStore());
    runtime.scripted = {
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Quieres el estado o que revise el comprobante?',
        interpretations: [],
        candidateOperations: [],
        questionKey: 'status_or_proof_review',
      },
    };
    await service.handleTurn(faqTurn('Confirma el monto de mi comprobante', 'wamid.coldq'));
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Confirma el monto de mi comprobante');
  });

  it('an image that fulfills the pending question answers and clears it', async () => {
    const runtime = new OwnerStubRuntime();
    runtime.pendingOutcome = 'answered';
    const store = new StubFileStore();
    const planStore = new InMemoryPlanStore();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await planStore.save({
      plan: mergePlan(empty, { owner_pending_question: 'Que monto ves ahi?' }),
      reason: 'test-seed',
    });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: store,
    });
    const response = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', '', 'wamid.img1'));
    expect(response.outbound.delivery.action).toBe('send');
    const request = runtime.composeRequests.at(-1);
    expect(request?.continuity).toMatchObject({ pendingQuestion: 'Que monto ves ahi?' });
    expect(request?.pendingQuestionRef).toBe('Que monto ves ahi?');
    expect(request?.imageFileAttachments).toHaveLength(1);
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBeNull();
    expect(reloaded?.last_outbound_context?.message_id).toBe('wamid.img1');
  });

  it('a successful clarification keeps the original pending question', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await planStore.save({
      plan: mergePlan(empty, { owner_pending_question: 'Que monto ves ahi?' }),
      reason: 'test-seed',
    });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = {
      ambiguity: {
        status: 'ambiguous',
        clarificationQuestion: 'Cual de los dos comprobantes?',
        interpretations: [],
        candidateOperations: [],
        questionKey: 'type_missing',
      },
    };
    const response = await service.handleTurn(faqTurn('Es el segundo comprobante', 'wamid.clar1'));
    expect(response.outbound.delivery.action).toBe('send');
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Que monto ves ahi?');
  });

  it('an image reply without an answered outcome keeps the pending question', async () => {
    const runtime = new OwnerStubRuntime();
    runtime.pendingOutcome = 'needs_input';
    const store = new StubFileStore();
    const planStore = new InMemoryPlanStore();
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    await planStore.save({
      plan: mergePlan(empty, { owner_pending_question: 'Que monto ves ahi?' }),
      reason: 'test-seed',
    });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: store,
    });
    const response = await service.handleTurn(inboundWithBase64(PNG_1X1, 'image/png', '', 'wamid.img2'));
    expect(response.outbound.delivery.action).toBe('send');
    const reloaded = await planStore.getByExternalUser('whatsapp', 'whatsapp:+51987654321');
    expect(reloaded?.owner_pending_question).toBe('Que monto ves ahi?');
    expect(reloaded?.last_outbound_context?.message_id).toBe('wamid.img2');
  });
});

describe('R2 last-response fallback exposure', () => {
  function faqTurn(text: string, messageId: string): NormalizedInboundMessage {
    return {
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
      text,
      messageId,
      receivedAt: '2026-09-08T14:35:00Z',
      contactPhone: '+51987654321',
    };
  }

  function recordPlan(messageId: string, text: string): ReturnType<typeof createEmptyPlan> {
    const empty = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'whatsapp:+51987654321' });
    return mergePlan(empty, {
      last_outbound_context: buildLastOutboundContext({
        messageId,
        text,
        recordedAt: '2026-09-08T14:30:00.000Z',
      }),
    });
  }

  it('exposes the record only when backend history lacks the thread', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: recordPlan('wamid.prev', 'Respuesta previa útil.'), reason: 'test-seed' });
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Y ahora?' }] };
    await service.handleTurn(faqTurn('Y ahora?', 'wamid.q6'));
    const request = runtime.composeRequests.at(-1);
    const fallback = (request?.messageContext.recentMessages ?? []).filter(
      (message) => message.whatsappMessageId === 'wamid.prev',
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({
      direction: 'outbound',
      body: 'Respuesta previa útil.',
      status: 'constructed',
    });
  });

  it('stays out of the way when no record exists', async () => {
    const runtime = new OwnerStubRuntime();
    const { service } = fileService(runtime, new StubFileStore());
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Hola?' }] };
    await service.handleTurn(faqTurn('Hola?', 'wamid.q7'));
    const request = runtime.composeRequests.at(-1);
    expect(request?.messageContext.recentMessages ?? []).toHaveLength(0);
  });

  it('merges the latest response over inbound-only history without inventing linkage', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: recordPlan('wamid.prev', 'Respuesta previa útil.'), reason: 'test-seed' });
    const backendMessage: AgentConversationMessage = {
      id: 7,
      direction: 'inbound',
      source: null,
      body: 'hola',
      status: 'sent',
      whatsappMessageId: 'wamid.other',
      sentAt: '2026-09-08T14:20:00Z',
      createdAt: '2026-09-08T14:20:00Z',
    };
    const gateway = {
      getRecentMessages: async () => ({ status: 'success' as const, messages: [backendMessage] }),
      logMessage: async () => ({ status: 'success' as const, message: null }),
    } as unknown as AgentConversationGateway;
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Y ahora?' }] };
    await service.handleTurn(faqTurn('Y ahora?', 'wamid.q8'));
    const request = runtime.composeRequests.at(-1);
    const recent = request?.messageContext.recentMessages ?? [];
    expect(recent).toHaveLength(2);
    expect(recent[0]?.whatsappMessageId).toBe('wamid.other');
    const fallback = recent.filter((message) => message.whatsappMessageId === 'wamid.prev');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({
      direction: 'outbound',
      body: 'Respuesta previa útil.',
      status: 'constructed',
    });
  });

  it('a newer authoritative outbound supersedes the stored record', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: recordPlan('wamid.prev', 'Respuesta previa útil.'), reason: 'test-seed' });
    const backendMessage: AgentConversationMessage = {
      id: 9,
      direction: 'outbound',
      source: null,
      body: 'Respuesta más reciente del backend.',
      status: 'delivered',
      whatsappMessageId: 'wamid.newer',
      sentAt: '2026-09-08T14:40:00Z',
      createdAt: '2026-09-08T14:40:00Z',
    };
    const gateway = {
      getRecentMessages: async () => ({ status: 'success' as const, messages: [backendMessage] }),
      logMessage: async () => ({ status: 'success' as const, message: null }),
    } as unknown as AgentConversationGateway;
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Y ahora?' }] };
    await service.handleTurn(faqTurn('Y ahora?', 'wamid.q9'));
    const request = runtime.composeRequests.at(-1);
    const recent = request?.messageContext.recentMessages ?? [];
    expect(recent).toHaveLength(1);
    expect(recent[0]?.whatsappMessageId).toBe('wamid.newer');
  });

  it('an old campaign outbound never suppresses the newest response', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: recordPlan('wamid.prev', 'Respuesta previa útil.'), reason: 'test-seed' });
    const campaign: AgentConversationMessage = {
      id: 1,
      direction: 'outbound',
      source: 'admin_campaign',
      body: 'Campaña antigua.',
      status: 'delivered',
      whatsappMessageId: 'wamid.campaign',
      sentAt: '2020-01-01T00:00:00Z',
      createdAt: '2020-01-01T00:00:00Z',
    };
    const gateway = {
      getRecentMessages: async () => ({ status: 'success' as const, messages: [campaign] }),
      logMessage: async () => ({ status: 'success' as const, message: null }),
    } as unknown as AgentConversationGateway;
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Y ahora?' }] };
    await service.handleTurn(faqTurn('Y ahora?', 'wamid.q10'));
    const request = runtime.composeRequests.at(-1);
    const recent = request?.messageContext.recentMessages ?? [];
    const fallback = recent.filter((message) => message.whatsappMessageId === 'wamid.prev');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({ direction: 'outbound', status: 'constructed' });
  });

  it('already-linked history deduplicates by message identity, not text', async () => {
    const runtime = new OwnerStubRuntime();
    const planStore = new InMemoryPlanStore();
    await planStore.save({ plan: recordPlan('wamid.prev', 'Mismo texto.'), reason: 'test-seed' });
    const linked: AgentConversationMessage = {
      id: 11,
      direction: 'outbound',
      source: null,
      body: 'Mismo texto.',
      status: 'delivered',
      whatsappMessageId: 'wamid.prev',
      sentAt: '2026-09-08T14:30:00Z',
      createdAt: '2026-09-08T14:30:00Z',
    };
    const sameTextOtherId: AgentConversationMessage = {
      id: 12,
      direction: 'outbound',
      source: null,
      body: 'Mismo texto.',
      status: 'delivered',
      whatsappMessageId: 'wamid.other-text',
      sentAt: '2026-09-08T14:31:00Z',
      createdAt: '2026-09-08T14:31:00Z',
    };
    const gateway = {
      getRecentMessages: async () => ({ status: 'success' as const, messages: [linked, sameTextOtherId] }),
      logMessage: async () => ({ status: 'success' as const, message: null }),
    } as unknown as AgentConversationGateway;
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      agentConversationGateway: gateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      imageFileStore: new StubFileStore(),
    });
    runtime.scripted = { informationRequests: [{ kind: 'faq', query: 'Y ahora?' }] };
    await service.handleTurn(faqTurn('Y ahora?', 'wamid.q11'));
    const request = runtime.composeRequests.at(-1);
    const recent = request?.messageContext.recentMessages ?? [];
    expect(recent.filter((message) => message.whatsappMessageId === 'wamid.prev')).toHaveLength(1);
    expect(recent.some((message) => message.whatsappMessageId === undefined)).toBe(false);
  });
});
