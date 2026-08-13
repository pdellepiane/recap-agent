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
import type { HandleTurnResponse } from '../runtime/agent-service';
import { AgentParticipationService } from '../runtime/agent-participation-service';
import { OpenAiMessageResponseClassifier } from '../runtime/message-response-classifier';
import {
  NoopKnowledgeRetrievalGateway,
  OpenAiKnowledgeRetrievalGateway,
} from '../runtime/knowledge-retrieval-gateway';
import { InformationOrchestrator } from '../runtime/information-orchestrator';
import { WhatsAppMessageRenderer, WebChatMessageRenderer } from '../runtime/message-renderer';
import { resolveChannelApiKeys, resolveOpenAiApiKey, resolveSeApiKey } from '../runtime/secrets';
import { buildTurnPerfRecord, toCliPerfSummary, type CliPerfSummary } from '../logs/trace/perf';
import { DynamoPerfStore } from '../storage/dynamo-perf-store';
import { NoopPerfStore, type PerfStore } from '../storage/perf-store';
import {
  projectSafePlan,
  projectSafeRecord,
  projectSafeTrace,
  redactArtifactText,
  type ArtifactJsonValue,
} from '../runtime/artifact-redaction';
import { bearerTokenMatchesAny, readBearerAuthorization } from './bearer-auth';
import {
  agentParticipationRequestSchema,
  channelRequestSchema,
} from './request-contract';
import {
  isRuntimeRequestMethodAllowed,
  resolveRuntimeRequestRoute,
} from './request-route';
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
let planStore: DynamoPlanStore | null = null;
let agentParticipationService: AgentParticipationService | null = null;

