#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { Command } from 'commander';
import dotenv from 'dotenv';

import { assertRequiredAwsIdentity, createRequiredAwsEnv, REQUIRED_AWS_PROFILE } from './aws-profile.mjs';

dotenv.config({ quiet: true });

const program = new Command();

program
  .name('purge-terminal-plans')
  .description('Delete DynamoDB plan entries that belong to the terminal test channel.')
  .option(
    '--stack-name <name>',
    'CloudFormation stack name used to resolve the plans table',
    process.env.STACK_NAME ?? 'recap-agent-runtime',
  )
  .option(
    '--table <name>',
    'Explicit DynamoDB table name. Overrides CloudFormation lookup.',
  )
  .option(
    '--channel <channel>',
    'Exact channel prefix to purge',
    process.env.TERMINAL_CHANNEL ?? 'terminal_whatsapp',
  )
  .option(
    '--phone <phone>',
    'Reset every item for one synthetic 51900xxxxxx phone; development only. ' +
      'The value must equal the probe --user-id (no leading +); a leading + is accepted and stripped.',
  )
  .option(
    '--region <region>',
    'AWS region',
    process.env.AWS_REGION ?? 'us-east-1',
  )
  .option(
    '--profile <profile>',
    `AWS profile; only ${REQUIRED_AWS_PROFILE} is allowed`,
    process.env.AWS_PROFILE ?? REQUIRED_AWS_PROFILE,
  )
  .option('--dry-run', 'List matching items without deleting them', false)
  .option('--yes', 'Execute deletion without an extra confirmation guard', false);

program.parse();
const options = program.opts();

if (options.phone !== undefined) {
  if (!['whatsapp', 'terminal_whatsapp'].includes(options.channel)) {
    throw new Error('Phone-scoped reset allows only whatsapp or terminal_whatsapp.');
  }
  if (options.table !== 'recap-agent-runtime-dev-plans') {
    throw new Error('Phone-scoped reset requires --table recap-agent-runtime-dev-plans.');
  }
  normalizeSyntheticPhone(options.phone);
}

if (!options.dryRun && !options.yes) {
  console.error(
    'Refusing to delete without --yes. Use --dry-run first if you want to inspect matching items.',
  );
  process.exit(1);
}

const awsEnv = createRequiredAwsEnv({
  ...process.env,
  AWS_PROFILE: options.profile,
  AWS_REGION: options.region,
});
assertRequiredAwsIdentity(awsEnv);

if (options.phone !== undefined) {
  const tableName = options.table;
  const phone = normalizeSyntheticPhone(options.phone);
  const pk = `${options.channel}#${phone}`;
  reportPartition({ pk, phone, count: null });
  const before = queryConversationItems({ tableName, pk, env: awsEnv });
  reportPartition({ pk, phone, count: before.length });
  if (options.dryRun) {
    printResult({ tableName, pk, phone, dryRun: true, before, matched: before.length, deleted: 0 });
    process.exit(0);
  }
  for (const item of before) {
    runAwsJson([
      'dynamodb', 'delete-item', '--table-name', tableName,
      '--key', JSON.stringify({ pk: item.pk, sk: item.sk }), '--output', 'json',
    ], awsEnv);
  }
  const after = queryConversationItems({ tableName, pk, env: awsEnv });
  printResult({ tableName, pk, phone, dryRun: false, before, after, deleted: before.length, remaining: after.length });
  reportPartition({ pk, phone, count: after.length, phase: 'after reset' });
  if (after.length !== 0) {
    throw new Error('Reset incomplete: conversation items remain. Stop concurrent turns before retrying.');
  }
  process.exit(0);
}

const tableName = resolveTableName({
  explicitTableName: options.table,
  stackName: options.stackName,
  env: awsEnv,
});

const items = scanTerminalPlans({
  tableName,
  pkPrefix: `${options.channel}#`,
  env: awsEnv,
});

if (items.length === 0) {
  printResult({
    tableName,
    channel: options.channel,
    matched: 0,
    deleted: 0,
    dryRun: options.dryRun,
  });
  process.exit(0);
}

if (options.dryRun) {
  printResult({
    tableName,
    channel: options.channel,
    matched: items.length,
    deleted: 0,
    dryRun: true,
    items: items.map((item) => ({
      pk: item.pk?.S ?? null,
      sk: item.sk?.S ?? null,
      reason: item.reason?.S ?? null,
      updated_at: item.updated_at?.S ?? null,
    })),
  });
  process.exit(0);
}

deleteItems({
  tableName,
  items,
  env: awsEnv,
});

printResult({
  tableName,
  channel: options.channel,
  matched: items.length,
  deleted: items.length,
  dryRun: false,
});

