import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import type { ComposeReplyRequest, ExtractRequest, ExtractionResult } from '../src/runtime/contracts';
import type { CustomerContextProjection } from '../src/runtime/customer-context';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { runtimeOperationIds } from '../src/runtime/capability-manifest';
import {
  deriveReplyCompilerContext,
  selectReplyModules,
} from '../src/runtime/model-request-projector';
import { instructionModuleRegistry } from '../src/runtime/prompt-manifest';
import {
  buildTurnMessageContext,
  localTurnMessageContext,
} from '../src/runtime/turn-message-context';

const promptsDir = path.resolve(process.cwd(), 'prompts');
const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');
const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

function testRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(promptsDir),
    providerGateway: {
      async searchProviders(): Promise<never> {
        throw new Error('construction must not call the provider gateway');
      },
    } as never,
  });
}

function supportPlan(overrides: Record<string, unknown> = {}): PersistedPlan {
  return mergePlan(
    createEmptyPlan({ planId: 'owner-b-plan', channel: 'whatsapp', externalUserId: 'owner-b-user' }),
    { current_node: 'resolver_consultas_informativas', ...overrides },
  ) as PersistedPlan;
}

function baseExtraction(overrides: Record<string, unknown> = {}): ExtractionResult {
  return {
    actionIntent: null,
    requestedOperation: null,
    reportedEventRole: null,
    informationRequests: [],
    supportAct: null,
    humanHelpIntent: null,
    phoneConfirmation: null,
    rsvpAction: null,
    rsvpDecisionSource: 'plan_state',
    rsvpCandidateGuestId: null,
    rsvpEventReference: null,
    rsvpParty: null,
    intentConfidence: null,
    ambiguity: {
      status: 'clear',
      clarificationQuestion: null,
      interpretations: [],
      candidateOperations: [],
      questionKey: null,
    },
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
    conversationSummary: '',
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
    imageReference: null,
    ...overrides,
  } as unknown as ExtractionResult;
}

function replyRequest(plan: PersistedPlan, overrides: Record<string, unknown> = {}): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'resolver_consultas_informativas',
    userMessage: '¿Cuál es la dirección del evento?',
    messageContext: localTurnMessageContext('not_configured'),
    plan,
    extraction: baseExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    errorMessage: null,
    promptBundleId: 'trace-bundle',
    promptFilePaths: [],
    toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
    ...overrides,
  } as unknown as ComposeReplyRequest;
}

