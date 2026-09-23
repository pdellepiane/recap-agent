/**
 * Narrowly scoped production model-parameter promotion (Owner C, C5).
 *
 * Production promotion previously omitted the OpenAI model parameter
 * overrides, so artifact-only parity could silently leave production on a
 * stale model. These pure helpers resolve and verify exactly the three
 * model parameters; all AWS calls stay in scripts/deploy.mjs.
 *
 * Fail-closed rules:
 * - All three values must be explicitly configured; a missing or empty
 *   value aborts instead of reusing a stale production value.
 * - Every value must equal the corresponding development stack parameter
 *   (model-parameter parity with the tested deployment). There is no
 *   silent fallback to gpt-5.6-luna when gpt-6-luna is unavailable.
 * - Post-deploy verification compares CloudFormation parameters and the
 *   live Lambda environment against the intended values, plus the
 *   content-addressed S3 key.
 */

export const PRODUCTION_MODEL_PARAMETERS = Object.freeze([
  Object.freeze({
    envKey: 'OPENAI_MODEL',
    parameterKey: 'OpenAIModel',
    lambdaEnvKey: 'OPENAI_MODEL',
  }),
  Object.freeze({
    envKey: 'OPENAI_EXTRACTOR_MODEL',
    parameterKey: 'OpenAIExtractorModel',
    lambdaEnvKey: 'OPENAI_EXTRACTOR_MODEL',
  }),
  Object.freeze({
    envKey: 'OPENAI_RESPONSE_CLASSIFIER_MODEL',
    parameterKey: 'OpenAIResponseClassifierModel',
    lambdaEnvKey: 'OPENAI_RESPONSE_CLASSIFIER_MODEL',
  }),
]);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {object} args
 * @param {Record<string, string | undefined>} args.env merged dotenv + process environment
 * @param {Record<string, string>} args.developmentStack development stack parameters
 * @param {Record<string, string>} args.productionStack current production stack parameters
 * @param {string} args.developmentStackName development stack name for error messages
 * @returns {{ overrides: string[], models: Record<string, string>, rollback: Record<string, string | null> }}
 */
export function resolveProductionModelParams({
  env,
  developmentStack,
  productionStack,
  developmentStackName,
}) {
  const overrides = [];
  const models = {};
  const rollback = {
    CodeS3Key: trimmed(productionStack.CodeS3Key) || null,
  };
  for (const { envKey, parameterKey } of PRODUCTION_MODEL_PARAMETERS) {
    const configured = trimmed(env[envKey]);
    if (!configured) {
      throw new Error(
        `Production promotion requires an explicit ${envKey}; refusing to reuse a stale production model value.`,
      );
    }
    const developmentValue = trimmed(developmentStack[parameterKey]);
    if (!developmentValue) {
      throw new Error(
        `Refusing production promotion because ${developmentStackName} has no ${parameterKey} to match for parity.`,
      );
    }
    if (configured !== developmentValue) {
      throw new Error(
        `Production ${parameterKey} (${configured}) must exactly match ${developmentStackName} (${developmentValue}); model-parameter parity is required.`,
      );
    }
    rollback[parameterKey] = trimmed(productionStack[parameterKey]) || null;
    models[parameterKey] = configured;
    overrides.push(`${parameterKey}=${configured}`);
  }
  return { overrides, models, rollback };
}

/**
 * @param {object} args
 * @param {Record<string, string>} args.stackParams deployed production stack parameters
 * @param {Record<string, string | undefined>} args.lambdaEnv live Lambda environment variables
 * @param {string} args.deployedCodeS3Key deployed production CodeS3Key
 * @param {Record<string, string>} args.expectedModels intended parameterKey -> model values
 * @param {string} args.artifactKey content-addressed artifact key that must be deployed
 * @param {string} args.codeSha256 live Lambda CodeSha256 for the deployment record
 */
export function verifyProductionModelDeployment({
  stackParams,
  lambdaEnv,
  deployedCodeS3Key,
  expectedModels,
  artifactKey,
  codeSha256,
}) {
  if (trimmed(deployedCodeS3Key) !== artifactKey) {
    throw new Error(
      `Production CodeS3Key mismatch: expected ${artifactKey}, got ${trimmed(deployedCodeS3Key) || '<empty>'}.`,
    );
  }
  if (!trimmed(codeSha256)) {
    throw new Error('Production Lambda CodeSha256 is missing; refusing to record the promotion.');
  }
  for (const { parameterKey, lambdaEnvKey } of PRODUCTION_MODEL_PARAMETERS) {
    const expected = expectedModels[parameterKey];
    const stackValue = trimmed(stackParams[parameterKey]);
    if (stackValue !== expected) {
      throw new Error(
        `Production ${parameterKey} mismatch: expected ${expected}, got ${stackValue || '<empty>'}.`,
      );
    }
    const envValue = trimmed(lambdaEnv[lambdaEnvKey]);
    if (envValue !== expected) {
      throw new Error(
        `Production Lambda ${lambdaEnvKey} mismatch: expected ${expected}, got ${envValue || '<empty>'}.`,
      );
    }
  }
}
