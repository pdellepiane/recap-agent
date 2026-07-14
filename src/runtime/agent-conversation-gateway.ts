import { z } from 'zod';

export type AgentMessageDirection = 'inbound' | 'outbound';

export type AgentConversationMessage = {
  id: number;
  direction: AgentMessageDirection;
  source: string | null;
  body: string;
  status: string;
  sentAt: string | null;
  createdAt: string | null;
};

export type AgentGatewayResult =
  | {
      status: 'success';
      message: string | null;
    }
  | {
      status: 'skipped';
      reason: 'not_configured' | 'missing_phone_number';
      message: string;
    }
  | {
      status: 'failed';
      error: string;
      retryable: boolean;
    };

type AgentGatewaySkippedResult = Extract<AgentGatewayResult, { status: 'skipped' }>;

export type AgentMessageLogInput = {
  phoneNumber: string;
  body: string;
  direction: AgentMessageDirection;
  whatsappMessageId?: string | null;
  sentAt?: string | null;
};

export interface AgentConversationGateway {
  logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult>;
  getRecentMessages(phoneNumber: string): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  >;
  requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult>;
}

export class NoopAgentConversationGateway implements AgentConversationGateway {
  constructor(
    private readonly reason: 'not_configured' = 'not_configured',
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    return this.skipped('Agent API message logging is not configured.');
  }

  async getRecentMessages(phoneNumber: string): Promise<Exclude<AgentGatewayResult, { status: 'success' }>> {
    void phoneNumber;
    return this.skipped('Agent API conversation context is not configured.');
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    void phoneNumber;
    return this.skipped('Agent API human takeover is not configured.');
  }

  private skipped(message: string): AgentGatewaySkippedResult {
    return {
      status: 'skipped',
      reason: this.reason,
      message,
    };
  }
}

const envelopeSchema = z.object({
  status: z.boolean(),
  data: z.unknown().nullable().optional(),
  errors: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
});

const messageSchema = z.object({
  id: z.number(),
  direction: z.enum(['inbound', 'outbound']),
  source: z.string().nullable().optional(),
  body: z.string(),
  status: z.string(),
  sent_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const messagesDataSchema = z.object({
  messages: z.array(messageSchema),
});

export class HttpAgentConversationGateway implements AgentConversationGateway {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      maxRetries: number;
    },
  ) {}

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    const payload: Record<string, unknown> = {
      phone_number: input.phoneNumber,
      body: input.body,
      direction: input.direction,
    };
    if (input.whatsappMessageId) {
      payload.whatsapp_message_id = input.whatsappMessageId;
    }
    if (input.sentAt) {
      payload.sent_at = input.sentAt;
    }

    const response = await this.request('/messages', {
      method: 'POST',
      body: payload,
    });
    if (response.status !== 'success') {
      return response;
    }
    return {
      status: 'success',
      message: 'Message logged.',
    };
  }

  async getRecentMessages(phoneNumber: string): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    const params = new URLSearchParams({ phone_number: phoneNumber });
    const response = await this.request(`/conversations/messages?${params.toString()}`, {
      method: 'GET',
    });
    if (response.status !== 'success') {
      return response;
    }

    const parsed = messagesDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        status: 'failed',
        error: 'Agent API messages response had an unexpected shape.',
        retryable: false,
      };
    }

    return {
      status: 'success',
      messages: parsed.data.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        source: message.source ?? null,
        body: message.body,
        status: message.status,
        sentAt: message.sent_at ?? null,
        createdAt: message.created_at ?? null,
      })),
    };
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    const response = await this.request('/conversations/request-human', {
      method: 'POST',
      body: { phone_number: phoneNumber },
    });
    if (response.status !== 'success') {
      return response;
    }
    return {
      status: 'success',
      message: 'Human takeover requested.',
    };
  }

  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
    },
  ): Promise<
    | { status: 'success'; data: unknown }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    const attempts = Math.max(1, this.options.maxRetries + 1);
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(`${this.options.baseUrl}${path}`, {
          method: options.method,
          headers: {
            'X-Agent-Key': this.options.apiKey,
            ...(options.body ? { 'content-type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const parsedBody = await this.parseBody(response);
        if (!response.ok) {
          const retryable = this.isRetryableStatus(response.status);
          if (retryable && attempt < attempts) {
            lastError = this.httpError(response.status, parsedBody);
            await this.backoff(attempt);
            continue;
          }
          return {
            status: 'failed',
            error: this.httpError(response.status, parsedBody),
            retryable,
          };
        }

        const envelope = envelopeSchema.safeParse(parsedBody);
        if (!envelope.success) {
          return {
            status: 'failed',
            error: 'Agent API response had an unexpected envelope.',
            retryable: false,
          };
        }
        if (!envelope.data.status) {
          return {
            status: 'failed',
            error: envelope.data.error ?? 'Agent API returned status=false.',
            retryable: false,
          };
        }

        return {
          status: 'success',
          data: envelope.data.data ?? null,
        };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < attempts) {
          await this.backoff(attempt);
          continue;
        }
        return {
          status: 'failed',
          error: lastError,
          retryable: true,
        };
      }
    }

    return {
      status: 'failed',
      error: lastError ?? 'Agent API request failed.',
      retryable: true,
    };
  }

  private async parseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return await response.text().catch(() => '');
    }
    return await response.json().catch(() => null);
  }

  private httpError(status: number, body: unknown): string {
    const parsed = envelopeSchema.safeParse(body);
    if (parsed.success && parsed.data.error) {
      return `Agent API request failed with ${status}: ${parsed.data.error}`;
    }
    return `Agent API request failed with ${status}.`;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async backoff(attempt: number): Promise<void> {
    const delayMs = Math.min(100 * 2 ** Math.max(0, attempt - 1), 1_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
