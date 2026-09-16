import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import {
  MAX_IMAGE_ATTACHMENTS_JSON_BYTES,
  MAX_IMAGE_ATTACHMENT_REFS,
  appendImageAttachmentRef,
  imageAttachmentsJsonBytes,
  redactImageUrlForLog,
  selectRecentImageAttachmentRefs,
  type ImageAttachmentRef,
} from '../src/core/image-attachments';
import {
  inboundImageSchema,
  isDirectlyFetchableImageUrlShape,
  normalizeInboundImage,
} from '../src/core/inbound-image';
import {
  createEmptyPlan,
  mergePlan,
  normalizeRawPlan,
  planSchema,
} from '../src/core/plan';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
import {
  buildReplyImageContent,
  ProviderImageAccessError,
  resolveProjectedImageAttachments,
  toResponsesWireImageItem,
} from '../src/runtime/openai-agent-runtime';
import type { OpenAiTransportMetrics } from '../src/runtime/contracts';
import { ModelComposedFailureError } from '../src/runtime/model-composition';
import type { InformationExecutionSummary, InformationTaskResult } from '../src/core/information';
import type { InformationOrchestrator } from '../src/runtime/information-orchestrator';
import { AgentService } from '../src/runtime/agent-service';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const URL_A = 'https://example.com/media/receipt-a.png';
const URL_SIGNED = 'https://files.example.net/voucher/b.png?sig=sekret&exp=999';
const FIXTURE_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';

function ref(url: string, messageId: string, receivedAt: string): ImageAttachmentRef {
  return { kind: 'url', url, messageId, receivedAt };
}

class UrlStubRuntime implements AgentRuntime {
  public inspectCalls = 0;
  public readonly composeRequests: ComposeReplyRequest[] = [];

  async extract(): Promise<ExtractionResult> {
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
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return { text: 'Respuesta del propietario.' };
  }

  async inspectImage(): Promise<{
    outcome: 'readable';
    answer: string;
    tokenUsage: null;
    openAiCall: null;
    promptBundleId: string;
  }> {
    this.inspectCalls += 1;
    return {
      outcome: 'readable',
      answer: 'visible',
      tokenUsage: null,
      openAiCall: null,
      promptBundleId: 'test:image_inspection',
    };
  }
}

