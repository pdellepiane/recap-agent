#!/usr/bin/env bun

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Command } from 'commander';
import dotenv from 'dotenv';
import pc from 'picocolors';

import type { PlanSnapshot } from '../core/plan';
import type { TurnTrace } from '../core/trace';
import { DynamoPlanStore } from '../storage/dynamo-plan-store';

dotenv.config({ quiet: true });

type CliOptions = {
  url?: string;
  stackName: string;
  plansTable?: string;
  userId: string;
  channel: string;
  region: string;
  profile: string;
  timeoutMs: number;
  showRaw: boolean;
  fullPlan: boolean;
  noPlan: boolean;
  noTrace: boolean;
};

type ResolvedCliConfig = {
  functionUrl: string;
  plansTableName: string;
  stackName: string;
  region: string;
  profile: string;
  userId: string;
  channel: string;
  timeoutMs: number;
  showRaw: boolean;
  showPlan: boolean;
  showTrace: boolean;
  fullPlan: boolean;
};

type LambdaSuccessPayload = {
  message: string;
  conversation_id: string | null;
  plan_id: string;
  current_node: string;
  trace: TurnTrace;
};

type LambdaErrorPayload = {
  error?: string;
};

const program = new Command();

program
  .name('recap-agent-cli')
  .description('Developer CLI for the deployed recap-agent Lambda runtime')
  .option(
    '--url <url>',
    'Lambda Function URL. Defaults to AGENT_FUNCTION_URL or the CloudFormation stack output.',
  )
  .option(
    '--stack-name <name>',
    'CloudFormation stack name used to resolve defaults',
    process.env.STACK_NAME ?? 'recap-agent-runtime',
  )
  .option(
    '--plans-table <name>',
    'DynamoDB table name. Defaults to PLANS_TABLE_NAME or the CloudFormation stack output.',
  )
  .option(
    '--user-id <id>',
    'External user id for the simulated channel',
    process.env.TERMINAL_USER_ID ?? '51999999999',
  )
  .option(
    '--channel <channel>',
    'Channel identifier sent to the runtime',
    process.env.TERMINAL_CHANNEL ?? 'terminal_whatsapp',
  )
  .option(
    '--region <region>',
    'AWS region',
    process.env.AWS_REGION ?? 'us-east-1',
  )
  .option(
    '--profile <profile>',
    'AWS profile',
    process.env.AWS_PROFILE ?? 'se-dev',
  )
  .option(
    '--timeout-ms <ms>',
    'Per-turn HTTP timeout in milliseconds',
    (value) => Number.parseInt(value, 10),
    Number.parseInt(process.env.CLI_TIMEOUT_MS ?? '90000', 10),
  )
  .option('--show-raw', 'Print the raw Lambda JSON after each turn', false)
  .option('--full-plan', 'Print the full persisted plan JSON after each turn', false)
  .option('--no-plan', 'Do not fetch the persisted plan from DynamoDB after each turn')
  .option('--no-trace', 'Do not print the trace summary after each turn');

void main();

async function main() {
  program.parse();
  const options = program.opts<CliOptions>();

  process.env.AWS_PROFILE = options.profile;
  process.env.AWS_REGION = options.region;
  process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG ?? '1';
  process.env.AWS_PAGER = '';

  const config = await resolveDefaults(options);
  const planStore = new DynamoPlanStore(config.plansTableName, {
    region: config.region,
  });

  renderIntro(config);

  const rl = readline.createInterface({ input, output });

  while (true) {
    const line = (await rl.question(pc.cyan('you> '))).trim();

    if (!line) {
      continue;
    }

    switch (line) {
      case '/exit':
      case '/quit':
        rl.close();
        output.write(pc.gray('Session closed.\n'));
        return;
      case '/help':
        renderHelp();
        continue;
      case '/config':
        renderConfig(config);
        continue;
      case '/plan': {
        const plan = await planStore.getByExternalUser(config.channel, config.userId);
        renderPlan(plan, config.fullPlan);
        continue;
      }
      default:
        break;
    }

    const startedAt = Date.now();
    const result = await invokeLambda(config.functionUrl, {
      channel: config.channel,
      user_id: config.userId,
      text: line,
    }, config.timeoutMs);
    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      renderError(result.body.error ?? 'Unknown runtime error.', durationMs);
      continue;
    }

    renderReply(result.body.message, result.body.current_node, durationMs);

    if (config.showTrace) {
      renderTrace(result.body.trace);
    }

    if (config.showPlan) {
      const plan = await planStore.getByExternalUser(config.channel, config.userId);
      renderPlan(plan, config.fullPlan);
    }

    if (config.showRaw) {
      output.write(`${pc.gray(JSON.stringify(result.body, null, 2))}\n`);
    }
  }
}