function venueResult(requestId: string): Record<string, unknown> {
  return {
    requestId,
    kind: 'associated_event',
    status: 'completed',
    result: {
      lookup: { email: null, phone: '+51900000001' },
      user: null,
      events: [{
        relation: 'guest',
        guestId: 42,
        eventId: 702201,
        slug: 'boda-ana-luis',
        url: null,
        name: 'Boda Ana y Luis',
        place: 'Lima',
        datetime: '2026-09-20T18:00:00',
        detail: {
          withTime: true,
          timezone: null,
          celebrateds: [],
          moments: [{
            label: 'Recepción y Fiesta',
            description: null,
            datetime: '2026-09-20T18:00:00',
            withTime: true,
            locationDescription: 'Hacienda Recoveco',
            locationReference: 'Avenida Manuel Valle en Lima',
            locationUrl: null,
            locationCoords: null,
            position: 0,
          }],
          dresscode: null,
          commonAsked: [],
          contactInfo: [],
        },
      }],
      counts: { ownerEvents: 0, guestEvents: 1, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
    },
    accessMethod: 'trusted_phone_guest',
  };
}

function venueCustomerContext(): CustomerContextProjection {
  const section = {
    status: 'ready' as const,
    source: 'agent_profile',
    fetchedAt: '2026-09-20T10:00:00.000Z',
    scope: 'trusted_phone',
    completeness: null,
    paginationExhausted: null,
    historyLimit: null,
  };
  return {
    identityAccess: {
      section: 'identity_access',
      ...section,
      customerRef: 'trusted-phone',
      displayName: null,
      email: null,
      phone: null,
      authorizedScopes: ['trusted_phone'],
      guestEventIds: [702201],
      hostEventIds: [],
    },
    currentContext: {
      section: 'current_context',
      ...section,
      relevantEventIds: [],
      relevantOrderIds: [],
      pendingQuestion: null,
      unresolvedCandidateOrderIds: [],
      unresolvedCandidateEventIds: [],
    },
    purchases: [],
    carts: [],
    invitations: [{
      relation: 'guest',
      guestId: 42,
      eventId: 702201,
      slug: 'boda-ana-luis',
      url: null,
      name: 'Boda Ana y Luis',
      place: 'Lima',
      type: null,
      datetime: '2026-09-20T18:00:00',
      stage: null,
      isVisible: null,
      isPublic: null,
      currency: null,
      country: null,
      guestStatus: null,
      hostType: null,
      hostPermission: null,
      hostStatus: null,
      celebratedType: null,
      amountCollected: null,
      amountTransferred: null,
      transactionsCount: null,
      invitedGuestCount: null,
      confirmedGuestCount: null,
      orders: [],
      source: 'agent_profile',
      accessScope: 'trusted_phone',
      detail: {
        withTime: true,
        timezone: null,
        city: 'Lima',
        celebrateds: [],
        moments: [{
          label: 'Recepción y Fiesta',
          description: null,
          datetime: '2026-09-20T18:00:00',
          withTime: true,
          locationDescription: 'Hacienda Recoveco',
          locationReference: 'Avenida Manuel Valle en Lima',
          locationUrl: null,
          locationCoords: null,
          position: 0,
        }],
        dresscode: null,
        commonAsked: [],
        contactInfo: [],
      },
    }],
    actionOutcomes: [],
    coverage: {
      purchasesCarts: { ...section, status: 'empty' },
      invitationsEvents: section,
    },
  };
}

describe('Owner B B6 classifier economy', () => {
  const general = readFileSync(
    path.join(promptsDir, 'nodes/deteccion_intencion/response_classifier.txt'), 'utf8',
  );
  const campaign = readFileSync(
    path.join(promptsDir, 'nodes/deteccion_intencion/response_classifier_campaign.txt'), 'utf8',
  );

  it('keeps the general classifier within its byte budget with one decision contract', () => {
    // Negative control: restoring the old 9,175-byte automation recital
    // breaks this ceiling.
    expect(bytes(general)).toBeLessThanOrEqual(6_000);
    expect(general).toContain('Contrato de decisión');
    expect(general).toContain('Ante cualquier duda, devuelve `respond`');
    expect(general).toContain('automation_confidence');
    expect(general).toContain('automation_pattern');
    expect(general).toContain('automation_scope');
    // Health and human-help output semantics (field names live in the
    // response schema; the prompt carries the decision rules).
    expect(general).toContain('`stalled`');
    expect(general).toContain('`frustrated`');
    expect(general).toContain('`progressing`');
    expect(general).toContain('help_offer_status');
    // RSVP decisions always reach extraction, before state exists.
    expect(general).toContain('cuando el estado aún sea `none`');
    expect(general).toContain('Debe pasar a extracción estructurada');
    expect(general).toContain('nunca la suprimas como simple acuse de recibo');
    // One positive and one negative counterexample survive the cut.
    expect(general).toContain('Contrajemplos: suprime cuando');
    expect(general).toContain('Responde cuando una persona se identifica');
  });

  it('removes the repeated automation examples, priority list and menu lectures', () => {
    expect(general).not.toContain('Aplica esta prioridad de decisión');
    expect(general).not.toContain('Ejemplo semántico de supresión');
    expect(general).not.toContain('Ejemplo semántico de respuesta');
    expect(general).not.toContain('selector de sede o área');
    expect(general).not.toContain('segundo paso de un menú');
    expect(general).not.toContain('No confundas una selección con el menú que la solicitó. Si un mensaje');
    // The single kept human-versus-menu distinction is the short form.
    expect(general).toContain('No confundas una selección con el menú que la solicitó:');
  });

  it('keeps the campaign classifier within budget with its enum mapping', () => {
    // Negative control: restoring the old 2,282-byte campaign file breaks
    // this ceiling.
    expect(bytes(campaign)).toBeLessThanOrEqual(1_500);
    for (const kind of [
      'rsvp_decision',
      'declines_campaign_offer',
      'acknowledgement_only',
      'reaction_only',
      'question_or_request',
      'other_actionable',
      'unclear',
    ]) {
      expect(campaign).toContain(kind);
    }
    expect(campaign).toContain('action: respond');
    expect(campaign).not.toContain('No decidas por palabras o frases exactas');
  });

  it('measures the actual classifier bundles below budget', async () => {
    const loader = new PromptLoader(promptsDir);
    const generalBundle = await loader.loadResponseClassifierBundle('general');
    const campaignBundle = await loader.loadResponseClassifierBundle('campaign_reply');
    expect(bytes(generalBundle.instructions)).toBeLessThan(6_100);
    expect(bytes(campaignBundle.instructions)).toBeLessThan(1_600);
    // Stable cache identity per profile; a second load resolves identical.
    const again = await loader.loadResponseClassifierBundle('general');
    expect(again.id).toBe(generalBundle.id);
  });
});

describe('Owner B B7 extractor instruction economy', () => {
  it('keeps fresh cross-domain recognition below 12,000 actual bytes', async () => {
    const runtime = testRuntime();
    const fresh = mergePlan(
      createEmptyPlan({ planId: 'owner-b-new', channel: 'whatsapp', externalUserId: 'owner-b-new' }),
      { current_node: 'contacto_inicial' },
    ) as PersistedPlan;
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Hola, busco local para boda',
      plan: fresh,
      messageContext: localTurnMessageContext('not_configured'),
    });
    // Negative control: restoring the old extractor prose returns to the
    // measured 14,954-byte case and breaks this ceiling.
    expect(bytes(spec.instructions)).toBeLessThan(12_000);
    // Fresh turns keep compact cross-domain recognition, not a router.
    expect(spec.filePaths).toContain('extractors/planning.txt');
    expect(spec.filePaths).toContain('extractors/information.txt');
    expect(spec.filePaths).toContain('extractors/rsvp.txt');
    expect(spec.filePaths).toContain('extractors/base_system.txt');
    expect(spec.filePaths).toContain('extractors/capability_boundary.txt');
    expect(spec.filePaths).not.toContain('extractors/provider_management.txt');
    expect(spec.filePaths).not.toContain('extractors/close_pause.txt');
    // Operations and schema guidance stay intact.
    expect(spec.input).toContain('Acciones disponibles en este turno');
  });

  it('loads no planning detail on established support turns', async () => {
    const runtime = testRuntime();
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Gracias',
      plan: supportPlan(),
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(bytes(spec.instructions)).toBeLessThan(11_000);
    expect(spec.filePaths).toContain('extractors/contact.txt');
    expect(spec.filePaths).not.toContain('extractors/planning.txt');
    expect(spec.filePaths).not.toContain('extractors/provider_management.txt');
    expect(spec.filePaths).not.toContain('extractors/close_pause.txt');
    expect(bytes(spec.instructions)).toBeLessThanOrEqual(6_000);
    expect(spec.instructions).not.toContain('purchase_discovery');
    expect(spec.instructions).not.toContain('aspects');
  });

  it('keeps one source contract, auth boundary and recognition contracts', () => {
    const information = readFileSync(path.join(promptsDir, 'extractors/information.txt'), 'utf8');
    expect(information).toContain('orderId');
    expect(information).toContain('eventHint');
    expect(information).toContain('amount');
    expect(information).not.toContain('purchase_discovery');
    expect(information).not.toContain('orders` o `gift_purchases');
    expect(information).toContain('supportAct');
    expect(information).not.toContain('personReference');
    expect(information).not.toContain('eventReference');
    expect(information).not.toContain('Conserva literalmente el nombre del evento citado');
    const boundary = readFileSync(
      path.join(promptsDir, 'extractors/capability_boundary.txt'), 'utf8',
    );
    expect(boundary).toContain('El runtime valida capacidad, identidad, autorización y precondiciones');
    expect(boundary).not.toContain('purchase.read');
    const rsvp = readFileSync(path.join(promptsDir, 'extractors/rsvp.txt'), 'utf8');
    expect(rsvp).toContain('`rsvpAction` solo refleja una decisión expresada ahora');
    expect(rsvp).not.toContain('rsvpDecisionSource');
    const planning = readFileSync(path.join(promptsDir, 'extractors/planning.txt'), 'utf8');
    expect(planning).toContain('Fotografía y video');
    expect(planning).toContain('activeNeedCategory');
  });
});