function serviceWith(runtime: UrlStubRuntime): { service: AgentService; planStore: InMemoryPlanStore } {
  const planStore = new InMemoryPlanStore();
  const service = new AgentService({
    planStore,
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  return { service, planStore };
}

function inboundWithUrl(url: string, text: string, messageId: string): NormalizedInboundMessage {
  const image = normalizeInboundImage({ url });
  if (image.status !== 'available' || image.source !== 'url') {
    throw new Error('fixture URL must normalize to an available URL image');
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('URL image transport', () => {
  it('accepts the strict url variant and rejects ambiguous url+data', () => {
    const parsed = inboundImageSchema.safeParse({ url: URL_A });
    expect(parsed.success).toBe(true);
    expect(inboundImageSchema.safeParse({ url: URL_A, data: 'x', mime_type: 'image/png' }).success).toBe(false);
    const image = normalizeInboundImage({ url: URL_A });
    expect(image).toEqual({ status: 'available', source: 'url', url: URL_A, mimeType: null });
  });

  it('maps non-fetchable shapes to unavailable evidence instead of failing', () => {
    expect(isDirectlyFetchableImageUrlShape('http://example.com/a.png')).toBe(false);
    expect(isDirectlyFetchableImageUrlShape('https://127.0.0.1/a.png')).toBe(false);
    expect(isDirectlyFetchableImageUrlShape('https://user:pass@example.com/a.png')).toBe(false);
    expect(normalizeInboundImage({ url: 'http://example.com/a.png' }).status).toBe('unavailable');
    expect(normalizeInboundImage({ url: 'https://192.168.0.4/a.png' }).status).toBe('unavailable');
  });

  it('keeps the base64 path byte-identical in behavior', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const image = normalizeInboundImage({ data: png, mime_type: 'image/png' });
    expect(image.status).toBe('available');
    if (image.status === 'available' && image.source === 'base64') {
      expect(image.byteLength).toBeGreaterThan(0);
      expect(image.mimeType).toBe('image/png');
    } else {
      throw new Error('base64 must stay source base64');
    }
  });
});

describe('native wire shape', () => {
  it('builds SDK input_image items with the image field', () => {
    const content = buildReplyImageContent('cuanto dice aqui?', [{ url: URL_A, messageId: 'm1' }]);
    expect(content[0]).toEqual({ type: 'input_text', text: 'cuanto dice aqui?' });
    expect(content[1]).toEqual({ type: 'input_image', image: URL_A, detail: 'auto' });
  });

  it('serializes to the Responses wire shape with image_url', () => {
    const content = buildReplyImageContent('hola', [{ url: URL_A, messageId: 'm1' }]);
    const wire = content.map(toResponsesWireImageItem);
    expect(wire[1]).toEqual({ type: 'input_image', image_url: URL_A, detail: 'auto' });
    // Installed SDK converter (agents-openai openaiResponsesModel.js):
    // input_image reads item.image ?? item.imageUrl into image_url.
    const converterPath = path.resolve(
      process.cwd(), 'node_modules', '@openai', 'agents-openai', 'dist', 'openaiResponsesModel.js',
    );
    const source = fs.readFileSync(converterPath, 'utf8');
    expect(source).toContain('result.image_url = imageValue');
  });
});

describe('attachment persistence bounds', () => {
  it('dedupes duplicated delivery and caps references', () => {
    let refs: ImageAttachmentRef[] = [];
    refs = appendImageAttachmentRef(refs, ref(URL_A, 'm1', '2026-09-08T14:30:00Z'));
    refs = appendImageAttachmentRef(refs, ref(URL_A, 'm1', '2026-09-08T14:30:00Z'));
    expect(refs).toHaveLength(1);
    for (let index = 0; index < 10; index += 1) {
      refs = appendImageAttachmentRef(
        refs,
        ref(`https://example.com/${index}.png`, `m${index + 2}`, `2026-09-08T14:${30 + index}:00Z`),
      );
    }
    expect(refs.length).toBeLessThanOrEqual(MAX_IMAGE_ATTACHMENT_REFS);
    expect(imageAttachmentsJsonBytes(refs)).toBeLessThan(MAX_IMAGE_ATTACHMENTS_JSON_BYTES);
  });

  it('drops late events instead of evicting newer context', () => {
    let refs: ImageAttachmentRef[] = [];
    for (let index = 0; index < MAX_IMAGE_ATTACHMENT_REFS; index += 1) {
      refs = appendImageAttachmentRef(
        refs,
        ref(`https://example.com/n${index}.png`, `n${index}`, `2026-09-08T15:0${index}:00Z`),
      );
    }
    const before = refs.map((entry) => entry.messageId);
    refs = appendImageAttachmentRef(refs, ref('https://example.com/late.png', 'late', '2026-09-08T14:00:00Z'));
    expect(refs.map((entry) => entry.messageId).sort()).toEqual([...before].sort());
  });

  it('merges through mergePlan and strips legacy keys on load', () => {
    const empty = createEmptyPlan({ planId: 'p', channel: 'c', externalUserId: 'u' });
    const merged = mergePlan(empty, { image_attachments: [ref(URL_A, 'm1', '2026-09-08T14:30:00Z')] });
    expect(merged.image_attachments).toHaveLength(1);
    const dupe = mergePlan(merged, { image_attachments: [ref(URL_A, 'm1', '2026-09-08T14:30:00Z')] });
    expect(dupe.image_attachments).toHaveLength(1);
    const raw = normalizeRawPlan({
      ...merged,
      image_attachments: [
        { url: URL_A, messageId: 'm1', receivedAt: '2026-09-08T14:30:00Z', data: 'bytes!', description: 'x' },
        { nope: true },
      ],
    });
    const parsed = planSchema.parse(raw);
    expect(parsed.image_attachments).toHaveLength(1);
    expect(JSON.stringify(parsed.image_attachments)).not.toContain('bytes!');
  });

  it('selects at most two recent refs for later turns', () => {
    const refs = [0, 1, 2, 3].map((index) =>
      ref(`https://example.com/${index}.png`, `m${index}`, `2026-09-08T14:3${index}:00Z`));
    const selected = selectRecentImageAttachmentRefs(refs);
    expect(selected).toHaveLength(2);
    expect(selected[0]?.messageId).toBe('m3');
  });
});

describe('URL image turn routing', () => {
  it('answers through the owner reply call without inspecting', async () => {
    const runtime = new UrlStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.url1'));

    expect(runtime.inspectCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.imageUrlAttachments).toEqual([{ url: URL_A, messageId: 'wamid.url1' }]);
    expect(request?.imageEvidence).toMatchObject({ status: 'available', source: 'url', refStored: true });
    expect(response.outbound.text).toContain('Respuesta del propietario.');
    expect(response.plan.image_attachments).toHaveLength(1);
    expect(JSON.stringify(response.plan.image_attachments)).not.toContain('base64');
    const traceJson = JSON.stringify(response.trace);
    expect(traceJson).not.toContain(URL_A);
  });

  it('treats signed URLs as credentials in tool evidence', async () => {
    const runtime = new UrlStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(inboundWithUrl(URL_SIGNED, '', 'wamid.url2'));

    expect(runtime.inspectCalls).toBe(0);
    const traceJson = JSON.stringify(response.trace);
    expect(traceJson).not.toContain('sig=sekret');
    expect(traceJson).not.toContain(URL_SIGNED);
    expect(traceJson).toContain('...[redacted]');
    expect(redactImageUrlForLog(URL_SIGNED)).toBe('https://files.example.net/...[redacted]');
  });

  it('does not duplicate refs on duplicated delivery', async () => {
    const runtime = new UrlStubRuntime();
    const { service } = serviceWith(runtime);
    await service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.dupe'));
    const second = await service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.dupe'));
    expect(second.plan.image_attachments).toHaveLength(1);
  });

  it('leaves the base64 path on inspect without URL attachments', async () => {
    const runtime = new UrlStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'whatsapp:+51987654321',
      text: 'Mi pedido sigue pendiente?',
      messageId: 'wamid.b64',
      receivedAt: '2026-09-08T14:30:00Z',
      contactPhone: '+51987654321',
      image: { status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/jpeg' },
    });
    expect(runtime.inspectCalls).toBe(0);
    const request = runtime.composeRequests.at(-1);
    expect(request?.imageUrlAttachments).toBeUndefined();
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable' });
    expect(response.plan.image_attachments ?? []).toHaveLength(0);
  });
});

describe('later-turn projection policy', () => {
  const stored = [0, 1, 2].map((index) =>
    ref(`https://example.com/${index}.png`, `m${index}`, `2026-09-08T14:3${index}:00Z`));

  it('honors an explicit list, including empty', () => {
    expect(resolveProjectedImageAttachments({
      explicit: [], currentNode: 'resolver_consultas_informativas', storedRefs: stored, openNeed: true,
    })).toEqual([]);
    expect(resolveProjectedImageAttachments({
      explicit: [{ url: URL_A, messageId: 'm0' }],
      currentNode: 'otro_nodo', storedRefs: stored, openNeed: true,
    })).toEqual([{ url: URL_A, messageId: 'm0' }]);
  });

  it('never projects stored refs without an explicit caller list', () => {
    expect(resolveProjectedImageAttachments({
      explicit: undefined, currentNode: 'elicitacion_necesidades', storedRefs: stored, openNeed: true,
    })).toEqual([]);
    expect(resolveProjectedImageAttachments({
      explicit: undefined, currentNode: 'resolver_consultas_informativas', storedRefs: stored, openNeed: false,
    })).toEqual([]);
    // Even the informative node with an open need gets nothing implicitly:
    // relevance must be demonstrated by the caller, never recency.
    expect(resolveProjectedImageAttachments({
      explicit: undefined, currentNode: 'resolver_consultas_informativas', storedRefs: stored, openNeed: true,
    })).toEqual([]);
  });
});

describe('instruction and input byte evidence', () => {
  it('keeps URL projection far below a base64 payload', () => {
    const text = 'Es mi comprobante';
    const urlPayload = JSON.stringify([
      { role: 'user', content: buildReplyImageContent(text, [{ url: FIXTURE_URL, messageId: 'm1' }]) },
    ]);
    const base64Payload = JSON.stringify([
      { role: 'user', content: buildReplyImageContent(text, [{ url: `data:image/png;base64,${'A'.repeat(1_000_000)}`, messageId: 'm1' }]) },
    ]);
    const urlBytes = Buffer.byteLength(urlPayload, 'utf8');
    const base64Bytes = Buffer.byteLength(base64Payload, 'utf8');
    expect(urlBytes).toBeLessThan(4096);
    expect(base64Bytes / urlBytes).toBeGreaterThan(100);
    const refs = [ref(FIXTURE_URL, 'm1', '2026-09-08T14:30:00Z')];
    expect(imageAttachmentsJsonBytes(refs)).toBeLessThan(MAX_IMAGE_ATTACHMENTS_JSON_BYTES);
  });
});

class ScriptedImageRuntime extends UrlStubRuntime {
  public extractCalls = 0;

  constructor(private readonly scriptedExtraction: Partial<ExtractionResult>) {
    super();
  }

  override async extract(): Promise<ExtractionResult> {
    this.extractCalls += 1;
    return {
      actionIntent: null,
      informationRequests: [],
      phoneConfirmation: null,
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
      conversationSummary: 'caption extraída por el modelo',
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
      ...this.scriptedExtraction,
    };
  }
}

function purchaseResultFor(
  requestId: string,
  orderId: string,
  total: number,
  cartId: string,
): { result: InformationTaskResult; summary: InformationExecutionSummary } {
  const result: InformationTaskResult = {
    requestId,
    kind: 'purchase',
    status: 'completed',
    resource: 'orders',
    lookupResource: 'orders',
    purchases: [{
      orderId,
      paymentStatus: 'pending',
      shippingStatus: null,
      grandTotal: total,
      paymentMethod: 'transfer',
      eventName: 'Evento Prueba',
      eventDate: null,
      eventUrl: null,
      createdAt: null,
      items: [],
    }],
    needsSelection: false,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    carts: [{
      cartId,
      status: 'abandoned',
      wasAbandoned: true,
      eventName: 'Evento Prueba',
      items: [],
    }],
  };
  const summary: InformationExecutionSummary = {
    requestId,
    kind: 'purchase',
    status: 'completed',
    source: 'agent_api',
    outcomeCode: 'completed_with_results',
    retryable: null,
    queryHash: 'q',
    evidence: [],
    resultCount: 1,
    durationMs: 40,
    accessMethod: 'trusted_phone_purchase',
    coverage: 'complete',
    resource: 'orders',
  };
  return { result, summary };
}

function orchestratorWith(
  results: InformationTaskResult[],
  summaries: InformationExecutionSummary[],
): InformationOrchestrator {
  return {
    execute: async () => ({ results, summaries }),
  } as unknown as InformationOrchestrator;
}

describe('established owner URL path', () => {
  it('runs real extraction on the established node instead of forcing the informative node', async () => {
    const runtime = new ScriptedImageRuntime({});
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.owner1'));

    expect(runtime.extractCalls).toBe(1);
    expect(runtime.inspectCalls).toBe(0);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    // Fresh plans serve from contacto_inicial; the informative node is not forced.
    expect(request?.currentNode).toBe('contacto_inicial');
    expect(request?.extraction.conversationSummary).toBe('caption extraída por el modelo');
    expect(request?.imageUrlAttachments).toEqual([{ url: URL_A, messageId: 'wamid.owner1' }]);
    expect(request?.imageEvidence).toMatchObject({ status: 'available', source: 'url', refStored: true });
    expect(response.plan.owner).toBe('planning');
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('supplies current purchase results and question-relevant customer context', async () => {
    const runtime = new ScriptedImageRuntime({
      informationRequests: [{
        kind: 'purchase',
        resource: 'orders',
        query: '¿Ya se aprobó mi regalo?',
        orderId: 'ORD-A',
        aspects: ['payment_status'],
        sensitiveFields: [],
        authAction: 'none',
      }],
    });
    const relevant = purchaseResultFor('information-1', 'ORD-A', 150.5, 'cart-sentinel-9');
    const unrelated = purchaseResultFor('information-2', 'ORD-B', 999.75, 'cart-other-1');
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: orchestratorWith(
        [relevant.result, unrelated.result],
        [relevant.summary, unrelated.summary],
      ),
    });
    const response = await service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante, ¿ya se aprobó?', 'wamid.owner2'));

    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.currentNode).toBe('resolver_consultas_informativas');
    expect(request?.informationResults).toHaveLength(2);
    const customerContext = request?.customerContext;
    expect(customerContext).toBeDefined();
    const serialized = JSON.stringify(customerContext);
    // One canonical profile: every authorized record travels once, with the
    // requested order leading by reference instead of hiding the rest.
    expect(serialized).toContain('150.5');
    expect(serialized).toContain('999.75');
    expect(customerContext?.commonRefs.orderIds).toEqual(expect.arrayContaining(['ORD-A', 'ORD-B']));
    expect(customerContext?.purchases.map((entry) => entry.orderId)).toEqual(['ORD-A', 'ORD-B']);
    expect(customerContext?.carts.map((entry) => entry.cartId)).toEqual(['cart-sentinel-9', 'cart-other-1']);
    expect(request?.imageUrlAttachments).toEqual([{ url: URL_A, messageId: 'wamid.owner2' }]);
    expect(response.plan.image_attachments).toHaveLength(1);
  });

  it('keeps the projection stable when unrelated facts change and moves it when relevant facts change', async () => {
    const scripted = {
      informationRequests: [{
        kind: 'purchase' as const,
        resource: 'orders' as const,
        query: '¿Ya se aprobó mi regalo?',
        orderId: 'ORD-A',
        aspects: ['payment_status' as const],
        sensitiveFields: [],
        authAction: 'none' as const,
      }],
    };
    const relevant = purchaseResultFor('information-1', 'ORD-A', 150.5, 'cart-sentinel-9');
    const unrelated = purchaseResultFor('information-2', 'ORD-B', 999.75, 'cart-other-1');
    let liveResults: InformationTaskResult[] = [relevant.result, unrelated.result];
    const liveSummaries = [relevant.summary, unrelated.summary];
    const seen: string[] = [];
    const runtime = new ScriptedImageRuntime(scripted);
    const planStore = new InMemoryPlanStore();
    const service = new AgentService({
      planStore,
      runtime,
      providerGateway: {} as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: new WhatsAppMessageRenderer() },
      informationOrchestrator: {
        execute: async () => ({ results: liveResults, summaries: liveSummaries }),
      } as unknown as InformationOrchestrator,
    });
    const turn = async (messageId: string): Promise<void> => {
      await service.handleTurn(inboundWithUrl(URL_A, '¿Ya se aprobó?', messageId));
      const last = runtime.composeRequests.at(-1)?.customerContext;
      seen.push(JSON.stringify(last));
    };
    await turn('wamid.stable1');
    const base = seen[0];
    // Unrelated order total changes: only that entity's evidence moves;
    // the requested order's evidence stays byte-identical.
    const drifted = purchaseResultFor('information-2', 'ORD-B', 111.11, 'cart-other-1');
    liveResults = [relevant.result, drifted.result];
    await turn('wamid.stable2');
    expect(seen[1]).not.toBe(base);
    const entityEvidence = (serialized: string | undefined, orderId: string): string => {
      const projection = JSON.parse(serialized ?? '{}') as {
        purchases: Array<{ orderId: string }>;
        detailedPurchases: Array<{ orderId: string }>;
        candidates: Array<{ orderId?: string }>;
      };
      return JSON.stringify({
        purchases: projection.purchases.filter((entry) => entry.orderId === orderId),
        detailed: projection.detailedPurchases.filter((entry) => entry.orderId === orderId),
        candidates: projection.candidates.filter((entry) => entry.orderId === orderId),
      });
    };
    expect(entityEvidence(seen[1], 'ORD-A')).toBe(entityEvidence(base, 'ORD-A'));
    expect(entityEvidence(seen[1], 'ORD-B')).not.toBe(entityEvidence(base, 'ORD-B'));
    // Relevant status changes: projection bytes move.
    const approvedBase = relevant.result.kind === 'purchase' && relevant.result.status === 'completed'
      ? relevant.result
      : null;
    if (!approvedBase) throw new Error('fixture must be a completed purchase');
    const approved: InformationTaskResult = {
      ...approvedBase,
      purchases: approvedBase.purchases.map((purchase) => ({ ...purchase, paymentStatus: 'approved' })),
    };
    liveResults = [approved, unrelated.result];
    await turn('wamid.stable3');
    expect(seen[2]).not.toBe(base);
  });
});

