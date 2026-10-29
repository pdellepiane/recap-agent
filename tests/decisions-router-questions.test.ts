import { describe, expect, it } from 'vitest';

import type { OpenRequest } from '../src/core/open-request';
import {
  bindRouterRequestChoices,
  type RouterQuestion,
} from '../src/runtime/decisions-router-questions';

const questions: readonly RouterQuestion[] = [
  {
    type: 'choice',
    name: 'route',
    instructions: 'route instructions',
    choices: [
      { value: 'answer_with_records', description: 'answer' },
      { value: 'ask_clarification', description: 'clarify' },
    ],
  },
  {
    type: 'choice',
    name: 'same_open_request',
    instructions: 'same_open_request instructions',
    choices: [
      { value: 'same', description: 'the same request' },
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

function openRequest(key: string): OpenRequest {
  return {
    key,
    opening_text: `request ${key}`,
    state: 'unresolved',
    since: '2026-10-23T00:00:00.000Z',
    turns: 1,
  };
}

describe('bindRouterRequestChoices', () => {
  it('omits same_open_request when no request is retained', () => {
    const bound = bindRouterRequestChoices(questions, []);

    expect(bound.map((question) => question.name)).toEqual([
      'route',
      'request_settled',
    ]);
  });

  it.each([1, 2, 3])('binds %i retained request(s) plus new', (count) => {
    const requests = Array.from({ length: count }, (_, index) => openRequest(`req-${index}`));

    const bound = bindRouterRequestChoices(questions, requests);
    const sameOpenRequest = bound.find(
      (question) => question.name === 'same_open_request',
    );

    expect(sameOpenRequest?.choices.map((choice) => choice.value)).toEqual([
      ...requests.map((request) => `request:${request.key}`),
      'new',
    ]);
  });

  it('keeps the route and request_settled questions untouched', () => {
    const bound = bindRouterRequestChoices(questions, [openRequest('req-1')]);

    expect(bound.filter((question) => question.name !== 'same_open_request'))
      .toEqual(questions.filter((question) => question.name !== 'same_open_request'));
  });
});
