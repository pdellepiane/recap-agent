import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type OpenAI from 'openai';
import type {
  OpenAiTransportMetrics,
  OpenAiTransportRequest,
} from '../runtime/contracts';

type CaptureContext = {
  stage: OpenAiTransportRequest['stage'];
  requests: OpenAiTransportRequest[];
  sequence: number;
};

const captureStorage = new AsyncLocalStorage<CaptureContext>();
const instrumentedClients = new WeakSet<object>();
type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function installOpenAiTransportCapture(client: OpenAI): void {
  if (instrumentedClients.has(client)) return;
  const clientRecord = client as unknown as Record<string, unknown>;
  const configuredFetch = clientRecord['fetch'];
  if (typeof configuredFetch !== 'function') {
    throw new Error('OpenAI client does not expose a transport fetch implementation.');
  }
  const originalFetch = configuredFetch.bind(client) as FetchImplementation;
  const capturedFetch: FetchImplementation = async (input, init) => {
    const context = captureStorage.getStore();
    if (!context) return originalFetch(input, init);

    const body = serializeRequestBody(init?.body);
    const parsed = parseJsonRecord(body.text);
    const sequence = context.sequence;
    context.sequence += 1;
    const base = buildRequestObservation(context.stage, sequence, body, parsed);
    try {
      const response = await originalFetch(input, init);
      const responseData = await readResponseIdentifiers(response);
      context.requests.push({
        ...base,
        requestId: response.headers.get('x-request-id') ?? response.headers.get('openai-request-id'),
        responseId: responseData.responseId,
        statusCode: response.status,
        succeeded: response.ok,
      });
      return response;
    } catch (error) {
      context.requests.push({
        ...base,
        requestId: null,
        responseId: null,
        statusCode: null,
        succeeded: null,
      });
      throw error;
    }
  };
  clientRecord['fetch'] = capturedFetch;
  instrumentedClients.add(client);
}

export async function captureOpenAiTransport<T>(
  stage: CaptureContext['stage'],
  operation: () => Promise<T>,
  onCaptured?: (metrics: OpenAiTransportMetrics) => void,
): Promise<{ value: T; metrics: OpenAiTransportMetrics }> {
  const context: CaptureContext = { stage, requests: [], sequence: 0 };
  try {
    const value = await captureStorage.run(context, operation);
    return { value, metrics: summarizeTransportRequests(context.requests) };
  } finally {
    onCaptured?.(summarizeTransportRequests(context.requests));
  }
}

export function summarizeTransportRequests(
  requests: readonly OpenAiTransportRequest[],
): OpenAiTransportMetrics {
  const sum = (selector: (request: OpenAiTransportRequest) => number | null): number | null => {
    const values = requests.map(selector);
    return values.every((value) => value !== null)
      ? values.reduce((total, value) => total + (value ?? 0), 0)
      : null;
  };
  return {
    observedRequestCount: requests.length,
    totalPayloadBytes: sum((request) => request.totalPayloadBytes),
    instructionBytes: sum((request) => request.instructionBytes),
    inputBytes: sum((request) => request.inputBytes),
    toolBytes: sum((request) => request.toolBytes),
    outputSchemaBytes: sum((request) => request.outputSchemaBytes),
    requests: [...requests],
  };
}

export type TransportCompleteness = {
  /** Full per-request reconciliation against private request arrays. */
  complete: boolean;
  /** Compact aggregates are present but per-request detail was redacted. */
  aggregateComplete: boolean;
  /** True when the public compact path carries aggregates without detail. */
  detailRedacted: boolean;
  reasons: string[];
};

/**
 * Completeness check for transport evidence at the acceptance boundary.
 * Absent evidence is missing, never zero: a metrics object without observed
 * requests or with null byte aggregates is incomplete. A compact object that
 * carries aggregates but no per-request array (public redacted path) is only
 * aggregate-complete; full completeness requires reconciling the aggregates
 * against the private per-request arrays, never fabricating zeros.
 */
