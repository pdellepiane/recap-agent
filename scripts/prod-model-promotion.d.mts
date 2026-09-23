export type ProductionModelParameter = {
  readonly envKey: string;
  readonly parameterKey: string;
  readonly lambdaEnvKey: string;
};

export const PRODUCTION_MODEL_PARAMETERS: readonly ProductionModelParameter[];

export function resolveProductionModelParams(args: {
  env: Record<string, string | undefined>;
  developmentStack: Record<string, string>;
  productionStack: Record<string, string>;
  developmentStackName: string;
}): {
  overrides: string[];
  models: Record<string, string>;
  rollback: Record<string, string | null>;
};

export function verifyProductionModelDeployment(args: {
  stackParams: Record<string, string>;
  lambdaEnv: Record<string, string | undefined>;
  deployedCodeS3Key: string;
  expectedModels: Record<string, string>;
  artifactKey: string;
  codeSha256: string;
  expectedCodeSha256: string;
}): void;
