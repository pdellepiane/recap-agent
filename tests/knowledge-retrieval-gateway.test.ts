import { describe, expect, it, vi } from 'vitest';

import { OpenAiKnowledgeRetrievalGateway } from '../src/runtime/knowledge-retrieval-gateway';

describe('OpenAiKnowledgeRetrievalGateway', () => {
  it('searches the configured vector store with the complete semantic query', async () => {
    const search = vi.fn().mockResolvedValue({
      data: [
        {
          file_id: 'file-1',
          filename: 'faq.md',
          score: 0.91,
          content: [
            { type: 'text', text: 'La comisión depende del producto.' },
          ],
        },
      ],
    });
    const gateway = new OpenAiKnowledgeRetrievalGateway({
      apiKey: 'test-key',
      vectorStoreId: 'vs_faq',
      maxResults: 4,
      scoreThreshold: 0.2,
    });
    Object.assign(
      gateway as unknown as {
        client: {
          vectorStores: {
            search: typeof search;
          };
        };
      },
      {
        client: {
          vectorStores: { search },
        },
      },
    );

    const result = await gateway.search(
      '¿Cuánto cobra Sin Envolturas por una lista de regalos?',
    );

    expect(search).toHaveBeenCalledWith('vs_faq', {
      query: '¿Cuánto cobra Sin Envolturas por una lista de regalos?',
      max_num_results: 4,
      rewrite_query: true,
      ranking_options: {
        ranker: 'auto',
        score_threshold: 0.2,
      },
    });
    expect(result).toEqual({
      status: 'success',
      evidence: [
        {
          fileId: 'file-1',
          filename: 'faq.md',
          score: 0.91,
          text: 'La comisión depende del producto.',
        },
      ],
    });
  });

  it('returns a retryable failure without exposing query content', async () => {
    const search = vi.fn().mockRejectedValue(new Error('temporary failure'));
    const gateway = new OpenAiKnowledgeRetrievalGateway({
      apiKey: 'test-key',
      vectorStoreId: 'vs_faq',
      maxResults: 4,
      scoreThreshold: 0,
    });
    Object.assign(
      gateway as unknown as {
        client: {
          vectorStores: {
            search: typeof search;
          };
        };
      },
      {
        client: {
          vectorStores: { search },
        },
      },
    );

    await expect(gateway.search('consulta privada')).resolves.toEqual({
      status: 'failed',
      reason: 'request_failed',
      retryable: true,
      error: 'temporary failure',
    });
  });
});