export function checkTransportMetricsCompleteness(
  metrics: OpenAiTransportMetrics | null | undefined,
  label: string,
): TransportCompleteness {
  if (!metrics) {
    return {
      complete: false,
      aggregateComplete: false,
      detailRedacted: false,
      reasons: [`${label}: transport evidence is missing; absent is not zero`],
    };
  }
  const requests = metrics.requests ?? [];
  if (requests.length === 0) {
    return checkCompactTransportAggregates(metrics, label);
  }
  const reasons: string[] = [];
  if (requests.length !== metrics.observedRequestCount) {
    reasons.push(
      `${label}: transport request count mismatch: observed=${metrics.observedRequestCount} evidenced=${requests.length}`,
    );
  }
  try {
    assertCompleteTransportAccounting(metrics, metrics.observedRequestCount);
  } catch (error) {
    reasons.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  reasons.push(...reconcileTransportAggregates(metrics, label));
  return {
    complete: reasons.length === 0,
    aggregateComplete: reasons.length === 0,
    detailRedacted: false,
    reasons,
  };
}

function checkCompactTransportAggregates(
  metrics: OpenAiTransportMetrics,
  label: string,
): TransportCompleteness {
  const reasons: string[] = [];
  if (metrics.observedRequestCount === 0) {
    reasons.push(`${label}: no transport requests observed; missing detail is not zero`);
  }
  for (const [field, value] of [
    ['totalPayloadBytes', metrics.totalPayloadBytes],
    ['instructionBytes', metrics.instructionBytes],
    ['inputBytes', metrics.inputBytes],
    ['toolBytes', metrics.toolBytes],
    ['outputSchemaBytes', metrics.outputSchemaBytes],
  ] as const) {
    if (value === null) {
      reasons.push(`${label}: transport ${field} is missing; absent is not zero`);
    }
  }
  return {
    complete: false,
    aggregateComplete: reasons.length === 0,
    detailRedacted: reasons.length === 0,
    reasons: reasons.length === 0
      ? [`${label}: aggregate-only transport evidence; per-request detail redacted from public path`]
      : reasons,
  };
}

/**
 * Reconciles compact aggregates against the private per-request arrays.
 * Any aggregate that does not equal the sum of its per-request parts is
 * inconsistent, even when every part is non-null.
 */
function reconcileTransportAggregates(
  metrics: OpenAiTransportMetrics,
  label: string,
): string[] {
  const requests = metrics.requests ?? [];
  const sum = (selector: (request: OpenAiTransportRequest) => number | null): number | null => {
    let total = 0;
    for (const request of requests) {
      const value = selector(request);
      if (value === null) return null;
      total += value;
    }
    return total;
  };
  const reasons: string[] = [];
  const pairs = [
    ['totalPayloadBytes', metrics.totalPayloadBytes, sum((request) => request.totalPayloadBytes)],
    ['instructionBytes', metrics.instructionBytes, sum((request) => request.instructionBytes)],
    ['inputBytes', metrics.inputBytes, sum((request) => request.inputBytes)],
    ['toolBytes', metrics.toolBytes, sum((request) => request.toolBytes)],
    ['outputSchemaBytes', metrics.outputSchemaBytes, sum((request) => request.outputSchemaBytes)],
  ] as const;
  for (const [field, aggregate, recomputed] of pairs) {
    if (aggregate !== null && recomputed !== null && aggregate !== recomputed) {
      reasons.push(
        `${label}: transport ${field} aggregate=${aggregate} does not reconcile with per-request sum=${recomputed}`,
      );
    }
  }
  return reasons;
}

export function assertCompleteTransportAccounting(
  metrics: OpenAiTransportMetrics,
  expectedRequestCount?: number,
): void {
  if (expectedRequestCount !== undefined && metrics.observedRequestCount !== expectedRequestCount) {
    throw new Error(
      `transport request count mismatch: observed=${metrics.observedRequestCount} expected=${expectedRequestCount}`,
    );
  }
  if (metrics.observedRequestCount === 0 || metrics.requests.length !== metrics.observedRequestCount) {
    throw new Error('transport request observations are missing');
  }
  for (const request of metrics.requests) {
    if (
      request.totalPayloadBytes === null ||
      request.instructionBytes === null ||
      request.inputBytes === null ||
      request.toolBytes === null ||
      request.outputSchemaBytes === null ||
      request.requestBodySha256 === null
    ) {
      throw new Error(`transport request ${request.sequence} is missing serialized byte accounting`);
    }
  }
}

function buildRequestObservation(
  stage: OpenAiTransportRequest['stage'],
  sequence: number,
  body: SerializedBody,
  parsed: Record<string, unknown> | null,
): OpenAiTransportRequest {
  const component = (key: string): number | null =>
    parsed === null ? null : key in parsed ? utf8JsonBytes(parsed[key]) : 0;
  const schema = parsed === null
    ? undefined
    : recordValue(parsed.text)?.format ?? parsed.output_schema ?? parsed.response_format ?? null;
  return {
    sequence,
    stage,
    requestId: null,
    responseId: null,
    statusCode: null,
    succeeded: null,
    totalPayloadBytes: body.byteLength,
    instructionBytes: component('instructions'),
    inputBytes: component('input'),
    toolBytes: component('tools'),
    outputSchemaBytes: schema === undefined ? null : schema === null ? 0 : utf8JsonBytes(schema),
    requestBodySha256: body.text === null ? null : sha256(body.text),
  };
}

type SerializedBody = { text: string | null; byteLength: number | null };

function serializeRequestBody(body: RequestInit['body']): SerializedBody {
  if (typeof body === 'string') {
    return { text: body, byteLength: Buffer.byteLength(body, 'utf8') };
  }
  if (body instanceof Uint8Array) {
    const text = Buffer.from(body).toString('utf8');
    return { text, byteLength: body.byteLength };
  }
  return { text: null, byteLength: null };
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function utf8JsonBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

async function readResponseIdentifiers(response: Response): Promise<{ responseId: string | null }> {
  try {
    const raw = await response.clone().text();
    const parsed = parseJsonRecord(raw);
    const responseId = parsed && typeof parsed.id === 'string'
      ? parsed.id
      : parsed && typeof parsed.response_id === 'string'
        ? parsed.response_id
        : null;
    return { responseId };
  } catch {
    return { responseId: null };
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