describe('URL failure classification and reply accounting', () => {
  it('recovers the exact image-download 400 with both attempts recorded', async () => {
    const failedTransport: OpenAiTransportMetrics = {
      observedRequestCount: 1, totalPayloadBytes: 100, instructionBytes: 10, inputBytes: 90,
      toolBytes: 0, outputSchemaBytes: 5, requests: [],
    };
    const runtime = new ScriptedImageRuntime({});
    let calls = 0;
    const inner = runtime.composeReply.bind(runtime);
    runtime.composeReply = async (request: ComposeReplyRequest): Promise<ComposeReplyResult> => {
      calls += 1;
      if (calls === 1) {
        throw new ProviderImageAccessError(
          '400 Error while downloading file. Upstream status code: 404.',
          {
            status: 400, providerCode: null, providerParam: null,
            providerType: 'invalid_request_error', failedTransport,
          },
        );
      }
      return inner(request);
    };
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.fail1'));

    expect(calls).toBe(2);
    expect(runtime.composeRequests).toHaveLength(1);
    const request = runtime.composeRequests[0];
    expect(request?.imageEvidence).toMatchObject({ status: 'unavailable', reason: 'image_unavailable' });
    expect(request?.imageUrlAttachments).toEqual([]);
    const outputs = JSON.stringify(response.trace.tool_outputs);
    expect(outputs).toContain('reply_failed_file_access');
    expect(outputs).toContain('fallback_reply_received');
    // The failed attempt never yields token usage: the retry usage is
    // partial evidence, never a complete accounting.
    expect(outputs).toContain('\\"token_usage\\": \\"unavailable\\"');
    // The failed image attempt is retained, never dropped.
    expect(response.plan.image_attachments).toHaveLength(1);
    expect(response.trace.plan_persist_reason).toBe('image_url_unavailable');
    const call = response.trace.openai_calls.reply;
    expect(call?.attemptCount).toBe(2);
    expect(call?.requestMetrics.transport?.observedRequestCount).toBe(1);
  });

  it('propagates a generic model failure without an image_unavailable fallback', async () => {
    const runtime = new ScriptedImageRuntime({});
    let calls = 0;
    const inner = runtime.composeReply.bind(runtime);
    runtime.composeReply = async (request: ComposeReplyRequest): Promise<ComposeReplyResult> => {
      calls += 1;
      if (calls === 1) throw new ModelComposedFailureError('model_error');
      return inner(request);
    };
    const { service } = serviceWith(runtime);
    await expect(
      service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.fail2')),
    ).rejects.toThrow();
    // Exactly one attempt: no mislabeled unavailable retry was composed.
    expect(calls).toBe(1);
    expect(runtime.composeRequests).toHaveLength(0);
  });

  it('never relabels a persistence failure as image unavailability', async () => {
    const runtime = new ScriptedImageRuntime({});
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
    });
    await expect(
      service.handleTurn(inboundWithUrl(URL_A, 'Es mi comprobante', 'wamid.persist1')),
    ).rejects.toThrow('plan persistence down');
    // Exactly one model attempt: no mislabeled unavailable fallback was composed.
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageEvidence).toMatchObject({ status: 'available' });
  });
});
