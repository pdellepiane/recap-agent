import { describe, expect, it } from 'vitest';

import {
  resolveRuntimeRequestRoute,
  runtimeRequestPaths,
} from '../src/lambda/request-route';

describe('Lambda request routing', () => {
  it('routes conversational messages through the original root endpoint', () => {
    expect(resolveRuntimeRequestRoute(runtimeRequestPaths.message)).toBe('message');
  });

  it('routes takeover through its conversation endpoint', () => {
    expect(resolveRuntimeRequestRoute(runtimeRequestPaths.overtakeConversation)).toBe(
      'overtake_conversation',
    );
  });

  it('routes resume through its conversation endpoint', () => {
    expect(resolveRuntimeRequestRoute(runtimeRequestPaths.resumeAutomatedAgent)).toBe(
      'resume_automated_agent',
    );
  });

  it('rejects unknown paths', () => {
    expect(resolveRuntimeRequestRoute('/unknown')).toBe('not_found');
  });
});
