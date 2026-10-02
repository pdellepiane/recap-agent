import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  OpenAiKnowledgeRetrievalGateway,
  FixtureKnowledgeRetrievalGateway,
  projectFullArticleForEvidence,
} from '../src/runtime/knowledge-retrieval-gateway';

describe('OpenAiKnowledgeRetrievalGateway', () => {
  it('searches the configured vector store with the complete semantic query', async () => {
    const search = vi.fn(async (...args: [
      string,
      Record<string, unknown>,
      { signal?: AbortSignal }?,
    ]) => {
      void args;
      return {
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
      };
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

    const call = search.mock.calls[0];
    expect(call?.[0]).toBe('vs_faq');
    expect(call?.[1]).toEqual({
      query: '¿Cuánto cobra Sin Envolturas por una lista de regalos?',
      filters: { type: 'and', filters: [
        { type: 'ne', key: 'source', value: 'notion_customer_service_templates' },
        { type: 'ne', key: 'source_kind', value: 'response_sample' },
      ] },
      max_num_results: 4,
      rewrite_query: true,
      ranking_options: {
        ranker: 'auto',
        score_threshold: 0.2,
      },
    });
    expect(call?.[2]?.signal).toBeInstanceOf(AbortSignal);
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

  it('expands snapshot articles with full-article citation evidence', async () => {
    {
      const articlesDir = snapshotWith([
        { slug: 'cuanto-cuesta-invitados', title: 'Invitados', body: 'Tablas.' },
        {
          slug: 'cuanto-cuesta',
          title: '¿Cuánto cuesta?',
          body: 'Crearte una cuenta es gratis.   \n\n\n| Variable | Fija |\n| --- | --- |\n| 1.35% | US$1.15 |',
        },
      ], 'kb-batch-1');
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-guest',
            filename: 'cuanto-cuesta-invitados.md',
            score: 0.874,
            content: [{ type: 'text', text: 'Chunk invitado.' }],
          },
          {
            file_id: 'file-host',
            filename: 'cuanto-cuesta.md',
            score: 0.854,
            content: [{ type: 'text', text: 'Chunk anfitrión.' }],
          },
          {
            file_id: 'file-host',
            filename: 'cuanto-cuesta.md',
            score: 0.82,
            content: [{ type: 'text', text: 'Segundo chunk del mismo archivo.' }],
          },
          {
            file_id: 'file-other',
            filename: 'medios-de-pago.md',
            score: 0.7,
            content: [{ type: 'text', text: 'Bajo el piso.' }],
          },
        ],
      }));
      const gateway = gatewayWith({ search, list: storeFiles(['kb-batch-1']), articlesDir });

      const result = await gateway.search('¿Cuánto cobran de comisión?');

      expect(result.status).toBe('success');
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence).toHaveLength(4);
      // Expanded entries lead longest-first, so the fuller host article pins
      // the citation target even though the guest article ranked first.
      expect(evidence[0]?.fullArticle).toBe(true);
      expect(evidence[0]?.sourceUrl).toBe('https://sinenvolturas.tawk.help/article/cuanto-cuesta');
      expect(evidence[1]?.fullArticle).toBe(true);
      expect(evidence[1]?.sourceUrl).toBe('https://sinenvolturas.tawk.help/article/cuanto-cuesta-invitados');
      // Token efficiency: title + collapsed body only; the source URL stays
      // out of model text so the agent can never preempt the footer link.
      expect(evidence[0]?.text).toBe(
        '# ¿Cuánto cuesta?\n\n' +
          'Crearte una cuenta es gratis.\n\n' +
          '| Variable | Fija |\n| --- | --- |\n| 1.35% | US$1.15 |',
      );
      expect(evidence[0]?.text).not.toContain('tawk.help');
      // Later chunks of an expanded file stay as ranked context.
      expect(evidence[2]?.fullArticle).toBeUndefined();
      expect(evidence[3]?.fullArticle).toBeUndefined();
    }

    {
      const articlesDir = snapshotWith([
        { slug: 'cuanto-cuesta-invitados', title: 'Invitados', body: 'Tabla de invitados.' },
        { slug: 'cuanto-cuesta', title: 'Anfitriones', body: 'Ejemplo publicado de US$100.' },
      ], 'kb-batch-1');
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-guest',
            filename: 'cuanto-cuesta-invitados.md',
            score: 0.8405,
            content: [{ type: 'text', text: 'Fragmento de invitado.' }],
          },
          {
            file_id: 'file-host',
            filename: 'cuanto-cuesta.md',
            score: 0.7874,
            content: [{ type: 'text', text: 'Fragmento de anfitrión.' }],
          },
        ],
      }));
      const gateway = gatewayWith({ search, list: storeFiles(['kb-batch-1']), articlesDir });

      const result = await gateway.search('¿Y si el aporte es de S/50?');
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence.filter((entry) => entry.fullArticle)).toHaveLength(2);
      expect(evidence.map((entry) => entry.sourceUrl)).toContain(
        'https://sinenvolturas.tawk.help/article/cuanto-cuesta',
      );
      expect(evidence.map((entry) => entry.sourceUrl)).toContain(
        'https://sinenvolturas.tawk.help/article/cuanto-cuesta-invitados',
      );
    }
  });

  it('keeps chunks when expansion is unavailable or unsafe', async () => {
    {
      const articlesDir = snapshotWith(
        [{ slug: 'vigencia-evento', title: 'Cuesta', body: 'Cuerpo.' }],
        'kb-batch-1',
      );
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-top',
            filename: 'vigencia-evento.md',
            score: 0.7,
            content: [{ type: 'text', text: 'Texto parcial.' }],
          },
        ],
      }));
      const list = storeFiles(['kb-batch-1']);
      const gateway = gatewayWith({ search, list, articlesDir });

      const result = await gateway.search('comisión');
      expect(list).not.toHaveBeenCalled();
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence[0]?.text).toBe('Texto parcial.');
      expect(evidence[0]?.fullArticle).toBeUndefined();
    }

    {
      const articlesDir = snapshotWith(
        [{ slug: 'cuanto-cuesta', title: 'Cuesta', body: 'Cuerpo viejo.' }],
        'kb-batch-1',
      );
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-top',
            filename: 'cuanto-cuesta.md',
            score: 0.95,
            content: [{ type: 'text', text: 'Texto parcial.' }],
          },
        ],
      }));
      const gateway = gatewayWith({ search, list: storeFiles(['kb-batch-2']), articlesDir });

      const result = await gateway.search('comisión');
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence[0]?.text).toBe('Texto parcial.');
      expect(evidence[0]?.fullArticle).toBeUndefined();
    }

    {
      const articlesDir = snapshotWith(
        [{ slug: 'cuanto-cuesta', title: 'Cuesta', body: 'Cuerpo.' }],
        'kb-batch-1',
      );
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-evil',
            filename: '../escape.md',
            score: 0.95,
            content: [{ type: 'text', text: 'Chunk sospechoso.' }],
          },
          {
            file_id: 'file-missing',
            filename: 'no-existe.md',
            score: 0.94,
            content: [{ type: 'text', text: 'Chunk huérfano.' }],
          },
        ],
      }));
      const gateway = gatewayWith({ search, list: storeFiles(['kb-batch-1']), articlesDir });

      const result = await gateway.search('comisión');
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence[0]?.text).toBe('Chunk sospechoso.');
      expect(evidence[0]?.fullArticle).toBeUndefined();
      expect(evidence[1]?.text).toBe('Chunk huérfano.');
      expect(evidence[1]?.fullArticle).toBeUndefined();
    }
  });

  it('preserves the official citation for a first-ranked commission article below a score threshold', async () => {
    const articlesDir = snapshotWith([
      { slug: 'cuanto-cuesta', title: 'Comisiones', body: 'Tabla oficial.' },
      { slug: 'cuanto-cuesta-invitados', title: 'Invitados', body: 'Ejemplo oficial.' },
    ], 'kb-batch-1');
    const search = vi.fn(async () => ({ data: [
      { file_id: 'host', filename: 'cuanto-cuesta.md', score: 0.7998310192463652, content: [{ type: 'text', text: 'Chunk.' }] },
      { file_id: 'guest', filename: 'cuanto-cuesta-invitados.md', score: 0.7615131717837881, content: [{ type: 'text', text: 'Chunk.' }] },
    ] }));
    const result = await gatewayWith({ search, list: storeFiles(['kb-batch-1']), articlesDir }).search('comisión para 50 soles');
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Retrieval failed');
    expect(result.evidence.map((entry) => entry.sourceUrl)).toEqual(expect.arrayContaining([
      'https://sinenvolturas.tawk.help/article/cuanto-cuesta',
      'https://sinenvolturas.tawk.help/article/cuanto-cuesta-invitados',
    ]));
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.every((entry) => entry.fullArticle)).toBe(true);
  });

  it('retries the batch check after a list failure instead of caching it', async () => {
    const articlesDir = snapshotWith(
      [{ slug: 'cuanto-cuesta', title: 'Cuesta', body: 'Cuerpo.' }],
      'kb-batch-1',
    );
    const search = vi.fn(async () => ({
      data: [
        {
          file_id: 'file-top',
          filename: 'cuanto-cuesta.md',
          score: 0.95,
          content: [{ type: 'text', text: 'Texto parcial.' }],
        },
      ],
    }));
    let calls = 0;
    const list = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('list down');
      return (async function* () {
        yield {
          id: 'vsfile-0',
          attributes: { source: 'recap-agent-knowledge-sync', batch_id: 'kb-batch-1', slug: 'cuanto-cuesta' },
        };
      })();
    });
    const gateway = gatewayWith({ search, list, articlesDir });

    const first = await gateway.search('comisión');
    const firstEvidence = first.status === 'success' ? first.evidence : [];
    expect(firstEvidence[0]?.fullArticle).toBeUndefined();

    const second = await gateway.search('comisión');
    const secondEvidence = second.status === 'success' ? second.evidence : [];
    expect(secondEvidence[0]?.fullArticle).toBe(true);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('skips a snapshot article whose hash disagrees with the manifest', async () => {
    const articlesDir = snapshotWith([
      { slug: 'cuanto-cuesta-invitados', title: 'Invitados', body: 'Tablas.' },
      { slug: 'cuanto-cuesta', title: 'Cuesta', body: 'Cuerpo íntegro.' },
    ], 'kb-batch-1');
    fs.writeFileSync(
      path.join(articlesDir, 'articles', 'cuanto-cuesta-invitados.md'),
      'Contenido manipulado sin frontmatter.',
      'utf-8',
    );
    const search = vi.fn(async () => ({
      data: [
        {
          file_id: 'file-guest',
          filename: 'cuanto-cuesta-invitados.md',
          score: 0.9,
          content: [{ type: 'text', text: 'Chunk invitado.' }],
        },
        {
          file_id: 'file-host',
          filename: 'cuanto-cuesta.md',
          score: 0.89,
          content: [{ type: 'text', text: 'Chunk anfitrión.' }],
        },
      ],
    }));
    const gateway = gatewayWith({ search, list: storeFiles(['kb-batch-1']), articlesDir });

    const result = await gateway.search('comisión');
    const evidence = result.status === 'success' ? result.evidence : [];
    expect(evidence[0]?.fullArticle).toBe(true);
    expect(evidence[0]?.sourceUrl).toBe('https://sinenvolturas.tawk.help/article/cuanto-cuesta');
    expect(evidence[1]?.text).toBe('Chunk invitado.');
    expect(evidence[1]?.fullArticle).toBeUndefined();
  });

  it('stays on chunks without snapshot or help-center configuration', async () => {
    {
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-top',
            filename: 'cuanto-cuesta.md',
            score: 0.95,
            content: [{ type: 'text', text: 'Texto parcial.' }],
          },
        ],
      }));
      const gateway = new OpenAiKnowledgeRetrievalGateway({
        apiKey: 'test-key',
        vectorStoreId: 'vs_faq',
        maxResults: 4,
        scoreThreshold: 0,
        articleBaseUrl: 'https://sinenvolturas.tawk.help',
      });
      const list = storeFiles(['kb-batch-1']);
      Object.assign(gateway as unknown as { client: unknown }, {
        client: { vectorStores: { search, files: { list } } },
      });
      const result = await gateway.search('comisión');
      expect(list).not.toHaveBeenCalled();
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence[0]?.fullArticle).toBeUndefined();
    }

    {
      const search = vi.fn(async () => ({
        data: [
          {
            file_id: 'file-top',
            filename: 'cuanto-cuesta.md',
            score: 0.95,
            content: [{ type: 'text', text: 'Texto parcial.' }],
          },
        ],
      }));
      const gateway = new OpenAiKnowledgeRetrievalGateway({
        apiKey: 'test-key',
        vectorStoreId: 'vs_faq',
        maxResults: 4,
        scoreThreshold: 0,
      });
      Object.assign(gateway as unknown as { client: unknown }, {
        client: { vectorStores: { search } },
      });
      const result = await gateway.search('comisión');
      const evidence = result.status === 'success' ? result.evidence : [];
      expect(evidence[0]?.fullArticle).toBeUndefined();
    }
  });

  it('excludes case-specific replies even when they outrank the official FAQ', async () => {
    const sample = { score: 1, content: [{ type: 'text', text: 'Tu regalo ya está validado.' }] };
    const search = vi.fn(async () => ({ data: [
      { ...sample, file_id: 'tagged', filename: 'otherwise-normal.md', attributes: { source: 'notion_customer_service_templates' } },
      { ...sample, file_id: 'legacy', filename: 'atc-template-validacion.md' },
      { ...sample, file_id: 'response', filename: 'sample.md', attributes: { source_kind: 'response_sample' } },
      { file_id: 'official', filename: 'validacion.md', score: 0.8, attributes: { source: 'recap-agent-knowledge-sync' }, content: [{ type: 'text', text: 'La validación requiere verificación.' }] },
      { file_id: 'helper', filename: 'helper-document.txt', score: 0.7, attributes: { source: 'recap-agent-faq-helper' }, content: [{ type: 'text', text: 'Documento publicado por el equipo.' }] },
    ] }));
    const result = await gatewayWith({ search }).search('¿Ya validaron mi regalo?');
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Retrieval failed');
    expect(result.evidence.map((entry) => entry.fileId)).toEqual(['official', 'helper']);
    expect(result.evidence.some((entry) => entry.text.includes('ya está validado'))).toBe(false);
  });

  it('also excludes legacy template passages from fixture model input', async () => {
    const gateway = new FixtureKnowledgeRetrievalGateway([
      { filename: 'atc-template-validacion.md', text: 'Ya validamos tu pago.', score: 1 },
      { filename: 'faq.md', text: 'La validación requiere verificación.', score: 0.8 },
    ]);
    const result = await gateway.search('validación');
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Retrieval failed');
    expect(result.evidence.map((entry) => entry.filename)).toEqual(['faq.md']);
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

describe('projectFullArticleForEvidence', () => {
  const base = {
    baseUrl: 'https://sinenvolturas.tawk.help',
    filename: 'cuanto-cuesta.md',
    maxChars: 10_000,
  };

  function markdownWith(head: string, body = 'Cuerpo.'): string {
    return `---\n${head}\n---\n\n${body}`;
  }

  const validHead = [
    'title: "¿Cuánto cuesta?"',
    'slug: cuanto-cuesta',
    'source_url: "https://sinenvolturas.tawk.help/article/cuanto-cuesta"',
  ].join('\n');

  it('rejects untrusted article projections', () => {
    {
      const head = validHead.replace('slug: cuanto-cuesta', 'slug: otro-articulo');
      expect(
        projectFullArticleForEvidence({ ...base, markdown: markdownWith(head) }),
      ).toBeNull();
    }

    {
      const head = validHead.replace(
        'https://sinenvolturas.tawk.help/article/cuanto-cuesta',
        'https://ejemplo.com/article/cuanto-cuesta',
      );
      expect(
        projectFullArticleForEvidence({ ...base, markdown: markdownWith(head) }),
      ).toBeNull();
    }

    {
      expect(
        projectFullArticleForEvidence({ ...base, markdown: 'Sin frontmatter.' }),
      ).toBeNull();
    }
  });

  it('cuts over-budget bodies at a paragraph boundary with a marker', () => {
    const body = `${'a'.repeat(400)}\n\n${'b'.repeat(400)}\n\n${'c'.repeat(400)}`;
    const projected = projectFullArticleForEvidence({
      ...base,
      maxChars: 600,
      markdown: markdownWith(validHead, body),
    });
    expect(projected).not.toBeNull();
    expect(projected?.text.endsWith('\n\n…')).toBe(true);
    expect(projected?.text).toContain('a'.repeat(400));
    expect(projected?.text).not.toContain('c'.repeat(400));
    expect(projected?.sourceUrl).toBe('https://sinenvolturas.tawk.help/article/cuanto-cuesta');
  });
});

function articleMarkdown(slug: string, title: string, body: string): string {
  return [
    '---',
    `title: "${title}"`,
    `slug: ${slug}`,
    `source_url: "https://sinenvolturas.tawk.help/article/${slug}"`,
    '---',
    '',
    body,
  ].join('\n');
}

function snapshotWith(
  articles: Array<{ slug: string; title: string; body: string }>,
  batchId: string,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-snapshot-'));
  fs.mkdirSync(path.join(dir, 'articles'), { recursive: true });
  const entries = articles.map(({ slug, title, body }) => {
    const markdown = articleMarkdown(slug, title, body);
    fs.writeFileSync(path.join(dir, 'articles', `${slug}.md`), markdown, 'utf-8');
    return {
      slug,
      sha256: crypto.createHash('sha256').update(markdown, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(markdown, 'utf8'),
    };
  });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      source: 'recap-agent-knowledge-sync',
      batchId,
      vectorStoreId: 'vs_faq',
      syncedAt: '2026-09-24T00:00:00.000Z',
      articles: entries,
    }),
    'utf-8',
  );
  return dir;
}

function storeFiles(batchIds: string[]) {
  return vi.fn(() => (async function* () {
    for (const [index, batchId] of batchIds.entries()) {
      yield {
        id: `vsfile-${index}`,
        attributes: { source: 'recap-agent-knowledge-sync', batch_id: batchId, slug: `slug-${index}` },
      };
    }
  })());
}

function gatewayWith(clients: { search: unknown; list?: unknown; articlesDir?: string }): OpenAiKnowledgeRetrievalGateway {
  const gateway = new OpenAiKnowledgeRetrievalGateway({
    apiKey: 'test-key',
    vectorStoreId: 'vs_faq',
    maxResults: 4,
    scoreThreshold: 0,
    articleBaseUrl: 'https://sinenvolturas.tawk.help',
    ...(clients.articlesDir ? { articlesDir: clients.articlesDir } : {}),
  });
  Object.assign(gateway as unknown as { client: unknown }, {
    client: {
      vectorStores: {
        search: clients.search,
        files: { list: clients.list ?? storeFiles([]) },
      },
    },
  });
  return gateway;
}
