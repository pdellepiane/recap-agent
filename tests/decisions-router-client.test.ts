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
import type { RouterQuestion } from '../src/runtime/decisions-router-questions';

const questions: readonly RouterQuestion[] = [
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
  },
  {
    type: 'choice',
    name: 'same_open_request',
    instructions: 'same_open_request instructions',
    choices: [
      { value: 'same', description: 'same request' },
      { value: 'new', description: 'a different request' },
    ],
  },
  {
    type: 'choice',
    name: 'request_settled',
    instructions: 'request_settled instructions',
    choices: [
      { value: 'settled', description: 'settled' },
      { value: 'open', description: 'still open' },
    ],
  },
];

type ChoiceValue = {
  readonly value: string;
  readonly probability: number;
};

function choiceAnswer(
  name: string,
  choice: string,
  probabilities: readonly ChoiceValue[],
  confidence?: number,
): Record<string, unknown> {
  return {
    type: 'choice',
    name,
    choice,
    probabilities,
    ...(confidence === undefined ? {} : { confidence }),
  };
}

const routeProbabilities: readonly ChoiceValue[] = [
  { value: 'answer_with_records', probability: 0.48 },
  { value: 'ask_clarification', probability: 0.18 },
  { value: 'offer_human', probability: 0.1 },
  { value: 'escalate_human', probability: 0.21 },
  { value: 'rsvp_flow', probability: 0.01 },
  { value: 'planning_flow', probability: 0.01 },
  { value: 'suppress_ack', probability: 0.01 },
];

/** A complete three-choice answer set with the values a test overrides. */
function answerPayload(args: {
  readonly route?: string;
  readonly routeProbabilities?: readonly ChoiceValue[];
  readonly sameOpenRequest?: string;
  readonly sameOpenRequestProbability?: number;
  readonly requestSettled?: string;
  readonly requestSettledProbability?: number;
  readonly usage?: unknown;
  readonly id?: string;
} = {}): Record<string, unknown> {
  const route = args.route ?? 'answer_with_records';
  const same = args.sameOpenRequest ?? 'same';
  const settled = args.requestSettled ?? 'settled';
  const sameProbability = args.sameOpenRequestProbability ?? 0.8;
  const settledProbability = args.requestSettledProbability ?? 0.7;
  return {
    ...(args.id === undefined ? {} : { id: args.id }),
    answers: [
      choiceAnswer(
        'route',
        route,
        args.routeProbabilities ?? [{ value: route, probability: 0.48 }],
        0.48,
      ),
      choiceAnswer(
        'same_open_request',
        same,
        [
          { value: same, probability: sameProbability },
          ...(same === 'same'
            ? [{ value: 'new', probability: Number((1 - sameProbability).toFixed(2)) }]
            : [{ value: 'same', probability: Number((1 - sameProbability).toFixed(2)) }]),
        ],
      ),
      choiceAnswer(
        'request_settled',
        settled,
        [
          { value: settled, probability: settledProbability },
          ...(settled === 'settled'
            ? [{ value: 'open', probability: Number((1 - settledProbability).toFixed(2)) }]
            : [{ value: 'settled', probability: Number((1 - settledProbability).toFixed(2)) }]),
        ],
      ),
    ],
    ...(args.usage === undefined ? { usage: { input_tokens: 1534 } } : { usage: args.usage }),
  };
}

