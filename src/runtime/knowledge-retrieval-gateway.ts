import OpenAI from 'openai';

import type { KnowledgeEvidence } from '../core/information';

export type KnowledgeRetrievalResult =
  | {
      status: 'success';
      evidence: KnowledgeEvidence[];
    }
  | {
      status: 'failed';
      reason: 'not_configured' | 'request_failed';
      retryable: boolean;
      error: string;
    };

export interface KnowledgeRetrievalGateway {
  search(query: string): Promise<KnowledgeRetrievalResult>;
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
    },
  ) {
    this.options = options;
    this.client = new OpenAI({ apiKey: options.apiKey, maxRetries: 3 });
  }

  private readonly options: {
    apiKey: string;
    vectorStoreId: string;
    maxResults: number;
    scoreThreshold: number;
  };

  async search(query: string): Promise<KnowledgeRetrievalResult> {
    try {
      const page = await this.client.vectorStores.search(
        this.options.vectorStoreId,
        {
          query,
          max_num_results: this.options.maxResults,
          rewrite_query: true,
          ranking_options: {
            ranker: 'auto',
            score_threshold: this.options.scoreThreshold,
          },
        },
      );

      return {
        status: 'success',
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
      };
    }
  }
}
