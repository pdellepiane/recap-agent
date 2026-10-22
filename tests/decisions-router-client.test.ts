import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';

import {
  runDecisionsRouter,
  type DecisionsRouterResult,
} from '../src/runtime/decisions-router-client';
import type {
  RouterChoiceQuestion,
  RouterQuestion,
  RouterScoreQuestion,
} from '../src/runtime/decisions-router-questions';
import { decideRouterPolicy } from '../src/runtime/decisions-router-policy';

const questions: readonly RouterQuestion[] = [
  { type: 'predicate', name: 'needs_human_now', instructions: 'needs_human_now instructions' },
  { type: 'predicate', name: 'capability_blocked', instructions: 'capability_blocked instructions' },
  {
    type: 'choice',
    name: 'route',
    instructions: 'route instructions',
    choices: [
      { value: 'answer_with_records', description: 'answer' },
      { value: 'ask_clarification', description: 'clarify' },
      { value: 'offer_human', description: 'offer' },
      { value: 'escalate_human', description: 'escalate' },
      { value: 'rsvp_flow', description: 'rsvp' },
      { value: 'planning_flow', description: 'planning' },
      { value: 'suppress_ack', description: 'suppress' },
    ],
  } satisfies RouterChoiceQuestion,
  {
    type: 'score',
    name: 'loop_risk',
    instructions: 'loop_risk instructions',
    levels: [
      { label: '0', description: 'progressing' },
      { label: '1', description: 'first unresolved outcome' },
      { label: '2', description: 'same outcome repeated' },
      { label: '3', description: 'repeated with frustration' },
      { label: '4', description: 'repeated with money demand' },
    ],
  } satisfies RouterScoreQuestion,
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchMock = Mock<[string, RequestInit?], Promise<Response>>;

function makeFetchMock(response: Response): FetchMock {
  return vi.fn<[string, RequestInit?], Promise<Response>>().mockResolvedValue(response);
}

async function runRouter(fetchStub: FetchMock): Promise<DecisionsRouterResult> {
  vi.stubGlobal('fetch', fetchStub);
  return runDecisionsRouter({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test/v1',
    model: 'gpt-6-luna',
    timeoutMs: 5_000,
    input: 'mensaje actual',
    questions,
  });
}

describe('decisions router client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the live Decisions API answer shape, whose score level value is a number', async () => {
    // Captured verbatim from a real POST /v1/decisions response (2026-10-21).
    // The API returns the rubric LEVEL INDEX as the level value (a number),
    // while the label is the rubric label. A parser that expects a string
    // value rejects the whole answer set and the turn silently falls back to
    // the classifier path, so this shape is pinned here.
    const fetchMock = makeFetchMock(jsonResponse(200, {
      model: 'gpt-6-luna',
      answers: [
        { type: 'predicate', name: 'needs_human_now', probability: 0.04 },
        { type: 'predicate', name: 'capability_blocked', probability: 0.97 },
        {
          type: 'choice',
          name: 'route',
          choice: 'answer_with_records',
          probabilities: [
            { value: 'answer_with_records', probability: 0.48 },
            { value: 'ask_clarification', probability: 0.18 },
            { value: 'offer_human', probability: 0.1 },
            { value: 'escalate_human', probability: 0.21 },
            { value: 'rsvp_flow', probability: 0.01 },
            { value: 'planning_flow', probability: 0.01 },
            { value: 'suppress_ack', probability: 0.01 },
          ],
          confidence: 0.39,
        },
        {
          type: 'score',
          name: 'loop_risk',
          score: 1.09,
          probabilities: [
            { value: 0, label: '0', probability: 0.06 },
            { value: 1, label: '1', probability: 0.88 },
            { value: 2, label: '2', probability: 0.01 },
            { value: 3, label: '3', probability: 0.01 },
            { value: 4, label: '4', probability: 0.04 },
          ],
          confidence: 0.83,
        },
      ],
      usage: { input_tokens: 1534, output_tokens: 0, total_tokens: 1534 },
    }));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.answers.needsHumanNow).toBe(0.04);
    expect(result.answers.capabilityBlocked).toBe(0.97);
    expect(result.answers.route).toBe('answer_with_records');
    expect(result.answers.loopRisk).toBe(1);
    expect(result.answers.loopRiskScore).toBe(1.09);
    expect(result.answers.loopRiskProbabilities).toHaveLength(5);
    expect(result.answers.refusals).toEqual([]);
    // The measured input tokens come from the API, never from an estimate.
    expect(result.inputTokensEstimated).toBe(false);
    expect(result.tokenUsage.input_tokens).toBe(1534);
    expect(result.tokenUsage.output_tokens).toBe(0);
  });

  it('reads the rubric level from the level index when the label is not numeric', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, {
      answers: [
        { type: 'predicate', name: 'needs_human_now', probability: 0.1 },
        { type: 'predicate', name: 'capability_blocked', probability: 0.2 },
        {
          type: 'choice',
          name: 'route',
          choice: 'answer_with_records',
          probabilities: [{ value: 'answer_with_records', probability: 1 }],
          confidence: 1,
        },
        {
          type: 'score',
          name: 'loop_risk',
          score: 3,
          probabilities: [
            { value: 3, label: 'repeated', probability: 0.7 },
            { value: 2, label: 'same outcome', probability: 0.3 },
          ],
          confidence: 0.7,
        },
      ],
    }));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.answers.loopRisk).toBe(3);
  });

  it('parses predicate, choice and score answers into typed router answers', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, {
      id: 'dec_router_1',
      answers: [
        { type: 'predicate', name: 'needs_human_now', probability: 0.82 },
        { type: 'predicate', name: 'capability_blocked', probability: 0.1 },
        {
          type: 'choice',
          name: 'route',
          choice: 'escalate_human',
          probabilities: [
            { value: 'escalate_human', probability: 0.71 },
            { value: 'answer_with_records', probability: 0.29 },
          ],
          confidence: 0.71,
        },
        {
          type: 'score',
          name: 'loop_risk',
          score: 3,
          probabilities: [
            { value: '3', label: '3', probability: 0.8 },
            { value: '2', label: '2', probability: 0.2 },
          ],
          confidence: 0.8,
        },
      ],
    }));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.answers.needsHumanNow).toBe(0.82);
    expect(result.answers.capabilityBlocked).toBe(0.1);
    expect(result.answers.route).toBe('escalate_human');
    expect(result.answers.loopRisk).toBe(3);
    expect(result.answers.loopRiskScore).toBe(3);
    expect(result.answers.refusals).toEqual([]);
    expect(result.tokenUsage.output_tokens).toBe(0);
    expect(result.tokenUsage.input_tokens).toBeGreaterThan(0);
    expect(result.decision.route).toBe('escalate_human');
    expect(result.decision.route_probability).toBe(0.71);
    expect(JSON.stringify(result.decision)).not.toContain('mensaje actual');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/decisions');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    const rawBody = init.body;
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(rawBody as string) as {
      model: string;
      input: string;
      questions: RouterQuestion[];
    };
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input).toBe('mensaje actual');
    expect(body.questions).toHaveLength(4);
  });

  it('records a refusal and keeps it away from the escalation triggers', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, {
      answers: [
        { type: 'refusal', name: 'needs_human_now' },
        { type: 'predicate', name: 'capability_blocked', probability: 0.2 },
        {
          type: 'choice',
          name: 'route',
          choice: 'answer_with_records',
          probabilities: [{ value: 'answer_with_records', probability: 0.6 }],
        },
        {
          type: 'score',
          name: 'loop_risk',
          score: 0,
          probabilities: [{ value: '0', label: '0', probability: 1 }],
        },
      ],
    }));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.answers.refusals).toEqual(['needs_human_now']);
    expect(result.answers.needsHumanNow).toBe(0);
    expect(decideRouterPolicy({
      needsHumanNow: result.answers.needsHumanNow,
      capabilityBlocked: result.answers.capabilityBlocked,
      loopRisk: result.answers.loopRisk,
      route: result.answers.route,
      repeatCount: 0,
      unresolvedMoney: false,
      capabilityBlockedStreak: 0,
    })).toEqual({ kind: 'answer' });
  });

  it('returns unavailable instead of throwing on a malformed response', async () => {
    const fetchMock = makeFetchMock(new Response('not json', { status: 200 }));

    const result = await runRouter(fetchMock);

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'malformed_response',
      retryable: false,
    });
  });

  it('classifies a non-2xx response and does not retry a permanent failure', async () => {
    const fetchMock = makeFetchMock(jsonResponse(400, { error: 'bad request' }));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toBe('permanent_http_400');
    expect(result.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and then reports it as unavailable', async () => {
    const fetchMock = makeFetchMock(jsonResponse(500, { error: 'server error' }));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toBe('transient_server');
    expect(result.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a missing api key as unavailable without calling the API', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const result = await runDecisionsRouter({
      apiKey: null,
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-6-luna',
      timeoutMs: 5_000,
      input: 'mensaje actual',
      questions,
    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'missing_api_key',
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
