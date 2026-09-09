import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import type { InboundImage } from '../src/core/inbound-image';
import { normalizeInboundImage } from '../src/core/inbound-image';import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';
import { AgentService } from '../src/runtime/agent-service';
import { PromptLoader } from '../src/runtime/prompt-loader';
import type {
  AgentConversationGateway,
  AgentGatewayResult,
} from '../src/runtime/agent-conversation-gateway';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import { WhatsAppMessageRenderer } from '../src/runtime/message-renderer';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_MINIMAL = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]).toString('base64');

const FALLBACK_TOO_LARGE =
  'No pude abrir la imagen porque supera el tamaño permitido. Puedes enviarla de nuevo más pequeña o escribirme la información en texto.';
const FALLBACK_UNAVAILABLE =
  'No pude abrir la imagen. Puedes enviarla de nuevo o escribirme la información en texto.';
const FALLBACK_HANDOFF_REQUESTED =
  'No puedo ejecutar esa acción a partir de una imagen. Ya solicité apoyo humano para que revisen tu consulta.';
const FALLBACK_HANDOFF_FAILED =
  'No puedo ejecutar esa acción a partir de una imagen. No pude registrar la solicitud de apoyo humano en este momento; puedes explicar tu consulta en texto por aquí.';

// Delivery preserves model text: only documented transport transforms apply
// (filecite markers, whitespace collapse). No trailing-period deletion.
function sans(value: string): string {
  return value
    .replace(/\bfilecite\s+turn\d+\s+file\s+\d+\b/giu, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}

type InspectionOutcome = 'readable' | 'unreadable' | 'human_help';

class ImageStubRuntime implements AgentRuntime {
  public extractCalls = 0;
  public inspectCalls = 0;
  public lastCaption: string | null = null;
  public outcome: InspectionOutcome = 'readable';
  public answer = 'En la imagen se ve un comprobante con el monto indicado.';

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractCalls += 1;
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
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    return { text: `caption:${request.userMessage}` };
  }

  async inspectImage(request: {
    image: Extract<InboundImage, { status: 'available' }>;
    caption: string;
  }): Promise<{
    outcome: InspectionOutcome;
    answer: string;
    tokenUsage: null;
    openAiCall: null;
    promptBundleId: string;
  }> {
    this.inspectCalls += 1;
    this.lastCaption = request.caption;
    return {
      outcome: this.outcome,
      answer: this.answer,
      tokenUsage: null,
      openAiCall: null,
      promptBundleId: 'test:image_inspection',
    };
  }
}

function serviceWith(runtime: ImageStubRuntime, gateway?: AgentConversationGateway): {
  service: AgentService;
  planStore: InMemoryPlanStore;
} {
  const planStore = new InMemoryPlanStore();
  const service = new AgentService({
    planStore,
    runtime,
    providerGateway: {} as unknown as ProviderGateway,
    ...(gateway ? { agentConversationGateway: gateway } : {}),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
  });
  return { service, planStore };
}

