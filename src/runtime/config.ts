import path from 'node:path';

export type AppConfig = {
  openAiApiKey: string | null;
  openAiSecretId: string | null;
  openAiModel: string;
  extractorModel: string;
  awsRegion: string;
  plansTableName: string;
  promptsDir: string;
  sinEnvolturasBaseUrl: string;
  lambdaFunctionUrl: string | null;
};

export function getConfig(): AppConfig {
  return {
    openAiApiKey: process.env.OPENAI_API_KEY ?? null,
    openAiSecretId: process.env.OPENAI_SECRET_ID ?? null,
    openAiModel: process.env.OPENAI_MODEL ?? 'gpt-5',
    extractorModel: process.env.OPENAI_EXTRACTOR_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5-mini',
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    plansTableName: process.env.PLANS_TABLE_NAME ?? 'recap-agent-plans',
    promptsDir:
      process.env.PROMPTS_DIR ?? path.resolve(process.cwd(), 'prompts'),
    sinEnvolturasBaseUrl:
      process.env.SINENVOLTURAS_BASE_URL ??
      'https://api.sinenvolturas.com/api-web/vendor',
    lambdaFunctionUrl: process.env.AGENT_FUNCTION_URL ?? null,
  };
}
