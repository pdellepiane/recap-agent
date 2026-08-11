import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import {
  evaluateSemanticJudgeOutcome,
  runSemanticJudge,
} from '../src/evals/scorers/semantic-judge';

describe('semantic judge expectation policy', () => {
  it('fails closed when a mandatory live judge is skipped', () => {
    expect(
      evaluateSemanticJudgeOutcome({
        outcome: {
          skipped: true,
          score: 0,
          message: 'Missing evaluator credentials.',
        },
        minScore: 0.85,
        requireJudge: true,
      }),
    ).toEqual({ passed: false, score: 0 });
  });

  it('preserves optional semantic checks for offline development', () => {
    expect(
      evaluateSemanticJudgeOutcome({
        outcome: {
          skipped: true,
          score: 0,
          message: 'Missing evaluator credentials.',
        },
        minScore: 0.85,
        requireJudge: false,
      }),
    ).toEqual({ passed: true, score: 1 });
  });

  it('applies the configured threshold when the judge runs', () => {
    expect(
      evaluateSemanticJudgeOutcome({
        outcome: {
          skipped: false,
          score: 0.84,
          message: 'A required behavior was missing.',
        },
        minScore: 0.85,
        requireJudge: true,
      }),
    ).toEqual({ passed: false, score: 0.84 });
  });

  it('uses a GPT-5.6-compatible request without temperature', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"score":1,"reason":"Cumple."}' } }],
    });
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;

    await expect(
      runSemanticJudge({
        apiKey: 'test-key',
        model: 'gpt-5.6-luna',
        rubric: 'La respuesta debe estar en español.',
        candidateText: '¿En qué distrito será el evento?',
        context: '{"eventType":"boda","location":"Lima"}',
        client,
      }),
    ).resolves.toMatchObject({ skipped: false, score: 1 });

    const calls = create.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]).not.toHaveProperty('temperature');
    const request = calls[0]?.[0];
    expect(JSON.stringify(request)).toContain('Interaction context');
    expect(JSON.stringify(request)).toContain('\\"location\\":\\"Lima\\"');
  });

  it('receives an explicit safe context without re-redacting structural values', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"score":1,"reason":"Seguro."}' } }],
    });
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const conversationHash = 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567';
    const safeContext = JSON.stringify({
      conversation_hash: conversationHash,
      auth_evidence: {
        status: 'authenticated',
        auth_method: 'phone',
        contact_fields_present: { email: true, phone: true },
      },
    });

    await runSemanticJudge({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      rubric: 'Evalúa la respuesta sin exponer secretos.',
      candidateText: 'La respuesta confirma el siguiente paso.',
      context: safeContext,
      client,
    });

    const serializedRequest = JSON.stringify(create.mock.calls[0]);
    expect(serializedRequest).toContain(conversationHash);
    expect(serializedRequest).toContain('auth_evidence');
  });
});