export async function handler(
  event: APIGatewayProxyEventV2,
  context?: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = Date.now();
  const requestId = context?.awsRequestId ?? event.requestContext.requestId;
  const method = event.requestContext.http.method;
  const route = resolveRuntimeRequestRoute(event.rawPath);
  const authorization = readBearerAuthorization(event.headers);
  let requestIdentity: {
    channel?: string;
    externalUserId?: string;
    messageId?: string;
    ownershipRequestId?: string;
    mediaKinds?: string[];
    providerMediaIds?: string[];
  } = {};
  const respond = (
    statusCode: number,
    body: unknown,
    outcome: ChannelRequestOutcome,
    diagnostics?: {
      validationIssues?: ChannelRequestValidationIssue[];
      deliveryAction?: string;
      currentNode?: string;
      traceId?: string;
      authenticationExecution?: HandleTurnResponse['trace']['authentication_execution_summary'];
      informationOutcomes?: HandleTurnResponse['trace']['information_execution_summary'];
      openAiCalls?: HandleTurnResponse['trace']['openai_calls'];
      participationStatus?: 'resumed' | 'already_active' | 'overtaken' | 'already_overtaken';
      planId?: string;
      humanEscalationStatus?: 'none' | 'requested';
      feedbackSignalVersion?: number;
      decisionSource?: 'deterministic' | 'model_assisted';
      ambiguityStatus?: 'clear' | 'ambiguous' | null;
      modelCallCount?: number;
      outputQualityFlagCount?: number;
      spanishPolicyTermHitCount?: number;
      error?: unknown;
      responseHeaders?: Record<string, string>;
    },
  ): APIGatewayProxyStructuredResultV2 => {
    const record = buildChannelRequestLog({
      requestId,
      method,
      requestPath: event.rawPath,
      requestRoute: route,
      requestBodyPresent: Boolean(event.body),
      statusCode,
      outcome,
      durationMs: Date.now() - startedAt,
      authorizationHeaderPresent: authorization.authorizationHeaderPresent,
      bearerTokenPresent: authorization.token !== null,
      channel: requestIdentity.channel,
      externalUserId: requestIdentity.externalUserId,
      messageId: requestIdentity.messageId,
      ownershipRequestId: requestIdentity.ownershipRequestId,
      mediaKinds: requestIdentity.mediaKinds,
      providerMediaIds: requestIdentity.providerMediaIds,
      participationStatus: diagnostics?.participationStatus,
      planId: diagnostics?.planId,
      humanEscalationStatus: diagnostics?.humanEscalationStatus,
      feedbackSignalVersion: diagnostics?.feedbackSignalVersion,
      decisionSource: diagnostics?.decisionSource,
      ambiguityStatus: diagnostics?.ambiguityStatus,
      modelCallCount: diagnostics?.modelCallCount,
      outputQualityFlagCount: diagnostics?.outputQualityFlagCount,
      spanishPolicyTermHitCount: diagnostics?.spanishPolicyTermHitCount,
      validationIssues: diagnostics?.validationIssues,
      deliveryAction: diagnostics?.deliveryAction,
      currentNode: diagnostics?.currentNode,
      traceId: diagnostics?.traceId,
      authenticationExecution: diagnostics?.authenticationExecution,
      informationOutcomes: diagnostics?.informationOutcomes,
      openAiCalls: diagnostics?.openAiCalls,
      error: diagnostics?.error,
    });
    if (statusCode >= 500) {
      console.error(record);
    } else {
      console.info(record);
    }
    return json(statusCode, body, {
      'x-recap-request-id': requestId,
      ...diagnostics?.responseHeaders,
    });
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

    if (route === 'not_found') {
      return respond(404, { error: 'Not found.' }, 'route_not_found');
    }

    if (!isRuntimeRequestMethodAllowed(method)) {
      return respond(405, { error: 'Method not allowed.' }, 'method_not_allowed', {
        responseHeaders: {
          allow: 'POST',
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
    if (route !== 'message') {
      const parsedOperation = agentParticipationRequestSchema.safeParse(rawBody);
      if (!parsedOperation.success) {
        const validationIssues = parsedOperation.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        }));
        return respond(400, {
          error: 'Invalid conversation ownership request.',
          issues: validationIssues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        }, 'invalid_request', { validationIssues });
      }

      const controlRequest = parsedOperation.data;
      requestIdentity = {
        channel: controlRequest.channel,
        externalUserId: controlRequest.user_id,
        ownershipRequestId: controlRequest.request_id,
      };
      const result = route === 'resume_automated_agent'
        ? await getAgentParticipationService().resumeAutomatedAgent({
            channel: controlRequest.channel,
            externalUserId: controlRequest.user_id,
          })
        : await getAgentParticipationService().overtakeConversation({
            channel: controlRequest.channel,
            externalUserId: controlRequest.user_id,
            requestedAt: controlRequest.requested_at,
          });
      if (result.status === 'plan_not_found') {
        return respond(404, {
          status: result.status,
        }, 'plan_not_found');
      }
      return respond(200, {
        status: result.status,
        plan_id: result.plan.plan_id,
        current_node: result.plan.current_node,
      }, participationOutcome(result.status), {
        currentNode: result.plan.current_node,
        participationStatus: result.status,
        planId: result.plan.plan_id,
        humanEscalationStatus: result.plan.human_escalation.status,
      });
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
      mediaKinds: body.media.map((item) => item.type),
      providerMediaIds: body.media.map((item) => item.id),
    };

    const runtime = await getRuntime();

    const receivedAt = body.received_at ?? new Date().toISOString();
    const media = body.media.map((item) => ({
      kind: item.type,
      providerMediaId: item.id,
      mimeType: item.mime_type,
      sha256: item.sha256,
      fileName: item.filename ?? null,
    }));
    const response = await runtime.service.handleTurn({
      channel,
      externalUserId: body.user_id,
      text: body.text,
      messageId,
      receivedAt,
      media,
      sessionId: body.session_id ?? null,
      contactPhone: body.contact_phone ?? null,
    });
    const perfRecord = buildTurnPerfRecord({
      trace: response.trace,
      channel,
      externalUserId: body.user_id,
      messageId,
      userMessage: body.text,
      media,
      receivedAt,
      sessionId: body.session_id ?? null,
      contactPhonePresent: body.contact_phone !== null && body.contact_phone !== undefined,
      deliveryAction: response.outbound.delivery.action,
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

    return respond(200, buildCliResponseBody({
      response,
      perf,
      includeDiagnostics,
    }), 'success', {
      deliveryAction: response.outbound.delivery.action,
      currentNode: response.plan.current_node,
      traceId: response.trace.trace_id,
      authenticationExecution: response.trace.authentication_execution_summary,
      informationOutcomes: response.trace.information_execution_summary,
      openAiCalls: response.trace.openai_calls,
      feedbackSignalVersion: perfRecord.feedback_signals.schema_version,
      decisionSource: perfRecord.feedback_signals.routing.decision_source,
      ambiguityStatus: perfRecord.feedback_signals.routing.ambiguity_status,
      modelCallCount: perfRecord.feedback_signals.execution.model_call_count,
      outputQualityFlagCount: perfRecord.feedback_signals.output.quality_flags.length,
      spanishPolicyTermHitCount:
        perfRecord.feedback_signals.output.spanish_policy_term_hits.length,
    });
  } catch (error) {
    return respond(500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    }, 'internal_error', { error });
  }
}

export function buildCliResponseBody(args: {
  response: HandleTurnResponse;
  perf: CliPerfSummary | null | undefined;
  includeDiagnostics: boolean;
}): Record<string, ArtifactJsonValue> {
  const body = {
    message: args.response.outbound.text,
    delivery: args.response.outbound.delivery,
    conversation_id: args.response.outbound.conversationId,
    plan_id: args.response.plan.plan_id,
    current_node: args.response.plan.current_node,
    trace_id: args.response.trace.trace_id,
  };
  if (!args.includeDiagnostics) {
    return body;
  }

  return {
    ...body,
    message: redactArtifactText(args.response.outbound.text ?? ''),
    trace: projectSafeTrace(args.response.trace),
    perf: args.perf === null || args.perf === undefined
      ? null
      : projectSafeRecord(args.perf),
    plan: projectSafePlan(args.response.plan),
  };
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
              timeoutMs: config.openAi.timeoutsMs.retrieval,
            })
          : null;
      const providerGateway = new SinEnvolturasGateway({
        baseUrl: config.providerApi.baseUrl,
        guestServiceBaseUrl: config.providerApi.guestServiceBaseUrl,
        userAuthBaseUrl: config.providerApi.userAuthBaseUrl,
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
      const knowledgeGateway =
        config.knowledgeBase.enabled && config.knowledgeBase.vectorStoreId
          ? new OpenAiKnowledgeRetrievalGateway({
              apiKey,
              vectorStoreId: config.knowledgeBase.vectorStoreId,
              maxResults: config.knowledgeBase.maxResults,
              scoreThreshold: config.knowledgeBase.scoreThreshold,
              timeoutMs: config.openAi.timeoutsMs.retrieval,
            })
          : new NoopKnowledgeRetrievalGateway();
      const informationOrchestrator = new InformationOrchestrator({
        knowledgeGateway,
        providerGateway,
        agentGateway: agentConversationGateway,
      });
      const runtime = new OpenAiAgentRuntime({
        apiKey,
        replyModel: config.openAi.models.reply,
        extractorModel: config.openAi.models.extractor,
        extractorTimeoutMs: config.openAi.timeoutsMs.extractor,
        replyTimeoutMs: config.openAi.timeoutsMs.reply,
        replyProviderLimit: config.recommendation.replyProviderLimit,
        presentationProviderLimit: config.recommendation.presentationProviderLimit,
        providerDetailLookupLimit: config.recommendation.providerDetailLookupLimit,
        promptLoader,
        providerGateway,
        features: config.features,
      });
      const responseClassifier = new OpenAiMessageResponseClassifier({
        apiKey,
        model: config.openAi.models.responseClassifier,
        mode: config.responseClassifier.mode,
        promptLoader,
        timeoutMs: config.openAi.timeoutsMs.responseClassifier,
      });
      const runtimePlanStore = getPlanStore();
      const perfStore = config.performance.tableName
        ? new DynamoPerfStore(config.performance.tableName, {
            region: config.aws.region,
          })
        : new NoopPerfStore();

      return {
        service: new AgentService({
          planStore: runtimePlanStore,
          runtime,
          providerGateway,
          agentConversationGateway,
          informationOrchestrator,
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

function getPlanStore(): DynamoPlanStore {
  if (!planStore) {
    planStore = new DynamoPlanStore(config.storage.plansTableName, {
      region: config.aws.region,
    });
  }
  return planStore;
}

function getAgentParticipationService(): AgentParticipationService {
  if (!agentParticipationService) {
    agentParticipationService = new AgentParticipationService(getPlanStore());
  }
  return agentParticipationService;
}

function participationOutcome(
  status: 'resumed' | 'already_active' | 'overtaken' | 'already_overtaken',
): ChannelRequestOutcome {
  switch (status) {
    case 'resumed':
      return 'agent_participation_resumed';
    case 'already_active':
      return 'agent_participation_unchanged';
    case 'overtaken':
      return 'conversation_overtaken';
    case 'already_overtaken':
      return 'conversation_overtake_unchanged';
  }
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
