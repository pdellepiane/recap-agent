import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import type { ComposeReplyRequest } from '../src/runtime/contracts';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
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
