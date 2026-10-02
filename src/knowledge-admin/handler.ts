import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DocumentError, DocumentService } from './documents';
import { OpenAiDocumentIndex, S3DocumentStorage } from './aws-adapters';

const secrets = new SecretsManagerClient({ region: 'us-east-1' });
let capability: string | undefined;
let service: DocumentService | undefined;
async function secret(id: string): Promise<string> {
  const response = await secrets.send(new GetSecretValueCommand({ SecretId: id }));
  if (!response.SecretString) throw new Error('Required secret is missing.');
  return response.SecretString;
}
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is not configured.`); return value; }
export function resolveAdminRoute(rawPath: string, expected: string): string | null {
  const pieces = rawPath.split('/');
  const given = Buffer.from(pieces[1] ?? ''); const wanted = Buffer.from(expected);
  if (!wanted.length || given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  return pieces.slice(2).join('/');
}
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src blob:; img-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
function response(statusCode: number, body: string, contentType = 'application/json'): APIGatewayProxyStructuredResultV2 { return { statusCode, headers: { ...headers, 'content-type': contentType }, body }; }
export async function handleAdminRequest(event: APIGatewayProxyEventV2, adminService: DocumentService, route: string): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method !== 'GET' && event.headers['x-knowledge-action'] !== '1') throw new DocumentError(403, 'Unsupported request.');
  if (route === 'api/documents' && method === 'GET') return response(200, JSON.stringify(await adminService.list()));
  if (route === 'api/documents' && method === 'POST') {
    const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
    if (Buffer.byteLength(body) > 4_300_000) throw new DocumentError(413, 'Upload exceeds 3 MiB.');
    let input: unknown; try { input = JSON.parse(body) as unknown; } catch { throw new DocumentError(400, 'Invalid upload.'); }
    return response(201, JSON.stringify(await adminService.create(input)));
  }
  const match = route.match(/^api\/documents\/([^/]+)(?:\/(preview|publish|original))?$/u);
  if (!match) return response(404, JSON.stringify({ error: 'Not found.' }));
  const id = match[1]; const action = match[2];
  if (action === 'preview' && method === 'GET') return response(200, JSON.stringify(await adminService.preview(id)));
  if (action === 'original' && method === 'GET') {
    const original = await adminService.original(id);
    return { ...response(200, original.data.toString('base64'), original.contentType), isBase64Encoded: true };
  }
  if (action === 'publish' && method === 'POST') return response(202, JSON.stringify(await adminService.publish(id)));
  if (!action && method === 'DELETE') { await adminService.remove(id); return response(200, JSON.stringify({ deleted: true })); }
  return response(405, JSON.stringify({ error: 'Method not allowed.' }));
}
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    capability ??= await secret(required('ADMIN_PATH_SECRET_ID'));
    const route = resolveAdminRoute(event.rawPath, capability);
    if (route === null) return response(404, JSON.stringify({ error: 'Not found.' }));
    if (event.requestContext.http.method === 'GET' && route === '' && !event.rawPath.endsWith('/')) {
      return { ...response(302, ''), headers: { ...headers, location: `${event.rawPath}/` } };
    }
    if (event.requestContext.http.method === 'GET' && (route === '' || route === 'app.js')) {
      const filename = route === '' ? 'page.html' : 'app.js';
      return response(200, await readFile(path.join(__dirname, filename), 'utf8'), route === '' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    }
    if (!service) {
      const titles = z.record(z.string(), z.string()).parse(JSON.parse(await readFile(path.join(__dirname, 'original-titles.json'), 'utf8')) as unknown);
      service = new DocumentService(new S3DocumentStorage(required('DOCUMENT_BUCKET')), new OpenAiDocumentIndex(await secret(required('OPENAI_SECRET_ID')), required('KB_VECTOR_STORE_ID')), titles);
    }
    return await handleAdminRequest(event, service, route);
  } catch (error) {
    if (error instanceof DocumentError) return response(error.status, JSON.stringify({ error: error.message }));
    // Never log the capability path, document body, filenames or provider errors.
    console.error('Knowledge helper request failed.');
    return response(502, JSON.stringify({ error: 'The request could not be completed. Refresh the list before retrying.' }));
  }
}
