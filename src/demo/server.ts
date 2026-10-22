#!/usr/bin/env bun
/**
 * Local demo server: serves demo/index.html and proxies live turns to the
 * deployed Lambda, using the exact same request shape and credential
 * resolution as src/terminal/client.ts.
 * Works with `bun run src/demo/server.ts` and `tsx src/demo/server.ts`.
 * The channel API key never leaves this process.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { BatchWriteItemCommand, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

import { configureRequiredLocalAwsProfile } from '../aws/local-profile';
import { assertRequiredLocalAwsIdentity } from '../aws/local-identity';
import { resolveDevelopmentTarget, type DevelopmentStackOutputs } from '../aws/development-target';
import { conversationPartitionKey } from '../storage/conversation-key';

dotenv.config({ path: ['.env.development', '.env', '.env.local'], quiet: true });

// Started from the repository root via `bun run demo` / `npm run demo:node`.
const root = process.cwd();
const parsedPort = Number.parseInt(process.env.DEMO_PORT ?? '4173', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 4173;
const timeoutMs = Number.parseInt(process.env.CLI_TIMEOUT_MS ?? '90000', 10);
const defaultUserId = process.env.TERMINAL_USER_ID ?? '51999999999';

type LiveConfig = {
  functionUrl: string;
  apiKey: string;
  source: 'env' | 'stack';
  /**
   * Stack-verified plans table. Null when the stack could not be verified:
   * purge stays disabled (fail closed) even if an explicit Function URL works.
   */
  plansTableName: string | null;
};

async function getStackOutputs(stackName: string, region: string): Promise<DevelopmentStackOutputs> {
  const client = new CloudFormationClient({ region });
  const response = await client.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = response.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(
    outputs
      .filter((item) => item.OutputKey && item.OutputValue)
      .map((item) => [item.OutputKey as string, item.OutputValue as string]),
  ) as DevelopmentStackOutputs;
}

/**
 * Same credential resolution as the terminal client: explicit Function URL
 * env vars win, otherwise fall back to the verified development
 * CloudFormation stack outputs. The channel key always comes from the local
 * env, exactly like `DEV_CHANNEL_API_KEY` in the terminal. Any failure
 * resolves to null so Simulado mode keeps working out of the box.
 */
async function resolveLiveConfig(): Promise<LiveConfig | null> {
  const apiKey = process.env.DEV_CHANNEL_API_KEY ?? process.env.CHANNEL_API_KEY ?? '';
  if (!apiKey) {
    return null;
  }
  const envUrl = process.env.DEV_AGENT_FUNCTION_URL ?? process.env.AGENT_FUNCTION_URL ?? '';
  try {
    configureRequiredLocalAwsProfile({
      profile: process.env.AWS_PROFILE,
      region: process.env.AWS_REGION,
    });
    assertRequiredLocalAwsIdentity();
    const stackName = process.env.DEV_STACK_NAME ?? 'recap-agent-runtime-dev';
    const outputs = await getStackOutputs(stackName, 'us-east-1');
    if (envUrl) {
      // Same guard as the terminal: an explicit URL must match the stack.
      const target = resolveDevelopmentTarget(outputs, { functionUrl: envUrl });
      return { functionUrl: envUrl, apiKey, source: 'env', plansTableName: target.plansTableName };
    }
    const target = resolveDevelopmentTarget(outputs, {});
    return { functionUrl: target.functionUrl, apiKey, source: 'stack', plansTableName: target.plansTableName };
  } catch {
    // CloudFormation/AWS unavailable (or URL mismatch): honor an explicit
    // env URL without stack verification, otherwise stay mock-only.
    // Purge stays disabled without a verified table.
    if (envUrl) {
      return { functionUrl: envUrl, apiKey, source: 'env', plansTableName: null };
    }
    return null;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Deletes every item under one user's partition key, in 25-item batches. */
async function purgeUserPartition(tableName: string, pk: string): Promise<number> {
  const client = new DynamoDBClient({ region: 'us-east-1' });
  const keys: Array<{ pk: string; sk: string }> = [];
  let exclusiveStartKey: Record<string, { S: string }> | undefined;
  while (true) {
    const page = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: pk } },
      ProjectionExpression: 'pk, sk',
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of page.Items ?? []) {
      const sk = item.sk?.S;
      if (typeof sk === 'string') keys.push({ pk, sk });
    }
    const lastKey = page.LastEvaluatedKey as Record<string, { S: string }> | undefined;
    if (!lastKey) break;
    exclusiveStartKey = lastKey;
  }
  for (let index = 0; index < keys.length; index += 25) {
    await client.send(new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: keys.slice(index, index + 25).map((key) => ({
          DeleteRequest: { Key: { pk: { S: key.pk }, sk: { S: key.sk } } },
        })),
      },
    }));
  }
  return keys.length;
}

