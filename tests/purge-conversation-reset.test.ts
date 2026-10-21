import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const phone = '51900000403';
const pk = `whatsapp#${phone}`;
const script = path.resolve('scripts/purge-terminal-plans.mjs');
const keys = ['PLAN', 'TURN_LOCK', 'SESSION#one', 'SESSION#two', 'RSVP_EFFECT#message', 'FUTURE#item'];

function fixture(extraEnv: Record<string, string> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'reset-completeness-'));
  directories.push(directory);
  const state = path.join(directory, 'state.json');
  const calls = path.join(directory, 'calls.jsonl');
  writeFileSync(state, JSON.stringify([
    ...keys.map((sk) => ({ pk: { S: pk }, sk: { S: sk } })),
    { pk: { S: 'whatsapp#51900000992' }, sk: { S: 'PLAN' } },
    { pk: { S: `whatsapp#+${phone}` }, sk: { S: 'PLAN' } },
  ]));
  writeFileSync(path.join(directory, 'aws'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_CALLS, JSON.stringify(args) + '\\n');
const value = (flag) => args[args.indexOf(flag) + 1];
let items = JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'));
if (args[0] === 'sts') {
  console.log(process.env.MOCK_ACCOUNT || '684516060775');
} else if (args[1] === 'query') {
  const pk = JSON.parse(value('--expression-attribute-values'))[':pk'].S;
  items = items.filter((item) => item.pk.S === pk);
  const cursor = args.includes('--exclusive-start-key') ? JSON.parse(value('--exclusive-start-key')) : null;
  const start = cursor ? items.findIndex((item) => item.sk.S === cursor.sk.S) + 1 : 0;
  const page = items.slice(start, start + 1);
  console.log(JSON.stringify({ Items: page, ...(start + 1 < items.length ? { LastEvaluatedKey: page[0] } : {}) }));
} else if (args[1] === 'delete-item') {
  const key = JSON.parse(value('--key'));
  if (!process.env.MOCK_KEEP_ITEMS) items = items.filter((item) => item.pk.S !== key.pk.S || item.sk.S !== key.sk.S);
  fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(items));
  console.log('{}');
} else { throw new Error('Unexpected AWS operation'); }
`, { mode: 0o755 });
  return {
    state,
    calls,
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
      AWS_PROFILE: 'se-dev',
      AWS_REGION: 'us-east-1',
      MOCK_STATE: state,
      MOCK_CALLS: calls,
      ...extraEnv,
    },
  };
}

function args(channel = 'whatsapp', testPhone = phone) {
  return [script, '--table', 'recap-agent-runtime-dev-plans', '--channel', channel, '--phone', testPhone];
}

function run(mock: ReturnType<typeof fixture>, argumentsList: string[]) {
  return spawnSync(process.execPath, argumentsList, { env: mock.env, encoding: 'utf8' });
}

function readCalls(mock: ReturnType<typeof fixture>): string {
  return existsSync(mock.calls) ? readFileSync(mock.calls, 'utf8') : '';
}

function queriedPartitionKeys(mock: ReturnType<typeof fixture>): string[] {
  return readCalls(mock)
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[])
    .filter((call) => call[1] === 'query')
    .map((call) => {
      const values = call[call.indexOf('--expression-attribute-values') + 1];
      return (JSON.parse(values) as { ':pk': { S: string } })[':pk'].S;
    });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('phone-scoped conversation reset', () => {
  it('paginates every sort key, deletes all conversation items, and lists zero remaining', () => {
    const mock = fixture();
    const output: unknown = JSON.parse(execFileSync(process.execPath, [...args(), '--yes'], {
      env: mock.env, encoding: 'utf8',
    }));
    expect(output).toMatchObject({ remaining: 0, after: [], deleted: keys.length });
    expect(JSON.parse(readFileSync(mock.state, 'utf8'))).toEqual([
      { pk: { S: 'whatsapp#51900000992' }, sk: { S: 'PLAN' } },
      { pk: { S: `whatsapp#+${phone}` }, sk: { S: 'PLAN' } },
    ]);
    const calls = readCalls(mock).trim().split('\n')
      .map((line) => JSON.parse(line) as string[]);
    const queries = calls.filter((call) => call[1] === 'query');
    expect(queries).toHaveLength(keys.length + 1);
    for (const query of queries) {
      expect(query).toContain('--consistent-read');
      expect(query).toContain('--no-paginate');
      expect(query).not.toContain('--filter-expression');
    }
  });

  it('dry-run lists every item without deleting', () => {
    const mock = fixture();
    const output: unknown = JSON.parse(execFileSync(process.execPath, [...args(), '--dry-run'], {
      env: mock.env, encoding: 'utf8',
    }));
    expect(output).toMatchObject({ matched: keys.length, deleted: 0, dryRun: true });
    expect(readCalls(mock)).not.toContain('delete-item');
  });

  it('fails if the post-reset query finds surviving items', () => {
    const mock = fixture({ MOCK_KEEP_ITEMS: '1' });
    const result = run(mock, [...args(), '--yes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Reset incomplete');
  });

  it('rejects the wrong account before accessing DynamoDB', () => {
    const mock = fixture({ MOCK_ACCOUNT: '000000000000' });
    const result = run(mock, [...args(), '--yes']);
    expect(result.status).not.toBe(0);
    expect(readCalls(mock)).not.toContain('dynamodb');
  });

  it.each([
    [...args('whatsapp', '+51987654321'), '--yes'],
    [...args('other'), '--yes'],
    [...args(), '--table', 'recap-agent-runtime-prod-plans', '--yes'],
    [...args(), '--profile', 'default', '--yes'],
    [...args(), '--region', 'us-west-2', '--yes'],
    args(),
  ])('rejects unsafe scope or missing confirmation: %j', (...argumentsList) => {
    const mock = fixture();
    const result = run(mock, argumentsList);
    expect(result.status).not.toBe(0);
  });
});

