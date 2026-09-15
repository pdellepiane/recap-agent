import OpenAI from 'openai';

import type { KnowledgeEvidence } from '../core/information';
import type { OpenAiTransportMetrics } from './contracts';
import { executeOpenAiStage } from './openai-stage-execution';
import {
  captureOpenAiTransport,
  installOpenAiTransportCapture,
} from '../audit/openai-transport-capture';

export type KnowledgeRetrievalResult =
  | {
      status: 'success';
      evidence: KnowledgeEvidence[];
      openAiTransport?: OpenAiTransportMetrics;
    }
  | {
      status: 'failed';
      reason: 'not_configured' | 'request_failed';
      retryable: boolean;
      error: string;
      openAiTransport?: OpenAiTransportMetrics;
    };

export interface KnowledgeRetrievalGateway {
  search(query: string, options?: { rewriteQuery: boolean }): Promise<KnowledgeRetrievalResult>;
}

export class NoopKnowledgeRetrievalGateway implements KnowledgeRetrievalGateway {
  async search(query: string): Promise<KnowledgeRetrievalResult> {
    void query;
    return {
      status: 'failed',
      reason: 'not_configured',
      retryable: false,
      error: 'Knowledge-base retrieval is not configured.',
    };
  }
}

export class OpenAiKnowledgeRetrievalGateway implements KnowledgeRetrievalGateway {
  private readonly client: OpenAI;

  constructor(
    options: {
      apiKey: string;
      vectorStoreId: string;
      maxResults: number;
      scoreThreshold: number;
      timeoutMs?: number;
    },
  ) {
    this.options = options;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 1,
      timeout: options.timeoutMs ?? 8_000,
    });
    installOpenAiTransportCapture(this.client);
  }

  private readonly options: {
    apiKey: string;
    vectorStoreId: string;
    maxResults: number;
    scoreThreshold: number;
    timeoutMs?: number;
  };

  async search(query: string, options?: { rewriteQuery: boolean }): Promise<KnowledgeRetrievalResult> {
    let transportMetrics: OpenAiTransportMetrics | undefined;
    try {
      const captured = await captureOpenAiTransport('knowledge_retrieval',
        async () => await executeOpenAiStage({
          stage: 'knowledge_retrieval',
          model: 'vector_store_search',
          timeoutMs: this.options.timeoutMs ?? 8_000,
          operation: async (signal) => await this.client.vectorStores.search(
            this.options.vectorStoreId,
            {
              query,
              max_num_results: this.options.maxResults,
              rewrite_query: options?.rewriteQuery ?? true,
              ranking_options: {
                ranker: 'auto',
                score_threshold: this.options.scoreThreshold,
              },
            },
            { signal },
          ),
        }),
        (metrics) => { transportMetrics = metrics; },
      );
      const page = captured.value;

      return {
        status: 'success',
        ...(transportMetrics && transportMetrics.observedRequestCount > 0
          ? { openAiTransport: transportMetrics }
          : {}),
        evidence: page.data.map((result) => ({
          fileId: result.file_id,
          filename: result.filename,
          score: result.score,
          text: result.content
            .map((content) => content.text.trim())
            .filter(Boolean)
            .join('\n')
            .slice(0, 6_000),
        })),
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: 'request_failed',
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
        ...(transportMetrics && transportMetrics.observedRequestCount > 0
          ? { openAiTransport: transportMetrics }
          : {}),
      };
    }
  }
}