describe('Owner B B8 single extractor continuity object', () => {
  function cardTurn(): { request: ExtractRequest; pendingQuestion: string } {
    const pendingQuestion = '¿Para qué evento es la compra?';
    const messageContext = buildTurnMessageContext({
      messages: [
        {
          id: 1, direction: 'inbound', source: 'user', body: 'Mi tarjeta fue rechazada',
          status: 'delivered', whatsappMessageId: null,
          sentAt: '2026-09-22T10:00:00.000Z', createdAt: '2026-09-22T10:00:00.000Z',
        },
        {
          id: 2, direction: 'outbound', source: 'agent',
          body: 'Revisa con tu banco la autorización en línea. ¿Para qué evento es la compra?',
          status: 'delivered', whatsappMessageId: null,
          sentAt: '2026-09-22T10:01:00.000Z', createdAt: '2026-09-22T10:01:00.000Z',
        },
      ],
      inbound: {
        channel: 'whatsapp', externalUserId: 'owner-b-user',
        text: 'El invitado es Roger Abanto y el evento es Baby Shower Catalina',
        messageId: 'owner-b-card', receivedAt: '2026-09-22T10:02:00.000Z',
      },
    });
    const plan = supportPlan({
      owner_pending_question: pendingQuestion,
      information_state: {
        resume_node: 'entrevista',
        pending_requests: [{
          requestId: 'p-venue', kind: 'associated_event',
          query: pendingQuestion, eventHint: null,
        }],
        selection_candidates: [],
        last_completed_request: { kind: 'faq', query: 'tarjeta rechazada' },
      },
    });
    return {
      request: {
        userMessage: 'El invitado es Roger Abanto y el evento es Baby Shower Catalina',
        plan,
        messageContext,
      },
      pendingQuestion,
    };
  }

  it('omits every continuity section on a true first turn', async () => {
    const runtime = testRuntime();
    const fresh = mergePlan(
      createEmptyPlan({ planId: 'owner-b-new', channel: 'whatsapp', externalUserId: 'owner-b-new' }),
      { current_node: 'contacto_inicial' },
    ) as PersistedPlan;
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Hola',
      plan: fresh,
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(spec.input).not.toContain('Evidencia condicional de continuidad');
    expect(spec.input).not.toContain('Estado del historial');
    // Baseline first-turn input measured 1,249 bytes; the identical fact
    // set must decline once empty-history boilerplate is gone.
    expect(bytes(spec.input)).toBeLessThan(1_249);
    expect(spec.input).toContain('Mensaje del usuario: Hola');
  });

  it('carries the unresolved issue once on a detail-only card follow-up', async () => {
    const runtime = testRuntime();
    const { request, pendingQuestion } = cardTurn();
    const spec = await runtime.buildExtractionRequestSpec(request);
    // Negative controls: restoring any duplicated history/gist/continuity
    // copy breaks these absences.
    expect(spec.input).not.toContain('Estado del historial');
    expect(spec.input).not.toContain('Respuesta anterior del asistente (gist');
    expect(spec.input).not.toContain('Pregunta pendiente previa');
    // One typed continuity object carries each member exactly once.
    expect(spec.input).toContain('Evidencia condicional de continuidad');
    expect(countOccurrences(spec.input, '"pending_question"')).toBe(1);
    expect(countOccurrences(spec.input, '"prior_answer_gist"')).toBe(1);
    expect(countOccurrences(spec.input, '"unresolved"')).toBe(1);
    expect(countOccurrences(spec.input, '"last_completed"')).toBe(1);
    // Decision 2: the names-only turn keeps the card issue behind them.
    expect(spec.input).toContain(pendingQuestion);
    expect(spec.input).toContain('"query":"tarjeta rechazada"');
    expect(spec.input).toContain('p-venue');
    // The current message travels once.
    expect(countOccurrences(spec.input, request.userMessage)).toBe(1);
    expect(countOccurrences(spec.input, 'Roger Abanto')).toBe(1);
  });

  it('retains a real campaign reference without repeating its body', async () => {
    const runtime = testRuntime();
    const messageContext = buildTurnMessageContext({
      messages: [{
        id: 1, direction: 'outbound', source: 'admin_campaign',
        body: 'Te invitamos a la celebración',
        status: 'sent', whatsappMessageId: null,
        sentAt: '2026-09-15T19:10:00-05:00', createdAt: null,
      }],
      inbound: {
        channel: 'whatsapp', externalUserId: 'owner-b-user', text: 'Gracias, confirmo asistencia',
        messageId: 'owner-b-campaign', receivedAt: '2026-09-15T19:12:00-05:00',
      },
    });
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Gracias, confirmo asistencia',
      plan: supportPlan({ owner_pending_question: '¿Confirmas tu asistencia?' }),
      messageContext,
    });
    expect(spec.input).toContain('Historial reciente para el extractor');
    // Two legitimate representations only: the history message and the
    // single prior-answer gist. The campaign reference carries a null
    // excerpt instead of a third body copy.
    expect(countOccurrences(spec.input, 'Te invitamos a la celebración')).toBe(2);
    expect(spec.input).toContain('"bodyExcerpt":null');
    expect(spec.input).toContain('¿Confirmas tu asistencia?');
    expect(countOccurrences(spec.input, '"pending_question"')).toBe(1);
    expect(spec.input).toContain('Plan base (JSON compacto)');
  });

  it('keeps an RSVP-switched turn on history without resolver continuity', async () => {
    const runtime = testRuntime();
    const plan = mergePlan(
      createEmptyPlan({ planId: 'owner-b-rsvp', channel: 'whatsapp', externalUserId: 'owner-b-rsvp' }),
      { current_node: 'responder_invitacion' },
    ) as PersistedPlan;
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Sí, asistiré',
      plan,
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(spec.input).not.toContain('Evidencia condicional de continuidad');
    expect(spec.input).not.toContain('Contexto previo relevante');
    expect(spec.filePaths).toContain('extractors/rsvp.txt');
    expect(spec.input).toContain('Mensaje del usuario: Sí, asistiré');
  });

  it.each([
    ['responder_invitacion', 'none'],
    ['entrevista', 'none'],
    ['resolver_consultas_informativas', 'code_requested'],
  ] as const)('retains the pending question on %s with auth %s', async (node, authStatus) => {
    const runtime = testRuntime();
    const plan = mergePlan(
      createEmptyPlan({ planId: `continuity-${node}-${authStatus}`, channel: 'whatsapp', externalUserId: 'owner-b-user' }),
      {
        current_node: node,
        owner_pending_question: '¿A cuál evento te refieres?',
        user_auth: { status: authStatus },
      },
    ) as PersistedPlan;
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Ese mismo',
      plan,
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(spec.input).toContain('Contexto previo relevante');
    expect(spec.input).toContain('"pending_question":"¿A cuál evento te refieres?"');
    expect(spec.input).not.toContain('El mensaje actual es un seguimiento de esta ruta');
    expect(countOccurrences(spec.input, '"pending_question"')).toBe(1);
  });

  it('retains the prior answer gist after switching from support to RSVP', async () => {
    const runtime = testRuntime();
    const plan = mergePlan(
      createEmptyPlan({ planId: 'continuity-rsvp-gist', channel: 'whatsapp', externalUserId: 'owner-b-user' }),
      { current_node: 'responder_invitacion' },
    ) as PersistedPlan;
    const messageContext = buildTurnMessageContext({
      messages: [{
        id: 1, direction: 'outbound', source: 'agent',
        body: 'La invitación de Ana sigue pendiente de respuesta.',
        status: 'delivered', whatsappMessageId: null,
        sentAt: '2026-09-22T10:00:00.000Z', createdAt: '2026-09-22T10:00:00.000Z',
      }],
      inbound: {
        channel: 'whatsapp', externalUserId: 'owner-b-user', text: 'Sí, asistiré',
        messageId: 'continuity-rsvp-gist', receivedAt: '2026-09-22T10:01:00.000Z',
      },
    });
    const spec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Sí, asistiré', plan, messageContext,
    });
    expect(spec.input).toContain('"prior_answer_gist"');
    expect(spec.input).toContain('La invitación de Ana sigue pendiente de respuesta.');
    expect(spec.input).not.toContain('El mensaje actual es un seguimiento de esta ruta');
  });

  it('carries image presence only while stored refs exist', async () => {
    const runtime = testRuntime();
    const plain = await runtime.buildExtractionRequestSpec({
      userMessage: 'Hola',
      plan: supportPlan(),
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(plain.input).not.toContain('Imagen actual');
    const withImage = await runtime.buildExtractionRequestSpec({
      userMessage: 'Te envié el comprobante',
      plan: supportPlan({
        image_attachments: [{
          kind: 'url', url: 'https://example.com/media/receipt-a.png',
          messageId: 'm1', receivedAt: '2026-09-16T12:00:00.000Z',
        }],
      }),
      messageContext: localTurnMessageContext('not_configured'),
    });
    expect(withImage.input).toContain('Imagen actual');
    expect(withImage.filePaths).toContain('extractors/image_reference.txt');
  });
});

