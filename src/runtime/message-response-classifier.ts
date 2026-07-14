import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import type { PersistedPlan } from '../core/plan';
import type { TokenUsage } from './contracts';
import type { AgentConversationMessage } from './agent-conversation-gateway';
import type { PromptLoader } from './prompt-loader';

const classifierOutputSchema = z.object({
  action: z.enum(['respond', 'suppress_acknowledgement', 'suppress_reaction']),
  reason: z.enum(['requires_response', 'acknowledgement', 'reaction']),
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
});

export type ResponseClassifierMode = 'observe' | 'enforce';

export type MessageResponseClassifierTrace = {
  mode: ResponseClassifierMode;
  action: z.infer<typeof classifierOutputSchema>['action'];
  reason:
    | z.infer<typeof classifierOutputSchema>['reason']
    | 'classifier_unavailable'
    | 'missing_outbound_context'
    | 'help_offer_response_requires_reply';
  would_suppress: boolean;
  context_source: 'agent_api' | 'local_plan';
  has_prior_outbound_message: boolean;
  fallback_used: boolean;
  conversation_health: z.infer<typeof classifierOutputSchema>['conversation_health'];
  health_reason: z.infer<typeof classifierOutputSchema>['health_reason'];
  human_help_response: z.infer<typeof classifierOutputSchema>['human_help_response'];
  prompt_bundle_id: string | null;
  prompt_file_paths: string[];
};

export type MessageResponseClassifierResult = {
  trace: MessageResponseClassifierTrace;
  tokenUsage: TokenUsage | null;
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
    },
  ) {
    this.client = new OpenAI({ apiKey: options.apiKey, maxRetries: 1 });
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
    let promptBundleId: string | null = null;
    let promptFilePaths: string[] = [];

    try {
      const bundle = await this.options.promptLoader.loadResponseClassifierBundle();
      promptBundleId = bundle.id;
      promptFilePaths = bundle.filePaths;
      const response = await this.client.responses.parse({
        model: this.options.model,
        reasoning: { effort: 'none' },
        max_output_tokens: 128,
        input: [
          { role: 'system', content: bundle.instructions },
          {
            role: 'user',
            content: JSON.stringify(this.buildInput(args, hasPriorOutboundMessage)),
          },
        ],
        text: {
          format: zodTextFormat(classifierOutputSchema, 'reply_delivery_decision'),
        },
      });
      const decision = response.output_parsed;
      if (!decision) {
        return this.fallback({
          contextSource: args.contextSource,
          hasPriorOutboundMessage,
          promptBundleId,
          promptFilePaths,
        });
      }

      const hasOutstandingHelpOffer =
        args.plan.conversation_health.help_offer_status === 'offered';
      const validSuppression =
        decision.action === 'respond' ||
        (hasPriorOutboundMessage && !hasOutstandingHelpOffer);
      const action = validSuppression ? decision.action : 'respond';
      const reason = validSuppression
        ? decision.reason
        : hasOutstandingHelpOffer
          ? 'help_offer_response_requires_reply'
          : 'missing_outbound_context';
      return {
        trace: {
          mode: this.options.mode,
          action,
          reason,
          would_suppress: action !== 'respond',
          context_source: args.contextSource,
          has_prior_outbound_message: hasPriorOutboundMessage,
          fallback_used: !validSuppression,
          conversation_health: decision.conversation_health,
          health_reason: decision.health_reason,
          human_help_response: decision.human_help_response,
          prompt_bundle_id: bundle.id,
          prompt_file_paths: bundle.filePaths,
        },
        tokenUsage: this.toTokenUsage(response.usage),
      };
    } catch {
      return this.fallback({
        contextSource: args.contextSource,
        hasPriorOutboundMessage,
        promptBundleId,
        promptFilePaths,
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
  ): Record<string, unknown> {
    return {
      inbound_message: truncatePreservingEnds(args.inboundText, 1_200),
      plan_context: {
        current_node: args.plan.current_node,
        active_need_category: args.plan.active_need_category,
        human_escalation_status: args.plan.human_escalation.status,
        conversation_health: args.plan.conversation_health,
        conversation_summary: truncatePreservingEnds(args.plan.conversation_summary, 600),
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
    promptBundleId: string | null;
    promptFilePaths: string[];
  }): MessageResponseClassifierResult {
    return {
      trace: {
        mode: this.options.mode,
        action: 'respond',
        reason: 'classifier_unavailable',
        would_suppress: false,
        context_source: args.contextSource,
        has_prior_outbound_message: args.hasPriorOutboundMessage,
        fallback_used: true,
        conversation_health: 'uncertain',
        health_reason: 'insufficient_context',
        human_help_response: 'not_applicable',
        prompt_bundle_id: args.promptBundleId,
        prompt_file_paths: args.promptFilePaths,
      },
      tokenUsage: null,
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
