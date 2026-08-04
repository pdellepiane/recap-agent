export type StoredOpenAiResponse = Record<string, unknown> & {
  id: string;
};

export type StoredOpenAiInputItem = Record<string, unknown> & {
  id?: string;
};

export class OpenAiAuditClient {
  constructor(
    private readonly options: {
      apiKey: string;
      fetch?: typeof fetch;
      baseUrl?: string;
    },
  ) {}

  async retrieveResponse(responseId: string): Promise<StoredOpenAiResponse> {
    return await this.getJson(
      `/responses/${encodeURIComponent(validateResponseId(responseId))}`,
    ) as StoredOpenAiResponse;
  }

  async listAllInputItems(responseId: string): Promise<StoredOpenAiInputItem[]> {
    const validatedResponseId = validateResponseId(responseId);
    const items: StoredOpenAiInputItem[] = [];
    let after: string | null = null;

    do {
      const query = new URLSearchParams({ limit: '100' });
      if (after) {
        query.set('after', after);
      }
      const page = await this.getJson(
        `/responses/${encodeURIComponent(validatedResponseId)}/input_items?${query.toString()}`,
      );
      if (!isRecord(page) || !Array.isArray(page.data)) {
        throw new Error('OpenAI input-items response has an invalid shape.');
      }
      items.push(...page.data.filter(isRecord));
      const hasMore = page.has_more === true;
      if (!hasMore) {
        after = null;
        continue;
      }
      const lastId = typeof page.last_id === 'string'
        ? page.last_id
        : readLastItemId(page.data);
      if (!lastId) {
        throw new Error('OpenAI input-items pagination omitted last_id.');
      }
      after = lastId;
    } while (after);

    return items;
  }

  private async getJson(pathname: string): Promise<unknown> {
    const requestFetch = this.options.fetch ?? fetch;
    const baseUrl = this.options.baseUrl ?? 'https://api.openai.com/v1';
    const response = await requestFetch(`${baseUrl}${pathname}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        accept: 'application/json',
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenAI audit GET failed with HTTP ${response.status}: ${sanitizeOpenAiError(body)}`,
      );
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error('OpenAI audit GET returned invalid JSON.');
    }
  }
}

export function sanitizeOpenAiError(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/gu, '[redacted-api-key]')
    .slice(0, 500);
}

function validateResponseId(responseId: string): string {
  if (!/^resp_[A-Za-z0-9_-]+$/u.test(responseId)) {
    throw new Error('OpenAI response ID must start with resp_.');
  }
  return responseId;
}

function readLastItemId(items: unknown[]): string | null {
  const last = items.at(-1);
  return isRecord(last) && typeof last.id === 'string' ? last.id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
