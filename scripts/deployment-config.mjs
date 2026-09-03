/**
 * @typedef {'development' | 'production'} DeploymentEnvironment
 *
 * @typedef {object} DeploymentDefaults
 * @property {string} stackName
 * @property {string} functionName
 * @property {string} openAiSecretName
 * @property {string} seApiSecretName
 * @property {string} channelApiSecretName
 * @property {string} channelApiKeyEnvName
 * @property {string} providerSyncStackName
 * @property {'dev' | 'prod'} providerSyncEnvironment
 */

export const productionDeploymentDefaults = Object.freeze({
  stackName: 'recap-agent-runtime',
  functionName: 'recap-agent-runtime',
  openAiSecretName: 'recap-agent/openai-api-key',
  seApiSecretName: 'recap-agent/se-api-key',
  channelApiSecretName: 'recap-agent/channel-api-key',
  channelApiKeyEnvName: 'CHANNEL_API_KEY',
  providerSyncStackName: 'recap-agent-provider-sync-prod',
  providerSyncEnvironment: 'prod',
});

export const developmentDeploymentDefaults = Object.freeze({
  stackName: 'recap-agent-runtime-dev',
  functionName: 'recap-agent-runtime-dev',
  // The value may be reused, but the secret path must remain isolated so a
  // development deploy can never update production credentials.
  openAiSecretName: 'recap-agent/development/openai-api-key',
  seApiSecretName: 'recap-agent/development/se-api-key',
  channelApiSecretName: 'recap-agent/development/channel-api-key',
  channelApiKeyEnvName: 'DEV_CHANNEL_API_KEY',
  providerSyncStackName: 'recap-agent-provider-sync-dev',
  providerSyncEnvironment: 'dev',
});

/**
 * @param {Record<string, string | undefined>} sourceEnv
 * @returns {DeploymentEnvironment}
 */
export function requireDeploymentEnvironment(sourceEnv) {
  const value = sourceEnv.DEPLOYMENT_ENV;
  if (value !== 'development' && value !== 'production') {
    throw new Error(
      'DEPLOYMENT_ENV is required and must be exactly development or production.',
    );
  }
  return value;
}

/**
 * @param {DeploymentEnvironment} environment
 * @returns {DeploymentDefaults}
 */
export function getDeploymentDefaults(environment) {
  return environment === 'development'
    ? developmentDeploymentDefaults
    : productionDeploymentDefaults;
}

/**
 * Resolve names that are safe for the selected environment. Names remain
 * configurable for migrations, but a target may never use the other
 * environment's canonical function, stack, or application secret names.
 *
 * @param {Record<string, string | undefined>} sourceEnv
 * @returns {DeploymentDefaults & { environment: DeploymentEnvironment }}
 */
export function resolveDeploymentTarget(sourceEnv) {
  const environment = requireDeploymentEnvironment(sourceEnv);
  const defaults = getDeploymentDefaults(environment);
  const opposite = getDeploymentDefaults(
    environment === 'development' ? 'production' : 'development',
  );

  const target = {
    environment,
    stackName: sourceEnv.STACK_NAME ?? defaults.stackName,
    functionName: sourceEnv.FUNCTION_NAME ?? defaults.functionName,
    openAiSecretName: sourceEnv.OPENAI_SECRET_NAME ?? defaults.openAiSecretName,
    seApiSecretName: sourceEnv.SE_API_SECRET_NAME ?? defaults.seApiSecretName,
    channelApiSecretName:
      sourceEnv.CHANNEL_API_SECRET_NAME ?? defaults.channelApiSecretName,
    channelApiKeyEnvName: defaults.channelApiKeyEnvName,
    providerSyncStackName:
      sourceEnv.PROVIDER_SYNC_STACK_NAME ?? defaults.providerSyncStackName,
    providerSyncEnvironment: defaults.providerSyncEnvironment,
  };

  const protectedNames = [
    ['STACK_NAME', target.stackName, opposite.stackName],
    ['FUNCTION_NAME', target.functionName, opposite.functionName],
    ['OPENAI_SECRET_NAME', target.openAiSecretName, opposite.openAiSecretName],
    ['SE_API_SECRET_NAME', target.seApiSecretName, opposite.seApiSecretName],
    [
      'CHANNEL_API_SECRET_NAME',
      target.channelApiSecretName,
      opposite.channelApiSecretName,
    ],
  ];
  for (const [variableName, actual, forbidden] of protectedNames) {
    if (actual === forbidden) {
      throw new Error(
        `${variableName}=${actual} belongs to the ${environment === 'development' ? 'production' : 'development'} deployment and cannot be used for ${environment}.`,
      );
    }
  }

  return target;
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function optionalTrimmed(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
