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
import type { CliPerfSummary } from '../logs/trace/perf';
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
  noPlan?: boolean;
  noTrace?: boolean;
  plan?: boolean;
  trace?: boolean;
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
  plan?: PlanSnapshot;
  perf?: CliPerfSummary | null;
};

type LambdaErrorPayload = {
  error?: string;
};

type InvokeTiming = {
  total: number;
  fetch: number;
  parse: number;
};

type ProgressPhase =
  | 'sending_request'
  | 'waiting_response'
  | 'parsing_response'
  | 'rendering_reply'
  | 'rendering_trace'
  | 'loading_plan'
  | 'rendering_plan'
  | 'rendering_raw';

type TurnProgressReporter = {
  setPhase: (phase: ProgressPhase) => void;
  stop: () => void;
};

type LocalTurnTiming = {
  render_reply_ms: number;
  render_trace_ms: number;
  load_plan_ms: number;
  render_plan_ms: number;
  render_raw_ms: number;
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
    const progressReporter = createTurnProgressReporter({
      timeoutMs: config.timeoutMs,
    });
    const localTiming: LocalTurnTiming = {
      render_reply_ms: 0,
      render_trace_ms: 0,
      load_plan_ms: 0,
      render_plan_ms: 0,
      render_raw_ms: 0,
    };
    let result:
      | { ok: true; body: LambdaSuccessPayload; timing: InvokeTiming }
      | { ok: false; body: LambdaErrorPayload; timing: InvokeTiming };
    try {
      result = await invokeLambda(
        config.functionUrl,
        {
          channel: config.channel,
          user_id: config.userId,
          text: line,
          client_mode: 'cli',
        },
        config.timeoutMs,
        progressReporter,
      );
      const durationMs = Date.now() - startedAt;

      if (!result.ok) {
        renderError(
          result.body.error ?? 'Unknown runtime error.',
          durationMs,
          result.timing,
        );
        continue;
      }
      progressReporter.setPhase('rendering_reply');
      const renderReplyStartedAt = Date.now();
      renderReply(
        result.body.message,
        result.body.current_node,
        durationMs,
        result.body.trace,
        result.body.perf ?? null,
      );
      localTiming.render_reply_ms = Date.now() - renderReplyStartedAt;

      let planForRender = result.body.plan ?? null;

      if (config.showPlan) {
        if (!planForRender) {
          progressReporter.setPhase('loading_plan');
          const loadPlanStartedAt = Date.now();
          planForRender = await planStore.getByExternalUser(config.channel, config.userId);
          localTiming.load_plan_ms = Date.now() - loadPlanStartedAt;
        }
        progressReporter.setPhase('rendering_plan');
        const renderPlanStartedAt = Date.now();
        renderPlan(planForRender, config.fullPlan);
        localTiming.render_plan_ms = Date.now() - renderPlanStartedAt;
      }

      if (config.showTrace) {
        progressReporter.setPhase('rendering_trace');
        localTiming.render_trace_ms = renderTrace(
          result.body.trace,
          result.timing,
          result.body.perf ?? null,
          localTiming,
        );
      }

      if (config.showRaw) {
        progressReporter.setPhase('rendering_raw');
        const renderRawStartedAt = Date.now();
        output.write(`${pc.gray(JSON.stringify(result.body, null, 2))}\n`);
        localTiming.render_raw_ms = Date.now() - renderRawStartedAt;
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      renderError(formatInvokeFailure(error), durationMs);
      continue;
    } finally {
      progressReporter.stop();
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

  const showPlan = resolveBooleanToggle(options, 'plan', 'noPlan', true);
  const showTrace = resolveBooleanToggle(options, 'trace', 'noTrace', true);

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
    showPlan,
    showTrace,
    fullPlan: options.fullPlan,
  };
}

function resolveBooleanToggle(
  options: CliOptions,
  positiveKey: 'plan' | 'trace',
  legacyNegativeKey: 'noPlan' | 'noTrace',
  defaultValue: boolean,
): boolean {
  const positiveValue = options[positiveKey];
  if (typeof positiveValue === 'boolean') {
    return positiveValue;
  }

  const legacyNegativeValue = options[legacyNegativeKey];
  if (typeof legacyNegativeValue === 'boolean') {
    return !legacyNegativeValue;
  }

  return defaultValue;
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
  progressReporter?: TurnProgressReporter,
): Promise<
  | { ok: true; body: LambdaSuccessPayload; timing: InvokeTiming }
  | { ok: false; body: LambdaErrorPayload; timing: InvokeTiming }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let fetchCompletedAt = startedAt;

  try {
    progressReporter?.setPhase('sending_request');
    const fetchStartedAt = Date.now();
    progressReporter?.setPhase('waiting_response');
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    fetchCompletedAt = Date.now();

    const parseStartedAt = Date.now();
    progressReporter?.setPhase('parsing_response');
    const json = (await response.json()) as LambdaSuccessPayload | LambdaErrorPayload;
    const parseCompletedAt = Date.now();
    const timing: InvokeTiming = {
      total: parseCompletedAt - startedAt,
      fetch: fetchCompletedAt - fetchStartedAt,
      parse: parseCompletedAt - parseStartedAt,
    };

    if (!response.ok) {
      return { ok: false, body: json as LambdaErrorPayload, timing };
    }

    return { ok: true, body: json as LambdaSuccessPayload, timing };
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

function renderReply(
  message: string,
  node: string,
  durationMs: number,
  trace: TurnTrace,
  perf: CliPerfSummary | null,
) {
  const runtimeTiming = trace.timing_ms;
  const runtimeTokens = trace.token_usage.total;
  const totalCacheHitRate = runtimeTokens
    ? calculateCacheHitRate(runtimeTokens.input_tokens, runtimeTokens.cached_input_tokens ?? 0)
    : null;
  const timingHint = runtimeTiming
    ? ` · extract ${runtimeTiming.extraction}ms · compose ${runtimeTiming.compose_reply}ms`
    : '';
  const tokensHint = runtimeTokens
    ? ` · tokens ${runtimeTokens.total_tokens}`
    : '';
  const cacheHint =
    totalCacheHitRate !== null
      ? ` · cache ${(totalCacheHitRate * 100).toFixed(1)}%`
      : '';
  const perfHint = perf ? ` · perf ${perf.runtime_latency_ms}ms` : '';
  output.write(
    `${boxen(message, {
      padding: 1,
      borderColor: 'green',
      title: `agent reply · ${node} · ${durationMs}ms${timingHint}${tokensHint}${cacheHint}${perfHint}`,
      titleAlignment: 'left',
    })}\n`,
  );
}

function renderTrace(
  trace: TurnTrace,
  invokeTiming?: InvokeTiming,
  perf?: CliPerfSummary | null,
  localTiming?: LocalTurnTiming,
): number {
  const renderTraceStartedAt = Date.now();
  const hasToolInputsField = Object.prototype.hasOwnProperty.call(
    trace,
    'tool_inputs',
  );
  const toolInputs = trace.tool_inputs ?? [];
  const toolOutputs = trace.tool_outputs ?? [];
  const providerResults = trace.provider_results ?? [];
  const toolsCalled = trace.tools_called ?? [];
  const recommendationFunnel = trace.recommendation_funnel ?? {
    available_candidates: providerResults.length,
    context_candidates: providerResults.length,
    context_candidate_ids: providerResults.map((provider) => provider.id),
    presentation_limit: 5,
  };
  const toolInputsSummary =
    toolInputs.length > 0
      ? toolInputs
          .map(
            (entry, index) =>
              `${index + 1}. ${entry.tool}\n${truncateForTrace(entry.input, 1200)}`,
          )
          .join('\n\n')
      : hasToolInputsField
        ? toolsCalled.length > 0
          ? 'No tool input payloads were captured for this turn.'
          : 'No tools were called in this turn.'
        : toolsCalled.length > 0
          ? 'Tool inputs are not available in this runtime response. Redeploy Lambda with the latest trace schema.'
          : 'No tools were called in this turn.';

  const table = new Table({
    head: [pc.bold('Trace'), pc.bold('Value')],
    style: { head: [], border: [] },
    colWidths: [24, 86],
    wordWrap: true,
  });
  const localTimingForDisplay = localTiming
    ? {
        ...localTiming,
        render_trace_ms: Date.now() - renderTraceStartedAt,
      }
    : null;

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
    ['Tools Called', toolsCalled.join(', ') || 'none'],
    ...(toolInputs.length > 0
      ? toolInputs.map((entry, index) => [
          index === 0 ? 'Tool Inputs' : '',
          `${index + 1}. ${entry.tool}\n${truncateForTrace(entry.input, 1200)}`,
        ])
      : [
          [
            'Tool Inputs',
            hasToolInputsField
              ? toolsCalled.length > 0
                ? 'No tool input payloads were captured for this turn.'
                : 'No tools were called in this turn.'
              : toolsCalled.length > 0
                ? 'Tool inputs are not available in this runtime response. Redeploy Lambda with the latest trace schema.'
                : 'No tools were called in this turn.',
          ],
        ]),
    ...(toolOutputs.length > 0
      ? toolOutputs.map((entry, index) => [
          index === 0 ? 'Tool Outputs' : '',
          `${index + 1}. ${entry.tool}\n${truncateForTrace(entry.output, 1200)}`,
        ])
      : [['Tool Outputs', 'none']]),
    ...(providerResults.length > 0
      ? [
          ...providerResults
            .slice(0, 10)
            .map((provider, index) => [
              index === 0 ? 'Provider Results' : '',
              formatProviderDebug(provider, index),
            ]),
          ...(providerResults.length > 10
            ? [['', `... ${providerResults.length - 10} more providers not shown`]]
            : []),
        ]
      : [['Provider Results', 'none']]),
    [
      'Recommendation Funnel',
      [
        `available_candidates=${recommendationFunnel.available_candidates}`,
        `context_candidates=${recommendationFunnel.context_candidates}`,
        `presentation_limit=${recommendationFunnel.presentation_limit}`,
        `context_candidate_ids=${recommendationFunnel.context_candidate_ids.join(', ') || 'none'}`,
      ].join('\n'),
    ],
    ['Plan Persisted', String(trace.plan_persisted)],
    ['Persist Reason', trace.plan_persist_reason ?? 'null'],
    [
      'Timing (agent pipeline)',
      [
        `total=${trace.timing_ms.total}ms`,
        `load_plan=${trace.timing_ms.load_plan}ms`,
        `prepare_working_plan=${trace.timing_ms.prepare_working_plan}ms`,
        `extraction=${trace.timing_ms.extraction}ms`,
        `apply_extraction=${trace.timing_ms.apply_extraction}ms`,
        `compute_sufficiency=${trace.timing_ms.compute_sufficiency}ms`,
        `provider_search=${trace.timing_ms.provider_search}ms`,
        `provider_enrichment=${trace.timing_ms.provider_enrichment}ms`,
        `prompt_bundle_load=${trace.timing_ms.prompt_bundle_load}ms`,
        `compose_reply=${trace.timing_ms.compose_reply}ms`,
        `save_plan=${trace.timing_ms.save_plan}ms`,
      ].join('\n'),
    ],
    [
      'Timing (transport)',
      invokeTiming
        ? `total=${invokeTiming.total}ms\nfetch=${invokeTiming.fetch}ms\nparse=${invokeTiming.parse}ms`
        : 'not captured',
    ],
    [
      'Timing (local CLI)',
      localTimingForDisplay
        ? [
            `render_reply=${localTimingForDisplay.render_reply_ms}ms`,
            `render_trace=${localTimingForDisplay.render_trace_ms}ms`,
            `load_plan=${localTimingForDisplay.load_plan_ms}ms`,
            `render_plan=${localTimingForDisplay.render_plan_ms}ms`,
            `render_raw=${localTimingForDisplay.render_raw_ms}ms`,
          ].join('\n')
        : 'not captured',
    ],
    [
      'Performance Insights',
      formatPerformanceInsights(trace, invokeTiming),
    ],
    [
      'Perf Record',
      perf
        ? [
            `trace_id=${perf.trace_id}`,
            `captured_at=${perf.captured_at}`,
            `persisted=${perf.persisted ?? 'unknown'} target=${perf.storage_target ?? 'n/a'}`,
            `runtime=${perf.runtime_latency_ms}ms extraction=${perf.extraction_latency_ms}ms compose=${perf.compose_latency_ms}ms`,
            `tools=${perf.tools_called_count} providers=${perf.provider_results_count}`,
            `funnel_context=${perf.recommendation_context_candidates ?? 'n/a'} presentation_limit=${perf.recommendation_presentation_limit ?? 'n/a'}`,
            `total_tokens=${perf.total_tokens ?? 'n/a'} cached_input=${perf.cached_input_tokens ?? 'n/a'}`,
            `cache_hit_rate=${
              perf.cache_hit_rate === null
                ? 'n/a'
                : `${(perf.cache_hit_rate * 100).toFixed(1)}%`
            }`,
            `extract_compose_ratio=${
              perf.extraction_to_compose_ratio === null
                ? 'n/a'
                : `${perf.extraction_to_compose_ratio.toFixed(2)}x`
            }`,
          ].join('\n')
        : 'not available in response',
    ],
    [
      'Token Usage',
      [
        trace.token_usage.extraction
          ? `extraction: ${formatTokenUsageWithCache(trace.token_usage.extraction)}`
          : 'extraction: not available',
        trace.token_usage.reply
          ? `reply: ${formatTokenUsageWithCache(trace.token_usage.reply)}`
          : 'reply: not available',
        trace.token_usage.total
          ? `overall: ${formatTokenUsageWithCache(trace.token_usage.total)}`
          : 'overall: not available',
      ].join('\n'),
    ],
  );

  output.write(`${table.toString()}\n`);
  return Date.now() - renderTraceStartedAt;
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
        .map((need, index) => formatProviderNeedDebug(need, index))
        .join('\n') || 'none',
    ],
    ['Category', plan.vendor_category ?? 'null'],
    ['Location', plan.location ?? 'null'],
    ['Budget', plan.budget_signal ?? 'null'],
    ['Guest Range', plan.guest_range ?? 'null'],
    ['Missing Fields', plan.missing_fields.join(', ') || 'none'],
    ['Selected Provider', String(plan.selected_provider_id ?? 'null')],
    ...(plan.recommended_providers.length > 0
      ? plan.recommended_providers.map((provider, index) => [
          index === 0 ? 'Recommended Providers' : '',
          formatProviderDebug(provider, index),
        ])
      : [['Recommended Providers', 'none']]),
    ['Summary', plan.conversation_summary || ''],
    ['Updated At', plan.updated_at],
  );

  output.write(`${table.toString()}\n`);

  if (fullPlan) {
    output.write(`${pc.gray(JSON.stringify(plan, null, 2))}\n`);
  }
}