async function resolveDefaults(options: CliOptions): Promise<ResolvedCliConfig> {
  const outputs =
    options.url && options.plansTable
      ? {}
      : await getStackOutputs(options.stackName, options.region);

  const functionUrl =
    options.url ??
    process.env.AGENT_FUNCTION_URL ??
    outputs.FunctionUrl;

  if (!functionUrl) {
    throw new Error(
      'Unable to resolve the Function URL. Pass --url or set AGENT_FUNCTION_URL.',
    );
  }

  const plansTableName =
    options.plansTable ??
    process.env.PLANS_TABLE_NAME ??
    outputs.PlansTableName;

  if (!plansTableName) {
    throw new Error(
      'Unable to resolve the plans table. Pass --plans-table or set PLANS_TABLE_NAME.',
    );
  }

  return {
    functionUrl,
    plansTableName,
    stackName: options.stackName,
    region: options.region,
    profile: options.profile,
    userId: options.userId,
    channel: options.channel,
    timeoutMs: options.timeoutMs,
    showRaw: options.showRaw,
    showPlan: !options.noPlan,
    showTrace: !options.noTrace,
    fullPlan: options.fullPlan,
  };
}

async function getStackOutputs(stackName: string, region: string) {
  const client = new CloudFormationClient({ region });
  const response = await client.send(
    new DescribeStacksCommand({
      StackName: stackName,
    }),
  );

  const outputs = response.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(
    outputs
      .filter((item) => item.OutputKey && item.OutputValue)
      .map((item) => [item.OutputKey as string, item.OutputValue as string]),
  ) as Partial<Record<'FunctionUrl' | 'PlansTableName', string>>;
}

async function invokeLambda(
  functionUrl: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<
  | { ok: true; body: LambdaSuccessPayload }
  | { ok: false; body: LambdaErrorPayload }
> {
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

    const json = (await response.json()) as LambdaSuccessPayload | LambdaErrorPayload;
    if (!response.ok) {
      return { ok: false, body: json as LambdaErrorPayload };
    }

    return { ok: true, body: json as LambdaSuccessPayload };
  } finally {
    clearTimeout(timeout);
  }
}

function renderIntro(config: ResolvedCliConfig) {
  const lines = [
    `${pc.bold('Runtime')}: live deployed Lambda`,
    `${pc.bold('Function URL')}: ${config.functionUrl}`,
    `${pc.bold('Plans Table')}: ${config.plansTableName}`,
    `${pc.bold('Stack')}: ${config.stackName}`,
    `${pc.bold('AWS')}: ${config.profile} @ ${config.region}`,
    `${pc.bold('User')}: ${config.userId}`,
    `${pc.bold('Channel')}: ${config.channel}`,
    '',
    pc.gray('Commands: /help  /config  /plan  /exit'),
  ];

  output.write(
    `${boxen(lines.join('\n'), {
      padding: 1,
      borderColor: 'cyan',
      title: 'recap-agent dev cli',
      titleAlignment: 'left',
    })}\n`,
  );
}

function renderHelp() {
  const table = new Table({
    head: [pc.bold('Command'), pc.bold('Description')],
    style: { head: [], border: [] },
    colWidths: [16, 80],
    wordWrap: true,
  });

  table.push(
    ['/help', 'Show CLI commands'],
    ['/config', 'Show resolved runtime configuration and defaults'],
    ['/plan', 'Fetch and print the persisted plan from DynamoDB'],
    ['/exit', 'Exit the CLI session'],
  );

  output.write(`${table.toString()}\n`);
}

