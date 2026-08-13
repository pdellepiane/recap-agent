export type OpenAiStage =
  | 'classifier'
  | 'extraction'
  | 'reply'
  | 'knowledge_retrieval'
  | 'provider_vector_search';

export type OpenAiStageLog = {
  event: 'openai_stage_started' | 'openai_stage_completed' | 'openai_stage_failed';
  stage: OpenAiStage;
  model: string;
  timeout_ms: number;
  duration_ms?: number;
  error_name?: string;
  error_message?: string;
  response_id?: string;
  request_id?: string;
  attempt_count?: number;
};

export async function executeOpenAiStage<T>(args: {
  stage: OpenAiStage;
  model: string;
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
  log?: (record: OpenAiStageLog) => void;
}): Promise<T> {
  const startedAt = Date.now();
  const log = args.log ?? defaultLog;
  log({
    event: 'openai_stage_started',
    stage: args.stage,
    model: args.model,
    timeout_ms: args.timeoutMs,
  });

  try {
    const value = await args.operation(AbortSignal.timeout(args.timeoutMs));
    const identifiers = extractResponseIdentifiers(value);
    log({
      event: 'openai_stage_completed',
      stage: args.stage,
      model: args.model,
      timeout_ms: args.timeoutMs,
      duration_ms: Date.now() - startedAt,
      ...identifiers,
    });
    return value;
  } catch (error) {
    log({
      event: 'openai_stage_failed',
      stage: args.stage,
      model: args.model,
      timeout_ms: args.timeoutMs,
      duration_ms: Date.now() - startedAt,
      error_name: error instanceof Error ? error.name : 'UnknownError',
      error_message: safeErrorMessage(error),
    });
    throw error;
  }
}

function extractResponseIdentifiers(value: unknown): Pick<
  OpenAiStageLog,
  'response_id' | 'request_id' | 'attempt_count'
> {
  if (!value || typeof value !== 'object') return {};
  const root = value as Record<string, unknown>;
  const responseId = readString(root, ['id', 'lastResponseId'])
    ?? readLastRawResponseString(root, ['responseId', 'id']);
  const requestId = readString(root, ['_request_id', 'requestId'])
    ?? readLastRawResponseString(root, ['requestId', '_request_id']);
  const state = asRecord(root.state);
  const usage = asRecord(state?.usage);
  const attempts = typeof usage?.requests === 'number' ? usage.requests : null;
  return {
    ...(responseId ? { response_id: responseId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(attempts !== null ? { attempt_count: Math.max(1, attempts) } : {}),
  };
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key];
  }
  return null;
}

function readLastRawResponseString(
  root: Record<string, unknown>,
  keys: string[],
): string | null {
  const state = asRecord(root.state);
  const responses = Array.isArray(root.rawResponses)
    ? root.rawResponses
    : Array.isArray(state?.rawResponses)
      ? state.rawResponses
      : [];
  const last = asRecord(responses.at(-1));
  return last ? readString(last, keys) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function defaultLog(record: OpenAiStageLog): void {
  if (record.event === 'openai_stage_failed') {
    console.error(record);
    return;
  }
  console.info(record);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{20,}/gu, '[redacted]').slice(0, 240);
}