function renderError(
  message: string,
  durationMs: number,
  invokeTiming?: InvokeTiming,
) {
  const invokeHint = invokeTiming
    ? ` · fetch ${invokeTiming.fetch}ms · parse ${invokeTiming.parse}ms`
    : '';
  output.write(
    `${boxen(message, {
      padding: 1,
      borderColor: 'red',
      title: `runtime error · ${durationMs}ms${invokeHint}`,
      titleAlignment: 'left',
    })}\n`,
  );
}

function formatInvokeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Request timed out before Lambda returned a response.';
    }
    return error.message;
  }
  return 'Unknown runtime invocation failure.';
}

function createTurnProgressReporter(args: {
  timeoutMs: number;
}): TurnProgressReporter {
  const spinnerFrames = ['-', '\\', '|', '/'];
  const startedAt = Date.now();
  let phase: ProgressPhase = 'sending_request';
  let frameIndex = 0;
  let wroteLine = false;
  const interval = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
    const spinner = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex += 1;

    const stageText = formatProgressPhase(phase);

    const timeoutShare = elapsedMs / args.timeoutMs;
    const timeoutHint =
      timeoutShare >= 0.85 ? ' [near timeout]' : '';
    const line = `${pc.gray(
      `${spinner} waiting ${elapsedSeconds}s · stage: ${stageText}${timeoutHint}`,
    )}`;
    output.write(`\r\x1b[2K${line}`);
    wroteLine = true;
  }, 250);

  return {
    setPhase(nextPhase: ProgressPhase) {
      phase = nextPhase;
    },
    stop() {
      clearInterval(interval);
      if (wroteLine) {
        output.write('\r\x1b[2K');
      }
    },
  };
}

