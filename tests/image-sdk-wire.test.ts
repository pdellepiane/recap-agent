import OpenAI from 'openai';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ComposeReplyRequest, ExtractRequest } from '../src/runtime/contracts';
import type { PersistedPlan } from '../src/core/plan';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

const IMAGE_URL = 'https://example.com/media/receipt-sdk-wire.png';

function cannedResponsesPayload(): string {
  return JSON.stringify({
    id: 'resp_img_wire_1',
    object: 'response',
    created_at: 1750000000,
    model: 'gpt-test',
    status: 'completed',
    output: [{
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: '{"type":"generic","paragraphs_es":["Recibí tu imagen y la tengo en cuenta."]}',
        annotations: [],
      }],
    }],
    usage: { input_tokens: 120, output_tokens: 12, total_tokens: 132 },
  });
}

function baseRequest(): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: 'Es mi comprobante',
    messageContext: localTurnMessageContext('not_configured'),
    plan: mergePlan(
      createEmptyPlan({ planId: 'sdk-wire', channel: 'whatsapp', externalUserId: 'u' }),
      { current_node: 'resolver_consultas_informativas' },
    ),
    extraction: {
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
      conversationSummary: 'Comprobante por URL.',
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
    },
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'test-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    imageEvidence: { status: 'available', reason: null, captionPresent: true, source: 'url', refStored: true },
    imageUrlAttachments: [{ url: IMAGE_URL, messageId: 'wamid.sdk1' }],
  };
}

