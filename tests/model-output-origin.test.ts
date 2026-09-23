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
import { unavailableTurnMessageContext } from '../src/runtime/turn-message-context';
import type { ProviderDetail, ProviderSummary } from '../src/core/provider';
import type { ProviderFitCriteria } from '../src/runtime/provider-fit';
import type { StructuredMessage } from '../src/runtime/structured-message';
import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type { AgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { missingOutputOrigin, observeOutputOrigin, validateOutputOriginEvidence } from '../src/audit/output-origin';
import {
  applyDocumentedTransportTransforms,
  assertModelOrigin,
  buildModelOriginReceipt,
  canonicalModelContent,
  composeModelReply,
  hashCanonicalModelContent,
  ModelOriginViolationError,
} from '../src/runtime/model-composition';
import { InMemoryPlanStore } from '../src/storage/in-memory-plan-store';
import {
  deriveReplyCompilerContext,
  moduleFilesFor,
  selectReplyModules,
} from '../src/runtime/model-request-projector';

/**
 * Stub compiler identity: reports the exact registry modules the production
 * compiler selects for the received request. The bundle id is stub-labeled;
 * the module files are real.
 */
function stubCompilerPrompt(
  request: ComposeReplyRequest,
): NonNullable<ComposeReplyResult['compilerPrompt']> {
  const modules = selectReplyModules(deriveReplyCompilerContext(request));
  return {
    bundleId: `stub-compiler:${modules.map((module) => module.id).join('+')}`,
    filePaths: moduleFilesFor(modules),
  };
}

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
      supportAct: { kind: 'defer_submission',},
    };
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return {
      text: '',
      structuredMessage: { type: 'generic', paragraphs_es: [...this.paragraphs] },
      compilerPrompt: stubCompilerPrompt(request),
    };
  }
}

class FailingRuntime extends SentinelRuntime {
  async composeReply(): Promise<ComposeReplyResult> {
    throw new Error('model unavailable');
  }
}

class ExplicitHandoffRuntime extends SentinelRuntime {
  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      actionIntent: 'solicitar_humano',
      informationRequests: [],
      phoneConfirmation: null,
      intentConfidence: 0.99,
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
      conversationSummary: 'La persona pide hablar con un humano.',
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
      supportAct: null,
    };
  }
}

function handoffStubGateway(takeover: 'success' | 'failed'): AgentConversationGateway {
  return {
    async logMessage() {
      return { status: 'skipped', reason: 'disabled', message: 'Disabled.' };
    },
    async getRecentMessages() {
      return { status: 'success', messages: [] };
    },
    async requestHumanTakeover() {
      return takeover === 'success'
        ? { status: 'success', message: 'Requested.' }
        : { status: 'failed', error: 'takeover unavailable', retryable: false };
    },
  } as unknown as AgentConversationGateway;
}

const nullKnowledgeGateway: KnowledgeRetrievalGateway = {
  async search() {
    throw new Error('no knowledge lookups on the support acknowledgment path');
  },
};