describe('Owner B decision 2 support continuity', () => {
  it('omits continuation prose on a first report but keeps it on real follow-ups', async () => {
    const runtime = testRuntime();
    const report = baseExtraction({
      supportAct: {
        kind: 'report_issue',
        personReference: null, eventReference: null,
      },
    });
    const first = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        userMessage: 'Mi tarjeta fue rechazada',
        extraction: report,
      }),
    );
    // Negative control: restoring the supportAct-alone trigger reloads the
    // follow-up directive on this empty-history first turn.
    expect(first.modules.map((module) => module.id)).not.toContain('reply_support_continuity');
    expect(first.instructions).not.toContain('La persona aportó un dato o reportó una situación');

    const continued = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan({ owner_pending_question: '¿Para qué evento es la compra?' }), {
        userMessage: 'El invitado es Roger Abanto y el evento es Baby Shower Catalina',
        extraction: baseExtraction({
          supportAct: {
            kind: 'provide_detail',
            personReference: 'Roger Abanto', eventReference: 'Baby Shower Catalina',
          },
        }),
      }),
    );
    expect(continued.modules.map((module) => module.id)).toContain('reply_support_continuity');
    expect(continued.instructions).toContain('Usa el mensaje actual y el historial');
  });

  it('addresses the unresolved issue after names and separates handoff states', () => {
    const continuity = readFileSync(
      path.join(promptsDir, 'nodes/resolver_consultas_informativas/support_continuity.txt'), 'utf8',
    );
    // Card case: names alone never restart the interview.
    expect(continuity).toContain('Usa el mensaje actual y el historial');
    expect(continuity).toContain('información reportada');
    expect(continuity).toContain('resultado confirmado');
    expect(bytes(continuity)).toBeLessThanOrEqual(500);
    expect(continuity).not.toContain('support_query_open');
  });

  it('derives the serving owner per turn so a cross-topic turn can switch', () => {
    const source = {
      currentNode: 'resolver_consultas_informativas',
      informationResults: [],
      customerContext: null,
      extraction: { informationRequests: [], supportAct: null },
      plan: { information_state: { pending_requests: [] } },
      capabilityDecision: null,
      handoffOutcome: null,
      authenticationOutcome: null,
      imageEvidence: null,
      rsvpPhoneEvidence: null,
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0];
    const support = deriveReplyCompilerContext(source);
    expect(support.owner).toBe('customer_assistance');
    const planning = deriveReplyCompilerContext({ ...source, currentNode: 'entrevista' });
    expect(planning.owner).toBe('planning');
    expect(planning.tasks).toContain('planning');
  });
});