describe('installed-SDK image transport capture', () => {
  it('serializes native image input through the installed SDK converter', async () => {
    const wireBodies: string[] = [];
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    Reflect.set(client, 'fetch', async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') wireBodies.push(init.body);
      return new Response(cannedResponsesPayload(), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-sdk-wire' },
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

    const reply = await runtime.composeReply(baseRequest());

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
    // Installed-SDK serialization evidence (agents-openai
    // getInputMessageContent): {type: input_image, image_url, detail}.
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0]).toMatchObject({ type: 'input_image', image_url: IMAGE_URL, detail: 'auto' });
    // The raw URL travels only as native image_url, never as prompt text.
    for (const body of wireBodies) {
      const occurrences = body.split(IMAGE_URL).length - 1;
      expect(occurrences).toBe(1);
    }
    // The turn still carries a model origin receipt for the reply.
    expect(reply.origin?.modelParagraphs).toEqual(['Recibí tu imagen y la tengo en cuenta.']);
    expect(reply.openAiCall?.requestMetrics.transport?.observedRequestCount).toBeGreaterThan(0);
  });

  it('serializes persisted file_id image input through the installed SDK converter', async () => {
    const wireBodies: string[] = [];
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    Reflect.set(client, 'fetch', async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') wireBodies.push(init.body);
      return new Response(cannedResponsesPayload(), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-sdk-file-wire' },
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

    const FILE_ID = 'file-sdk-wire-1';
    const request = {
      ...baseRequest(),
      userMessage: 'Cuanto dice aqui?',
      imageUrlAttachments: [],
      imageFileAttachments: [{ fileId: FILE_ID, messageId: 'wamid.sdkfile1' }],
      imageEvidence: {
        status: 'available',
        reason: null,
        captionPresent: true,
        source: 'file',
        refStored: true,
        fileRefProjected: true,
      },
    } as unknown as ComposeReplyRequest;
    const reply = await runtime.composeReply(request);

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
    // Installed-SDK serialization evidence (agents-openai converter):
    // {image: {id}} rides the Responses wire as {type: input_image, file_id}.
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0]).toMatchObject({ type: 'input_image', file_id: FILE_ID });
    // The file ID travels only as native image content, never as prompt
    // text: the current user text stays visible while the raw ID occurs
    // exactly once on the wire.
    const textItems = bodies.flatMap((body) => {
      const input = body['input'];
      if (!Array.isArray(input)) return [];
      return input.flatMap((entry) => {
        const record = entry as { content?: unknown[] };
        return Array.isArray(record.content) ? record.content : [];
      });
    }).filter((item) => (item as { type?: string }).type === 'input_text');
    expect(textItems.some((item) => JSON.stringify(item).includes('Cuanto dice aqui?'))).toBe(true);
    for (const body of wireBodies) {
      const occurrences = body.split(FILE_ID).length - 1;
      expect(occurrences).toBe(1);
    }
    // The model call is accounted once with transport evidence; the Files
    // upload that produced the reference is a separate operation and never
    // counts as an extra model call on this turn.
    expect(reply.openAiCall?.requestMetrics.transport?.observedRequestCount).toBe(1);
    expect(reply.origin?.modelParagraphs).toEqual(['Recibí tu imagen y la tengo en cuenta.']);
  });

describe('installed-SDK extraction transport capture', () => {
  const EXTRACT_FILE_ID = 'file-sdk-extract-1';
  const EXTRACT_URL = 'https://example.com/media/receipt-extract.png';
  const EXTRACT_MESSAGE_ID = 'wamid.sdkextract1';

  function quotaErrorPayload(): string {
    return JSON.stringify({
      error: {
        message: 'You exceeded your current quota.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    });
  }

  function extractRuntime(client: OpenAI): OpenAiAgentRuntime {
    return new OpenAiAgentRuntime({
      apiKey: 'test-key',
      replyModel: 'gpt-test',
      extractorModel: 'gpt-test',
      replyProviderLimit: 4,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 3,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      providerGateway: {} as never,
      openAIClient: client,
    });
  }

  function planWithFileRef(): PersistedPlan {
    return mergePlan(
      createEmptyPlan({ planId: 'sdk-extract', channel: 'whatsapp', externalUserId: 'u' }),
      {
        current_node: 'resolver_consultas_informativas',
        image_attachments: [{
          kind: 'file',
          fileId: EXTRACT_FILE_ID,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          mimeType: 'image/jpeg',
          byteLength: 1024,
          contentDigest: 'a'.repeat(64),
          messageId: EXTRACT_MESSAGE_ID,
          receivedAt: new Date().toISOString(),
        }],
      },
    ) as PersistedPlan;
  }

  function mockQuotaClient(wireBodies: string[]): OpenAI {
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    Reflect.set(client, 'fetch', async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') wireBodies.push(init.body);
      return new Response(quotaErrorPayload(), {
        status: 429,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-sdk-extract' },
      });
    });
    return client;
  }

  function firstWireBody(bodies: string[]): string {
    const raw = bodies[0];
    if (typeof raw !== 'string') throw new Error('expected one captured wire body');
    return raw;
  }

  function parseWireBody(raw: string): Record<string, unknown> {
    return JSON.parse(raw) as Record<string, unknown>;
  }

  function readStringField(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === 'string' ? value : '';
  }

  function inputTexts(items: Array<Record<string, unknown>>): string[] {
    return items
      .filter((item) => item['type'] === 'input_text')
      .map((item) => readStringField(item, 'text'));
  }

  function wireInputItems(body: Record<string, unknown>): Array<Record<string, unknown>> {
    const input = body['input'];
    if (!Array.isArray(input)) return [];
    return input.flatMap((entry) => {
      const record = entry as { content?: unknown[] };
      return Array.isArray(record.content) ? record.content as Array<Record<string, unknown>> : [];
    });
  }

  it('sends the uploaded file ref as native input_image on the production extraction payload', async () => {
    const wireBodies: string[] = [];
    const runtime = extractRuntime(mockQuotaClient(wireBodies));
    const request: ExtractRequest = {
      userMessage: 'Es mi comprobante',
      plan: planWithFileRef(),
      messageContext: localTurnMessageContext('not_configured'),
      currentMessageId: EXTRACT_MESSAGE_ID,
      imageFileAttachments: [{ fileId: EXTRACT_FILE_ID, messageId: EXTRACT_MESSAGE_ID }],
    };

    await expect(runtime.extract(request)).rejects.toBeDefined();

    // One decision model call and no inspection stage: the retired
    // inspectImage entrypoint no longer exists, so the single captured wire
    // body below is the native-behavior proof.
    expect(wireBodies).toHaveLength(1);
    const raw = firstWireBody(wireBodies);
    const body = parseWireBody(raw);
    const items = wireInputItems(body);
    const images = items.filter((item) => item['type'] === 'input_image');
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: 'input_image', file_id: EXTRACT_FILE_ID });
    // The existing textual context rides the same user message as input_text.
    expect(inputTexts(items)).toHaveLength(1);
    expect(inputTexts(items).join('\n')).toContain('Mensaje del usuario: Es mi comprobante');
    // The file ID travels only as native image content, never as prompt text.
    const occurrences = raw.split(EXTRACT_FILE_ID).length - 1;
    expect(occurrences).toBe(1);
    // Scoped receipt guidance loads on the image decision call.
    expect(readStringField(body, 'instructions')).toContain('Comprobante visible');
  });

  it('sends the backend URL as native input_image on the production extraction payload', async () => {
    const wireBodies: string[] = [];
    const runtime = extractRuntime(mockQuotaClient(wireBodies));
    const plan = mergePlan(
      createEmptyPlan({ planId: 'sdk-extract-url', channel: 'whatsapp', externalUserId: 'u' }),
      {
        current_node: 'resolver_consultas_informativas',
        image_attachments: [{
          kind: 'url',
          url: EXTRACT_URL,
          messageId: EXTRACT_MESSAGE_ID,
          receivedAt: new Date().toISOString(),
        }],
      },
    ) as PersistedPlan;
    const request: ExtractRequest = {
      userMessage: 'Es mi comprobante',
      plan,
      messageContext: localTurnMessageContext('not_configured'),
      currentMessageId: EXTRACT_MESSAGE_ID,
      imageUrlAttachments: [{ url: EXTRACT_URL, messageId: EXTRACT_MESSAGE_ID }],
    };

    await expect(runtime.extract(request)).rejects.toBeDefined();

    // No inspection stage exists (retired entrypoint removed); the single
    // captured wire body below is the native-behavior proof.
    expect(wireBodies).toHaveLength(1);
    const raw = firstWireBody(wireBodies);
    const body = parseWireBody(raw);
    const items = wireInputItems(body);
    const images = items.filter((item) => item['type'] === 'input_image');
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: 'input_image', image_url: EXTRACT_URL });
    expect(inputTexts(items)).toHaveLength(1);
    expect(inputTexts(items).join('\n')).toContain('Mensaje del usuario: Es mi comprobante');
    const occurrences = raw.split(EXTRACT_URL).length - 1;
    expect(occurrences).toBe(1);
  });

  it('keeps the imageless extraction payload as the existing string input', async () => {
    const wireBodies: string[] = [];
    const runtime = extractRuntime(mockQuotaClient(wireBodies));
    const plan = mergePlan(
      createEmptyPlan({ planId: 'sdk-extract-plain', channel: 'whatsapp', externalUserId: 'u' }),
      { current_node: 'resolver_consultas_informativas' },
    ) as PersistedPlan;
    const request: ExtractRequest = {
      userMessage: '¿Dónde es el evento?',
      plan,
      messageContext: localTurnMessageContext('not_configured'),
    };
    const spec = await runtime.buildExtractionRequestSpec(request);

    await expect(runtime.extract(request)).rejects.toBeDefined();

    // No inspection stage exists (retired entrypoint removed); the single
    // captured wire body below is the native-behavior proof.
    expect(wireBodies).toHaveLength(1);
    const body = parseWireBody(firstWireBody(wireBodies));
    // Imageless bytes are unchanged: the SDK wraps the existing string as a
    // single user message whose content is byte-identical to the spec input.
    const input: unknown = body['input'];
    if (!Array.isArray(input)) throw new Error('expected array input');
    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({ role: 'user', content: spec.input });
    // No receipt directions leak into imageless instructions.
    expect(readStringField(body, 'instructions')).not.toContain('Comprobante visible');
  });
});

describe('image-evidence reply gating', () => {
  it('omits planning categories and the capability catalog on image-evidence replies', async () => {
    const wireBodies: string[] = [];
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
    Reflect.set(client, 'fetch', async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') wireBodies.push(init.body);
      return new Response(cannedResponsesPayload(), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-sdk-image-suppress' },
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

    // Unavailable-image reply on the detection node: the failure used to
    // project planning categories and broad capabilities next to a fake
    // human intent. Only transport availability plus linkage travel now.
    const request = {
      ...baseRequest(),
      currentNode: 'deteccion_intencion',
      previousNode: 'deteccion_intencion',
      imageUrlAttachments: [],
      imageEvidence: { status: 'unavailable', reason: 'media_unavailable', captionPresent: true },
    } as unknown as ComposeReplyRequest;
    await runtime.composeReply(request);

    expect(wireBodies.length).toBeGreaterThan(0);
    const wireText = wireBodies.join('\n');
    expect(wireText).not.toContain('Categorías sugeridas');
    expect(wireText).not.toContain('Capacidades habilitadas');
    // The image facts themselves stay visible as canonical evidence.
    expect(wireText).toContain('image_evidence');
    expect(wireText).toContain('media_unavailable');
  });
});
});