function resolveTableName({ explicitTableName, stackName, env }) {
  if (explicitTableName) {
    return explicitTableName;
  }

  if (process.env.PLANS_TABLE_NAME) {
    return process.env.PLANS_TABLE_NAME;
  }

  return runAwsJson(
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--query',
      "Stacks[0].Outputs[?OutputKey=='PlansTableName'].OutputValue | [0]",
      '--output',
      'text',
    ],
    env,
  ).trim();
}

/**
 * The runtime writes conversation state under `channel#externalUserId`, where
 * the external user id is the OPAQUE value the probe passes as `--user-id`.
 * The probe uses the bare digits (51900000403); only `--contact-phone` carries
 * the `+`. A leading `+` is therefore stripped here so both spellings resolve
 * to the SAME partition instead of a partition the runtime never writes.
 */
function normalizeSyntheticPhone(rawPhone) {
  const phone = rawPhone.trim().replace(/^\+/, '');
  if (!/^51900\d{6}$/.test(phone)) {
    throw new Error(
      `Phone-scoped reset requires a synthetic 51900xxxxxx phone (11 digits, Peru test range), ` +
        `the same digits the probe passes as --user-id. Received: ${rawPhone}`,
    );
  }
  return phone;
}

/**
 * Prints the exact partition key the reset touched, so the operator can
 * compare it with the probe's --user-id. A zero count is reported loudly:
 * on a real conversation phone it means the identifier form was wrong, not
 * that there was nothing to clean.
 */
function reportPartition({ pk, phone, count, phase }) {
  if (count === null) {
    console.error(`Phone-scoped reset target: pk=${pk} (phone=${phone})`);
    return;
  }
  const label = phase ? `items in ${pk} ${phase}` : `items in ${pk}`;
  console.error(`Phone-scoped reset: ${count} ${label}.`);
  if (count === 0 && phase === undefined) {
    console.error(
      `WARNING: 0 items found for pk=${pk}. The runtime keys conversation state as ` +
        `channel#user_id with the probe's --user-id verbatim (no leading +). ` +
        `If this phone has a real conversation, the identifier form is wrong and the reset did nothing.`,
    );
  }
}

function queryConversationItems({ tableName, pk, env }) {
  const items = [];
  let cursor;
  do {
    const args = [
      'dynamodb', 'query', '--table-name', tableName, '--consistent-read', '--no-paginate',
      '--key-condition-expression', 'pk = :pk',
      '--expression-attribute-values', JSON.stringify({ ':pk': { S: pk } }),
      '--output', 'json',
    ];
    if (cursor) args.push('--exclusive-start-key', JSON.stringify(cursor));
    const response = JSON.parse(runAwsJson(args, env));
    for (const item of response.Items ?? []) {
      if (item.pk?.S !== pk || typeof item.sk?.S !== 'string') {
        throw new Error('Query returned an invalid or out-of-scope conversation key.');
      }
      items.push(item);
    }
    cursor = response.LastEvaluatedKey;
  } while (cursor && Object.keys(cursor).length > 0);
  return items;
}

function scanTerminalPlans({ tableName, pkPrefix, env }) {
  const items = [];
  let exclusiveStartKey = null;

  while (true) {
    const args = [
      'dynamodb',
      'scan',
      '--table-name',
      tableName,
      '--projection-expression',
      'pk, sk, reason, updated_at',
      '--filter-expression',
      'begins_with(pk, :pkPrefix) AND sk = :plan',
      '--expression-attribute-values',
      JSON.stringify({
        ':pkPrefix': { S: pkPrefix },
        ':plan': { S: 'PLAN' },
      }),
      '--output',
      'json',
    ];

    if (exclusiveStartKey) {
      args.push('--exclusive-start-key', JSON.stringify(exclusiveStartKey));
    }

    const response = JSON.parse(runAwsJson(args, env));
    items.push(...(response.Items ?? []));

    if (!response.LastEvaluatedKey) {
      return items;
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  }
}

function deleteItems({ tableName, items, env }) {
  for (let index = 0; index < items.length; index += 25) {
    const batch = items.slice(index, index + 25);
    const requestItems = {
      [tableName]: batch.map((item) => ({
        DeleteRequest: {
          Key: {
            pk: item.pk,
            sk: item.sk,
          },
        },
      })),
    };

    runAwsJson(
      [
        'dynamodb',
        'batch-write-item',
        '--request-items',
        JSON.stringify(requestItems),
        '--output',
        'json',
      ],
      env,
    );
  }
}

function runAwsJson(args, env) {
  return execFileSync('aws', args, {
    env,
    encoding: 'utf8',
  });
}

function printResult(payload) {
  console.log(JSON.stringify(payload, null, 2));
}
