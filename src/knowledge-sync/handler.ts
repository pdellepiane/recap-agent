import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, S3Event } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { runKnowledgeBaseSyncFromDir } from './sync';
import type { KnowledgeBaseSyncConfig } from './types';

const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

export async function handler(
  event: APIGatewayProxyEventV2 | S3Event | Record<string, unknown>,
): Promise<APIGatewayProxyResultV2 | { statusCode: number; body: string }> {
  console.log('Event type:', detectEventType(event));

  let resolvedApiKey: string;
  const secretId = process.env.OPENAI_SECRET_ID;
  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (openAiApiKey) {
    resolvedApiKey = openAiApiKey;
  } else if (secretId) {
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const secretsClient = new SecretsManagerClient({ region });
    const secretResponse = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    if (!secretResponse.SecretString) {
      return errorResponse('OPENAI_SECRET_ID does not contain a SecretString');
    }
    resolvedApiKey = secretResponse.SecretString;
  } else {
    return errorResponse('OPENAI_API_KEY or OPENAI_SECRET_ID must be configured');
  }

  const vectorStoreId = process.env.KB_VECTOR_STORE_ID ?? null;
  const vectorStoreName = process.env.KB_VECTOR_STORE_NAME ?? 'Sin Envolturas Knowledge Base';
  const outputDir = '/tmp/knowledge-base';

  const config: KnowledgeBaseSyncConfig = {
    baseUrl: process.env.KB_BASE_URL ?? 'https://sinenvolturas.tawk.help',
    outputDir,
    openAiApiKey: resolvedApiKey,
    vectorStoreName,
    vectorStoreId,
  };

  try {
    const eventType = detectEventType(event);

    if (eventType === 's3') {
      const s3Event = event as S3Event;
      const record = s3Event.Records[0];
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      console.log(`S3 event: ${bucket}/${key}`);

      // Download the zip from S3
      fs.mkdirSync(outputDir, { recursive: true });
      const zipPath = path.join('/tmp', 'knowledge-base-articles.zip');

      const getObjectResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );

      if (!getObjectResponse.Body) {
        return errorResponse('S3 object body is empty');
      }

      const chunks: Buffer[] = [];
      for await (const chunk of getObjectResponse.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      fs.writeFileSync(zipPath, Buffer.concat(chunks));

      // Extract the zip
      execFileSync('unzip', ['-o', zipPath, '-d', outputDir]);
      console.log(`Extracted ${zipPath} to ${outputDir}`);

      // Count extracted files
      const extractedFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.md'));
      console.log(`Found ${extractedFiles.length} markdown files`);

      // Run sync from the extracted directory
      const result = await runKnowledgeBaseSyncFromDir(config, extractedFiles.length);
      return successResponse(result);
    }

    if (eventType === 'api') {
      const apiEvent = event as APIGatewayProxyEventV2;
      const body = parseBodyRecord(apiEvent.body);
      const force =
        apiEvent.queryStringParameters?.force === 'true' ||
        body?.force === true;

      if (force) {
        console.log('Manual force trigger received');
      }

      // For API events, try scraping first (will fail from Lambda IPs, but works locally)
      const result = await runKnowledgeBaseSyncFromDir(config);
      return successResponse(result);
    }

    if (eventType === 'scheduled' || eventType === 'github-actions') {
      if (eventType === 'github-actions') {
        console.log('GitHub Actions trigger: fetching latest articles from S3');
      } else {
        console.log('Scheduled trigger: fetching latest articles from S3');
      }
      const bucket = process.env.ARTIFACT_BUCKET ?? `recap-agent-artifacts-${process.env.AWS_ACCOUNT_ID ?? ''}-${process.env.AWS_REGION ?? 'us-east-1'}`;
      const key = 'knowledge-sync/dev/articles-latest.zip';

      fs.mkdirSync(outputDir, { recursive: true });
      const zipPath = path.join('/tmp', 'knowledge-base-articles.zip');

      try {
        const getObjectResponse = await s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );

        if (!getObjectResponse.Body) {
          return errorResponse('S3 object body is empty');
        }

        const chunks: Buffer[] = [];
        for await (const chunk of getObjectResponse.Body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        fs.writeFileSync(zipPath, Buffer.concat(chunks));
        execFileSync('unzip', ['-o', zipPath, '-d', outputDir]);
        console.log(`Extracted ${zipPath} to ${outputDir}`);
      } catch (s3Error) {
        const msg = s3Error instanceof Error ? s3Error.message : String(s3Error);
        console.error('Failed to fetch articles from S3:', msg);
        return errorResponse(`Sync failed: no articles found in S3 (${msg}). Run the GitHub Actions workflow first.`);
      }

      const extractedFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.md'));
      const result = await runKnowledgeBaseSyncFromDir(config, extractedFiles.length);
      return successResponse(result);
    }

    return errorResponse(`Unknown event type: ${eventType}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Knowledge base sync failed:', message);
    return errorResponse(message);
  }
}

function detectEventType(event: unknown): string {
  if (!event || typeof event !== 'object') return 'unknown';
  const e = event as Record<string, unknown>;

  if (Array.isArray(e.Records) && e.Records[0] && typeof e.Records[0] === 'object') {
    const record = e.Records[0] as Record<string, unknown>;
    if (record.eventSource === 'aws:s3') return 's3';
    if (record.EventSource === 'aws.events' || record.source === 'aws.events') return 'scheduled';
  }

  if (e.requestContext && typeof e.requestContext === 'object') return 'api';
  if (e.source === 'aws.events' || e['detail-type'] === 'Scheduled Event') return 'scheduled';
  if (e.source === 'github-actions') return 'github-actions';

  return 'unknown';
}

function parseBodyRecord(body: string | undefined): Record<string, unknown> | null {
  if (!body) {
    return null;
  }

  const parsed: unknown = JSON.parse(body);
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : null;
}

function successResponse(body: unknown): { statusCode: number; body: string } {
  return {
    statusCode: 200,
    body: JSON.stringify(body),
  };
}

function errorResponse(message: string): { statusCode: number; body: string } {
  return {
    statusCode: 500,
    body: JSON.stringify({ error: message }),
  };
}