function inboundWithImage(
  image: NormalizedInboundMessage['image'],
  text: string,
): NormalizedInboundMessage {
  return {
    channel: 'whatsapp',
    externalUserId: 'whatsapp:+51987654321',
    text,
    messageId: 'wamid.HBgLNTE5ODc2NTQzMjE',
    receivedAt: '2026-09-08T14:30:00Z',
    contactPhone: '+51987654321',
    image,
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
  it('stores the contract-exact fallback content in the image outcomes bundle', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const messages = await loader.loadImageMessages();
    expect(messages.image_too_large).toBe(FALLBACK_TOO_LARGE);
    expect(messages.media_unavailable).toBe(FALLBACK_UNAVAILABLE);
    expect(messages.handoff_requested).toBe(FALLBACK_HANDOFF_REQUESTED);
    expect(messages.handoff_failed).toBe(FALLBACK_HANDOFF_FAILED);
  });

  it('answers an image-only turn from inspection without running text extraction', async () => {
    const runtime = new ImageStubRuntime();
    const { service, planStore } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, ''));

    expect(image.status).toBe('available');
    expect(runtime.inspectCalls).toBe(1);
    expect(runtime.lastCaption).toBe('');
    expect(runtime.extractCalls).toBe(0);
    expect(response.outbound.text).toBe(sans(runtime.answer));
    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
    expect(planStore).toBeDefined();
    const traceJson = JSON.stringify(response.trace);
    expect(traceJson).not.toContain(JPEG_MINIMAL);
    expect(traceJson).not.toContain('base64,');
  });

  it('preserves the caption with the image in a single reply', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/png' });
    const response = await service.handleTurn(inboundWithImage(image, 'Cuanto dice aqui?'));

    expect(image.status).toBe('available');
    expect(runtime.inspectCalls).toBe(1);
    expect(runtime.lastCaption).toBe('Cuanto dice aqui?');
    expect(response.outbound.text).toBe(sans(runtime.answer));
  });

  it('sends the smaller-image fallback for image_too_large without inspecting', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage({ status: 'unavailable', reason: 'image_too_large', mimeType: 'image/jpeg' }, ''),
    );

    expect(runtime.inspectCalls).toBe(0);
    expect(runtime.extractCalls).toBe(0);
    expect(response.outbound.text).toBe(sans(FALLBACK_TOO_LARGE));
  });

  it('sends the resend fallback for media_unavailable without inspecting', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage({ status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/jpeg' }, ''),
    );

    expect(runtime.inspectCalls).toBe(0);
    expect(response.outbound.text).toBe(sans(FALLBACK_UNAVAILABLE));
  });

  it('answers the caption through the text pipeline and adds the fallback once', async () => {
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(
      inboundWithImage(
        { status: 'unavailable', reason: 'media_unavailable', mimeType: 'image/jpeg' },
        'Mi pedido sigue pendiente?',
      ),
    );

    expect(runtime.inspectCalls).toBe(0);
    expect(runtime.extractCalls).toBeGreaterThan(0);
    expect(response.outbound.text).toContain('caption:Mi pedido sigue pendiente?');
    expect(response.outbound.text).toContain(sans(FALLBACK_UNAVAILABLE));
    const occurrences = response.outbound.text?.split(sans(FALLBACK_UNAVAILABLE)).length ?? 0;
    expect(occurrences).toBe(2);
  });

  it('treats mismatched bytes as unavailable instead of inspecting', async () => {
    const image = normalizeInboundImage({ data: PNG_1X1, mime_type: 'image/jpeg' });
    expect(image.status).toBe('unavailable');
    const runtime = new ImageStubRuntime();
    const { service } = serviceWith(runtime);
    const response = await service.handleTurn(inboundWithImage(image, ''));

    expect(runtime.inspectCalls).toBe(0);
    expect(response.outbound.text).toBe(sans(FALLBACK_UNAVAILABLE));
  });

  it('requests human help when the caption needs an action from the image', async () => {
    const runtime = new ImageStubRuntime();
    runtime.outcome = 'human_help';
    runtime.answer = '';
    const { service } = serviceWith(runtime, handoffGateway({ status: 'success', message: 'ok' }));
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Confirma mi pago con este voucher'));

    expect(runtime.inspectCalls).toBe(1);
    expect(response.outbound.text).toBe(sans(FALLBACK_HANDOFF_REQUESTED));
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
  });

  it('falls back to text when human help cannot be registered', async () => {
    const runtime = new ImageStubRuntime();
    runtime.outcome = 'human_help';
    runtime.answer = '';
    const { service } = serviceWith(
      runtime,
      handoffGateway({ status: 'failed', error: 'boom', retryable: false }),
    );
    const image = normalizeInboundImage({ data: JPEG_MINIMAL, mime_type: 'image/jpeg' });
    const response = await service.handleTurn(inboundWithImage(image, 'Confirma mi pago'));

    expect(response.outbound.text).toBe(sans(FALLBACK_HANDOFF_FAILED));
    expect(response.plan.current_node).toBe('resolver_consultas_informativas');
  });
});
