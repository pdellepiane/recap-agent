import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

type DeploymentEnvironment = 'development' | 'production';

interface DeploymentDefaults {
  stackName: string;
  functionName: string;
  openAiSecretName: string;
  seApiSecretName: string;
  channelApiSecretName: string;
  channelApiKeyEnvName: string;
  providerSyncStackName: string;
  providerSyncEnvironment: 'dev' | 'prod';
}

interface DeploymentConfigModule {
  developmentDeploymentDefaults: DeploymentDefaults;
  productionDeploymentDefaults: DeploymentDefaults;
  requireDeploymentEnvironment(
    sourceEnv: Record<string, string | undefined>,
  ): DeploymentEnvironment;
  resolveDeploymentTarget(
    sourceEnv: Record<string, string | undefined>,
  ): DeploymentDefaults & { environment: DeploymentEnvironment };
}

const deploymentConfig = pathToFileURL(
  path.resolve(process.cwd(), 'scripts/deployment-config.mjs'),
).href;
const readModule = async (): Promise<DeploymentConfigModule> =>
  (await import(deploymentConfig)) as unknown as DeploymentConfigModule;

describe('deployment target safety', () => {
  it('requires an explicit supported deployment environment', async () => {
    const config = await readModule();

    expect(() => config.requireDeploymentEnvironment({})).toThrow('DEPLOYMENT_ENV');
    expect(() => config.requireDeploymentEnvironment({ DEPLOYMENT_ENV: '' })).toThrow(
      'development or production',
    );
    expect(() => config.requireDeploymentEnvironment({ DEPLOYMENT_ENV: 'dev' })).toThrow(
      'development or production',
    );
    expect(config.requireDeploymentEnvironment({ DEPLOYMENT_ENV: 'development' })).toBe(
      'development',
    );
    expect(config.requireDeploymentEnvironment({ DEPLOYMENT_ENV: 'production' })).toBe(
      'production',
    );
  });

  it('derives distinct runtime, secret, and channel-key targets', async () => {
    const config = await readModule();
    const development = config.resolveDeploymentTarget({ DEPLOYMENT_ENV: 'development' });
    const production = config.resolveDeploymentTarget({ DEPLOYMENT_ENV: 'production' });

    expect(development).toMatchObject({
      environment: 'development',
      stackName: 'recap-agent-runtime-dev',
      functionName: 'recap-agent-runtime-dev',
      openAiSecretName: 'recap-agent/development/openai-api-key',
      seApiSecretName: 'recap-agent/development/se-api-key',
      channelApiSecretName: 'recap-agent/development/channel-api-key',
      channelApiKeyEnvName: 'DEV_CHANNEL_API_KEY',
    });
    expect(production).toMatchObject({
      environment: 'production',
      stackName: 'recap-agent-runtime',
      functionName: 'recap-agent-runtime',
      openAiSecretName: 'recap-agent/openai-api-key',
      seApiSecretName: 'recap-agent/se-api-key',
      channelApiSecretName: 'recap-agent/channel-api-key',
      channelApiKeyEnvName: 'CHANNEL_API_KEY',
    });
    expect(development.seApiSecretName).not.toBe(production.seApiSecretName);
    expect(development.channelApiSecretName).not.toBe(production.channelApiSecretName);
    expect(development.channelApiKeyEnvName).not.toBe(production.channelApiKeyEnvName);
  });

  it('rejects canonical cross-environment stack, function, and secret targets', async () => {
    const config = await readModule();

    expect(() =>
      config.resolveDeploymentTarget({
        DEPLOYMENT_ENV: 'development',
        STACK_NAME: 'recap-agent-runtime',
      }),
    ).toThrow('STACK_NAME');
    expect(() =>
      config.resolveDeploymentTarget({
        DEPLOYMENT_ENV: 'development',
        FUNCTION_NAME: 'recap-agent-runtime',
      }),
    ).toThrow('FUNCTION_NAME');
    expect(() =>
      config.resolveDeploymentTarget({
        DEPLOYMENT_ENV: 'development',
        OPENAI_SECRET_NAME: 'recap-agent/openai-api-key',
      }),
    ).toThrow('OPENAI_SECRET_NAME');
    expect(() =>
      config.resolveDeploymentTarget({
        DEPLOYMENT_ENV: 'development',
        CHANNEL_API_SECRET_NAME: 'recap-agent/channel-api-key',
      }),
    ).toThrow('CHANNEL_API_SECRET_NAME');
    expect(() =>
      config.resolveDeploymentTarget({
        DEPLOYMENT_ENV: 'production',
        FUNCTION_NAME: 'recap-agent-runtime-dev',
      }),
    ).toThrow('FUNCTION_NAME');
    expect(() =>
      config.resolveDeploymentTarget({
        DEPLOYMENT_ENV: 'production',
        SE_API_SECRET_NAME: 'recap-agent/development/se-api-key',
      }),
    ).toThrow('SE_API_SECRET_NAME');
  });

  it('requires deployment and artifact safeguards in the executable path', () => {
    const deployScript = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/deploy.mjs'),
      'utf8',
    );
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'infra/cloudformation/stack.yaml'),
      'utf8',
    );
    const gitignore = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8');

    expect(deployScript).toContain('resolveDeploymentTarget(process.env)');
    expect(deployScript).toContain('DEPLOY_ARTIFACT_PATH');
    expect(deployScript).toContain('DEPLOY_ARTIFACT_SHA256');
    expect(deployScript).toContain("process.env.DEPLOY_PROVIDER_SYNC === 'true'");
    expect(deployScript).toContain('set DEPLOY_PROVIDER_SYNC=true to opt in');
    expect(template).toContain('DeploymentEnvironment:');
    expect(template).toContain('DEPLOYMENT_ENV: !Ref DeploymentEnvironment');
    expect(template).toContain('DeploymentEnvironment:\n    Description: Deployment target used by the runtime.');
    expect(gitignore).toContain('.env.development');
  });
});