function formatProgressPhase(phase: ProgressPhase): string {
  switch (phase) {
    case 'sending_request':
      return 'sending request';
    case 'waiting_response':
      return 'waiting lambda response';
    case 'parsing_response':
      return 'parsing response';
    case 'rendering_reply':
      return 'rendering agent reply';
    case 'rendering_trace':
      return 'rendering trace table';
    case 'loading_plan':
      return 'loading plan from dynamo';
    case 'rendering_plan':
      return 'rendering plan table';
    case 'rendering_raw':
      return 'rendering raw payload';
  }
}

function truncateForTrace(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n... [truncated ${omitted} chars]`;
}

function formatProviderNeedDebug(
  need: PlanSnapshot['provider_needs'][number],
  index: number,
): string {
  const selectedProvider =
    need.selected_provider_id !== null
      ? need.recommended_providers.find(
          (provider) => provider.id === need.selected_provider_id,
        ) ?? null
      : null;
  const selectedText =
    need.selected_provider_id !== null
      ? ` | selected=${selectedProvider?.title ?? need.selected_provider_id}`
      : '';

  return `${index + 1}. ${need.category} [${need.status}]${selectedText}`;
}

function formatProviderDebug(
  provider: PlanSnapshot['recommended_providers'][number],
  index: number,
): string {
  const lines = [
    `${index + 1}. ${provider.title} (${provider.id})`,
    `category=${provider.category ?? 'null'} | location=${provider.location ?? 'null'} | price=${provider.priceLevel ?? 'null'} | rating=${provider.rating ?? 'null'}`,
    `reason=${provider.reason ?? 'null'}`,
  ];

  if (provider.promoBadge || provider.promoSummary) {
    lines.push(
      `promo=${provider.promoBadge ?? 'null'} | promo_summary=${provider.promoSummary ?? 'null'}`,
    );
  }

  if (provider.minPrice || provider.maxPrice) {
    lines.push(
      `min_price=${provider.minPrice ?? 'null'} | max_price=${provider.maxPrice ?? 'null'}`,
    );
  }

  if (provider.descriptionSnippet) {
    lines.push(`description=${provider.descriptionSnippet}`);
  }

  if (provider.serviceHighlights.length > 0) {
    lines.push(`services=${provider.serviceHighlights.join(' | ')}`);
  }

  if (provider.termsHighlights.length > 0) {
    lines.push(`terms=${provider.termsHighlights.join(' | ')}`);
  }

  if (provider.detailUrl || provider.websiteUrl) {
    lines.push(
      `detail=${provider.detailUrl ?? 'null'} | website=${provider.websiteUrl ?? 'null'}`,
    );
  }

  return lines.join('\n');
}

function formatTokenUsageWithCache(usage: {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
}): string {
  const cachedInput = usage.cached_input_tokens ?? 0;
  const cacheHitRate = calculateCacheHitRate(usage.input_tokens, cachedInput);
  const estimatedInputSavings = cachedInput * 0.5;
  const effectiveInputTokens = usage.input_tokens - estimatedInputSavings;
  const cacheDetails =
    cacheHitRate !== null
      ? ` cached_input=${cachedInput} cache_hit_rate=${(cacheHitRate * 100).toFixed(1)}% est_input_savings=${estimatedInputSavings.toFixed(1)} effective_input=${effectiveInputTokens.toFixed(1)}`
      : '';
  return `input=${usage.input_tokens} output=${usage.output_tokens} total=${usage.total_tokens}${cacheDetails}`;
}

function formatPerformanceInsights(
  trace: TurnTrace,
  invokeTiming?: InvokeTiming,
): string {
  const insights: string[] = [];
  const extractionMs = trace.timing_ms.extraction;
  const composeMs = trace.timing_ms.compose_reply;
  const pipelineMs = trace.timing_ms.total;
  const transportMs = invokeTiming?.total ?? 0;
  const endToEndMs = pipelineMs + transportMs;

  const extractionToComposeRatio =
    composeMs > 0 ? extractionMs / composeMs : null;
  if (extractionToComposeRatio !== null) {
    insights.push(
      `extract_vs_compose_ratio=${extractionToComposeRatio.toFixed(2)}x`,
    );
  }

  if (endToEndMs > 0) {
    const pipelineShare = pipelineMs / endToEndMs;
    const transportShare = transportMs / endToEndMs;
    insights.push(
      `pipeline_share=${(pipelineShare * 100).toFixed(1)}% transport_share=${(transportShare * 100).toFixed(1)}%`,
    );
  }

  const totalUsage = trace.token_usage.total;
  if (totalUsage) {
    const cacheHitRate = calculateCacheHitRate(
      totalUsage.input_tokens,
      totalUsage.cached_input_tokens ?? 0,
    );
    if (cacheHitRate !== null) {
      const estimatedInputSavings = (totalUsage.cached_input_tokens ?? 0) * 0.5;
      const fullInputCost = totalUsage.input_tokens;
      const savingsPct =
        fullInputCost > 0 ? (estimatedInputSavings / fullInputCost) * 100 : 0;
      insights.push(
        `cache_hit_rate=${(cacheHitRate * 100).toFixed(1)}% est_input_cost_savings=${savingsPct.toFixed(1)}%`,
      );
    }
  }

  if (insights.length === 0) {
    return 'not enough telemetry yet';
  }

  return insights.join('\n');
}

function calculateCacheHitRate(
  inputTokens: number,
  cachedInputTokens: number,
): number | null {
  if (inputTokens <= 0) {
    return null;
  }
  return Math.min(Math.max(cachedInputTokens / inputTokens, 0), 1);
}
