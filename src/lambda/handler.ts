import crypto from 'node:crypto';

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { PromptLoader } from '../runtime/prompt-loader';
import { getConfig } from '../runtime/config';
import { DynamoPlanStore } from '../storage/dynamo-plan-store';
import { OpenAiAgentRuntime } from '../runtime/openai-agent-runtime';
import { SinEnvolturasGateway } from '../runtime/sinenvolturas-gateway';
import { AgentService } from '../runtime/agent-service';
import { WhatsAppMessageRenderer, WebChatMessageRenderer } from '../runtime/message-renderer';
import { resolveOpenAiApiKey } from '../runtime/secrets';
import { buildTurnPerfRecord, toCliPerfSummary, type CliPerfSummary } from '../logs/trace/perf';
import { DynamoPerfStore } from '../storage/dynamo-perf-store';
import { NoopPerfStore, type PerfStore } from '../storage/perf-store';

type TerminalRequestBody = {
  text: string;
  user_id: string;
  channel: string;
  message_id?: string;
  received_at?: string;
  client_mode?: 'cli' | 'channel';
  /** Phone number provided by the channel payload (e.g. WhatsApp). */
  contact_phone?: string | null;
};

const config = getConfig();

let runtimePromise: Promise<{
  service: AgentService;
  perfStore: PerfStore;
}> | null = null;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const runtime = await getRuntime();

    if (!event.body) {
      return json(400, { error: 'Missing request body.' });
    }

    const body = JSON.parse(event.body) as TerminalRequestBody;

    if (!body.text || !body.user_id || !body.channel) {
      return json(400, { error: 'text, user_id, and channel are required.' });
    }

    const channel = body.channel;
    const messageId = body.message_id ?? crypto.randomUUID();
    const receivedAt = body.received_at ?? new Date().toISOString();
    const response = await runtime.service.handleTurn({
      channel,
      externalUserId: body.user_id,
      text: body.text,
      messageId,
      receivedAt,
      contactPhone: body.contact_phone ?? null,
    });
    const perfRecord = buildTurnPerfRecord({
      trace: response.trace,
      channel,
      externalUserId: body.user_id,
      messageId,
      userMessage: body.text,
      retentionDays: config.performance.retentionDays,
    });
    let perf: CliPerfSummary | undefined;
    let perfPersisted = false;
    try {
      await runtime.perfStore.saveTurn(perfRecord);
      perfPersisted = true;
      if (body.client_mode === 'cli') {
        perf = toCliPerfSummary(perfRecord, {
          persisted: perfPersisted,
          storageTarget: config.performance.tableName ?? null,
        });
      }
    } catch (error) {
      console.error('Failed to persist perf trace.', error);
      if (body.client_mode === 'cli') {
        perf = toCliPerfSummary(perfRecord, {
          persisted: perfPersisted,
          storageTarget: config.performance.tableName ?? null,
        });
      }
    }

    const includeDiagnostics = body.client_mode === 'cli';

    return json(200, {
      message: response.outbound.text,
      conversation_id: response.outbound.conversationId,
      plan_id: response.plan.plan_id,
      current_node: response.plan.current_node,
      ...(includeDiagnostics
        ? {
            trace: response.trace,
            perf: perf ?? null,
            plan: response.plan,
          }
        : {}),
    });
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    });
  }
}

async function getRuntime(): Promise<{
  service: AgentService;
  perfStore: PerfStore;
}> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const apiKey = await resolveOpenAiApiKey({
        directApiKey: config.openAi.apiKey,
        secretId: config.openAi.secretId,
        region: config.aws.region,
      });
      process.env.OPENAI_API_KEY = apiKey;

      const promptLoader = new PromptLoader(config.prompts.dir);
      const providerGateway = new SinEnvolturasGateway({
        baseUrl: config.providerApi.baseUrl,
        persistedSearchLimit: config.providerApi.persistedSearchLimit,
        summarySearchWordLimit: config.providerApi.summarySearchWordLimit,
      });
      const runtime = new OpenAiAgentRuntime({
        apiKey,
        replyModel: config.openAi.models.reply,
        extractorModel: config.openAi.models.extractor,
        promptCacheRetention: config.openAi.promptCacheRetention,
        replyProviderLimit: config.recommendation.replyProviderLimit,
        presentationProviderLimit: config.recommendation.presentationProviderLimit,
        providerDetailLookupLimit: config.recommendation.providerDetailLookupLimit,
        promptLoader,
        providerGateway,
        knowledgeBase: config.knowledgeBase,
      });
      const planStore = new DynamoPlanStore(config.storage.plansTableName, {
        region: config.aws.region,
      });
      const perfStore = config.performance.tableName
        ? new DynamoPerfStore(config.performance.tableName, {
            region: config.aws.region,
          })
        : new NoopPerfStore();

      return {
        service: new AgentService({
          planStore,
          runtime,
          providerGateway,
          promptLoader,
          renderers: {
            whatsapp: new WhatsAppMessageRenderer(),
            webchat: new WebChatMessageRenderer(),
            terminal_whatsapp: new WhatsAppMessageRenderer(),
          },
        }),
        perfStore,
      };
    })();
  }

  return runtimePromise;
}

function json(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body, null, 2),
  };
}
