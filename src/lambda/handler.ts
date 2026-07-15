import crypto from 'node:crypto';

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';

import { PromptLoader } from '../runtime/prompt-loader';
import { getConfig } from '../runtime/config';
import { DynamoPlanStore } from '../storage/dynamo-plan-store';
import { OpenAiAgentRuntime } from '../runtime/openai-agent-runtime';
import { SinEnvolturasGateway } from '../runtime/sinenvolturas-gateway';
import {
  HttpAgentConversationGateway,
} from '../runtime/agent-conversation-gateway';
import { ProviderVectorSearchGateway } from '../runtime/provider-vector-search';
import { AgentService } from '../runtime/agent-service';
import { OpenAiMessageResponseClassifier } from '../runtime/message-response-classifier';
import { WhatsAppMessageRenderer, WebChatMessageRenderer } from '../runtime/message-renderer';
import { resolveChannelApiKeys, resolveOpenAiApiKey, resolveSeApiKey } from '../runtime/secrets';
import { buildTurnPerfRecord, toCliPerfSummary, type CliPerfSummary } from '../logs/trace/perf';
import { DynamoPerfStore } from '../storage/dynamo-perf-store';
import { NoopPerfStore, type PerfStore } from '../storage/perf-store';
import { bearerTokenMatchesAny, readBearerAuthorization } from './bearer-auth';
import { channelRequestSchema } from './request-contract';
import {
  buildChannelRequestLog,
  type ChannelRequestOutcome,
  type ChannelRequestValidationIssue,
} from './request-observability';

const config = getConfig();

let runtimePromise: Promise<{
  service: AgentService;
  perfStore: PerfStore;
}> | null = null;
let channelApiKeysPromise: Promise<string[]> | null = null;

export async function handler(
  event: APIGatewayProxyEventV2,
  context?: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = Date.now();
  const requestId = context?.awsRequestId ?? event.requestContext.requestId;
  const method = event.requestContext.http.method;
  const authorization = readBearerAuthorization(event.headers);
  let requestIdentity: {
    channel?: string;
    externalUserId?: string;
    messageId?: string;
  } = {};
  const respond = (
    statusCode: number,
    body: unknown,
    outcome: ChannelRequestOutcome,
    diagnostics?: {
      validationIssues?: ChannelRequestValidationIssue[];
      deliveryAction?: string;
      currentNode?: string;
      error?: unknown;
      responseHeaders?: Record<string, string>;
    },
  ): APIGatewayProxyStructuredResultV2 => {
    const record = buildChannelRequestLog({
      requestId,
      method,
      statusCode,
      outcome,
      durationMs: Date.now() - startedAt,
      authorizationHeaderPresent: authorization.authorizationHeaderPresent,
      bearerTokenPresent: authorization.token !== null,
      channel: requestIdentity.channel,
      externalUserId: requestIdentity.externalUserId,
      messageId: requestIdentity.messageId,
      validationIssues: diagnostics?.validationIssues,
      deliveryAction: diagnostics?.deliveryAction,
      currentNode: diagnostics?.currentNode,
      error: diagnostics?.error,
    });
    if (statusCode >= 500) {
      console.error(record);
    } else {
      console.info(record);
    }
    return json(statusCode, body, diagnostics?.responseHeaders);
  };

  try {
    const expectedApiKeys = await getChannelApiKeys();
    if (!bearerTokenMatchesAny(authorization.token, expectedApiKeys)) {
      return respond(401, { error: 'Unauthorized.' }, 'unauthorized', {
        responseHeaders: {
          'www-authenticate': 'Bearer realm="recap-agent"',
        },
      });
    }

    if (!event.body) {
      return respond(400, { error: 'Missing request body.' }, 'missing_body');
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(event.body) as unknown;
    } catch {
      return respond(400, { error: 'Request body must be valid JSON.' }, 'invalid_json');
    }
    const parsedBody = channelRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      const validationIssues = parsedBody.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      }));
      return respond(400, {
        error: 'Invalid request body.',
        issues: validationIssues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      }, 'invalid_request', { validationIssues });
    }
    const body = parsedBody.data;
    const channel = body.channel;
    const messageId = body.message_id ?? crypto.randomUUID();
    requestIdentity = {
      channel,
      externalUserId: body.user_id,
      messageId,
    };

    const runtime = await getRuntime();

    const receivedAt = body.received_at ?? new Date().toISOString();
    const response = await runtime.service.handleTurn({
      channel,
      externalUserId: body.user_id,
      text: body.text,
      messageId,
      receivedAt,
      sessionId: body.session_id ?? null,
      contactPhone: body.contact_phone ?? null,
    });
    const perfRecord = buildTurnPerfRecord({
      trace: response.trace,
      channel,
      externalUserId: body.user_id,
      messageId,
      userMessage: body.text,
      assistantMessage: response.outbound.text,
      includeAssistantMessagePreview: config.performance.captureAssistantPreview,
      structuredMessageKind: response.outbound.structuredMessageKind,
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

    return respond(200, {
      message: response.outbound.text,
      delivery: response.outbound.delivery,
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
    }, 'success', {
      deliveryAction: response.outbound.delivery.action,
      currentNode: response.plan.current_node,
    });
  } catch (error) {
    return respond(500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    }, 'internal_error', { error });
  }
}

async function getChannelApiKeys(): Promise<string[]> {
  if (!channelApiKeysPromise) {
    channelApiKeysPromise = resolveChannelApiKeys({
      directApiKey: config.channelAuth.apiKey,
      secretId: config.channelAuth.secretId,
      region: config.aws.region,
    });
  }
  return channelApiKeysPromise;
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
      const seApiKey = await resolveSeApiKey({
        secretId: config.agentApi.secretId,
        region: config.aws.region,
      });

      const promptLoader = new PromptLoader(config.prompts.dir);
      const providerVectorSearchGateway =
        config.providerApi.searchMode !== 'api' && config.providerApi.vectorStoreId
          ? new ProviderVectorSearchGateway({
              apiKey,
              vectorStoreId: config.providerApi.vectorStoreId,
              maxResults: config.providerApi.vectorMaxResults,
              scoreThreshold: config.providerApi.vectorScoreThreshold,
            })
          : null;
      const providerGateway = new SinEnvolturasGateway({
        baseUrl: config.providerApi.baseUrl,
        guestServiceBaseUrl: config.providerApi.guestServiceBaseUrl,
        guestAuthBaseUrl: config.providerApi.guestAuthBaseUrl,
        persistedSearchLimit: config.providerApi.persistedSearchLimit,
        summarySearchWordLimit: config.providerApi.summarySearchWordLimit,
        searchMode: config.providerApi.searchMode,
        vectorSearchGateway: providerVectorSearchGateway,
      });
      const agentConversationGateway = new HttpAgentConversationGateway({
        baseUrl: config.agentApi.baseUrl,
        apiKey: seApiKey,
        timeoutMs: config.agentApi.timeoutMs,
        maxRetries: config.agentApi.maxRetries,
        messageLoggingEnabled: config.agentApi.messageLoggingEnabled,
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
        features: config.features,
      });
      const responseClassifier = new OpenAiMessageResponseClassifier({
        apiKey,
        model: config.openAi.models.responseClassifier,
        mode: config.responseClassifier.mode,
        promptLoader,
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
          agentConversationGateway,
          responseClassifier,
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
  headers?: Record<string, string>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body, null, 2),
  };
}