describe('Owner B B9 single reply core', () => {
  it('selects exactly one reply-core file in production', () => {
    // Negative control: restoring the four-file core breaks this identity.
    expect([...instructionModuleRegistry.shared_invariants.files]).toEqual([
      'shared/reply_core.txt',
      'shared/customer_context_fields.txt',
    ]);
    const core = readFileSync(path.join(promptsDir, 'shared/reply_core.txt'), 'utf8');
    expect(bytes(core)).toBeLessThanOrEqual(2_000);
    expect(core).toContain('Responde en español natural a la solicitud actual');
    expect(core).toContain('Afirma una consulta o cambio únicamente según su resultado verificado');
    expect(core).toContain('no los enumeres si no ayudan a responder');
    // The legacy files stay on disk for the static audit inventory only.
    for (const legacy of [
      'shared/base_system.txt',
      'shared/agent_personality.txt',
      'shared/output_style.txt',
      'shared/common_anti_patterns.txt',
    ]) {
      expect(existsSync(path.join(promptsDir, legacy))).toBe(true);
    }
  });

  it('sends the single core on support replies without legacy style prose', async () => {
    const runtime = testRuntime();
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [venueResult('req-venue')] }),
    );
    expect(spec.filePaths).toContain('shared/reply_core.txt');
    expect(spec.filePaths).not.toContain('shared/base_system.txt');
    expect(spec.filePaths).not.toContain('shared/agent_personality.txt');
    expect(spec.filePaths).not.toContain('shared/output_style.txt');
    expect(spec.filePaths).not.toContain('shared/common_anti_patterns.txt');
    // Shared field semantics are loaded once alongside the concise reply core.
    expect(bytes(spec.instructions)).toBeLessThan(2_000);
    expect(spec.instructions).toContain('Responde en español natural a la solicitud actual');
    expect(spec.instructions).toContain('payment.amount');
    expect(spec.instructions).not.toContain('Claro, te ayudo');
    expect(spec.manifest.promptIdentity).toBe(spec.modules.map((module) => module.id).join('+'));
  });
});

