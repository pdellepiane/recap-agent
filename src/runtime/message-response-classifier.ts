import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import type { PersistedPlan } from '../core/plan';
import type {
  OpenAiCallRef,
  OpenAiRequestMetrics,
  OpenAiTransportMetrics,
  TokenUsage,
} from './contracts';
import type { AgentConversationMessage } from './agent-conversation-gateway';
import type {
  PromptLoader,
  ResponseClassifierPromptProfile,
} from './prompt-loader';
import { DEFAULT_PROMPT_CACHE_OPTIONS } from './openai-model-defaults';
import { executeWithOpenAiRetry } from './openai-retry';
import { executeOpenAiStage } from './openai-stage-execution';
import {
  captureOpenAiTransport,
  installOpenAiTransportCapture,
} from '../audit/openai-transport-capture';
import {
  resolveClassifierProfile,
} from './conversation-continuity-policy';

export { resolveClassifierProfile, resolveCampaignReplyDisposition } from './conversation-continuity-policy';

const classifierOutputSchema = z.object({
  action: z.enum([
    'respond',
    'suppress_acknowledgement',
    'suppress_reaction',
    'suppress_automated_response',
  ]),
  reason: z.enum([
    'requires_response',
    'acknowledgement',
    'reaction',
    'automated_response',
  ]),
  automation_confidence: z.enum(['not_automated', 'uncertain', 'high']),
  automation_pattern: z.enum([
    'none',
    'generic_corporate_reception',
    'interactive_menu',
    'away_or_hours_notice',
    'routing_or_queue',
    'automated_confirmation',
    'repeated_template',
    'explicit_virtual_assistant',
  ]),
  automation_scope: z.enum(['current_sender', 'quoted_or_discussed', 'none_or_uncertain']),
  conversation_health: z.enum(['progressing', 'uncertain', 'stalled', 'frustrated']),
  health_reason: z.enum([
    'normal_progress',
    'repeated_question',
    'repeated_correction',
    'unresolved_error',
    'circular_conversation',
    'explicit_frustration',
    'insufficient_context',
  ]),
  human_help_response: z.enum(['not_applicable', 'accept', 'decline', 'unclear']),
  campaign_reply_kind: z.enum([
    'not_applicable',
    'rsvp_decision',
    'declines_campaign_offer',
    'acknowledgement_only',
    'reaction_only',
    'question_or_request',
    'other_actionable',
    'unclear',
  ]),
});

export type ResponseClassifierMode = 'observe' | 'enforce';

export type MessageResponseClassifierAction = z.infer<typeof classifierOutputSchema>['action'];

export type MessageResponseClassifierTrace = {
  mode: ResponseClassifierMode;
  classifier_profile: ResponseClassifierPromptProfile;
  action: MessageResponseClassifierAction;
  reason:
    | z.infer<typeof classifierOutputSchema>['reason']
    | 'classifier_unavailable'
    | 'conversation_context_unavailable'
    | 'missing_outbound_context'
    | 'automation_confidence_insufficient'
    | 'campaign_action_requires_extraction'
    | 'help_offer_response_requires_reply';
  would_suppress: boolean;
  context_source: 'agent_api' | 'local_plan';
  has_prior_outbound_message: boolean;
  fallback_used: boolean;
  conversation_health: z.infer<typeof classifierOutputSchema>['conversation_health'];
  health_reason: z.infer<typeof classifierOutputSchema>['health_reason'];
  human_help_response: z.infer<typeof classifierOutputSchema>['human_help_response'];
  campaign_reply_kind: z.infer<typeof classifierOutputSchema>['campaign_reply_kind'];
  automation_confidence: z.infer<typeof classifierOutputSchema>['automation_confidence'];
  automation_pattern: z.infer<typeof classifierOutputSchema>['automation_pattern'];
  automation_scope: z.infer<typeof classifierOutputSchema>['automation_scope'];
  prompt_bundle_id: string | null;
  prompt_file_paths: string[];
};

