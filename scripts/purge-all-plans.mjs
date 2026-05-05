#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { Command } from 'commander';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const program = new Command();

program
  .name('purge-all-plans')
  .description('Delete all DynamoDB plan entries. Development-use only.')
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
    '--region <region>',
    'AWS region',
    process.env.AWS_REGION ?? 'us-east-1',
  )
  .option(
    '--profile <profile>',
    'AWS profile',
    process.env.AWS_PROFILE ?? 'se-dev',
  )
  .option('--dry-run', 'List matching items without deleting them', false)
  .option('--yes', 'Execute deletion without an extra confirmation guard', false);

program.parse();
const options = program.opts();

if (!options.dryRun && !options.yes) {
  console.error(
    'Refusing to delete without --yes. Use --dry-run first if you want to inspect matching items.',
  );
  process.exit(1);
}

const awsEnv = {
  ...process.env,
  AWS_PROFILE: options.profile,
  AWS_REGION: options.region,
  AWS_SDK_LOAD_CONFIG: '1',
  AWS_PAGER: '',
};

const tableName = resolveTableName({
  explicitTableName: options.table,
  stackName: options.stackName,
  env: awsEnv,
});

const items = scanAllPlans({
  tableName,
  env: awsEnv,
});

if (items.length === 0) {
  printResult({
    tableName,
    matched: 0,
    deleted: 0,
    dryRun: options.dryRun,
  });
  process.exit(0);
}

if (options.dryRun) {
  printResult({
    tableName,
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

function scanAllPlans({ tableName, env }) {
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
      'sk = :plan',
      '--expression-attribute-values',
      JSON.stringify({
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
