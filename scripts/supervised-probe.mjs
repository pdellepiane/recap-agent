#!/usr/bin/env node
/**
 * Supervised end-to-end probe for the development Lambda.
 *
 * One turn per invocation. The operator (a human or an orchestrating agent)
 * decides WHAT to say next; this script only carries the turn, the fixture
 * identity and the observation back. It never invents a message, so a probe
 * never overfits to a scripted phrase.
 *
 * SAFETY: the fixture scenario is REQUIRED. Every turn runs against the mocked
 * development fixture backend, never a real customer or a production record,
 * and the only writes are inside the development environment (the fixture
 * effect ledger and the development plan/perf tables).
 *
 * The turn is invoked in channel mode, so the delivered message is the exact
 * text the customer would receive (the CLI mode returns a redacted copy).
 * The state facts are read afterwards, read-only, from the development plan
 * and perf tables.
 *
 * AWS access goes through the required profile (se-dev / us-east-1 / account
 * 684516060775). No secret is ever printed.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { assertRequiredAwsIdentity, createRequiredAwsEnv } from './aws-profile.mjs';

const DEFAULT_STACK_NAME = process.env.DEV_STACK_NAME ?? 'recap-agent-runtime-dev';

function loadLocalEnvironment() {
  const root = process.cwd();
  dotenv.config({ path: path.join(root, '.env') });
  dotenv.config({ path: path.join(root, '.env.development') });
}

function parseArgs(argv) {
  const args = {
    text: null,
    scenario: null,
    userId: null,
    channel: 'whatsapp',
    contactPhone: null,
    sessionId: null,
    image: null,
    runId: null,
    caseId: null,
    stackName: DEFAULT_STACK_NAME,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${token}.`);
      return argv[index];
    };
    switch (token) {
      case '--text': args.text = next(); break;
      case '--scenario': args.scenario = next(); break;
      case '--user-id': args.userId = next(); break;
      case '--channel': args.channel = next(); break;
      case '--contact-phone': args.contactPhone = next(); break;
      case '--session-id': args.sessionId = next(); break;
      case '--image': args.image = next(); break;
      case '--run-id': args.runId = next(); break;
      case '--case-id': args.caseId = next(); break;
      case '--stack-name': args.stackName = next(); break;
      case '--json': args.json = true; break;
      case '--help':
      case '-h':
        process.stdout.write(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (args.text === null) throw new Error('--text is required.');
  if (args.userId === null) throw new Error('--user-id is required.');
  if (args.scenario === null) {
    throw new Error(
      '--scenario is required: the probe runs only against a mocked development fixture, never a real backend.',
    );
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/supervised-probe.mjs --user-id <id> --text "<message>" --scenario <id>',
    '',
    '  --scenario <id>   Backend fixture scenario (REQUIRED: mocked dev backend only).',
    '  --run-id <id>     Fixture run id. Defaults to a fresh id per invocation.',
    '  --case-id <id>    Fixture case id. Defaults to the scenario name.',
    '  --contact-phone   Contact phone (defaults to the user id). Required for WhatsApp.',
    '  --session-id <s>  Session id, so a conversation keeps one plan.',
    '  --image <path>    Local image file to send with the turn (base64).',
    '  --channel <name>  Channel (default: whatsapp).',
    '  --stack-name <s>  CloudFormation stack (default: recap-agent-runtime-dev).',
    '  --json            Print the raw Lambda payload instead of the summary.',
    '',
  ].join('\n');
}

function stackOutputs(awsEnv, stackName) {
  const output = execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json',
    ],
    { env: awsEnv, encoding: 'utf8' },
  );
  const outputs = JSON.parse(output);
  const map = {};
  for (const entry of outputs) map[entry.OutputKey] = entry.OutputValue;
  return map;
}

function readImagePayload(imagePath) {
  const absolute = path.resolve(imagePath);
  const bytes = fs.readFileSync(absolute);
  if (bytes.length > 2_000_000) throw new Error('Image exceeds the 2 MB inbound limit.');
  const extension = path.extname(absolute).toLowerCase();
  const mimeType = extension === '.jpg' || extension === '.jpeg'
    ? 'image/jpeg'
    : extension === '.webp'
      ? 'image/webp'
      : 'image/png';
  return { data: bytes.toString('base64'), mime_type: mimeType };
}

async function readPlan(documentClient, plansTable, channel, userId) {
  const result = await documentClient.send(new GetCommand({
    TableName: plansTable,
    Key: { pk: `${channel}#${userId}`, sk: 'PLAN' },
    ConsistentRead: true,
  }));
  return result.Item ?? null;
}

async function readPerfRecord(documentClient, perfTable, channel, userId, traceId) {
  const gsi1pk = `CHANNEL_USER#${channel}#${sha256(userId)}`;
  const result = await documentClient.send(new QueryCommand({
    TableName: perfTable,
    IndexName: 'channel-user-turns',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: { ':pk': gsi1pk },
    ScanIndexForward: false,
    Limit: 25,
  }));
  const items = result.Items ?? [];
  return items.find((item) => item.trace_id === traceId) ?? null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function summarize({ payload, plan, perf }) {
  const timing = perf?.timing_ms ?? {};
  const tokens = perf?.token_usage ?? {};
  const calls = perf?.openai_calls ?? {};
  const stages = ['classifier', 'extraction', 'reply', 'router'];
  const health = plan?.conversation_health ?? {};
  const outcome = plan?.support_outcome ?? {};
  const escalation = plan?.human_escalation ?? {};
  const receipt = plan?.human_help_receipt ?? null;
  const feedback = perf?.feedback_signals ?? {};
  return {
    message: payload.message ?? null,
    delivery: payload.delivery ?? null,
    current_node: payload.current_node ?? null,
    trace_id: payload.trace_id ?? null,
    route_kind: perf?.route_kind ?? null,
    next_node: perf?.next_node ?? null,
    stop_reason: perf?.turn_decision?.stopReason ?? perf?.turn_decision?.stop_reason ?? null,
    operational_note: perf?.operational_note ?? null,
    model_stages: stages.filter((stage) => tokens[stage] != null),
    timing_ms: {
      total: timing.total ?? null,
      router: timing.router ?? null,
      classifier: timing.response_classification ?? null,
      extraction: timing.extraction ?? null,
      reply: timing.compose_reply ?? null,
    },
    token_usage: Object.fromEntries(
      stages.filter((stage) => tokens[stage] != null).map((stage) => [stage, tokens[stage]]),
    ),
    models: Object.fromEntries(
      stages.filter((stage) => calls[stage] != null).map((stage) => [stage, calls[stage].model]),
    ),
    conversation_health: {
      status: health.status ?? null,
      reason: health.reason ?? null,
      help_offer_status: health.help_offer_status ?? null,
      consecutive_non_progress_turns: health.consecutive_non_progress_turns ?? null,
      capability_blocked_streak: health.capability_blocked_streak ?? null,
    },
    support_outcome: {
      signature: outcome.signature ?? null,
      repeat_count: outcome.repeat_count ?? null,
      unresolved_money: outcome.unresolved_money ?? null,
      reported_payment: outcome.reported_payment ?? null,
    },
    human_escalation: {
      status: escalation.status ?? null,
      requested_at: escalation.requested_at ?? null,
      last_error: escalation.last_error ?? null,
    },
    human_help_receipt: receipt
      ? { outcome: receipt.outcome, requested: receipt.requested, softPaused: receipt.softPaused }
      : null,
    takeover: {
      attempted: perf?.human_takeover_attempted ?? null,
      succeeded: perf?.human_takeover_succeeded ?? null,
    },
    information_execution: (perf?.information_execution_summary ?? []).map((entry) => ({
      kind: entry.kind,
      status: entry.status,
      outcomeCode: entry.outcomeCode ?? null,
    })),
    feedback: {
      model_call_stages: feedback.execution?.model_call_stages ?? null,
      model_call_count: feedback.execution?.model_call_count ?? null,
      decision_source: feedback.routing?.decision_source ?? null,
      next_node: feedback.routing?.next_node ?? null,
    },
    runtime_latency_ms: perf?.runtime_latency_ms ?? null,
  };
}

function printSummary(summary) {
  const line = (label, value) => console.log(`  ${label.padEnd(24)} ${value}`);
  console.log('--- delivered ---------------------------------------------');
  console.log(summary.message ?? '(no message)');
  console.log('--- observed ---------------------------------------------');
  line('delivery', JSON.stringify(summary.delivery));
  line('node', summary.current_node);
  line('route_kind', summary.route_kind);
  line('next_node', summary.next_node);
  line('stop_reason', summary.stop_reason);
  line('operational_note', summary.operational_note);
  line('model stages', summary.model_stages.join(', ') || '(none)');
  line('timing ms', JSON.stringify(summary.timing_ms));
  line('token usage', JSON.stringify(summary.token_usage));
  line('models', JSON.stringify(summary.models));
  line('health', JSON.stringify(summary.conversation_health));
  line('support_outcome', JSON.stringify(summary.support_outcome));
  line('human_escalation', JSON.stringify(summary.human_escalation));
  line('help receipt', JSON.stringify(summary.human_help_receipt));
  line('takeover', JSON.stringify(summary.takeover));
  line('information', JSON.stringify(summary.information_execution));
  line('feedback', JSON.stringify(summary.feedback));
  line('runtime latency ms', summary.runtime_latency_ms);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnvironment();
  const awsEnv = createRequiredAwsEnv();
  assertRequiredAwsIdentity(awsEnv);
  // The AWS SDK resolves the profile from the process environment.
  Object.assign(process.env, {
    AWS_PROFILE: awsEnv.AWS_PROFILE,
    AWS_REGION: awsEnv.AWS_REGION,
    AWS_SDK_LOAD_CONFIG: awsEnv.AWS_SDK_LOAD_CONFIG,
  });

  const channelApiKey = process.env.DEV_CHANNEL_API_KEY;
  if (!channelApiKey) throw new Error('DEV_CHANNEL_API_KEY is required to invoke development.');

  const outputs = stackOutputs(awsEnv, args.stackName);
  const functionUrl = process.env.DEV_AGENT_FUNCTION_URL ?? outputs.FunctionUrl;
  if (!functionUrl) throw new Error(`No FunctionUrl output in stack ${args.stackName}.`);
  const plansTable = process.env.DEV_PLANS_TABLE_NAME ?? outputs.PlansTableName;
  const perfTable = process.env.DEV_PERF_TABLE_NAME ?? outputs.PerfTableName;
  if (!plansTable || !perfTable) {
    throw new Error(`Unable to resolve the development plan/perf tables for ${args.stackName}.`);
  }

  const body = {
    channel: args.channel,
    user_id: args.userId,
    text: args.text,
    message_id: crypto.randomUUID(),
    received_at: new Date().toISOString(),
    contact_phone: args.contactPhone ?? args.userId,
    backendFixture: {
      scenario: args.scenario,
      runId: args.runId ?? `supervised-${crypto.randomUUID()}`,
      caseId: args.caseId ?? args.scenario,
    },
  };
  if (args.sessionId) body.session_id = args.sessionId;
  if (args.image) body.image = readImagePayload(args.image);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${channelApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json();
  const elapsed = Date.now() - startedAt;

  if (!response.ok) {
    console.error(`Turn failed (${response.status}) after ${elapsed} ms: ${payload.error ?? 'unknown error'}`);
    process.exitCode = 1;
    return;
  }
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsEnv.AWS_REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const plan = await readPlan(documentClient, plansTable, args.channel, args.userId);
  const perf = payload.trace_id
    ? await readPerfRecord(documentClient, perfTable, args.channel, args.userId, payload.trace_id)
    : null;

  console.log(`--- turn (${elapsed} ms wall) ------------------------------------`);
  printSummary(summarize({ payload, plan, perf }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
