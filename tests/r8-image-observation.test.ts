import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import { normalizeInboundImage } from '../src/core/inbound-image';
import type { ImageAttachmentRef } from '../src/core/image-attachments';
import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractionResult,
} from '../src/runtime/contracts';
import { buildImageObservation } from '../src/runtime/openai-agent-runtime';
import { AgentService } from '../src/runtime/agent-service';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const URL_A = 'https://example.com/media/receipt-a.png';

function urlRef(messageId: string, receivedAt: string): ImageAttachmentRef {
  return { kind: 'url', url: URL_A, messageId, receivedAt };
}

class R8StubRuntime implements AgentRuntime {
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
    return {
      text: 'Respuesta del propietario.',
      structuredMessage: { type: 'generic', paragraphs_es: ['Respuesta del propietario.'] },
    };
  }
}

function inbound(
  image: NormalizedInboundMessage['image'],
  text: string,
  messageId: string,
  receivedAt: string,
): NormalizedInboundMessage {
  return {
    channel: 'whatsapp',
    externalUserId: 'whatsapp:+51987654321',
    text,
    messageId,
    receivedAt,
    contactPhone: '+51987654321',
    image,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('R8 same-day image observation', () => {
  it('summarizes a current image turn without structured pixel values', () => {
    const nowMs = Date.parse('2026-09-08T15:00:00Z');
    const observation = buildImageObservation({
      imageAvailable: true,
      pixelsProjected: true,
      currentTurnCarriesImage: true,
      storedRefs: [urlRef('wamid.1', '2026-09-08T14:30:00Z')],
      nowMs,
      depositMentioned: false,
    });
    expect(observation).toEqual({
      seenToday: true,
      legibility: 'projected',
      linkage: 'current',
      depositMentioned: false,
    });
    // Never structured amounts/dates/phones: exactly these four fact keys.
    expect(Object.keys(observation ?? {}).sort()).toEqual(
      ['depositMentioned', 'legibility', 'linkage', 'seenToday'],
    );
  });

  it('links a follow-up turn to the prior same-day image', () => {
    const nowMs = Date.parse('2026-09-08T18:00:00Z');
    const observation = buildImageObservation({
      imageAvailable: true,
      pixelsProjected: true,
      currentTurnCarriesImage: false,
      storedRefs: [urlRef('wamid.1', '2026-09-08T14:30:00Z')],
      nowMs,
      depositMentioned: true,
    });
    expect(observation).toMatchObject({ seenToday: true, linkage: 'prior', depositMentioned: true });
  });

  it('creates no duties from older, absent, or expired images', () => {
    const nowMs = Date.parse('2026-09-09T09:00:00Z');
    expect(buildImageObservation({
      imageAvailable: false,
      pixelsProjected: false,
      currentTurnCarriesImage: false,
      storedRefs: [urlRef('wamid.1', '2026-09-08T14:30:00Z')],
      nowMs,
      depositMentioned: false,
    })).toBeNull();
    expect(buildImageObservation({
      imageAvailable: false,
      pixelsProjected: false,
      currentTurnCarriesImage: false,
      storedRefs: [],
      nowMs,
      depositMentioned: true,
    })).toBeNull();
    // Expired file refs are ignored the same way when nothing usable was
    // seen today.
    const expiredNowMs = Date.parse('2026-09-08T18:00:00Z');
    const expired: ImageAttachmentRef = {
      kind: 'file',
      fileId: 'file-old',
      expiresAt: '2026-09-01T00:00:00Z',
      mimeType: 'image/png',
      byteLength: 10,
      contentDigest: 'abc',
      messageId: 'wamid.old',
      receivedAt: '2026-09-08T10:00:00Z',
    };
    expect(buildImageObservation({
      imageAvailable: false,
      pixelsProjected: false,
      currentTurnCarriesImage: false,
      storedRefs: [expired],
      nowMs: expiredNowMs,
      depositMentioned: false,
    })).toBeNull();
  });
});

describe('R8 image-turn observation wiring', () => {
  function serviceWith(runtime: R8StubRuntime) {
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

  it('attaches a current-turn observation on an image reply', async () => {
    const runtime = new R8StubRuntime();
    const { service } = serviceWith(runtime);
    const now = new Date().toISOString();
    const image = normalizeInboundImage({ url: URL_A });
    expect(image.status).toBe('available');
    await service.handleTurn(inbound(image, 'Este es mi comprobante', 'wamid.img1', now));
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageEvidence).toMatchObject({
      status: 'available',
      source: 'url',
      refStored: true,
      observation: { seenToday: true, legibility: 'projected', linkage: 'current' },
    });
  });

  it('links an unreadable image to the prior same-day reference instead of demanding a resend', async () => {
    const runtime = new R8StubRuntime();
    const { service } = serviceWith(runtime);
    const firstAt = new Date(Date.now() - 60_000).toISOString();
    const secondAt = new Date().toISOString();
    const image = normalizeInboundImage({ url: URL_A });
    const silent = await service.handleTurn(inbound(image, '', 'wamid.img1', firstAt));
    expect(silent.outbound.delivery.action).toBe('suppress');
    const failed = normalizeInboundImage({ error: 'media_unavailable', mime_type: 'image/jpeg' });
    await service.handleTurn(inbound(failed, '', 'wamid.img2', secondAt));
    expect(runtime.composeRequests).toHaveLength(1);
    expect(runtime.composeRequests[0]?.imageEvidence).toMatchObject({
      status: 'unavailable',
      observation: { seenToday: true, legibility: 'retained', linkage: 'prior' },
    });
  });
});