function createOriginService(runtime: AgentRuntime, gateway?: AgentConversationGateway): AgentService {
  return new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: {
      async lookupUserEventContext() {
        return null;
      },
    } as unknown as ProviderGateway,
    agentConversationGateway: gateway,
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

async function runExplicitHandoffTurn(
  paragraphs: string[],
  options: { contactPhone?: string; takeover: 'success' | 'failed' },
) {
  const runtime = new ExplicitHandoffRuntime(paragraphs);
  const service = createOriginService(runtime, handoffStubGateway(options.takeover));
  const response = await service.handleTurn({
    channel: 'whatsapp',
    externalUserId: 'origin-handoff-user',
    ...(options.contactPhone ? { contactPhone: options.contactPhone } : {}),
    text: 'Necesito hablar con una persona',
    messageId: `origin-handoff-${options.takeover}-${paragraphs.length}-${options.contactPhone ?? 'nophone'}`,
    receivedAt: new Date().toISOString(),
  });
  return { response, runtime };
}

describe('model output origin (R01)', () => {
  it.each([
    ['first sentinel response', SENTINEL_A],
    ['second sentinel response', SENTINEL_B],
  ])('delivers %s verbatim through the migrated support path', async (_label, paragraphs) => {
    const response = await runSupportTurn(paragraphs);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe(paragraphs.join('\n\n'));
    // B11 contract revision: this first-turn deferral report carries no
    // prior context, so the follow-up directive stays off the bundle.
    expect(response.trace.prompt_bundle_id).toMatch(/^stub-compiler:shared_invariants\+reply_faq_policy$/u);
    expect(response.trace.prompt_file_paths).not.toContain(
      'nodes/resolver_consultas_informativas/support_continuity.txt',
    );
    expect(response.trace.prompt_file_paths).not.toContain(
      'nodes/resolver_consultas_informativas/system.txt',
    );
  });

  it.each([
    ['first handoff sentinel response', SENTINEL_A],
    ['second handoff sentinel response', SENTINEL_B],
  ])('delivers %s verbatim with requested handoff evidence', async (_label, paragraphs) => {
    const { response, runtime } = await runExplicitHandoffTurn(paragraphs, {
      contactPhone: '+51900000303',
      takeover: 'success',
    });
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe(paragraphs.join('\n\n'));
    expect(response.outbound.outputOrigin?.status).toBe('verified');
    expect(response.plan.current_node).toBe('solicitar_agente_humano');
    expect(response.plan.human_escalation.status).toBe('requested');
    expect(runtime.composeRequests.at(-1)?.handoffOutcome).toBe('handoff_requested');
    expect(runtime.composeRequests.at(-1)?.currentNode).toBe('solicitar_agente_humano');
  });

  it.each([
    ['first failed-handoff sentinel response', SENTINEL_A],
    ['second failed-handoff sentinel response', SENTINEL_B],
  ])('delivers %s verbatim with failed handoff evidence', async (_label, paragraphs) => {
    const { response, runtime } = await runExplicitHandoffTurn(paragraphs, {
      contactPhone: '+51900000303',
      takeover: 'failed',
    });
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe(paragraphs.join('\n\n'));
    expect(response.outbound.outputOrigin?.status).toBe('verified');
    expect(response.plan.human_escalation.status).toBe('none');
    expect(runtime.composeRequests.at(-1)?.handoffOutcome).toBe('handoff_failed');
  });

  it.each([
    ['first missing-identity sentinel response', SENTINEL_A],
    ['second missing-identity sentinel response', SENTINEL_B],
  ])('delivers %s verbatim without ever claiming a requested handoff', async (_label, paragraphs) => {
    const { response, runtime } = await runExplicitHandoffTurn(paragraphs, { takeover: 'success' });
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toBe(paragraphs.join('\n\n'));
    expect(response.plan.human_escalation.status).toBe('none');
    expect(runtime.composeRequests.at(-1)?.handoffOutcome).not.toBe('handoff_requested');
  });

  it('fails when post-generation code replaces the model paragraphs', async () => {
    const runtime = new SentinelRuntime(SENTINEL_A);
    const reply = await composeModelReply(runtime, {
      currentNode: 'resolver_consultas_informativas',
      previousNode: 'contacto_inicial',
      userMessage: 'Lo voy a enviar luego',
      messageContext: unavailableTurnMessageContext(),
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
    expect(reply.origin?.transformationVersion).toBe('transport-v2');
    const replaced = {
      ...reply,
      structuredMessage: { type: 'generic' as const, paragraphs_es: ['Texto fijo de respaldo.'] },
    };
    expect(() =>
      assertModelOrigin({ origin: reply.origin, reply: replaced, deliveredText: 'Texto fijo de respaldo.' }),
    ).toThrow(ModelOriginViolationError);
  });

  it('fails when a canned question is appended after generation', () => {
    const message = { type: 'generic' as const, paragraphs_es: [...SENTINEL_B] };
    const canonical = canonicalModelContent(message);
    expect(canonical).not.toBeNull();
    expect(() =>
      assertModelOrigin({
        origin: {
          modelParagraphs: SENTINEL_B,
          modelMessage: message,
          providerFields: [],
          modelContentSha256: hashCanonicalModelContent(canonical as string),
          bundleId: 'test',
          transformationVersion: 'transport-v2',
        },
        reply: {
          text: '',
          structuredMessage: { type: 'generic', paragraphs_es: [...SENTINEL_B] },
        },
        deliveredText: `${SENTINEL_B[0]}\n\n¿Qué proveedor o acción estás confirmando?`,
      }),
    ).toThrow(ModelOriginViolationError);
  });

  it('marks a migrated delivery as generation_failed when the model produces no output', async () => {
    const response = await createOriginService(new FailingRuntime(SENTINEL_A)).handleTurn({
      channel: 'whatsapp',
      externalUserId: 'origin-failed-user',
      contactPhone: '+51900000302',
      text: 'Lo voy a enviar luego',
      messageId: 'origin-failed',
      receivedAt: new Date().toISOString(),
    });
    expect(response.outbound.delivery.action).toBe('failure');
    expect(response.outbound.outputOrigin).toMatchObject({
      status: 'generation_failed',
      candidateSha256: null,
      deliveredSha256: null,
      transformationVersion: 'transport-v2',
      mismatchFields: ['model_output'],
    });
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

  it('emits hash-only verified, mismatch, and generation-failed observations', () => {
    const verified = observeOutputOrigin({
      candidateText: 'Texto del modelo.',
      deliveredText: 'Texto del modelo.',
      transformationVersion: 'transport-v2',
    });
    expect(verified).toMatchObject({
      status: 'verified',
      transformationVersion: 'transport-v2',
      mismatchFields: [],
    });
    expect(verified.candidateSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verified.deliveredSha256).toBe(verified.candidateSha256);

    const mismatch = observeOutputOrigin({
      candidateText: 'Texto del modelo.',
      deliveredText: 'Texto reemplazado.',
      transformationVersion: 'transport-v2',
      mismatchFields: ['model_paragraphs'],
    });
    expect(mismatch.status).toBe('mismatch');
    expect(mismatch.mismatchFields).toEqual(['model_paragraphs', 'delivered_text']);
    expect(mismatch.candidateSha256).not.toBe(mismatch.deliveredSha256);

    expect(observeOutputOrigin({
      candidateText: null,
      deliveredText: null,
      transformationVersion: 'transport-v2',
    })).toMatchObject({
      status: 'generation_failed',
      candidateSha256: null,
      deliveredSha256: null,
      mismatchFields: ['model_output'],
    });
    expect(missingOutputOrigin('legacy text').status).toBe('missing');
  });

  it('rejects verified receipts with inconsistent hashes, leftover fields, or unknown versions', () => {
    const identical = observeOutputOrigin({
      candidateText: 'Texto del modelo.',
      deliveredText: 'Texto del modelo.',
      transformationVersion: 'transport-v2',
    });
    expect(validateOutputOriginEvidence(identical).valid).toBe(true);

    const mismatch = observeOutputOrigin({
      candidateText: 'Texto del modelo.',
      deliveredText: 'Texto reemplazado.',
      transformationVersion: 'transport-v2',
      mismatchFields: ['model_paragraphs'],
    });
    expect(validateOutputOriginEvidence({ ...mismatch, status: 'verified' }).valid).toBe(false);
    expect(validateOutputOriginEvidence({
      ...identical,
      transformationVersion: 'transport-v9',
    }).valid).toBe(false);
    expect(validateOutputOriginEvidence(undefined).valid).toBe(false);
  });
});

type RecommendationMutation =
  | 'none'
  | 'rationale'
  | 'match_label'
  | 'swap_id'
  | 'inject_sentence'
  | 'provider_metadata'
  | 'provider_url'
  | 'reordered_providers'
  | 'removed_provider'
  | 'stale_version'
  | 'tampered_snapshot';

const ORIGIN_FIT_CRITERIA = {
  eventType: 'boda',
  needCategory: 'Fotografía y video',
  location: 'Lima',
  budgetAmount: null,
  budgetCurrency: null,
  mustHave: ['natural'],
  shouldAvoid: [],
  rankingNotes: 'Priorizar proveedores alineados con la necesidad activa.',
} satisfies ProviderFitCriteria;

function originNeedQuery(
  category: 'Catering' | 'Música',
  label: string,
  queryStrings: string[],
): {
  id: string;
  label: string;
  category: 'Catering' | 'Música';
  queryStrings: string[];
  mustHave: string[];
  shouldAvoid: string[];
  maxSelections: number;
  allowCrossCategory: boolean;
} {
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'query',
    label,
    category,
    queryStrings,
    mustHave: [],
    shouldAvoid: [],
    maxSelections: 1,
    allowCrossCategory: false,
  };
}

function originProviderDetail(providerId: number): ProviderDetail {
  const isCatering = providerId === 701;
  return {
    id: providerId,
    title: isCatering ? 'Sushi Mesa' : 'Banda Clara',
    slug: isCatering ? 'sushi-mesa' : 'banda-clara',
    category: isCatering ? 'Catering' : 'Música',
    location: 'Lima',
    priceLevel: 'mid',
    rating: null,
    reason: 'coincide con la necesidad',
    detailUrl: `https://sinenvolturas.com/proveedores/${isCatering ? 'sushi-mesa' : 'banda-clara'}`,
    websiteUrl: null,
    minPrice: null,
    maxPrice: null,
    promoBadge: null,
    promoSummary: null,
    descriptionSnippet: null,
    serviceHighlights: [],
    termsHighlights: [],
    description: null,
    eventTypes: ['boda'],
    raw: {},
  };
}

function originProviderGateway(): ProviderGateway {
  return {
    async lookupUserEventContext() {
      return null;
    },
    async searchProvidersByQueryIntent(input: { category: string }) {
      const isCatering = input.category === 'Catering';
      const providerId = isCatering ? 701 : 801;
      return { providers: [originProviderDetail(providerId)] };
    },
    async getProviderDetail(providerId: number) {
      return originProviderDetail(providerId);
    },
    async getProviderDetailAndTrackView(providerId: number) {
      return originProviderDetail(providerId);
    },
  } as unknown as ProviderGateway;
}

class OriginRecommendationRuntime implements AgentRuntime {
  public readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(
    private readonly mutation: RecommendationMutation,
    private readonly multiNeed: boolean,
  ) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    return {
      actionIntent: 'elicitar_necesidades',
      informationRequests: [],
      intentConfidence: 0.96,
      eventType: 'boda',
      vendorCategory: null,
      vendorCategories: ['Catering', 'Música'],
      activeNeedCategory: null,
      location: 'Lima',
      budgetSignal: null,
      guestRange: '101-200',
      preferences: ['sushi', 'música en vivo'],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Boda con catering y música.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: ORIGIN_FIT_CRITERIA,
      providerQueryIntents: [
        {
          category: 'Catering',
          label: 'Catering con sushi',
          priority: 1,
          queries: [originNeedQuery('Catering', 'Catering con sushi', ['catering sushi boda Lima'])],
          preferences: ['sushi'],
          hardConstraints: [],
          missingFields: [],
          retrievalReady: false,
          fitCriteria: { ...ORIGIN_FIT_CRITERIA, needCategory: 'Catering' },
        },
        {
          category: 'Música',
          label: 'Música en vivo',
          priority: 2,
          queries: [originNeedQuery('Música', 'Música en vivo', ['música en vivo boda Lima'])],
          preferences: ['música en vivo'],
          hardConstraints: [],
          missingFields: [],
          retrievalReady: false,
          fitCriteria: { ...ORIGIN_FIT_CRITERIA, needCategory: 'Música' },
        },
      ],
      providerPlanOperations: [],
      providerExplanationRequest: null,
      providerDetailRequest: null,
    };
  }

  private planProviders(request: ComposeReplyRequest): ProviderSummary[] {
    return request.plan.provider_needs
      .filter((need) => (need.recommended_providers ?? []).length > 0)
      .flatMap((need) => need.recommended_providers ?? []);
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    const planProviders = this.planProviders(request);
    const pristine: StructuredMessage = this.multiNeed
      ? {
        type: 'multi_need_recommendation',
        intro_es: 'Busqué proveedores de Sin Envolturas que encajan con tu plan.',
        needs: request.plan.provider_needs
          .filter((need) => (need.recommended_providers ?? []).length > 0)
          .map((need) => ({
            category: need.category,
            summary_es: `Opciones para ${need.category}.`,
            providers: (need.recommended_providers ?? []).map((provider) => ({
              provider_id: provider.id,
              match_label_es: null,
              rationale_es: 'Encaja con lo que pediste para este frente.',
              caveat_es: null,
            })),
          })),
        next_step_es: 'Podemos revisar frente por frente para confirmar, cambiar o quitar opciones.',
      }
      : {
        type: 'recommendation',
        intro_es: 'Encontré opciones que encajan con tu boda en Lima.',
        providers: planProviders.map((provider) => ({
          provider_id: provider.id,
          match_label_es: null,
          rationale_es: 'Encaja con lo que pediste para tu boda.',
          caveat_es: null,
        })),
      };
    const result: ComposeReplyResult = { text: '', structuredMessage: pristine };
    const origin = buildModelOriginReceipt(
      result,
      request.promptBundleId,
      planProviders,
    );
    const firstId = planProviders[0]?.id ?? 701;
    switch (this.mutation) {
      case 'none':
        return { ...result, origin };
      case 'rationale':
        return {
          ...result,
          origin,
          structuredMessage: {
            type: 'recommendation',
            intro_es: 'Encontré opciones que encajan con tu boda en Lima.',
            providers: [{
              provider_id: firstId,
              match_label_es: null,
              rationale_es: 'Texto reescrito por codigo posterior.',
              caveat_es: null,
            }],
          },
        };
      case 'match_label':
        return {
          ...result,
          origin,
          structuredMessage: {
            type: 'recommendation',
            intro_es: 'Encontré opciones que encajan con tu boda en Lima.',
            providers: [{
              provider_id: firstId,
              match_label_es: 'Etiqueta reescrita por codigo.',
              rationale_es: 'Encaja con lo que pediste para tu boda.',
              caveat_es: null,
            }],
          },
        };
      case 'swap_id':
        return {
          ...result,
          origin,
          structuredMessage: {
            type: 'recommendation',
            intro_es: 'Encontré opciones que encajan con tu boda en Lima.',
            providers: [{
              provider_id: 9999,
              match_label_es: null,
              rationale_es: 'Encaja con lo que pediste para tu boda.',
              caveat_es: null,
            }],
          },
        };
      case 'inject_sentence':
        return {
          ...result,
          origin,
          structuredMessage: {
            type: 'recommendation',
            intro_es: 'Encontré opciones que encajan con tu boda en Lima. Llama ahora mismo.',
            providers: planProviders.map((provider) => ({
              provider_id: provider.id,
              match_label_es: null,
              rationale_es: 'Encaja con lo que pediste para tu boda.',
              caveat_es: null,
            })),
          },
        };
      case 'provider_metadata': {
        for (const need of request.plan.provider_needs) {
          for (const provider of need.recommended_providers ?? []) {
            (provider as { title: string }).title = 'Título cambiado por codigo';
          }
        }
        return { ...result, origin };
      }
      case 'provider_url': {
        for (const need of request.plan.provider_needs) {
          for (const provider of need.recommended_providers ?? []) {
            (provider as { detailUrl: string | null }).detailUrl = 'https://ejemplo.test/ficha-cambiada';
          }
        }
        return { ...result, origin };
      }
      case 'reordered_providers': {
        const ids = planProviders.map((provider) => provider.id);
        if (ids.length < 2) return { ...result, origin };
        const reversed = [...planProviders].reverse();
        return {
          ...result,
          origin,
          structuredMessage: {
            type: 'recommendation',
            intro_es: 'Encontré opciones que encajan con tu boda en Lima.',
            providers: reversed.map((provider) => ({
              provider_id: provider.id,
              match_label_es: null,
              rationale_es: 'Encaja con lo que pediste para tu boda.',
              caveat_es: null,
            })),
          },
        };
      }
      case 'removed_provider': {
        const [first] = planProviders;
        if (!first) return { ...result, origin };
        return {
          ...result,
          origin,
          structuredMessage: {
            type: 'recommendation',
            intro_es: 'Encontré opciones que encajan con tu boda en Lima.',
            providers: [{
              provider_id: first.id,
              match_label_es: null,
              rationale_es: 'Encaja con lo que pediste para tu boda.',
              caveat_es: null,
            }],
          },
        };
      }
      case 'stale_version': {
        return {
          ...result,
          origin: origin === null ? origin : { ...origin, transformationVersion: 'transport-v1' as never },
        };
      }
      case 'tampered_snapshot': {
        if (origin === null) return { ...result, origin };
        return {
          ...result,
          origin: {
            ...origin,
            modelMessage: {
              type: 'recommendation' as const,
              intro_es: 'Texto reescrito en el recibo.',
              providers: [],
            },
          },
        };
      }
      default:
        return { ...result, origin };
    }
  }
}

function createRecommendationService(
  mutation: RecommendationMutation,
  multiNeed: boolean,
): { service: AgentService; runtime: OriginRecommendationRuntime } {
  const runtime = new OriginRecommendationRuntime(mutation, multiNeed);
  const service = new AgentService({
    planStore: new InMemoryPlanStore(),
    runtime,
    providerGateway: originProviderGateway(),
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    renderers: { whatsapp: new WhatsAppMessageRenderer() },
    informationOrchestrator: new InformationOrchestrator({
      knowledgeGateway: nullKnowledgeGateway,
      providerGateway: undefined,
      agentGateway: undefined,
    } as unknown as ConstructorParameters<typeof InformationOrchestrator>[0]),
  });
  return { service, runtime };
}

async function runRecommendationTurn(mutation: RecommendationMutation, multiNeed: boolean) {
  const { service } = createRecommendationService(mutation, multiNeed);
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: `origin-rec-${mutation}-${multiNeed ? 'multi' : 'single'}`,
    text: 'quiero una boda con sushi y música en vivo',
    messageId: `origin-rec-${mutation}-${multiNeed ? 'multi' : 'single'}`,
    receivedAt: new Date().toISOString(),
  });
}

describe('recommendation origin across the production delivery path (R1)', () => {
  it('delivers a rendered single recommendation with verified origin', async () => {
    const response = await runRecommendationTurn('none', false);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toContain('Encontré opciones que encajan con tu boda en Lima.');
    expect(response.outbound.text).toContain('Sushi Mesa');
    expect(response.outbound.text).toContain('Banda Clara');
    expect(response.outbound.text).toContain('https://sinenvolturas.com/proveedores/sushi-mesa');
    expect(response.outbound.outputOrigin?.status).toBe('verified');
    expect(response.outbound.outputOrigin?.candidateSha256).toBe(
      response.outbound.outputOrigin?.deliveredSha256,
    );
    expect(validateOutputOriginEvidence(response.outbound.outputOrigin).valid).toBe(true);
  });

  it('delivers a rendered multi-need recommendation with verified origin', async () => {
    const response = await runRecommendationTurn('none', true);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toContain('Busqué proveedores de Sin Envolturas');
    expect(response.outbound.text).toContain('Sushi Mesa');
    expect(response.outbound.text).toContain('Banda Clara');
    expect(response.outbound.outputOrigin?.status).toBe('verified');
    expect(validateOutputOriginEvidence(response.outbound.outputOrigin).valid).toBe(true);
  });

  it.each([
    ['changed rationale', 'rationale'],
    ['changed match label', 'match_label'],
    ['swapped provider id', 'swap_id'],
    ['injected sentence', 'inject_sentence'],
    ['swapped provider metadata', 'provider_metadata'],
    ['swapped provider url', 'provider_url'],
    ['reordered providers', 'reordered_providers'],
    ['removed provider', 'removed_provider'],
    ['stale transport version', 'stale_version'],
    ['tampered snapshot after composition', 'tampered_snapshot'],
  ])('fails closed through the same path on %s', async (_label, mutation) => {
    const response = await runRecommendationTurn(mutation as RecommendationMutation, false);
    expect(response.outbound.delivery.action).toBe('failure');
    expect(response.outbound.delivery.reason).toBe('model_origin_mismatch');
    expect(response.outbound.outputOrigin?.status).toBe('mismatch');
    expect(validateOutputOriginEvidence(response.outbound.outputOrigin).valid).toBe(false);
  });

  it('records no latest response when generation succeeds but origin verification fails', async () => {
    const { service } = createRecommendationService('rationale', false);
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'origin-rec-record-check',
      text: 'quiero una boda con sushi y música en vivo',
      messageId: 'origin-rec-record-check',
      receivedAt: new Date().toISOString(),
    });
    expect(response.outbound.delivery.action).toBe('failure');
    expect(response.plan.last_outbound_context ?? null).toBeNull();
    const store = (service as unknown as {
      dependencies: { planStore: { getByExternalUser(channel: string, id: string): Promise<{ last_outbound_context?: unknown } | null> } };
    }).dependencies.planStore;
    const reloaded = await store.getByExternalUser('whatsapp', 'origin-rec-record-check');
    expect(reloaded?.last_outbound_context ?? null).toBeNull();
  });
});

