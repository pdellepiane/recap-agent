#!/usr/bin/env node
/**
 * Support-lane measurement over the turn performance records.
 *
 * Reports the three numbers the implementation package asks for after the
 * router goes live:
 *   1. the escalation rate on purchase-support turns,
 *   2. the unresolved money loops that ran longer than three turns,
 *   3. the human-takeover success rate.
 *
 * Everything is derived from the persisted perf records (read-only). A turn
 * counts as a purchase-support turn when it answered the customer-assistance
 * node; a turn counts as an unresolved money turn when its purchase read came
 * back without results, which is the shape the dossier loops had. A thread
 * counts as an unresolved money loop when that shape repeats for more than
 * three consecutive turns.
 *
 * AWS access goes through the required profile (se-dev / us-east-1 / account
 * 684516060775). Nothing is written and no secret is printed.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import dotenv from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { assertRequiredAwsIdentity, createRequiredAwsEnv } from './aws-profile.mjs';

const DEFAULT_STACK_NAME = process.env.DEV_STACK_NAME ?? 'recap-agent-runtime-dev';
const SUPPORT_NODE = 'resolver_consultas_informativas';
const LOOP_TURN_THRESHOLD = 3;

function loadLocalEnvironment() {
  const root = process.cwd();
  dotenv.config({ path: path.join(root, '.env') });
  dotenv.config({ path: path.join(root, '.env.development') });
}

function parseArgs(argv) {
  const args = { stackName: DEFAULT_STACK_NAME, since: null, until: null, table: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${token}.`);
      return argv[index];
    };
    switch (token) {
      case '--stack-name': args.stackName = next(); break;
      case '--since': args.since = next(); break;
      case '--until': args.until = next(); break;
      case '--table': args.table = next(); break;
      case '--json': args.json = true; break;
      case '--help':
      case '-h':
        process.stdout.write([
          'Usage: node scripts/measure-support-lane.mjs [--since ISO] [--until ISO] [--table name]',
          '',
          '  --since ISO   Only turns captured at or after this instant.',
          '  --until ISO   Only turns captured at or before this instant.',
          '  --table name  Perf table (default: the stack PerfTableName output).',
          '',
        ].join('\n'));
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
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
  const map = {};
  for (const entry of JSON.parse(output)) map[entry.OutputKey] = entry.OutputValue;
  return map;
}

function isPurchaseSupportTurn(record) {
  if (record.next_node === SUPPORT_NODE) return true;
  const faqTurn = record.feedback_signals?.routing?.faq_turn;
  return faqTurn === true;
}

function isUnresolvedMoneyTurn(record) {
  const summaries = record.information_execution_summary ?? [];
  const purchaseSummaries = summaries.filter((entry) => entry.kind === 'purchase');
  if (purchaseSummaries.length === 0) return false;
  return purchaseSummaries.every((entry) =>
    entry.status === 'completed' && entry.outcomeCode === 'completed_without_results');
}

function measure(records) {
  const threads = new Map();
  let supportTurns = 0;
  let escalationTurns = 0;
  let takeoverAttempts = 0;
  let takeoverSuccesses = 0;

  for (const record of records) {
    if (!isPurchaseSupportTurn(record)) continue;
    supportTurns += 1;
    if (record.route_kind === 'human_escalation') escalationTurns += 1;
    if (record.human_takeover_attempted === true) takeoverAttempts += 1;
    if (record.human_takeover_succeeded === true) takeoverSuccesses += 1;

    const key = record.conversation_hash ?? record.plan_id ?? 'unknown';
    const entry = threads.get(key) ?? { turns: 0, unresolvedRun: 0, longestUnresolvedRun: 0 };
    entry.turns += 1;
    if (isUnresolvedMoneyTurn(record)) {
      entry.unresolvedRun += 1;
      entry.longestUnresolvedRun = Math.max(entry.longestUnresolvedRun, entry.unresolvedRun);
    } else {
      entry.unresolvedRun = 0;
    }
    threads.set(key, entry);
  }

  const longLoops = [...threads.entries()].filter(
    ([, entry]) => entry.longestUnresolvedRun > LOOP_TURN_THRESHOLD,
  );

  return {
    support_turns: supportTurns,
    escalation_turns: escalationTurns,
    escalation_rate: supportTurns === 0 ? null : escalationTurns / supportTurns,
    takeover_attempts: takeoverAttempts,
    takeover_successes: takeoverSuccesses,
    takeover_success_rate: takeoverAttempts === 0 ? null : takeoverSuccesses / takeoverAttempts,
    threads_observed: threads.size,
    unresolved_money_loops_over_threshold: longLoops.length,
    unresolved_money_loop_threads: longLoops.map(([key, entry]) => ({
      conversation_hash: key.slice(0, 12),
      turns: entry.turns,
      longest_unresolved_run: entry.longestUnresolvedRun,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnvironment();
  const awsEnv = createRequiredAwsEnv();
  assertRequiredAwsIdentity(awsEnv);
  Object.assign(process.env, {
    AWS_PROFILE: awsEnv.AWS_PROFILE,
    AWS_REGION: awsEnv.AWS_REGION,
    AWS_SDK_LOAD_CONFIG: awsEnv.AWS_SDK_LOAD_CONFIG,
  });

  const outputs = stackOutputs(awsEnv, args.stackName);
  const table = args.table ?? process.env.DEV_PERF_TABLE_NAME ?? outputs.PerfTableName;
  if (!table) throw new Error(`Unable to resolve the perf table for ${args.stackName}.`);

  const documentClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: awsEnv.AWS_REGION }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  const records = [];
  let exclusiveStartKey;
  do {
    const page = await documentClient.send(new ScanCommand({
      TableName: table,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of page.Items ?? []) {
      if (args.since && item.captured_at < args.since) continue;
      if (args.until && item.captured_at > args.until) continue;
      records.push(item);
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const result = measure(records);
  if (args.json) {
    console.log(JSON.stringify({ table, sampled_records: records.length, ...result }, null, 2));
    return;
  }
  const line = (label, value) => console.log(`  ${label.padEnd(38)} ${value}`);
  console.log(`--- support lane measurement (${table}) ------------------------`);
  line('sampled records', records.length);
  line('purchase-support turns', result.support_turns);
  line('escalation turns', result.escalation_turns);
  line('escalation rate', result.escalation_rate === null ? 'n/a' : result.escalation_rate.toFixed(3));
  line('takeover attempts', result.takeover_attempts);
  line('takeover successes', result.takeover_successes);
  line('takeover success rate', result.takeover_success_rate === null ? 'n/a' : result.takeover_success_rate.toFixed(3));
  line('threads observed', result.threads_observed);
  line(`unresolved money loops > ${LOOP_TURN_THRESHOLD} turns`, result.unresolved_money_loops_over_threshold);
  for (const loop of result.unresolved_money_loop_threads) {
    line('  loop thread', JSON.stringify(loop));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