function renderConfig(config: ResolvedCliConfig) {
  const table = new Table({
    style: { head: [], border: [] },
    colWidths: [22, 88],
    wordWrap: true,
  });

  table.push(
    ['Function URL', config.functionUrl],
    ['Plans Table', config.plansTableName],
    ['Stack', config.stackName],
    ['AWS Profile', config.profile],
    ['AWS Region', config.region],
    ['User ID', config.userId],
    ['Channel', config.channel],
    ['Timeout (ms)', String(config.timeoutMs)],
    ['Show Trace', String(config.showTrace)],
    ['Show Plan', String(config.showPlan)],
    ['Show Raw', String(config.showRaw)],
    ['Full Plan', String(config.fullPlan)],
  );

  output.write(`${table.toString()}\n`);
}

function renderReply(message: string, node: string, durationMs: number) {
  output.write(
    `${boxen(message, {
      padding: 1,
      borderColor: 'green',
      title: `agent reply · ${node} · ${durationMs}ms`,
      titleAlignment: 'left',
    })}\n`,
  );
}

function renderTrace(trace: TurnTrace) {
  const table = new Table({
    head: [pc.bold('Trace'), pc.bold('Value')],
    style: { head: [], border: [] },
    colWidths: [24, 86],
    wordWrap: true,
  });

  table.push(
    ['Trace ID', trace.trace_id],
    ['Conversation', trace.conversation_id ?? 'null'],
    ['Plan ID', trace.plan_id],
    ['Transition', `${trace.previous_node} -> ${trace.next_node}`],
    ['Node Path', trace.node_path.join(' -> ')],
    ['Intent', trace.intent ?? 'null'],
    ['Search Ready', String(trace.search_ready)],
    ['Missing Fields', trace.missing_fields.join(', ') || 'none'],
    ['Prompt Bundle', trace.prompt_bundle_id],
    ['Prompt Files', trace.prompt_file_paths.join('\n')],
    ['Tools Considered', trace.tools_considered.join(', ') || 'none'],
    ['Tools Called', trace.tools_called.join(', ') || 'none'],
    ['Plan Persisted', String(trace.plan_persisted)],
    ['Persist Reason', trace.plan_persist_reason ?? 'null'],
  );

  output.write(`${table.toString()}\n`);
}

function renderPlan(plan: PlanSnapshot | null, fullPlan: boolean) {
  if (!plan) {
    output.write(pc.yellow('No persisted plan found for this user.\n'));
    return;
  }

  const table = new Table({
    head: [pc.bold('Plan'), pc.bold('Value')],
    style: { head: [], border: [] },
    colWidths: [24, 86],
    wordWrap: true,
  });

  table.push(
    ['Plan ID', plan.plan_id],
    ['Current Node', plan.current_node],
    ['Conversation', plan.conversation_id ?? 'null'],
    ['Intent', plan.intent ?? 'null'],
    ['Event Type', plan.event_type ?? 'null'],
    ['Active Need', plan.active_need_category ?? 'null'],
    [
      'Provider Needs',
      plan.provider_needs
        .map((need, index) => `${index + 1}. ${need.category} [${need.status}]`)
        .join('\n') || 'none',
    ],
    ['Category', plan.vendor_category ?? 'null'],
    ['Location', plan.location ?? 'null'],
    ['Budget', plan.budget_signal ?? 'null'],
    ['Guest Range', plan.guest_range ?? 'null'],
    ['Missing Fields', plan.missing_fields.join(', ') || 'none'],
    ['Selected Provider', String(plan.selected_provider_id ?? 'null')],
    [
      'Recommended Providers',
      plan.recommended_providers
        .map((provider, index) => `${index + 1}. ${provider.title} (${provider.id})`)
        .join('\n') || 'none',
    ],
    ['Summary', plan.conversation_summary || ''],
    ['Updated At', plan.updated_at],
  );

  output.write(`${table.toString()}\n`);

  if (fullPlan) {
    output.write(`${pc.gray(JSON.stringify(plan, null, 2))}\n`);
  }
}

function renderError(message: string, durationMs: number) {
  output.write(
    `${boxen(message, {
      padding: 1,
      borderColor: 'red',
      title: `runtime error · ${durationMs}ms`,
      titleAlignment: 'left',
    })}\n`,
  );
}