function expectedInstructionBytes(): number {
  return questions.reduce(
    (total, question) => total + Buffer.byteLength(question.instructions, 'utf8')
      + question.choices.reduce(
        (sum, choice) => sum + Buffer.byteLength(choice.description, 'utf8'),
        0,
      ),
    0,
  );
}

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

  it('parses the three answers into the typed router answers', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, answerPayload({
      id: 'dec_router_1',
      route: 'escalate_human',
      routeProbabilities: [
        { value: 'escalate_human', probability: 0.71 },
        { value: 'answer_with_records', probability: 0.29 },
      ],
      sameOpenRequest: 'same',
      sameOpenRequestProbability: 0.82,
      requestSettled: 'settled',
      requestSettledProbability: 0.64,
    })));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.answers.route).toBe('escalate_human');
    expect(result.answers.routeProbabilities).toEqual([
      { value: 'escalate_human', probability: 0.71 },
      { value: 'answer_with_records', probability: 0.29 },
    ]);
    expect(result.answers.sameOpenRequest).toBe(true);
    expect(result.answers.sameOpenRequestProbability).toBe(0.82);
    expect(result.answers.requestSettled).toBe(true);
    expect(result.answers.requestSettledProbability).toBe(0.64);
    expect(result.answers.refusals).toEqual([]);
    // The measured input tokens come from the API, never from an estimate.
    expect(result.inputTokensEstimated).toBe(false);
    expect(result.tokenUsage.input_tokens).toBe(1534);
    expect(result.tokenUsage.output_tokens).toBe(0);
  });

  it.each([
    ['same', 'settled', true, true],
    ['same', 'open', true, false],
    ['new', 'settled', false, true],
    ['new', 'open', false, false],
  ] as const)(
    'maps same_open_request %s and request_settled %s onto booleans',
    async (same, settled, expectedSame, expectedSettled) => {
      const fetchMock = makeFetchMock(jsonResponse(200, answerPayload({
        sameOpenRequest: same,
        requestSettled: settled,
      })));

      const result = await runRouter(fetchMock);

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.answers.sameOpenRequest).toBe(expectedSame);
      expect(result.answers.requestSettled).toBe(expectedSettled);
    },
  );

  it('fails closed when request_settled is missing from the answers', async () => {
    const payload = answerPayload();
    const [routeAnswer, sameAnswer] = payload.answers as Record<string, unknown>[];
    const fetchMock = makeFetchMock(jsonResponse(200, {
      ...payload,
      answers: [routeAnswer, sameAnswer],
    }));

    const result = await runRouter(fetchMock);

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'malformed_answers',
      retryable: false,
    });
  });

  it('fails closed on an unknown same_open_request value', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, answerPayload({
      sameOpenRequest: 'maybe',
    })));

    const result = await runRouter(fetchMock);

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'malformed_answers',
      retryable: false,
    });
  });

  it.each([
    ['same_open_request', false, true],
    ['request_settled', true, false],
  ] as const)(
    'records a refusal on %s and keeps only that fact neutral',
    async (refusedName, expectedSame, expectedSettled) => {
      const payload = answerPayload({ sameOpenRequest: 'same', requestSettled: 'settled' });
      const answers = (payload.answers as Record<string, unknown>[])
        .filter((answer) => answer.name !== refusedName);
      const fetchMock = makeFetchMock(jsonResponse(200, {
        ...payload,
        answers: [...answers, { type: 'refusal', name: refusedName }],
      }));

      const result = await runRouter(fetchMock);

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.answers.refusals).toEqual([refusedName]);
      // A refusal is never an escalation trigger: that one fact answers with
      // its neutral value, so the record opens a new request and nothing is
      // reported as settled. The other fact keeps the value the API chose.
      expect(result.answers.sameOpenRequest).toBe(expectedSame);
      expect(result.answers.requestSettled).toBe(expectedSettled);
      if (refusedName === 'same_open_request') {
        expect(result.answers.sameOpenRequestProbability).toBe(0);
        expect(result.answers.requestSettledProbability).toBe(0.7);
      } else {
        expect(result.answers.sameOpenRequestProbability).toBe(0.8);
        expect(result.answers.requestSettledProbability).toBe(0);
      }
    },
  );

  it('reports route, same_open_request and request_settled in the decision trace', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, answerPayload({
      route: 'answer_with_records',
      routeProbabilities,
      sameOpenRequest: 'same',
      sameOpenRequestProbability: 0.77,
      requestSettled: 'open',
      requestSettledProbability: 0.31,
    })));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.decision.route).toBe('answer_with_records');
    expect(result.decision.route_probability).toBe(0.48);
    expect(result.decision.route_probabilities).toEqual(routeProbabilities);
    expect(result.decision.same_open_request).toBe(true);
    expect(result.decision.same_open_request_probability).toBe(0.77);
    expect(result.decision.request_settled).toBe(false);
    expect(result.decision.request_settled_probability).toBe(0.31);
    expect(Object.keys(result.decision).sort()).toEqual([
      'request_settled',
      'request_settled_probability',
      'route',
      'route_probabilities',
      'route_probability',
      'same_open_request',
      'same_open_request_probability',
    ].sort());
    expect(result.decision).not.toHaveProperty('needs_human_now');
    expect(result.decision).not.toHaveProperty('capability_blocked');
    expect(result.decision).not.toHaveProperty('loop_risk');
    expect(JSON.stringify(result.decision)).not.toContain('mensaje actual');
  });

  it('parses a zero-request question set without same_open_request as a new request', async () => {
    const zeroRequestQuestions = questions.filter(
      (question) => question.name !== 'same_open_request',
    );
    const payload = answerPayload();
    const answers = (payload.answers as Record<string, unknown>[])
      .filter((answer) => answer.name !== 'same_open_request');
    const fetchMock = makeFetchMock(jsonResponse(200, { ...payload, answers }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runDecisionsRouter({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-6-luna',
      timeoutMs: 5_000,
      input: 'mensaje actual',
      questions: zeroRequestQuestions,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.answers.sameOpenRequest).toBe(false);
    expect(result.answers.selectedRequestKey).toBeNull();
    expect(result.answers.refusals).toEqual([]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { questions: { name: string }[] };
    expect(body.questions.map((question) => question.name)).toEqual([
      'route',
      'request_settled',
    ]);
  });

  it('fails closed without a request when a choice question has fewer than two options', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, answerPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runDecisionsRouter({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-6-luna',
      timeoutMs: 5_000,
      input: 'mensaje actual',
      questions: questions.map((question) => question.name === 'same_open_request'
        ? { ...question, choices: question.choices.slice(0, 1) }
        : question),
    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'invalid_question_choices',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the three questions and records the transport metrics', async () => {
    const fetchMock = makeFetchMock(jsonResponse(200, answerPayload()));

    const result = await runRouter(fetchMock);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(String(url)).toBe('https://api.example.test/v1/decisions');
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('content-type')).toBe('application/json');
    const rawBody = init.body;
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(rawBody as string) as {
      model: string;
      input: string;
      questions: RouterQuestion[];
    };
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input).toBe('mensaje actual');
    expect(body.questions.map((question) => question.name)).toEqual([
      'route',
      'same_open_request',
      'request_settled',
    ]);

    const transport = result.call.requestMetrics.transport;
    expect(transport?.observedRequestCount).toBe(1);
    expect(transport?.requests).toHaveLength(1);
    expect(result.call.requestMetrics.schemaPropertyCount).toBe(3);
    // The instruction byte total is the question instructions plus every
    // choice description, and it is reported, never estimated.
    expect(result.call.requestMetrics.instructionBytes).toBe(expectedInstructionBytes());
    expect(transport?.instructionBytes).toBe(expectedInstructionBytes());
    expect(transport?.requests[0]?.instructionBytes).toBe(expectedInstructionBytes());
    expect(result.call.attemptCount).toBe(1);
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

  it('rejects the whole response when it carries an answer type the contract removed', async () => {
    // The response schema is the union of `choice` and `refusal` only. A
    // predicate or score answer is not a known member, so the schema fails and
    // the response is reported as malformed instead of being partially read.
    const payload = answerPayload();
    const fetchMock = makeFetchMock(jsonResponse(200, {
      ...payload,
      answers: [
        { type: 'predicate', name: 'needs_human_now', probability: 0.82 },
        ...(payload.answers as Record<string, unknown>[]),
      ],
    }));

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

describe('router exact answer-set contract', () => {
  it.each(['duplicate', 'unknown', 'unknown-refusal', 'duplicate-probability', 'missing-chosen-probability'])('rejects %s without inventing a route', async (variant) => {
    const payload = answerPayload() as { answers: Record<string, unknown>[] };
    if (variant === 'duplicate') payload.answers[1] = { ...payload.answers[0] };
    if (variant === 'unknown') payload.answers.push({ type: 'choice', name: 'ghost', choice: 'x', probabilities: [] });
    if (variant === 'unknown-refusal') payload.answers[1] = { type: 'refusal', name: 'ghost' };
    if (variant === 'duplicate-probability') payload.answers[0].probabilities = [{ value: 'answer_with_records', probability: 0.5 }, { value: 'answer_with_records', probability: 0.5 }];
    if (variant === 'missing-chosen-probability') payload.answers[0].probabilities = [{ value: 'escalate_human', probability: 1 }];
    const result = await runRouter(makeFetchMock(jsonResponse(200, payload)));
    expect(result).toMatchObject({ status: 'unavailable', reason: 'malformed_answers', retryable: false });
    vi.unstubAllGlobals();
  });
});
