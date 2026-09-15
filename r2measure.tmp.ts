/* R2 byte measurement: identical fixtures, old vs new request bytes. */
import { createEmptyPlan, mergePlan } from './src/core/plan';
import { localTurnMessageContext } from './src/runtime/turn-message-context';
import { OpenAiAgentRuntime } from './src/runtime/openai-agent-runtime';
import { PromptLoader } from './src/runtime/prompt-loader';
import path from 'node:path';

const fileRef = {
  kind: 'file' as const,
  fileId: 'file-abc123',
  expiresAt: '2030-01-01T00:00:00.000Z',
  mimeType: 'image/png' as const,
  byteLength: 70,
  contentDigest: 'd'.repeat(64),
  messageId: 'wamid.img1',
  receivedAt: '2026-09-08T14:30:00Z',
};
const urlRef = {
  kind: 'url' as const,
  url: 'https://example.com/a.png',
  messageId: 'wamid.img0',
  receivedAt: '2026-09-08T14:28:00Z',
};

const baseExtraction = {
  actionIntent: null,
  requestedOperation: null,
  informationRequests: [],
  supportAct: null,
  humanHelpIntent: null,
  phoneConfirmation: null,
  rsvpAction: null,
  rsvpDecisionSource: 'plan_state',
  rsvpCandidateGuestId: null,
  rsvpEventReference: null,
  rsvpParty: null,
  intentConfidence: 1,
  ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [], candidateOperations: [], questionKey: null },
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
  imageReference: { status: 'none', referencedMessageIds: [] },
};

async function main(): Promise<void> {
  const runtime = new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'test-reply',
    extractorModel: 'test-extractor',
    replyProviderLimit: 3,
    presentationProviderLimit: 3,
    providerDetailLookupLimit: 1,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {} as never,
  });
  const anyRuntime = runtime as unknown as {
    composeExtractorInput(request: Record<string, unknown>, policy: Record<string, unknown>): string;
    composeConversationInput(request: Record<string, unknown>, funnel: Record<string, unknown>, urls?: unknown[], files?: unknown[]): string;
  };
  const policy = { allowedActionIntents: ['pausar'] };
  const funnel = { available_candidates: 0, context_candidates: 0, context_candidate_ids: [], presentation_limit: 3 };
  const base = createEmptyPlan({ planId: 'p', channel: 'whatsapp', externalUserId: 'u' });
  const withRefs = mergePlan(base, { image_attachments: [urlRef, fileRef] });
  const ctx = localTurnMessageContext('missing_phone_number');
  const toolUsage = { considered: [] as string[], called: [] as string[], inputs: [] as never[], outputs: [] as never[] };

  const cases: Record<string, { extractor: number; reply: number }> = {};
  const measure = (name: string, extractorRequest: Record<string, unknown>, replyRequest: Record<string, unknown>, urls: unknown[] = [], files: unknown[] = []): void => {
    const extractor = anyRuntime.composeExtractorInput(extractorRequest, policy);
    const reply = anyRuntime.composeConversationInput(replyRequest, funnel, urls, files);
    cases[name] = { extractor: Buffer.byteLength(extractor, 'utf8'), reply: Buffer.byteLength(reply, 'utf8') };
  };

  const replyBase = (plan: typeof base, extraction: typeof baseExtraction): Record<string, unknown> => ({
    currentNode: 'resolver_consultas_informativas', previousNode: 'contacto_inicial',
    userMessage: 'Cual es el horario?', messageContext: ctx, plan, extraction,
    missingFields: [], searchReady: false, providerResults: [], errorMessage: null,
    promptBundleId: 'test', promptFilePaths: [], toolUsage,
  });

  // A: plain FAQ, imageless.
  measure(
    'A_faq_imageless',
    { userMessage: 'Cual es el horario?', plan: base, messageContext: ctx, currentMessageId: null },
    replyBase(base, baseExtraction),
  );
  // B: image turn with customer context + native attachment.
  measure(
    'B_image_turn',
    { userMessage: 'Que dice?', plan: withRefs, messageContext: ctx, currentMessageId: 'wamid.img1', media: [{ kind: 'image', mimeType: 'image/png', fileName: null }] },
    {
      ...replyBase(withRefs, baseExtraction),
      customerContext: { focus: 'general' },
      imageEvidence: { status: 'available', reason: null, captionPresent: true },
    },
    [{ url: 'https://example.com/a.png', messageId: 'wamid.img0' }],
    [],
  );
  // C: text follow-up with stored priors, no current image.
  measure(
    'C_followup',
    { userMessage: 'Que monto ves?', plan: withRefs, messageContext: ctx, currentMessageId: 'wamid.q9' },
    replyBase(withRefs, { ...baseExtraction, imageReference: { status: 'prior_single', referencedMessageIds: ['wamid.img0'] } }),
  );
  console.log(JSON.stringify(cases));
}

void main();
