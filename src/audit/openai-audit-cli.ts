import 'dotenv/config';

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import type { OpenAiCallRef } from '../runtime/contracts';
import { OpenAiAuditClient, sanitizeOpenAiError } from './openai-audit-client';
import { writePrivateAuditFile } from './private-audit-file';

const requiredAwsProfile = 'se-dev';
const requiredAwsRegion = 'us-east-1';
const requiredAwsAccountId = '684516060775';

type AuditArguments = {
  conversationId: string | null;
  traceId: string | null;
  responseId: string | null;
};

type StoredCallRefs = {
  classifier: OpenAiCallRef | null;
  extraction: OpenAiCallRef | null;
  reply: OpenAiCallRef | null;
};

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for raw response audit retrieval.');
    }
    const auditClient = new OpenAiAuditClient({ apiKey });
    const audit = args.responseId
      ? await auditSingleResponse(auditClient, args.responseId)
      : await auditConversation(auditClient, args);
    const outputPath = await writePrivateAuditFile(audit);
    process.stdout.write(`OpenAI audit written to ${outputPath}\n`);
  } catch (error) {
    const message = sanitizeOpenAiError(
      error instanceof Error ? error.message : String(error),
    );
    process.stderr.write(`OpenAI audit failed: ${message}\n`);
    process.exitCode = 1;
  }
}

async function auditSingleResponse(
  client: OpenAiAuditClient,
  responseId: string,
): Promise<Record<string, unknown>> {
  return {
    audit_version: 1,
    captured_at: new Date().toISOString(),
    source: { response_id: responseId },
    calls: [await retrieveStoredPayload(client, null, responseId, null)],
  };
}

async function auditConversation(
  client: OpenAiAuditClient,
  args: AuditArguments,
): Promise<Record<string, unknown>> {
  if (!args.conversationId) {
    throw new Error('A conversation ID is required.');
  }
  assertRequiredAwsIdentity();
  const conversationHash = hashConversationId(args.conversationId);
  const records = await queryPerformanceRecords(conversationHash);
  const record = args.traceId
    ? records.find((candidate) => candidate.trace_id === args.traceId)
    : records[0];
  if (!record) {
    throw new Error(
      args.traceId
        ? `No performance record found for trace ${args.traceId}.`
        : 'No performance record found for the supplied conversation.',
    );
  }
  const callRefs = parseStoredCallRefs(record.openai_calls);
  const calls = await Promise.all(
    (Object.entries(callRefs) as Array<[keyof StoredCallRefs, OpenAiCallRef | null]>)
      .filter((entry): entry is [keyof StoredCallRefs, OpenAiCallRef] => entry[1] !== null)
      .map(([component, callRef]) =>
        retrieveStoredPayload(client, component, callRef.responseId, callRef),
      ),
  );
  if (calls.length === 0) {
    throw new Error('The selected performance record has no stored OpenAI response IDs.');
  }

  return {
    audit_version: 1,
    captured_at: new Date().toISOString(),
    source: {
      conversation_hash: conversationHash,
      trace_id: record.trace_id ?? null,
    },
    calls,
  };
}

async function retrieveStoredPayload(
  client: OpenAiAuditClient,
  component: keyof StoredCallRefs | null,
  responseId: string,
  callRef: OpenAiCallRef | null,
): Promise<Record<string, unknown>> {
  const [response, inputItems] = await Promise.all([
    client.retrieveResponse(responseId),
    client.listAllInputItems(responseId),
  ]);
  return {
    component,
    call_reference: callRef,
    identifiers: {
      response_id: response.id,
      request_id: callRef?.requestId ?? null,
      model: response.model ?? callRef?.model ?? null,
    },
    instructions: response.instructions ?? null,
    input_items: inputItems,
    tools: response.tools ?? [],
    output_schema: isRecord(response.text) ? response.text.format ?? null : null,
    settings: pickResponseSettings(response),
    output: response.output ?? [],
    usage: response.usage ?? null,
    response,
  };
}

function pickResponseSettings(response: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'model', 'reasoning', 'temperature', 'top_p', 'max_output_tokens',
    'parallel_tool_calls', 'tool_choice', 'truncation', 'store',
    'prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options',
  ];
  return Object.fromEntries(
    keys
      .filter((key) => key in response)
      .map((key) => [key, response[key]]),
  );
}

async function queryPerformanceRecords(
  conversationHash: string,
): Promise<Array<Record<string, unknown>>> {
  const tableName = process.env.PERF_TABLE_NAME ?? 'recap-agent-runtime-perf';
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: requiredAwsRegion,
  }));
  const records: Array<Record<string, unknown>> = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `CONVERSATION#${conversationHash}`,
      },
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    records.push(...(page.Items ?? []).filter(isRecord));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return records;
}

function assertRequiredAwsIdentity(): void {
  const configuredProfile = process.env.AWS_PROFILE;
  if (configuredProfile && configuredProfile !== requiredAwsProfile) {
    throw new Error(`AWS_PROFILE must be ${requiredAwsProfile}.`);
  }
  const configuredRegion = process.env.AWS_REGION;
  if (configuredRegion && configuredRegion !== requiredAwsRegion) {
    throw new Error(`AWS_REGION must be ${requiredAwsRegion}.`);
  }
  process.env.AWS_PROFILE = requiredAwsProfile;
  process.env.AWS_REGION = requiredAwsRegion;
  process.env.AWS_SDK_LOAD_CONFIG = '1';
  const accountId = execFileSync(
    'aws',
    [
      'sts', 'get-caller-identity', '--profile', requiredAwsProfile,
      '--query', 'Account', '--output', 'text',
    ],
    { encoding: 'utf8', env: process.env },
  ).trim();
  if (accountId !== requiredAwsAccountId) {
    throw new Error(
      `AWS account ${accountId} is not the required development account.`,
    );
  }
}

function parseArguments(argv: string[]): AuditArguments {
  const parsed: AuditArguments = {
    conversationId: null,
    traceId: null,
    responseId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag ?? 'argument'}.`);
    }
    if (flag === '--conversation-id') {
      parsed.conversationId = value;
    } else if (flag === '--trace-id') {
      parsed.traceId = value;
    } else if (flag === '--response-id') {
      parsed.responseId = value;
    } else {
      throw new Error(`Unknown argument: ${flag}.`);
    }
    index += 1;
  }
  if (Boolean(parsed.responseId) === Boolean(parsed.conversationId)) {
    throw new Error('Provide exactly one of --response-id or --conversation-id.');
  }
  if (parsed.traceId && !parsed.conversationId) {
    throw new Error('--trace-id requires --conversation-id.');
  }
  return parsed;
}

export function hashConversationId(conversationId: string): string {
  return crypto.createHash('sha256').update(conversationId).digest('hex');
}

function parseStoredCallRefs(value: unknown): StoredCallRefs {
  if (!isRecord(value)) {
    return { classifier: null, extraction: null, reply: null };
  }
  return {
    classifier: parseCallRef(value.classifier),
    extraction: parseCallRef(value.extraction),
    reply: parseCallRef(value.reply),
  };
}

function parseCallRef(value: unknown): OpenAiCallRef | null {
  if (
    !isRecord(value) ||
    typeof value.responseId !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.attemptCount !== 'number' ||
    !isRecord(value.requestMetrics)
  ) {
    return null;
  }
  return value as OpenAiCallRef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

void main();