describe('Owner B B10 tool narration and reply input', () => {
  it('drops the authorized-tools line when no tool is exposed', async () => {
    const runtime = testRuntime();
    const handoff = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        currentNode: 'solicitar_agente_humano',
        handoffOutcome: 'handoff_requested',
      }),
    );
    expect(handoff.scopedTools).toEqual([]);
    // Negative control: restoring the "ninguna" narration breaks this.
    expect(handoff.input).not.toContain('Herramientas autorizadas');
    const interview = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { currentNode: 'entrevista' }),
    );
    expect(interview.scopedTools).not.toEqual([]);
    expect(interview.input).toContain('Herramientas autorizadas en este nodo: ');
  });

  it('keeps provider menus and catalogues out of support replies', async () => {
    const runtime = testRuntime();
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), {
        informationResults: [venueResult('req-venue')],
        customerContext: venueCustomerContext(),
      }),
    );
    expect(spec.scopedTools).toEqual([]);
    expect(spec.input).not.toContain('Capacidades habilitadas');
    expect(spec.input).not.toContain('Categorías de proveedores disponibles');
    expect(spec.input).not.toContain('Categorías sugeridas');
    // Authorized facts still travel: the venue record is answerable.
    expect(spec.input).toContain('Hacienda Recoveco');
    expect(spec.input).toContain('Boda Ana y Luis');
  });

  it('keeps the canonical turn evidence parseable with its facts', async () => {
    const runtime = testRuntime();
    const spec = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [venueResult('req-venue')] }),
    );
    const marker = 'Evidencia canónica del turno (JSON): ';
    const start = spec.input.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const evidence = JSON.parse(spec.input.slice(start + marker.length).split('\n\n')[0] ?? '{}') as {
      information_results: unknown[];
    };
    expect(evidence.information_results).toHaveLength(1);
  });
});

