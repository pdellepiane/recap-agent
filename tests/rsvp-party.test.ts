import { describe, expect, it } from 'vitest';

import { extractionSchema } from '../src/runtime/extraction-schemas';
import { rsvpPartySchema } from '../src/core/rsvp';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import path from 'node:path';
import type { ExtractionResult } from '../src/runtime/contracts';
import type { PersistedPlan } from '../src/core/plan';
import { createEmptyPlan } from '../src/core/plan';

const fitCriteria = {
  eventType: 'boda',
  needCategory: 'catering',
  location: 'Lima',
  budgetAmount: null,
  budgetCurrency: null,
  mustHave: [],
  shouldAvoid: [],
  rankingNotes: '',
} as const;

describe('rsvpParty schema typing', () => {
  it('rsvpParty is optional and validated when present', () => {
    const base = {
      actionIntent: 'responder_invitacion',
      informationRequests: [],
      intentConfidence: 0.9,
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
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: fitCriteria,
      rsvpAction: 'attending',
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
    } as const;
    const absent = extractionSchema.parse({ ...base, conversationSummary: 'solo yo' });
    expect(absent.rsvpParty).toBeUndefined();
    const present = extractionSchema.parse({
      ...base,
      conversationSummary: 'yo y pareja',
      rsvpParty: { scope: 'self_and_others', mentioned_names: ['Maria'] },
    });
    expect(present.rsvpParty).toEqual({ scope: 'self_and_others', mentioned_names: ['Maria'] });
  });

  it('accepts valid self scope', () => {
    const parsed = rsvpPartySchema.parse({ scope: 'self', mentioned_names: [] });
    expect(parsed.scope).toBe('self');
  });

  it('rejects an invalid scope and extra fields (strict)', () => {
    expect(() => rsvpPartySchema.parse({ scope: 'invalid', mentioned_names: [] })).toThrow();
    expect(() => rsvpPartySchema.parse({ scope: 'self_and_others', mentioned_names: ['Maria'], extra: 'field' } as unknown as Record<string, unknown>)).toThrow();
  });

  // PASS 2: merged the rsvpParty capability-gating assertions into
  // tests/rsvp-schema.test.ts 'includes RSVP evidence only in the
  // RSVP-capable schema' (same dynamic-schema gating behavior, now pinned
  // alongside the other RSVP fields).
});

describe('rsvpParty projection wiring', () => {
  it('projects self_and_others party into reply evidence', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test',
      replyModel: 'gpt-5',
      extractorModel: 'gpt-5',
      replyProviderLimit: 2,
      presentationProviderLimit: 2,
      providerDetailLookupLimit: 2,
      promptLoader: loader,
      providerGateway: { lookupUserEventContext: async () => null } as unknown as never,
    });
    const extraction: ExtractionResult = {
      actionIntent: 'responder_invitacion',
      informationRequests: [],
      rsvpAction: 'attending',
      rsvpDecisionSource: 'current_message',
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
      rsvpParty: { scope: 'self_and_others', mentioned_names: ['Maria', 'Carlos'] },
      intentConfidence: 0.9,
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
      conversationSummary: 'test',
      selectedProviderHints: [],
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
    const plan = createEmptyPlan({ planId: 'plan-r1', channel: 'whatsapp', externalUserId: 'u1' }) as PersistedPlan;
    const evidence = (runtime as unknown as { buildReplyTurnEvidence: (args: unknown) => { rsvp_party:unknown; extraction:Record<string,unknown> } }).buildReplyTurnEvidence({
      request: {
        currentNode: 'responder_invitacion',
        previousNode: 'responder_invitacion',
        userMessage: 'confirmo yo y mi esposa Maria',
        messageContext: { historyStatus: 'none', recentMessages: [], history: [] } as unknown as never,
        plan,
        extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        errorMessage: null,
        promptBundleId: 'test',
        promptFilePaths: [],
        toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
        rsvpPhoneEvidence: null,
      },
      focusNeedCategory: null,
      providerResults: [],
      recommendationFunnel: null,
      authenticationOnlyReply: false,
    });
    expect(evidence.rsvp_party).toEqual({
      scope: 'self_and_others',
      mentioned_names: ['Maria', 'Carlos'],
      companion_count: 'unknown',
      plus_one_response: 'unknown',
    });
    expect(evidence.extraction).toMatchObject({ rsvp_party: { scope: 'self_and_others', mentioned_names: ['Maria', 'Carlos'] } });
  });

  it('projects null when single person', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test',
      replyModel: 'gpt-5',
      extractorModel: 'gpt-5',
      replyProviderLimit: 2,
      presentationProviderLimit: 2,
      providerDetailLookupLimit: 2,
      promptLoader: loader,
      providerGateway: { lookupUserEventContext: async () => null } as unknown as never,
    });
    const extraction: ExtractionResult = {
      actionIntent: 'responder_invitacion',
      informationRequests: [],
      rsvpAction: 'attending',
      rsvpDecisionSource: 'current_message',
      rsvpCandidateGuestId: null,
      rsvpEventReference: null,
      rsvpParty: null,
      intentConfidence: 0.9,
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
      conversationSummary: 'test',
      selectedProviderHints: [],
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
    const plan = createEmptyPlan({ planId: 'plan-r2', channel: 'whatsapp', externalUserId: 'u1' }) as PersistedPlan;
    const evidence = (runtime as unknown as { buildReplyTurnEvidence: (args: unknown) => { rsvp_party:unknown } }).buildReplyTurnEvidence({
      request: {
        currentNode: 'responder_invitacion',
        previousNode: 'responder_invitacion',
        userMessage: 'confirmo solo yo',
        messageContext: { historyStatus: 'none', recentMessages: [], history: [] } as unknown as never,
        plan,
        extraction,
        missingFields: [],
        searchReady: false,
        providerResults: [],
        errorMessage: null,
        promptBundleId: 'test',
        promptFilePaths: [],
        toolUsage: { considered: [], called: [], inputs: [], outputs: [] },
        rsvpPhoneEvidence: null,
      },
      focusNeedCategory: null,
      providerResults: [],
      recommendationFunnel: null,
      authenticationOnlyReply: false,
    });
    expect(evidence.rsvp_party).toBeNull();
  });
});
