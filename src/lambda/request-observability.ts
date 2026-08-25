import crypto from 'node:crypto';

import type { RuntimeRequestRoute } from './request-route';
import type { InformationExecutionSummary } from '../core/information';
import type { OpenAiCallRef } from '../runtime/contracts';

export type ChannelRequestOutcome =
  | 'success'
  | 'unauthorized'
  | 'method_not_allowed'
  | 'missing_body'
  | 'invalid_json'
  | 'invalid_request'
  | 'route_not_found'
  | 'plan_not_found'
  | 'agent_participation_resumed'
  | 'agent_participation_unchanged'
  | 'conversation_overtaken'
  | 'conversation_overtake_unchanged'
  | 'internal_error';

export type ChannelRequestValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ChannelRequestLog = {
  event: 'channel_request_completed';
  request_id: string;
  method: string;
  request_path: string;
  request_route: RuntimeRequestRoute;
  request_body_present: boolean;
  status_code: number;
  outcome: ChannelRequestOutcome;
  duration_ms: number;
  authorization_header_present: boolean;
  bearer_token_present: boolean;
  bearer_token_sha256?: string;
  bearer_token_length?: number;
  accepted_bearer_key_count?: number;
  matched_bearer_key_index?: number | null;
  channel?: string;
  external_user_hash?: string;
  message_id_hash?: string;
  message_id_source?: 'native' | 'generated';
  media_count?: number;
  media_kinds?: string[];
  provider_media_id_hashes?: string[];
  ownership_request_id_hash?: string;
  ownership_operation?: 'overtake' | 'resume';
  participation_status?: 'resumed' | 'already_active' | 'overtaken' | 'already_overtaken';
  plan_id?: string;
  human_escalation_status?: 'none' | 'requested';
  feedback_signal_version?: number;
  decision_source?: 'deterministic' | 'model_assisted';
  ambiguity_status?: 'clear' | 'ambiguous';
  model_call_count?: number;
  output_quality_flag_count?: number;
  spanish_policy_term_hit_count?: number;
  validation_issues?: ChannelRequestValidationIssue[];
  delivery_action?: string;
  current_node?: string;
  trace_id?: string;
  authentication_path?: string;
  authentication_reason?: string;
  information_outcomes?: Array<Pick<
    InformationExecutionSummary,
    'kind' | 'status' | 'source' | 'outcomeCode' | 'retryable' | 'queryHash' | 'evidence' | 'resultCount' | 'durationMs'
  >>;
  openai_calls?: Record<'classifier' | 'extraction' | 'reply', {
    status: 'completed' | 'not_called';
    response_id: string | null;
    request_id: string | null;
    model: string | null;
    attempt_count: number;
  }>;
  error_name?: string;
  error_message_redacted?: string;
};