describe('Owner B B11 module-selection truth', () => {
  function compilerSource(overrides: Record<string, unknown> = {}) {
    return {
      currentNode: 'resolver_consultas_informativas',
      informationResults: [],
      customerContext: null,
      extraction: { informationRequests: [], supportAct: null },
      plan: {
        owner_pending_question: null,
        owner_pending_task: null,
        last_outbound_context: null,
        information_state: { pending_requests: [] },
      },
      capabilityDecision: null,
      handoffOutcome: null,
      authenticationOutcome: null,
      imageEvidence: null,
      rsvpPhoneEvidence: null,
      ...overrides,
    } as unknown as Parameters<typeof deriveReplyCompilerContext>[0];
  }

  it('requires real prior context before loading continuation prose', () => {
    const reportIssue = {
      kind: 'report_issue', topic: 'unknown', detail: 'unknown',
      personReference: null, eventReference: null,
    };
    const first = deriveReplyCompilerContext(compilerSource({
      extraction: { informationRequests: [], supportAct: reportIssue },
    }));
    expect(first.hasSupportContinuity).toBe(false);
    expect(selectReplyModules(first).map((module) => module.id)).not.toContain(
      'reply_support_continuity',
    );
    for (const prior of [
      { owner_pending_question: '¿Para qué evento es la compra?' },
      { owner_pending_task: 'esperando nombre del evento' },
      {
        last_outbound_context: {
          message_id: 'w-1', recorded_at: '2026-09-22T10:00:00.000Z',
          text: '¿Para qué evento es la compra?', text_truncated: false,
          delivery_evidence: 'constructed',
        },
      },
      { information_state: { pending_requests: [{ requestId: 'p-1', kind: 'faq', query: 'q' }] } },
    ]) {
      const continued = deriveReplyCompilerContext(compilerSource({
        plan: {
          owner_pending_question: null,
          owner_pending_task: null,
          last_outbound_context: null,
          information_state: { pending_requests: [] },
          ...prior,
        },
      }));
      expect(continued.hasSupportContinuity).toBe(true);
    }
  });

  it('derives one task per requested operation from the shared domain mapping', () => {
    const expected: Record<string, string> = {
      'faq.read': 'faq_policy',
      'event.association.read': 'venue',
      'event.detail.read': 'venue',
      'purchase.orders.read': 'purchase',
      'purchase.gift_detail.read': 'purchase',
      'purchase.read': 'purchase',
      'purchase.modify': 'purchase',
      'rsvp.state.read': 'rsvp',
      'rsvp.response.write': 'rsvp',
      'provider.plan': 'planning',
      'provider.search': 'planning',
      'provider.quote.write': 'planning',
      'provider.favorites.write': 'planning',
      'provider.review.write': 'planning',
      'auth.phone': 'auth',
      'auth.email_otp': 'auth',
      'auth.phone_update.write': 'auth',
      'auth.otp.send': 'auth',
      'auth.otp.verify': 'auth',
      'human.takeover.write': 'handoff',
      'confirmation_document.send': 'purchase',
      'media.image.inspect': 'image',
      'payment_proof.verify': 'purchase',
      'refund_or_withdrawal.execute': 'purchase',
    };
    expect([...runtimeOperationIds].sort()).toEqual(Object.keys(expected).sort());
    for (const operation of runtimeOperationIds) {
      const context = deriveReplyCompilerContext(compilerSource({
        capabilityDecision: { status: 'executable', operation },
      }));
      expect(context.tasks).toContain(expected[operation]);
    }
  });
});

