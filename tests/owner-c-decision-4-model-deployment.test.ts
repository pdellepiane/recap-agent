import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { getFrozenBaselineIdentity } from '../src/evals/runner';
import { resolveModelIdentity } from '../src/evals/run-manifest';
import { getConfig } from '../src/runtime/config';
import { OpenAiMessageResponseClassifier } from '../src/runtime/message-response-classifier';
import {
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_GPT_TEXT_MODEL,
} from '../src/runtime/openai-model-defaults';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  PRODUCTION_MODEL_PARAMETERS,
  resolveProductionModelParams,
  verifyProductionModelDeployment,
} from '../scripts/prod-model-promotion.mjs';

const promptLoader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

function buildSettingsFor(model: string): Record<string, unknown> {
  const runtime = new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: model,
    extractorModel: model,
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: {} as never,
    providerGateway: {} as never,
  });
  return (
    runtime as unknown as {
      buildModelSettings: (args: { model: string; cacheKey: string }) => Record<string, unknown>;
    }
  ).buildModelSettings({ model, cacheKey: 'owner-c:test' });
}

function classifierResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_owner_c',
      output: [
        {
          content: [
            {
              text: JSON.stringify({
                action: 'respond',
                reason: 'requires_response',
                conversation_health: 'progressing',
                health_reason: 'normal_progress',
                human_help_response: 'not_applicable',
                automation_confidence: 'not_automated',
                automation_pattern: 'none',
                automation_scope: 'none_or_uncertain',
                campaign_reply_kind: 'not_applicable',
              }),
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('Owner C decision 4 model/deployment contracts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('targets gpt-6-luna for the application and pins the first comparison judge to gpt-5.6-luna', () => {
    expect(DEFAULT_GPT_TEXT_MODEL).toBe('gpt-6-luna');
    expect(DEFAULT_EVAL_JUDGE_MODEL).toBe('gpt-5.6-luna');
    expect(DEFAULT_EVAL_JUDGE_MODEL).not.toBe(DEFAULT_GPT_TEXT_MODEL);
  });

  it('resolves reply, extractor, and classifier models independently', () => {
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_EXTRACTOR_MODEL;
    delete process.env.OPENAI_RESPONSE_CLASSIFIER_MODEL;
    expect(getConfig().openAi.models).toEqual({
      reply: 'gpt-6-luna',
      extractor: 'gpt-6-luna',
      responseClassifier: 'gpt-6-luna',
    });

    vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
    vi.stubEnv('OPENAI_EXTRACTOR_MODEL', 'gpt-6-luna-custom');
    vi.stubEnv('OPENAI_RESPONSE_CLASSIFIER_MODEL', 'gpt-5.6-luna');
    expect(getConfig().openAi.models).toEqual({
      reply: 'gpt-6-luna',
      extractor: 'gpt-6-luna-custom',
      responseClassifier: 'gpt-5.6-luna',
    });

    vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna-override');
    expect(getConfig().openAi.models.reply).toBe('gpt-6-luna-override');
    expect(getConfig().openAi.models.extractor).toBe('gpt-6-luna-custom');
    expect(getConfig().openAi.models.responseClassifier).toBe('gpt-5.6-luna');
  });

  it('wires each configured model to its own runtime stage', () => {
    const handler = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lambda/handler.ts'),
      'utf8',
    );
    expect(handler).toContain('replyModel: config.openAi.models.reply');
    expect(handler).toContain('extractorModel: config.openAi.models.extractor');
    expect(handler).toContain('model: config.openAi.models.responseClassifier');
  });

  it('keeps low reasoning and low verbosity for gpt-6-luna extractor and reply settings', () => {
    expect(buildSettingsFor('gpt-6-luna')).toMatchObject({
      promptCacheOptions: { mode: 'implicit', ttl: '30m' },
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      store: true,
    });
  });

  it('preserves low reasoning for the gpt-5 family without touching unknown families', () => {
    expect(buildSettingsFor('gpt-5.6-luna')).toMatchObject({
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
    });
    const unknown = buildSettingsFor('some-future-model');
    expect(unknown).not.toHaveProperty('reasoning');
    expect(unknown).not.toHaveProperty('text');
    expect(unknown).toMatchObject({ store: true });
  });

  it('sends low reasoning for the gpt-6-luna classifier call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(classifierResponse());
    vi.stubGlobal('fetch', fetchMock);
    const classifier = new OpenAiMessageResponseClassifier({
      apiKey: 'test-key',
      model: 'gpt-6-luna',
      mode: 'observe',
      promptLoader,
    });
    await classifier.classify({
      inboundText: 'hola',
      plan: createEmptyPlan({
        planId: 'owner-c-classifier',
        channel: 'terminal_whatsapp',
        externalUserId: '51900000000',
      }),
      messages: [],
      contextSource: 'agent_api',
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    const request = JSON.parse(String(calls[0]?.[1]?.body)) as {
      model: string;
      reasoning: { effort: string };
      text: { verbosity: string };
    };
    expect(request.model).toBe('gpt-6-luna');
    expect(request.reasoning.effort).toBe('low');
    expect(request.text.verbosity).toBe('low');
  });

  it('records candidate and judge identities separately in the run manifest', () => {
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_EXTRACTOR_MODEL;
    delete process.env.OPENAI_RESPONSE_CLASSIFIER_MODEL;
    const models = resolveModelIdentity([]);
    expect(models.reply).toBe('gpt-6-luna');
    expect(models.extractor).toBe('gpt-6-luna');
    expect(models.classifier).toBe('gpt-6-luna');
    expect(models.judgeModels).toEqual(['gpt-5.6-luna']);
  });

  it('defaults all three CloudFormation model parameters to gpt-6-luna', () => {
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'infra/cloudformation/stack.yaml'),
      'utf8',
    );
    for (const parameter of ['OpenAIModel', 'OpenAIExtractorModel', 'OpenAIResponseClassifierModel']) {
      expect(template).toContain(`${parameter}:\n    Type: String\n    Default: gpt-6-luna`);
    }
    expect(template).not.toContain('Default: gpt-5.6-luna');
  });

  it('defaults all three development deployment model settings to gpt-6-luna', () => {
    const deploy = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/deploy.mjs'),
      'utf8',
    );
    expect(deploy).toContain(
      "OpenAIModel=${getDeploymentSetting('OPENAI_MODEL', 'OpenAIModel', 'gpt-6-luna')}",
    );
    expect(deploy).toContain(
      "OpenAIExtractorModel=${getDeploymentSetting('OPENAI_EXTRACTOR_MODEL', 'OpenAIExtractorModel', 'gpt-6-luna')}",
    );
    expect(deploy).toContain(
      "OpenAIResponseClassifierModel=${getDeploymentSetting('OPENAI_RESPONSE_CLASSIFIER_MODEL', 'OpenAIResponseClassifierModel', 'gpt-6-luna')}",
    );
  });

  it('promotes exactly the three model parameters on production with fail-closed verification', () => {
    const deploy = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/deploy.mjs'),
      'utf8',
    );
    expect(deploy).toContain('resolveProductionModelParams');
    expect(deploy).toContain('verifyProductionModelDeployment');
    expect(deploy).toContain('getLambdaConfiguration');
    expect(PRODUCTION_MODEL_PARAMETERS.map((entry) => entry.parameterKey)).toEqual([
      'OpenAIModel',
      'OpenAIExtractorModel',
      'OpenAIResponseClassifierModel',
    ]);
  });

  it('resolves production model params only with explicit parity to development', () => {
    const developmentStack = {
      OpenAIModel: 'gpt-6-luna',
      OpenAIExtractorModel: 'gpt-6-luna',
      OpenAIResponseClassifierModel: 'gpt-6-luna',
    };
    const productionStack = {
      CodeS3Key: 'lambda/old.zip',
      OpenAIModel: 'gpt-5.6-luna',
      OpenAIExtractorModel: 'gpt-5.6-luna',
      OpenAIResponseClassifierModel: 'gpt-5.6-luna',
    };
    const resolved = resolveProductionModelParams({
      env: {
        OPENAI_MODEL: 'gpt-6-luna',
        OPENAI_EXTRACTOR_MODEL: 'gpt-6-luna',
        OPENAI_RESPONSE_CLASSIFIER_MODEL: 'gpt-6-luna',
      },
      developmentStack,
      productionStack,
      developmentStackName: 'recap-agent-runtime-dev',
    });
    expect(resolved.overrides).toEqual([
      'OpenAIModel=gpt-6-luna',
      'OpenAIExtractorModel=gpt-6-luna',
      'OpenAIResponseClassifierModel=gpt-6-luna',
    ]);
    expect(resolved.rollback).toEqual({
      CodeS3Key: 'lambda/old.zip',
      OpenAIModel: 'gpt-5.6-luna',
      OpenAIExtractorModel: 'gpt-5.6-luna',
      OpenAIResponseClassifierModel: 'gpt-5.6-luna',
    });

    expect(() =>
      resolveProductionModelParams({
        env: {
          OPENAI_EXTRACTOR_MODEL: 'gpt-6-luna',
          OPENAI_RESPONSE_CLASSIFIER_MODEL: 'gpt-6-luna',
        },
        developmentStack,
        productionStack,
        developmentStackName: 'recap-agent-runtime-dev',
      }),
    ).toThrow(/explicit OPENAI_MODEL/);

    expect(() =>
      resolveProductionModelParams({
        env: {
          OPENAI_MODEL: 'gpt-5.6-luna',
          OPENAI_EXTRACTOR_MODEL: 'gpt-6-luna',
          OPENAI_RESPONSE_CLASSIFIER_MODEL: 'gpt-6-luna',
        },
        developmentStack,
        productionStack,
        developmentStackName: 'recap-agent-runtime-dev',
      }),
    ).toThrow(/parity is required/);
  });

  it('verifies deployed stack parameters, Lambda environment, S3 key, and CodeSha256', () => {
    const expectedModels = {
      OpenAIModel: 'gpt-6-luna',
      OpenAIExtractorModel: 'gpt-6-luna',
      OpenAIResponseClassifierModel: 'gpt-6-luna',
    };
    const lambdaEnv = {
      OPENAI_MODEL: 'gpt-6-luna',
      OPENAI_EXTRACTOR_MODEL: 'gpt-6-luna',
      OPENAI_RESPONSE_CLASSIFIER_MODEL: 'gpt-6-luna',
    };
    expect(() =>
      verifyProductionModelDeployment({
        stackParams: { ...expectedModels },
        lambdaEnv,
        deployedCodeS3Key: 'lambda/new.zip',
        expectedModels,
        artifactKey: 'lambda/new.zip',
        codeSha256: 'abc123',
      }),
    ).not.toThrow();

    expect(() =>
      verifyProductionModelDeployment({
        stackParams: { ...expectedModels, OpenAIModel: 'gpt-5.6-luna' },
        lambdaEnv,
        deployedCodeS3Key: 'lambda/new.zip',
        expectedModels,
        artifactKey: 'lambda/new.zip',
        codeSha256: 'abc123',
      }),
    ).toThrow(/OpenAIModel mismatch/);

    expect(() =>
      verifyProductionModelDeployment({
        stackParams: { ...expectedModels },
        lambdaEnv: { ...lambdaEnv, OPENAI_EXTRACTOR_MODEL: 'gpt-5.6-luna' },
        deployedCodeS3Key: 'lambda/new.zip',
        expectedModels,
        artifactKey: 'lambda/new.zip',
        codeSha256: 'abc123',
      }),
    ).toThrow(/Lambda OPENAI_EXTRACTOR_MODEL mismatch/);

    expect(() =>
      verifyProductionModelDeployment({
        stackParams: { ...expectedModels },
        lambdaEnv,
        deployedCodeS3Key: 'lambda/other.zip',
        expectedModels,
        artifactKey: 'lambda/new.zip',
        codeSha256: 'abc123',
      }),
    ).toThrow(/CodeS3Key mismatch/);

    expect(() =>
      verifyProductionModelDeployment({
        stackParams: { ...expectedModels },
        lambdaEnv,
        deployedCodeS3Key: 'lambda/new.zip',
        expectedModels,
        artifactKey: 'lambda/new.zip',
        codeSha256: '',
      }),
    ).toThrow(/CodeSha256 is missing/);
  });

  it('leaves historical baselines and frozen model identities untouched', () => {
    expect(getFrozenBaselineIdentity().artifactModel).toBe('gpt-5.6-luna');
    const classification = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'evals/baseline/s01-59-case-classification.json'),
        'utf8',
      ),
    ) as { artifactModel: string };
    expect(classification.artifactModel).toBe('gpt-5.6-luna');
    for (const file of [
      'evals/baselines/openai-legacy-2026-08-04.json',
      'evals/baselines/openai-luna-optimized-2026-08-05.json',
    ]) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
      expect(content).not.toContain('gpt-6');
    }
  });
});