async function main(): Promise<void> {
  const live = await resolveLiveConfig();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = await readFile(path.join(root, 'demo', 'index.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, { ok: true, liveConfigured: Boolean(live), liveSource: live?.source ?? null, purgeConfigured: Boolean(live?.plansTableName), mode: live ? 'lambda' : 'mock-only' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/purge') {
        // Same scope as `npm run purge:terminal-plans`, narrowed to one
        // configured number: deletes every stored item (plan, turn lock,
        // session focus) under that user's partition key so Nueva demo
        // restarts live conversation from zero. Fail-closed guards below.
        if (!live?.plansTableName) {
          json(res, 503, { error: 'Purge is not configured. Live mode needs the verified development stack (same AWS login as the terminal).' });
          return;
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Invalid JSON body.' });
          return;
        }
        const channel = typeof payload.channel === 'string' ? payload.channel : 'terminal_whatsapp';
        if (channel !== 'terminal_whatsapp') {
          json(res, 403, { error: 'Purge is only allowed for the terminal demo channel.' });
          return;
        }
        const rawUserId = typeof payload.user_id === 'string' ? payload.user_id.trim() : '';
        if (rawUserId.length === 0 || rawUserId.length > 64 || rawUserId.includes('#')) {
          json(res, 400, { error: 'user_id is required (1-64 chars, no #).' });
          return;
        }
        let pk: string;
        try {
          pk = conversationPartitionKey(channel, rawUserId);
        } catch {
          json(res, 400, { error: 'Invalid user_id.' });
          return;
        }
        try {
          const deleted = await purgeUserPartition(live.plansTableName, pk);
          json(res, 200, { ok: true, deleted });
        } catch {
          json(res, 502, { error: 'Could not purge the plan from DynamoDB.' });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/turn') {
        if (!live) {
          json(res, 503, { error: 'Live mode is not configured. Set DEV_AGENT_FUNCTION_URL and DEV_CHANNEL_API_KEY (see .env.example), use the same AWS login as the terminal (se-dev), or use Simulado mode.' });
          return;
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Invalid JSON body.' });
          return;
        }
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) {
          json(res, 400, { error: 'text is required.' });
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const upstream = await fetch(live.functionUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${live.apiKey}` },
            body: JSON.stringify({
              channel: typeof payload.channel === 'string' ? payload.channel : 'terminal_whatsapp',
              user_id: typeof payload.user_id === 'string' ? payload.user_id : defaultUserId,
              contact_phone: typeof payload.contact_phone === 'string' ? payload.contact_phone : null,
              text,
              session_id: typeof payload.session_id === 'string' ? payload.session_id : undefined,
              client_mode: 'cli',
            }),
            signal: controller.signal,
          });
          const body: unknown = await upstream.json().catch(() => ({}));
          json(res, upstream.status, body);
        } catch (error) {
          const message = error instanceof Error && error.name === 'AbortError'
            ? 'Request timed out before Lambda returned a response.'
            : 'Could not reach the Lambda Function URL.';
          json(res, 502, { error: message });
        } finally {
          clearTimeout(timer);
        }
        return;
      }
      json(res, 404, { error: 'Not found.' });
    })().catch(() => json(res, 500, { error: 'Demo server error.' }));
  });

  server.listen(port, () => {
    console.log(`Recap demo: http://localhost:${port}`);
    console.log(live ? `Live mode: configured via ${live.source} (key stays server-side)` : 'Live mode: not configured — Simulado mode works out of the box');
  });
}

void main();
