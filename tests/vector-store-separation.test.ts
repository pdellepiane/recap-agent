import { describe, expect, it } from 'vitest';
import { getConfig } from '../src/runtime/config';

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('FAQ and provider vector store separation', () => {
  it('keeps user authentication and event lookup in production by default', () => {
    withEnv(
      {
        SINENVOLTURAS_GUEST_SERVICE_BASE_URL: undefined,
        SINENVOLTURAS_USER_AUTH_BASE_URL: undefined,
      },
      () => {
        const config = getConfig();

        expect(config.providerApi.userAuthBaseUrl).toBe(
          'https://api.sinenvolturas.com/api-web/user',
        );
        expect(config.providerApi.guestServiceBaseUrl).toBe(
          'https://api.sinenvolturas.com/api/guest-service',
        );
      },
    );
  });

  it('maps KB_VECTOR_STORE_ID only to FAQ knowledge-base config', () => {
    withEnv(
      {
        OPENAI_API_KEY: 'test-key',
        PROVIDER_VECTOR_STORE_ID: 'vs_provider_test',
        KB_VECTOR_STORE_ID: 'vs_kb_test',
      },
      () => {
        const config = getConfig();

        expect(config.providerApi.vectorStoreId).toBe('vs_provider_test');
        expect(config.knowledgeBase.vectorStoreId).toBe('vs_kb_test');
        expect(config.providerApi.vectorStoreId).not.toBe(config.knowledgeBase.vectorStoreId);
      },
    );
  });

});
