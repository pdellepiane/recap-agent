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
    log({
      event: 'openai_stage_completed',
      stage: args.stage,
      model: args.model,
      timeout_ms: args.timeoutMs,
      duration_ms: Date.now() - startedAt,
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
