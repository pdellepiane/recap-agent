import crypto from 'node:crypto';

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { PromptLoader } from '../runtime/prompt-loader';
import { getConfig } from '../runtime/config';
import { DynamoPlanStore } from '../storage/dynamo-plan-store';
import { OpenAiAgentRuntime } from '../runtime/openai-agent-runtime';
import { SinEnvolturasGateway } from '../runtime/sinenvolturas-gateway';
import { AgentService } from '../runtime/agent-service';
import { resolveOpenAiApiKey } from '../runtime/secrets';

type TerminalRequestBody = {
  text: string;
  user_id: string;
  channel?: string;
  message_id?: string;
  received_at?: string;
};

const config = getConfig();

let servicePromise: Promise<AgentService> | null = null;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const service = await getService();

    if (!event.body) {
      return json(400, { error: 'Missing request body.' });
    }

    const body = JSON.parse(event.body) as TerminalRequestBody;

    if (!body.text || !body.user_id) {
      return json(400, { error: 'text and user_id are required.' });
    }

    const response = await service.handleTurn({
      channel: body.channel ?? 'terminal_whatsapp',
      externalUserId: body.user_id,
      text: body.text,
      messageId: body.message_id ?? crypto.randomUUID(),
      receivedAt: body.received_at ?? new Date().toISOString(),
    });

    return json(200, {
      message: response.outbound.text,
      conversation_id: response.outbound.conversationId,
      plan_id: response.plan.plan_id,
      current_node: response.plan.current_node,
      trace: response.trace,
    });
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    });
  }
}

async function getService(): Promise<AgentService> {
  if (!servicePromise) {
    servicePromise = (async () => {
      const apiKey = await resolveOpenAiApiKey({
        directApiKey: config.openAiApiKey,
        secretId: config.openAiSecretId,
        region: config.awsRegion,
      });
      process.env.OPENAI_API_KEY = apiKey;

      const promptLoader = new PromptLoader(config.promptsDir);
      const providerGateway = new SinEnvolturasGateway(config.sinEnvolturasBaseUrl);
      const runtime = new OpenAiAgentRuntime({
        apiKey,
        model: config.openAiModel,
        extractorModel: config.extractorModel,
        promptLoader,
        providerGateway,
      });
      const planStore = new DynamoPlanStore(config.plansTableName, {
        region: config.awsRegion,
      });

      return new AgentService({
        planStore,
        runtime,
        providerGateway,
        promptLoader,
      });
    })();
  }

  return servicePromise;
}

function json(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body, null, 2),
  };
}