type GenericPublicMutation = 'none' | 'appended' | 'removed' | 'reordered';

class GenericMutationRuntime extends SentinelRuntime {
  constructor(
    paragraphs: string[],
    private readonly mutation: GenericPublicMutation,
  ) {
    super(paragraphs);
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    const pristine = await super.composeReply(request);
    const origin = buildModelOriginReceipt(
      pristine,
      request.promptBundleId,
      request.providerResults,
    );
    const base = [...(pristine.structuredMessage as { paragraphs_es: string[] }).paragraphs_es];
    switch (this.mutation) {
      case 'none':
        return { ...pristine, origin };
      case 'appended':
        return {
          ...pristine,
          origin,
          structuredMessage: { type: 'generic', paragraphs_es: [...base, 'Pregunta agregada por codigo posterior.'] },
        };
      case 'removed':
        return {
          ...pristine,
          origin,
          structuredMessage: { type: 'generic', paragraphs_es: base.slice(0, 1) },
        };
      case 'reordered':
        return {
          ...pristine,
          origin,
          structuredMessage: { type: 'generic', paragraphs_es: [...base].reverse() },
        };
      default:
        return { ...pristine, origin };
    }
  }
}

function genericOriginForMutation(mutation: GenericPublicMutation) {
  const paragraphs = [
    'Tomo nota del faro verde que parpadea dos veces sobre tu consulta.',
    'Mantengo el hilo abierto con el ancla azul en su lugar.',
  ];
  const pristine: ComposeReplyResult = {
    text: '',
    structuredMessage: { type: 'generic', paragraphs_es: [...paragraphs] },
  };
  const origin = buildModelOriginReceipt(pristine, 'bundle-generic', []);
  const base = [...paragraphs];
  switch (mutation) {
    case 'none':
      return { origin, reply: pristine, deliveredText: base.join('\n\n') };
    case 'appended':
      return {
        origin,
        reply: {
          text: '',
          structuredMessage: { type: 'generic' as const, paragraphs_es: [...base, 'Pregunta agregada por codigo posterior.'] },
        } as ComposeReplyResult,
        deliveredText: [...base, 'Pregunta agregada por codigo posterior.'].join('\n\n'),
      };
    case 'removed':
      return {
        origin,
        reply: {
          text: '',
          structuredMessage: { type: 'generic' as const, paragraphs_es: base.slice(0, 1) },
        } as ComposeReplyResult,
        deliveredText: base.slice(0, 1).join('\n\n'),
      };
    case 'reordered':
      return {
        origin,
        reply: {
          text: '',
          structuredMessage: { type: 'generic' as const, paragraphs_es: [...base].reverse() },
        } as ComposeReplyResult,
        deliveredText: [...base].reverse().join('\n\n'),
      };
    default:
      return { origin, reply: pristine, deliveredText: base.join('\n\n') };
  }
}

