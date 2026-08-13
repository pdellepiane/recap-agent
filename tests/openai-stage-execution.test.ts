import { describe, expect, it } from 'vitest';

import {
  executeOpenAiStage,
  type OpenAiStageLog,
} from '../src/runtime/openai-stage-execution';

describe('executeOpenAiStage', () => {
  it('records bounded stage completion without payload content', async () => {
    const records: OpenAiStageLog[] = [];

    const result = await executeOpenAiStage({
      stage: 'extraction',
      model: 'gpt-5.6-luna',
      timeoutMs: 1_000,
      operation: async (signal) => {
        expect(signal.aborted).toBe(false);
        return 'ok';
      },
      log: (record) => records.push(record),
    });

    expect(result).toBe('ok');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      event: 'openai_stage_started',
      stage: 'extraction',
      model: 'gpt-5.6-luna',
      timeout_ms: 1_000,
    });
    expect(records[1]).toMatchObject({
      event: 'openai_stage_completed',
      stage: 'extraction',
      model: 'gpt-5.6-luna',
      timeout_ms: 1_000,
    });
    expect(records[1]).not.toHaveProperty('input');
  });

  it('aborts a hung stage and records a sanitized failure', async () => {
    const records: OpenAiStageLog[] = [];
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';

    await expect(executeOpenAiStage({
      stage: 'reply',
      model: 'gpt-5.6-luna',
      timeoutMs: 5,
      operation: async (signal) => await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error(`timeout ${secret}`)), {
          once: true,
        });
      }),
      log: (record) => records.push(record),
    })).rejects.toThrow('timeout');

    expect(records.at(-1)).toMatchObject({
      event: 'openai_stage_failed',
      stage: 'reply',
      error_name: 'Error',
    });
    expect(records.at(-1)?.error_message).not.toContain(secret);
  });

  it('records OpenAI response correlation on successful calls', async () => {
    const records: OpenAiStageLog[] = [];

    await executeOpenAiStage({
      stage: 'classifier',
      model: 'gpt-5.6-luna',
      timeoutMs: 1_000,
      operation: async () => ({
        id: 'resp_test',
        _request_id: 'req_test',
      }),
      log: (record) => records.push(record),
    });

    expect(records.at(-1)).toMatchObject({
      event: 'openai_stage_completed',
      response_id: 'resp_test',
      request_id: 'req_test',
    });
  });
});
