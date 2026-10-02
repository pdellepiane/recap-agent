import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConfig } from '../src/runtime/config';
import {
  DEFAULT_PROMPT_CACHE_OPTIONS,
} from '../src/runtime/openai-model-defaults';

describe('OpenAI model defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Default role mapping and model pins live in
  // tests/owner-c-decision-4-model-deployment.test.ts ('targets gpt-6-luna
  // for the application and the default judge' plus 'resolves reply,
  // extractor, and classifier models independently'), which assert the same
  // defaults with literal values and override coverage.

  it('locks implicit GPT-5.6 caching and removes the legacy deployment parameter', () => {
    expect(DEFAULT_PROMPT_CACHE_OPTIONS).toEqual({ mode: 'implicit', ttl: '30m' });
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'infra/cloudformation/stack.yaml'),
      'utf8',
    );
    expect(template).not.toContain('OpenAIPromptCacheRetention');
    expect(template).not.toContain('OPENAI_PROMPT_CACHE_RETENTION');
  });

  it('keeps every OpenAI runtime stage below the Lambda timeout', () => {
    delete process.env.OPENAI_RESPONSE_CLASSIFIER_TIMEOUT_MS;
    delete process.env.OPENAI_EXTRACTOR_TIMEOUT_MS;
    delete process.env.OPENAI_REPLY_TIMEOUT_MS;
    delete process.env.OPENAI_RETRIEVAL_TIMEOUT_MS;

    expect(getConfig().openAi.timeoutsMs).toEqual({
      responseClassifier: 16_000,
      extractor: 35_000,
      reply: 22_000,
      retrieval: 8_000,
    });

    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'infra/cloudformation/stack.yaml'),
      'utf8',
    );
    expect(template).toContain('OPENAI_RESPONSE_CLASSIFIER_TIMEOUT_MS');
    expect(template).toContain('OPENAI_EXTRACTOR_TIMEOUT_MS');
    expect(template).toContain('OPENAI_REPLY_TIMEOUT_MS');
    expect(template).toContain('OPENAI_RETRIEVAL_TIMEOUT_MS');
  });
});
