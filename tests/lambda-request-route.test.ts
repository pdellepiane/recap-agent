import { describe, expect, it } from 'vitest';

import {
  isRuntimeRequestMethodAllowed,
  resolveRuntimeRequestRoute,
  runtimeRequestPaths,
} from '../src/lambda/request-route';

describe('Lambda request routing', () => {
  it('routes known paths to runtime routes and rejects unknown paths', () => {
    expect(resolveRuntimeRequestRoute(runtimeRequestPaths.message)).toBe('message');
    expect(resolveRuntimeRequestRoute(runtimeRequestPaths.overtakeConversation)).toBe(
      'overtake_conversation',
    );
    expect(resolveRuntimeRequestRoute(runtimeRequestPaths.resumeAutomatedAgent)).toBe(
      'resume_automated_agent',
    );
    expect(resolveRuntimeRequestRoute('/unknown')).toBe('not_found');
  });

  it('accepts only POST for runtime requests', () => {
    expect(isRuntimeRequestMethodAllowed('POST')).toBe(true);
    expect(isRuntimeRequestMethodAllowed('post')).toBe(true);
    expect(isRuntimeRequestMethodAllowed('GET')).toBe(false);
    expect(isRuntimeRequestMethodAllowed('OPTIONS')).toBe(false);
  });
});