describe('conversation partition key convention', () => {
  it('builds whatsapp#51900000403 for the bare probe --user-id, with no leading +', () => {
    const mock = fixture();
    const output: unknown = JSON.parse(execFileSync(process.execPath, [...args(), '--dry-run'], {
      env: mock.env, encoding: 'utf8',
    }));
    expect(output).toMatchObject({ pk: 'whatsapp#51900000403', phone: '51900000403' });
    expect(new Set(queriedPartitionKeys(mock))).toEqual(new Set(['whatsapp#51900000403']));
  });

  it('resolves the +51900000403 form to the same partition', () => {
    const mock = fixture();
    const output: unknown = JSON.parse(execFileSync(process.execPath, [...args('whatsapp', `+${phone}`), '--dry-run'], {
      env: mock.env, encoding: 'utf8',
    }));
    expect(output).toMatchObject({ pk: 'whatsapp#51900000403', phone: '51900000403' });
    expect(new Set(queriedPartitionKeys(mock))).toEqual(new Set(['whatsapp#51900000403']));
  });

  it('never targets the plus-prefixed partition the runtime does not write', () => {
    const mock = fixture();
    run(mock, [...args(), '--yes']);
    const partitions = queriedPartitionKeys(mock);
    expect(partitions).not.toContain(`whatsapp#+${phone}`);
    expect(partitions.every((value) => value === 'whatsapp#51900000403')).toBe(true);
  });

  it('reports the exact partition key and item count to the operator', () => {
    const mock = fixture();
    const result = run(mock, [...args(), '--dry-run']);
    expect(result.stderr).toContain('pk=whatsapp#51900000403');
    expect(result.stderr).toContain(`${keys.length} items in whatsapp#51900000403`);
  });

  it('warns loudly when the partition holds zero items', () => {
    const mock = fixture();
    const empty = spawnSync(process.execPath, [...args('whatsapp', '51900000777'), '--dry-run'], {
      env: mock.env, encoding: 'utf8',
    });
    expect(empty.status).toBe(0);
    expect(empty.stderr).toContain('0 items in whatsapp#51900000777');
    expect(empty.stderr).toContain('WARNING');
  });
});

describe('phone-scoped reset guards', () => {
  it.each([
    ['a non-synthetic phone', ['51987654321']],
    ['a non-synthetic phone with a plus', ['+51987654321']],
    ['a real-looking mobile number', ['+51999999999']],
    ['a too short number', ['5190000']],
    ['a number outside the test range', ['519000004031']],
    ['a non-numeric value', ['not-a-phone']],
  ])('rejects %s before touching DynamoDB', (_label, [badPhone]) => {
    const mock = fixture();
    const result = run(mock, [...args('whatsapp', badPhone), '--yes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('51900xxxxxx');
    expect(readCalls(mock)).not.toContain('dynamodb');
  });

  it('rejects the wrong table', () => {
    const mock = fixture();
    const result = run(mock, [...args(), '--table', 'recap-agent-runtime-prod-plans', '--yes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('recap-agent-runtime-dev-plans');
    expect(readCalls(mock)).not.toContain('dynamodb');
  });

  it('rejects a channel outside the conversation lane', () => {
    const mock = fixture();
    const result = run(mock, [...args('sms'), '--yes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('whatsapp or terminal_whatsapp');
    expect(readCalls(mock)).not.toContain('dynamodb');
  });

  it('rejects the wrong account', () => {
    const mock = fixture({ MOCK_ACCOUNT: '000000000000' });
    const result = run(mock, [...args(), '--yes']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('684516060775');
    expect(readCalls(mock)).not.toContain('dynamodb');
  });
});