async function runGenericMutationTurn(mutation: GenericPublicMutation) {
  const paragraphs = [
    'Tomo nota del faro verde que parpadea dos veces sobre tu consulta.',
    'Mantengo el hilo abierto con el ancla azul en su lugar.',
  ];
  const service = createOriginService(new GenericMutationRuntime(paragraphs, mutation));
  return service.handleTurn({
    channel: 'whatsapp',
    externalUserId: `origin-generic-${mutation}`,
    contactPhone: '+51900000302',
    text: 'Lo voy a enviar luego',
    messageId: `origin-generic-${mutation}`,
    receivedAt: new Date().toISOString(),
  });
}

describe('injected renderer and generic prose mutations through the public path (S4)', () => {
  it('delivers genuine model-written freeform prose with verified transport-v2 origin', async () => {
    const response = await runGenericMutationTurn('none');
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.text).toContain('faro verde');
    expect(response.outbound.outputOrigin?.status).toBe('verified');
    expect(response.outbound.outputOrigin?.transformationVersion).toBe('transport-v2');
    expect(validateOutputOriginEvidence(response.outbound.outputOrigin).valid).toBe(true);
  });

  it.each([
    ['appended prose', 'appended'],
    ['removed prose', 'removed'],
    ['reordered prose', 'reordered'],
  ])('fails closed on generic %s (post-generation mutation)', async (_label, mutation) => {
    const { origin, reply, deliveredText } = genericOriginForMutation(mutation as GenericPublicMutation);
    expect(() => assertModelOrigin({ origin, reply, deliveredText })).toThrow(ModelOriginViolationError);
  });

  it('fails the exact injected-renderer probe through public AgentService, not just a helper', async () => {
    const paragraphs = ['Synthetic model sentence.'];
    const runtime = new SentinelRuntime(paragraphs);
    const injectedRenderer = {
      render(): string {
        return `${paragraphs[0]}\n\nSecond runtime sentence injected by the renderer.`;
      },
    };
    const service = new AgentService({
      planStore: new InMemoryPlanStore(),
      runtime,
      providerGateway: {
        async lookupUserEventContext() {
          return null;
        },
      } as unknown as ProviderGateway,
      promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      renderers: { whatsapp: injectedRenderer as unknown as WhatsAppMessageRenderer },
      informationOrchestrator: new InformationOrchestrator({
        knowledgeGateway: nullKnowledgeGateway,
        providerGateway: undefined,
        agentGateway: undefined,
      } as unknown as ConstructorParameters<typeof InformationOrchestrator>[0]),
    });
    const response = await service.handleTurn({
      channel: 'whatsapp',
      externalUserId: 'origin-injected-renderer',
      contactPhone: '+51900000302',
      text: 'Lo voy a enviar luego',
      messageId: 'origin-injected-renderer',
      receivedAt: new Date().toISOString(),
    });
    expect(response.outbound.delivery.action).toBe('failure');
    expect(response.outbound.delivery.reason).toBe('model_origin_mismatch');
    expect(response.outbound.outputOrigin?.status).toBe('mismatch');
    expect(response.outbound.outputOrigin?.mismatchFields).toContain('delivered_text');
    expect(validateOutputOriginEvidence(response.outbound.outputOrigin).valid).toBe(false);
  });

  it('still delivers genuine provider cards when the delivery renderer is honest', async () => {
    const response = await runRecommendationTurn('none', false);
    expect(response.outbound.delivery.action).toBe('send');
    expect(response.outbound.outputOrigin?.status).toBe('verified');
    expect(response.outbound.outputOrigin?.transformationVersion).toBe('transport-v2');
  });
});
