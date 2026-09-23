import { describe, expect, it, vi } from 'vitest';

import {
  classifyOpenAiRetry,
  executeWithOpenAiRetry,
  isPermanentQuotaExhaustion,
} from '../src/runtime/openai-retry';

describe('OpenAI retry policy', () => {
  it.each([
    [{ status: 429, error: { code: 'insufficient_quota' } }, 'permanent_code:insufficient_quota'],
    [{ status: 401, error: { code: 'invalid_api_key' } }, 'permanent_code:invalid_api_key'],
    [{ status: 403, error: { type: 'permission_denied' } }, 'permanent_code:permission_denied'],
    [{ status: 400, error: { type: 'invalid_request_error' } }, 'permanent_code:invalid_request_error'],
    [{ status: 422 }, 'permanent_http_422'],
  ])('does not retry permanent error %#', (error, reason) => {
    expect(classifyOpenAiRetry(error)).toEqual({
      retryable: false,
      reason,
    });
  });

  it.each([
    [{ status: 429 }, 'transient_rate_limit'],
    [{ status: 408 }, 'transient_timeout'],
    [{ status: 500 }, 'transient_server'],
    [{ status: 503 }, 'transient_server'],
    [Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }), 'transient_network'],
  ])('retries transient error %#', (error, reason) => {
    expect(classifyOpenAiRetry(error)).toMatchObject({
      retryable: true,
      reason,
    });
  });

  it('respects retry headers and the bounded attempt count', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({
        status: 429,
        headers: { 'retry-after-ms': '7' },
      })
      .mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await executeWithOpenAiRetry(operation, {
      maxAttempts: 2,
      sleep,
    });

    expect(result).toEqual({ value: 'ok', attemptCount: 2 });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it('makes exactly one attempt for insufficient quota', async () => {
    const operation = vi.fn().mockRejectedValue({
      status: 429,
      error: { code: 'insufficient_quota' },
    });

    await expect(executeWithOpenAiRetry(operation)).rejects.toMatchObject({
      status: 429,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('detects nested permanent codes despite unrelated wrapper fields', () => {
    const masked = {
      status: 429,
      type: 'outer_wrapper',
      error: {
        type: 'rate_limit_error',
        nested: { code: 'insufficient_quota' },
      },
    };
    expect(classifyOpenAiRetry(masked)).toEqual({
      retryable: false,
      reason: 'permanent_code:insufficient_quota',
    });
    expect(isPermanentQuotaExhaustion(masked)).toBe(true);

    const billingMasked = {
      status: 429,
      code: 'outer_ok',
      cause: { errorCode: 'billing_hard_limit_reached' },
    };
    expect(classifyOpenAiRetry(billingMasked)).toEqual({
      retryable: false,
      reason: 'permanent_code:billing_hard_limit_reached',
    });
    expect(isPermanentQuotaExhaustion(billingMasked)).toBe(true);
  });

  it('recognizes the no-credits diagnostic when structured fields are absent', () => {
    const messageOnly = {
      status: 429,
      error: { message: 'You exceeded your current quota, please check your plan and billing details.' },
    };
    expect(classifyOpenAiRetry(messageOnly)).toEqual({
      retryable: false,
      reason: 'permanent_code:insufficient_quota',
    });
    expect(isPermanentQuotaExhaustion(messageOnly)).toBe(true);
    expect(isPermanentQuotaExhaustion(new Error('No credits remaining for this API key'))).toBe(true);

    const transient = { status: 429, error: { message: 'Rate limit reached, retry shortly.' } };
    expect(classifyOpenAiRetry(transient)).toMatchObject({ retryable: true });
    expect(isPermanentQuotaExhaustion(transient)).toBe(false);
    expect(isPermanentQuotaExhaustion({ status: 401, error: { code: 'invalid_api_key' } })).toBe(false);
  });
});
