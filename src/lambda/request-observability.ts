import crypto from 'node:crypto';

import type { RuntimeRequestRoute } from './request-route';

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
  channel?: string;
  external_user_hash?: string;
  message_id_hash?: string;
  ownership_request_id_hash?: string;
  ownership_operation?: 'overtake' | 'resume';
  participation_status?: 'resumed' | 'already_active' | 'overtaken' | 'already_overtaken';
  plan_id?: string;
  human_escalation_status?: 'none' | 'requested';
  validation_issues?: ChannelRequestValidationIssue[];
  delivery_action?: string;
  current_node?: string;
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
  channel?: string;
  externalUserId?: string;
  messageId?: string;
  ownershipRequestId?: string;
  participationStatus?: 'resumed' | 'already_active' | 'overtaken' | 'already_overtaken';
  planId?: string;
  humanEscalationStatus?: 'none' | 'requested';
  validationIssues?: ChannelRequestValidationIssue[];
  deliveryAction?: string;
  currentNode?: string;
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
    ...(args.channel ? { channel: args.channel } : {}),
    ...(args.externalUserId
      ? { external_user_hash: sha256(args.externalUserId) }
      : {}),
    ...(args.messageId ? { message_id_hash: sha256(args.messageId) } : {}),
    ...(args.ownershipRequestId
      ? { ownership_request_id_hash: sha256(args.ownershipRequestId) }
      : {}),
    ...ownershipOperation(args.requestRoute),
    ...(args.participationStatus ? { participation_status: args.participationStatus } : {}),
    ...(args.planId ? { plan_id: args.planId } : {}),
    ...(args.humanEscalationStatus
      ? { human_escalation_status: args.humanEscalationStatus }
      : {}),
    ...(args.validationIssues && args.validationIssues.length > 0
      ? { validation_issues: args.validationIssues }
      : {}),
    ...(args.deliveryAction ? { delivery_action: args.deliveryAction } : {}),
    ...(args.currentNode ? { current_node: args.currentNode } : {}),
    ...error,
  };
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