export type MessageResponseClassifierResult = {
  trace: MessageResponseClassifierTrace;
  tokenUsage: TokenUsage | null;
  openAiCall?: OpenAiCallRef | null;
};

export interface MessageResponseClassifier {
  readonly mode: ResponseClassifierMode;
  classify(args: {
    inboundText: string;
    plan: PersistedPlan;
    messages: AgentConversationMessage[];
    contextSource: 'agent_api' | 'local_plan';
  }): Promise<MessageResponseClassifierResult>;
}

export class OpenAiMessageResponseClassifier implements MessageResponseClassifier {
  private readonly client: OpenAI;

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      mode: ResponseClassifierMode;
      promptLoader: PromptLoader;
      timeoutMs?: number;
      openAIClient?: OpenAI;
    },
  ) {
    this.client = options.openAIClient ?? new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 0,
    });
    installOpenAiTransportCapture(this.client);
  }

  get mode(): ResponseClassifierMode {
    return this.options.mode;
  }

  async classify(args: {
    inboundText: string;
    plan: PersistedPlan;
    messages: AgentConversationMessage[];
    contextSource: 'agent_api' | 'local_plan';
  }): Promise<MessageResponseClassifierResult> {
    const hasPriorOutboundMessage = args.messages.some((message) => message.direction === 'outbound');
    const latestOutboundMessage = [...args.messages]
      .reverse()
      .find((message) => message.direction === 'outbound') ?? null;
    // S05: campaign profile follows the newest outbound source only
    // (admin_campaign, frontend_followup). An old campaign displaced by a
    // newer agent or manual message resolves to general. Missing
    // history resolves to general with no onboarding. Source enum only.
    const classifierProfile: ResponseClassifierPromptProfile =
      resolveClassifierProfile(args.messages);
    let promptBundleId: string | null = null;
    let promptFilePaths: string[] = [];
    let transportMetrics: OpenAiTransportMetrics | undefined;
    let requestMetrics: OpenAiRequestMetrics | null = null;

    try {
      const bundle = await this.options.promptLoader.loadResponseClassifierBundle(
        classifierProfile,
      );
      promptBundleId = bundle.id;
      promptFilePaths = bundle.filePaths;
      const modelInput = this.buildInput(
        args,
        hasPriorOutboundMessage,
        classifierProfile,
        latestOutboundMessage,
      );
      const userInput = JSON.stringify(modelInput);
      const request = {
        model: this.options.model,
        reasoning: { effort: 'none' as const },
        max_output_tokens: 128,
        store: true,
        prompt_cache_key: `classifier:${bundle.id}`,
        prompt_cache_options: DEFAULT_PROMPT_CACHE_OPTIONS,
        input: [
          { role: 'system' as const, content: bundle.instructions },
          {
            role: 'user' as const,
            content: userInput,
          },
        ],
        text: {
          verbosity: 'low' as const,
          format: zodTextFormat(classifierOutputSchema, 'reply_delivery_decision'),
        },
      };
       requestMetrics = {
         instructionBytes: Buffer.byteLength(bundle.instructions, 'utf8'),
         inputBytes: Buffer.byteLength(userInput, 'utf8'),
         toolCount: 0,
         schemaPropertyCount: Object.keys(classifierOutputSchema.shape).length,
       };
       const captured = await captureOpenAiTransport('classifier',
         async () => await executeOpenAiStage({
           stage: 'classifier',
           model: this.options.model,
           timeoutMs: this.options.timeoutMs ?? 16_000,
           operation: async (signal) => await executeWithOpenAiRetry(
             async () => await this.client.responses.parse(request, { signal }),
           ),
         }),
         (metrics) => { transportMetrics = metrics; });
       const { value: stageResult } = captured;
       const { value: response, attemptCount } = stageResult;
       const openAiCall = this.buildOpenAiCall(
         response,
         attemptCount,
         { ...requestMetrics, transport: transportMetrics },
       );
      const decision = response.output_parsed;
      if (!decision) {
        return this.fallback({
          contextSource: args.contextSource,
          hasPriorOutboundMessage,
           classifierProfile,
           promptBundleId,
           promptFilePaths,
           openAiCall,
        });
      }

      const hasOutstandingHelpOffer =
        args.plan.conversation_health.help_offer_status === 'offered';
      const isHighConfidenceAutomatedResponse =
        decision.automation_confidence === 'high' &&
        decision.automation_scope === 'current_sender' &&
        decision.automation_pattern !== 'none' &&
        (decision.automation_pattern !== 'generic_corporate_reception' ||
          hasPriorOutboundMessage);
      const isNonActionableAcknowledgement =
        decision.action === 'suppress_acknowledgement';
      const isNonActionableReaction =
        decision.action === 'suppress_reaction';
      const isCampaignReply = classifierProfile === 'campaign_reply';
      const isCampaignClosure =
        decision.campaign_reply_kind === 'declines_campaign_offer' ||
        decision.campaign_reply_kind === 'acknowledgement_only';
      const isCampaignReaction = decision.campaign_reply_kind === 'reaction_only';
      const campaignActionRequiresExtraction =
        isCampaignReply &&
        decision.action !== 'respond' &&
        !(
          (isNonActionableAcknowledgement && isCampaignClosure) ||
          (isNonActionableReaction && isCampaignReaction)
        );
      const shouldSuppressAutomation =
        isHighConfidenceAutomatedResponse && !hasOutstandingHelpOffer;
      const validContextualSuppression =
        (isNonActionableAcknowledgement || isNonActionableReaction) &&
        !hasOutstandingHelpOffer &&
        !campaignActionRequiresExtraction &&
        args.plan.rsvp_state.status === 'none' &&
        args.plan.current_node !== 'responder_invitacion';
      const action = shouldSuppressAutomation
        ? 'suppress_automated_response'
        : decision.action === 'respond'
          ? 'respond'
          : validContextualSuppression
            ? decision.action
            : 'respond';
      const reason = shouldSuppressAutomation
        ? 'automated_response'
        : action !== 'respond'
          ? decision.reason
          : hasOutstandingHelpOffer && decision.action !== 'respond'
            ? 'help_offer_response_requires_reply'
            : campaignActionRequiresExtraction
              ? 'campaign_action_requires_extraction'
            : decision.action === 'suppress_automated_response'
              ? 'automation_confidence_insufficient'
              : decision.reason;
      const decisionNormalized = action !== decision.action || reason !== decision.reason;
      return {
        trace: {
          mode: this.options.mode,
          classifier_profile: classifierProfile,
          action,
          reason,
          would_suppress: action !== 'respond',
          context_source: args.contextSource,
          has_prior_outbound_message: hasPriorOutboundMessage,
          fallback_used: decisionNormalized,
          conversation_health: decision.conversation_health,
          health_reason: decision.health_reason,
          human_help_response: decision.human_help_response,
          campaign_reply_kind: decision.campaign_reply_kind,
          automation_confidence: decision.automation_confidence,
          automation_pattern: decision.automation_pattern,
          automation_scope: decision.automation_scope,
          prompt_bundle_id: bundle.id,
          prompt_file_paths: bundle.filePaths,
        },
        tokenUsage: this.toTokenUsage(response.usage),
        openAiCall: {
          responseId: response.id,
          requestId: response._request_id ?? null,
          model: this.options.model,
          attemptCount,
           requestMetrics: { ...requestMetrics, transport: transportMetrics },
        },
      };
    } catch {
      return this.fallback({
        contextSource: args.contextSource,
        hasPriorOutboundMessage,
         classifierProfile,
         promptBundleId,
         promptFilePaths,
         openAiCall: requestMetrics === null
           ? null
           : this.buildOpenAiCall(null, transportMetrics?.observedRequestCount ?? 0, {
               ...requestMetrics,
               transport: transportMetrics,
             }),
       });
    }
  }

  private buildInput(
    args: {
      inboundText: string;
      plan: PersistedPlan;
      messages: AgentConversationMessage[];
    },
    hasPriorOutboundMessage: boolean,
    classifierProfile: ResponseClassifierPromptProfile,
    latestOutboundMessage: AgentConversationMessage | null,
  ): Record<string, unknown> {
    const activeInformationThread =
      args.plan.current_node === 'resolver_consultas_informativas' &&
      ((args.plan.information_state.pending_requests.length ?? 0) > 0 ||
        args.plan.information_state.last_completed_request != null);
    if (classifierProfile === 'campaign_reply' && latestOutboundMessage) {
      return {
        inbound_message: truncatePreservingEnds(args.inboundText, 1_200),
        active_information_thread: activeInformationThread,
        decision_context: {
          profile: classifierProfile,
          rsvp_status: args.plan.rsvp_state.status,
          human_help_offer_status: args.plan.conversation_health.help_offer_status,
          active_information_thread: activeInformationThread,
        },
        campaign_message: {
          direction: latestOutboundMessage.direction,
          source: latestOutboundMessage.source,
          body: truncatePreservingEnds(latestOutboundMessage.body, 1_600),
        },
      };
    }
    return {
      inbound_message: truncatePreservingEnds(args.inboundText, 1_200),
      active_information_thread: activeInformationThread,
      plan_context: {
        current_node: args.plan.current_node,
        active_need_category: args.plan.active_need_category,
        human_escalation_status: args.plan.human_escalation.status,
        conversation_health: args.plan.conversation_health,
        rsvp_state: args.plan.rsvp_state,
        conversation_summary: truncatePreservingEnds(args.plan.conversation_summary, 600),
        active_information_thread: activeInformationThread,
      },
      has_prior_outbound_message: hasPriorOutboundMessage,
      recent_messages: args.messages.slice(-5).map((message) => ({
        direction: message.direction,
        source: message.source,
        body: truncatePreservingEnds(message.body, 400),
      })),
    };
  }

  private fallback(args: {
    contextSource: 'agent_api' | 'local_plan';
    hasPriorOutboundMessage: boolean;
    classifierProfile: ResponseClassifierPromptProfile;
    promptBundleId: string | null;
    promptFilePaths: string[];
    openAiCall?: OpenAiCallRef | null;
  }): MessageResponseClassifierResult {
    return {
      trace: {
        mode: this.options.mode,
        classifier_profile: args.classifierProfile,
        action: 'respond',
        reason: 'classifier_unavailable',
        would_suppress: false,
        context_source: args.contextSource,
        has_prior_outbound_message: args.hasPriorOutboundMessage,
        fallback_used: true,
        conversation_health: 'uncertain',
        health_reason: 'insufficient_context',
        human_help_response: 'not_applicable',
        campaign_reply_kind: 'not_applicable',
        automation_confidence: 'uncertain',
        automation_pattern: 'none',
        automation_scope: 'none_or_uncertain',
        prompt_bundle_id: args.promptBundleId,
        prompt_file_paths: args.promptFilePaths,
      },
      tokenUsage: null,
      openAiCall: args.openAiCall ?? null,
    };
  }

  private buildOpenAiCall(
    response: { id: string; _request_id?: string | null } | null,
    attemptCount: number,
    requestMetrics: OpenAiRequestMetrics,
  ): OpenAiCallRef {
    const lastRequest = requestMetrics.transport?.requests.at(-1);
    return {
      responseId: response?.id ?? lastRequest?.responseId ?? null,
      requestId: response?._request_id ?? lastRequest?.requestId ?? null,
      model: this.options.model,
      attemptCount: Math.max(1, attemptCount, requestMetrics.transport?.observedRequestCount ?? 0),
      requestMetrics,
    };
  }

  private toTokenUsage(usage: OpenAI.Responses.ResponseUsage | undefined): TokenUsage | null {
    if (!usage) {
      return null;
    }
    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      cached_input_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
      cache_write_input_tokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    };
  }
}

function truncatePreservingEnds(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const sideLength = Math.floor((maxLength - 5) / 2);
  return `${value.slice(0, sideLength)} ... ${value.slice(-sideLength)}`;
}