export function buildChannelRequestLog(args: {
  requestId: string;
  method: string;
  requestPath: string;
  requestRoute: RuntimeRequestRoute;
  requestBodyPresent: boolean;
  statusCode: number;
  outcome: ChannelRequestOutcome;
  durationMs: number;
  authorizationHeaderPresent: boolean;
  bearerTokenPresent: boolean;
  bearerToken?: string | null;
  acceptedBearerKeyCount?: number;
  matchedBearerKeyIndex?: number | null;
  channel?: string;
  externalUserId?: string;
  messageId?: string;
  messageIdSource?: 'native' | 'generated';
  mediaKinds?: string[];
  providerMediaIds?: string[];
  ownershipRequestId?: string;
  participationStatus?: 'resumed' | 'already_active' | 'overtaken' | 'already_overtaken';
  planId?: string;
  humanEscalationStatus?: 'none' | 'requested';
  feedbackSignalVersion?: number;
  decisionSource?: 'deterministic' | 'model_assisted';
  ambiguityStatus?: 'clear' | 'ambiguous' | null;
  modelCallCount?: number;
  outputQualityFlagCount?: number;
  spanishPolicyTermHitCount?: number;
  validationIssues?: ChannelRequestValidationIssue[];
  deliveryAction?: string;
  currentNode?: string;
  traceId?: string;
  authenticationExecution?: Array<{
    operation: string;
    status: string;
    auth_method: string | null;
    failure_kind: string | null;
  }>;
  informationOutcomes?: InformationExecutionSummary[];
  openAiCalls?: Record<'classifier' | 'extraction' | 'reply', OpenAiCallRef | null>;
  error?: unknown;
}): ChannelRequestLog {
  const error = describeError(args.error);
  return {
    event: 'channel_request_completed',
    request_id: args.requestId,
    method: args.method,
    request_path: redact(args.requestPath),
    request_route: args.requestRoute,
    request_body_present: args.requestBodyPresent,
    status_code: args.statusCode,
    outcome: args.outcome,
    duration_ms: Math.max(0, Math.round(args.durationMs)),
    authorization_header_present: args.authorizationHeaderPresent,
    bearer_token_present: args.bearerTokenPresent,
    ...(args.bearerToken
      ? {
          bearer_token_sha256: sha256(args.bearerToken),
          bearer_token_length: args.bearerToken.length,
        }
      : {}),
    ...(args.acceptedBearerKeyCount !== undefined
      ? { accepted_bearer_key_count: args.acceptedBearerKeyCount }
      : {}),
    ...(args.matchedBearerKeyIndex !== undefined
      ? { matched_bearer_key_index: args.matchedBearerKeyIndex }
      : {}),
    ...(args.channel ? { channel: args.channel } : {}),
    ...(args.externalUserId
      ? { external_user_hash: sha256(args.externalUserId) }
      : {}),
    ...(args.messageId ? { message_id_hash: sha256(args.messageId) } : {}),
    ...(args.messageIdSource ? { message_id_source: args.messageIdSource } : {}),
    ...(args.mediaKinds
      ? {
          media_count: args.mediaKinds.length,
          media_kinds: [...new Set(args.mediaKinds)],
        }
      : {}),
    ...(args.providerMediaIds && args.providerMediaIds.length > 0
      ? { provider_media_id_hashes: args.providerMediaIds.map(sha256) }
      : {}),
    ...(args.ownershipRequestId
      ? { ownership_request_id_hash: sha256(args.ownershipRequestId) }
      : {}),
    ...ownershipOperation(args.requestRoute),
    ...(args.participationStatus ? { participation_status: args.participationStatus } : {}),
    ...(args.planId ? { plan_id: args.planId } : {}),
    ...(args.humanEscalationStatus
      ? { human_escalation_status: args.humanEscalationStatus }
      : {}),
    ...(args.feedbackSignalVersion !== undefined
      ? { feedback_signal_version: args.feedbackSignalVersion }
      : {}),
    ...(args.decisionSource ? { decision_source: args.decisionSource } : {}),
    ...(args.ambiguityStatus ? { ambiguity_status: args.ambiguityStatus } : {}),
    ...(args.modelCallCount !== undefined ? { model_call_count: args.modelCallCount } : {}),
    ...(args.outputQualityFlagCount !== undefined
      ? { output_quality_flag_count: args.outputQualityFlagCount }
      : {}),
    ...(args.spanishPolicyTermHitCount !== undefined
      ? { spanish_policy_term_hit_count: args.spanishPolicyTermHitCount }
      : {}),
    ...(args.validationIssues && args.validationIssues.length > 0
      ? { validation_issues: args.validationIssues }
      : {}),
    ...(args.deliveryAction ? { delivery_action: args.deliveryAction } : {}),
    ...(args.currentNode ? { current_node: args.currentNode } : {}),
    ...(args.traceId ? { trace_id: args.traceId } : {}),
    ...describeAuthenticationPath(args.authenticationExecution),
    ...(args.informationOutcomes && args.informationOutcomes.length > 0
      ? {
          information_outcomes: args.informationOutcomes.map((summary) => ({
            kind: summary.kind,
            status: summary.status,
            source: summary.source,
            outcomeCode: summary.outcomeCode,
            retryable: summary.retryable,
            queryHash: summary.queryHash,
            evidence: summary.evidence,
            resultCount: summary.resultCount,
            durationMs: summary.durationMs,
          })),
        }
      : {}),
    ...(args.openAiCalls ? { openai_calls: summarizeOpenAiCalls(args.openAiCalls) } : {}),
    ...error,
  };
}

function describeAuthenticationPath(
  records: Array<{
    operation: string;
    status: string;
    auth_method: string | null;
    failure_kind: string | null;
  }> | undefined,
): Pick<ChannelRequestLog, 'authentication_path' | 'authentication_reason'> {
  if (!records || records.length === 0) return {};
  const phone = records.find((record) => record.operation === 'auth_by_phone');
  const email = records.find((record) => record.auth_method === 'email_otp');
  if (phone?.status === 'authenticated') {
    return { authentication_path: 'phone', authentication_reason: 'phone_authenticated' };
  }
  if (phone && email) {
    return {
      authentication_path: 'phone_to_email_otp',
      authentication_reason: phone.failure_kind ?? phone.status,
    };
  }
  if (phone) {
    return {
      authentication_path: 'phone',
      authentication_reason: phone.failure_kind ?? phone.status,
    };
  }
  return {
    authentication_path: 'email_otp',
    authentication_reason: email?.failure_kind ?? email?.status ?? 'email_otp',
  };
}

function summarizeOpenAiCalls(
  calls: Record<'classifier' | 'extraction' | 'reply', OpenAiCallRef | null>,
): NonNullable<ChannelRequestLog['openai_calls']> {
  return Object.fromEntries(
    (['classifier', 'extraction', 'reply'] as const).map((stage) => {
      const call = calls[stage];
      return [stage, call
        ? {
            status: 'completed' as const,
            response_id: call.responseId,
            request_id: call.requestId,
            model: call.model,
            attempt_count: call.attemptCount,
          }
        : {
            status: 'not_called' as const,
            response_id: null,
            request_id: null,
            model: null,
            attempt_count: 0,
          }];
    }),
  ) as NonNullable<ChannelRequestLog['openai_calls']>;
}

function ownershipOperation(
  route: RuntimeRequestRoute,
): Pick<ChannelRequestLog, 'ownership_operation'> {
  if (route === 'overtake_conversation') {
    return { ownership_operation: 'overtake' };
  }
  if (route === 'resume_automated_agent') {
    return { ownership_operation: 'resume' };
  }
  return {};
}

function describeError(error: unknown): Pick<
  ChannelRequestLog,
  'error_name' | 'error_message_redacted'
> {
  if (error === undefined) {
    return {};
  }
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message_redacted: redact(error.message),
    };
  }
  return {
    error_name: 'UnknownError',
    error_message_redacted: redact(describeUnknown(error)),
  };
}

function describeUnknown(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  try {
    return JSON.stringify(value) ?? 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

function redact(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replace(/\bhttps?:\/\/\S+/giu, '[url]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/gu, '[phone]')
    .slice(0, 240);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
