#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { Command } from 'commander';

import { buildObservableLiveTurns } from './observable-live-script';

type CliOptions = {
  url?: string;
  stackName: string;
  userId?: string;
  channel: string;
  region: string;
  profile: string;
  timeoutMs: number;
  delayMs: number;
};

type LambdaTranscriptPayload = {
  message?: string;
  error?: string;
};

type LambdaRequestBody = {
  channel: string;
  user_id: string;
  text: string;
  message_id: string;
  received_at: string;
  session_id: string;
  client_mode: 'channel';
};

const program = new Command();

program
  .name('observable-live-eval')
  .description('Run a fresh shuffled end-to-end Lambda conversation and print only the chat transcript.')
  .option('--url <url>', 'Lambda Function URL. Defaults to AGENT_FUNCTION_URL or CloudFormation output.')
  .option(
    '--stack-name <name>',
    'CloudFormation stack name used to resolve the Lambda Function URL.',
    process.env.STACK_NAME ?? 'recap-agent-runtime',
  )
  .option('--user-id <id>', 'External user id. Defaults to a fresh observable eval id.')
  .option(
    '--channel <channel>',
    'Channel identifier sent to Lambda.',
    process.env.TERMINAL_CHANNEL ?? 'terminal_whatsapp_eval',
  )
  .option('--region <region>', 'AWS region.', process.env.AWS_REGION ?? 'us-east-1')
  .option('--profile <profile>', 'AWS profile.', process.env.AWS_PROFILE ?? 'se-dev')
  .option(
    '--timeout-ms <ms>',
    'Per-turn HTTP timeout in milliseconds.',
    (value) => Number.parseInt(value, 10),
    Number.parseInt(process.env.CLI_TIMEOUT_MS ?? '90000', 10),
  )
  .option(
    '--delay-ms <ms>',
    'Delay between turns in milliseconds.',
    (value) => Number.parseInt(value, 10),
    250,
  );

void main();

async function main(): Promise<void> {
  program.parse();
  const options = program.opts<CliOptions>();

  process.env.AWS_PROFILE = options.profile;
  process.env.AWS_REGION = options.region;
  process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG ?? '1';
  process.env.AWS_PAGER = '';

  const functionUrl = await resolveFunctionUrl(options);
  const userId = options.userId ?? `observable-eval-${new Date().toISOString()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const sessionId = `observable-session-${Math.random().toString(36).slice(2, 10)}`;
  const turns = buildObservableLiveTurns();

  process.stdout.write('\nrecap-agent observable live eval\n');
  process.stdout.write(`Function URL: ${functionUrl}\n`);
  process.stdout.write(`User: ${userId}\n`);
  process.stdout.write(`Channel: ${options.channel}\n`);
  process.stdout.write(`Session: ${sessionId}\n`);
  process.stdout.write(`Turns: ${turns.length}\n`);
  process.stdout.write('Trace/plan output: hidden\n\n');

  for (const [index, turn] of turns.entries()) {
    process.stdout.write(`\n[${index + 1}/${turns.length}] ${turn.operationId}\n`);
    process.stdout.write(`you> ${turn.text}\n`);
    const startedAt = Date.now();
    const response = await invokeLambda(functionUrl, {
      channel: options.channel,
      user_id: userId,
      text: turn.text,
      message_id: `observable-${index}`,
      received_at: new Date().toISOString(),
      session_id: sessionId,
      client_mode: 'channel',
    }, options.timeoutMs);
    const elapsedMs = Date.now() - startedAt;
    process.stdout.write(`agent (${elapsedMs}ms)> ${response.message ?? response.error ?? '(empty response)'}\n`);
    if (response.error) {
      throw new Error(response.error);
    }
    if (options.delayMs > 0 && index < turns.length - 1) {
      await sleep(options.delayMs);
    }
  }

  process.stdout.write('\nObservable live eval finished.\n');
}

async function invokeLambda(
  functionUrl: string,
  body: LambdaRequestBody,
  timeoutMs: number,
): Promise<LambdaTranscriptPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json();
    const payload = parseLambdaPayload(parsed);
    if (!response.ok) {
      return {
        error: payload.error ?? `HTTP ${response.status}`,
      };
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function parseLambdaPayload(payload: unknown): LambdaTranscriptPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    message: typeof record.message === 'string' ? record.message : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  };
}

async function resolveFunctionUrl(options: CliOptions): Promise<string> {
  const directUrl = options.url ?? process.env.AGENT_FUNCTION_URL;
  if (directUrl) {
    return directUrl;
  }

  const client = new CloudFormationClient({
    region: options.region,
  });
  const response = await client.send(
    new DescribeStacksCommand({
      StackName: options.stackName,
    }),
  );
  const output = response.Stacks?.[0]?.Outputs?.find(
    (candidate) => candidate.OutputKey === 'FunctionUrl',
  )?.OutputValue;
  if (!output) {
    throw new Error('Unable to resolve FunctionUrl. Pass --url or set AGENT_FUNCTION_URL.');
  }
  return output;
}