describe('Owner B B12 cache layout and size table', () => {
  it('keeps stable prompt identities and customer-free cache keys', async () => {
    const runtime = testRuntime();
    const first = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [venueResult('req-venue')] }),
    );
    const second = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [venueResult('req-venue')] }),
    );
    expect(second.manifest.promptIdentity).toBe(first.manifest.promptIdentity);
    expect(second.bundleId).toBe(first.bundleId);
    // The bundle identity hashes tracked prompt files only: a different
    // customer phone behind the same modules resolves the same key.
    const otherPhone = await runtime.buildReplyRequestSpec(
      replyRequest(
        supportPlan({ contact_phone: '+51999999999' }),
        { informationResults: [venueResult('req-venue')] },
      ),
    );
    expect(otherPhone.bundleId).toBe(first.bundleId);
    expect(first.bundleId).not.toContain('51900000001');
    expect(first.manifest.promptIdentity).not.toContain('51900000001');
  });

  it('holds the per-flow instruction ceilings on actual production specs', async () => {
    const runtime = testRuntime();
    const loader = new PromptLoader(promptsDir);
    const general = await loader.loadResponseClassifierBundle('general');
    const campaign = await loader.loadResponseClassifierBundle('campaign_reply');
    const fresh = mergePlan(
      createEmptyPlan({ planId: 'owner-b-new', channel: 'whatsapp', externalUserId: 'owner-b-new' }),
      { current_node: 'contacto_inicial' },
    ) as PersistedPlan;
    const freshSpec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Hola', plan: fresh, messageContext: localTurnMessageContext('not_configured'),
    });
    const supportSpec = await runtime.buildExtractionRequestSpec({
      userMessage: 'Gracias', plan: supportPlan(),
      messageContext: localTurnMessageContext('not_configured'),
    });
    const firstReply = await runtime.buildReplyRequestSpec(
      replyRequest(supportPlan(), { informationResults: [venueResult('req-venue')] }),
    );
    const table: Record<string, number> = {
      classifierGeneral: bytes(general.instructions),
      classifierCampaign: bytes(campaign.instructions),
      extractorFresh: bytes(freshSpec.instructions),
      extractorEstablished: bytes(supportSpec.instructions),
      replyFirstSupport: bytes(firstReply.instructions),
    };
    expect(table.classifierGeneral).toBeLessThan(6_100);
    expect(table.classifierCampaign).toBeLessThan(1_600);
    expect(table.extractorFresh).toBeLessThan(12_000);
    expect(table.extractorEstablished).toBeLessThan(11_000);
    expect(table.replyFirstSupport).toBeLessThan(2_000);
    for (const value of Object.values(table)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});
