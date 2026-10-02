import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

export type FixtureKnowledgePassage = {
  filename: string;
  text: string;
  score?: number;
};

/** Raw historical replies are audit material, never knowledge evidence. */
export const ATC_TEMPLATE_SOURCE = 'notion_customer_service_templates';

function isResponseSample(result: {
  filename: string;
  attributes?: Record<string, string | number | boolean> | null;
}): boolean {
  return result.attributes?.source === ATC_TEMPLATE_SOURCE ||
    result.attributes?.source_kind === 'response_sample' ||
    result.filename.startsWith('atc-template-');
}

/**
 * Offline fixture KB gateway. Serves canned passages ranked by score
 * (declared order wins ties) as success evidence with stable fixture file
 * IDs. Used only when fixture data provides canned passages; all other
 * cases keep the shared live gateway. Never indexes or fetches articles.
 */
export class FixtureKnowledgeRetrievalGateway implements KnowledgeRetrievalGateway {
  constructor(private readonly passages: readonly FixtureKnowledgePassage[]) {}

  async search(query: string, options?: { rewriteQuery: boolean }): Promise<KnowledgeRetrievalResult> {
    void query;
    void options;
    const ranked = this.passages.filter((passage) => !isResponseSample(passage)).sort((a, b) => (b.score ?? 1) - (a.score ?? 1));
    return {
      status: 'success',
      evidence: ranked.map((passage, index) => ({
        fileId: `fixture-kb-${index}`,
        filename: passage.filename,
        score: passage.score ?? 1,
        text: passage.text,
      })),
    };
  }
}

export type FullArticleProjection = {
  text: string;
  sourceUrl: string;
};

/**
 * Vector-store file attribute source for official help-center articles.
 * The batch guard scopes to this source so supplemental template files in
 * the same store never affect the comparison.
 */
export const KNOWLEDGE_SYNC_SOURCE = 'recap-agent-knowledge-sync';

/** Filenames the snapshot reader accepts; traversal is rejected. */
const SAFE_ARTICLE_FILENAME = /^[\p{L}\p{N}][\p{L}\p{N}-]*\.md$/u;

export type KnowledgeSnapshotManifest = {
  version: 1;
  source: string;
  batchId: string;
  vectorStoreId: string;
  syncedAt: string;
  articles: Array<{ slug: string; sha256: string; bytes: number }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Defensive manifest parse; any shape deviation disables expansion. */
export function parseSnapshotManifest(value: unknown): KnowledgeSnapshotManifest | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.source !== 'string' || typeof value.batchId !== 'string') return null;
  if (typeof value.vectorStoreId !== 'string' || typeof value.syncedAt !== 'string') return null;
  if (!Array.isArray(value.articles)) return null;
  const articles: KnowledgeSnapshotManifest['articles'] = [];
  for (const entry of value.articles) {
    if (!isRecord(entry)) return null;
    if (typeof entry.slug !== 'string' || typeof entry.sha256 !== 'string') return null;
    if (typeof entry.bytes !== 'number') return null;
    articles.push({ slug: entry.slug, sha256: entry.sha256, bytes: entry.bytes });
  }
  return {
    version: 1,
    source: value.source,
    batchId: value.batchId,
    vectorStoreId: value.vectorStoreId,
    syncedAt: value.syncedAt,
    articles,
  };
}

/**
 * Token-efficient projection of a complete synced article for model evidence.
 * Keeps only the title and the collapsed body; frontmatter tags, topics and
 * timestamps never reach the model. The source URL is validated and
 * returned for the deterministic delivery citation, but is deliberately
 * withheld from model text so the agent can never generate, paraphrase or
 * preempt the footer link. Returns null unless the frontmatter slug matches
 * the search-result filename and the source URL shares the help-center
 * origin, so a mismatched file can never ground an answer or a citation.
 * Over-budget bodies cut at a paragraph boundary with an explicit
 * continuation marker.
 */
export function projectFullArticleForEvidence(args: {
  markdown: string;
  filename: string;
  baseUrl: string;
  maxChars: number;
}): FullArticleProjection | null {
  const frontmatter = args.markdown.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!frontmatter?.[1]) return null;
  const head = frontmatter[1];
  const title = head.match(/^title: "((?:[^"\\]|\\.)*)"/mu)?.[1]?.replace(/\\"/gu, '"') ?? null;
  const slug = head.match(/^slug: (\S+)/mu)?.[1] ?? null;
  const sourceUrl = head.match(/^source_url: "([^"]+)"/mu)?.[1] ?? null;
  if (!title || !slug || !sourceUrl) return null;
  if (args.filename !== `${slug}.md`) return null;
  let sourceOrigin: string;
  let baseOrigin: string;
  try {
    sourceOrigin = new URL(sourceUrl).origin;
    baseOrigin = new URL(args.baseUrl).origin;
  } catch {
    return null;
  }
  if (sourceOrigin !== baseOrigin) return null;
  const body = args.markdown
    .slice(frontmatter[0].length)
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  let text = `# ${title}\n\n${body}`;
  if (text.length > args.maxChars) {
    const cut = text.lastIndexOf('\n\n', args.maxChars);
    text = `${text.slice(0, cut > 0 ? cut : args.maxChars).trimEnd()}\n\n…`;
  }
  return { text, sourceUrl };
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
      /**
       * Help-center base URL enabling full-article expansion. Absent means
       * chunk evidence only; expansion stays fail-closed without it.
       */
      articleBaseUrl?: string;
      /**
       * Snapshot root holding manifest.json plus articles/. OpenAI blocks
       * downloading uploaded files, so complete articles come from this
       * committed snapshot instead of the Files API. Absent means chunk
       * evidence only.
       */
      articlesDir?: string;
      fullArticleMinScore?: number;
      fullArticleMaxFiles?: number;
      fullArticleMaxChars?: number;
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
    articleBaseUrl?: string;
    articlesDir?: string;
    fullArticleMinScore?: number;
    fullArticleMaxFiles?: number;
    fullArticleMaxChars?: number;
  };

  private snapshotManifest: KnowledgeSnapshotManifest | null | undefined;
  private observedStoreBatch: string | null | undefined;

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
              filters: {
                type: 'and',
                filters: [
                  { type: 'ne', key: 'source', value: ATC_TEMPLATE_SOURCE },
                  { type: 'ne', key: 'source_kind', value: 'response_sample' },
                ],
              },
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
      // Revalidate returned provenance as well as filtering before ranking.
      // Filename identity also blocks legacy exports with missing attributes.
      const results = captured.value.data.filter((result) => !isResponseSample(result));

      const evidence: KnowledgeEvidence[] = results.map((result) => ({
        fileId: result.file_id,
        filename: result.filename,
        score: result.score,
        text: result.content
          .map((content) => content.text.trim())
          .filter(Boolean)
          .join('\n')
          .slice(0, 6_000),
      }));
      const expanded = await this.maybeExpandFullArticle(
        results.map((result) => ({
          fileId: result.file_id,
          filename: result.filename,
          score: result.score,
        })),
        evidence,
      );

      return {
        status: 'success',
        ...(transportMetrics && transportMetrics.observedRequestCount > 0
          ? { openAiTransport: transportMetrics }
          : {}),
        evidence: expanded,
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

  /**
   * Full-article expansion for highly relevant hits. Chunk evidence can omit
   * the very tables or examples a question needs, inviting the model to
   * derive figures the articles never state; complete files close that gap.
   * Every distinct file at or above the score floor expands, up to
   * the file cap in rank order — sibling articles in a near-tie (host and
   * guest commission pages) are the mainline case, not ambiguity, and the
   * answer needs both. Complete text comes from the committed snapshot,
   * never the Files API (OpenAI blocks downloading uploaded files), and
   * only while the live store reports the snapshot's batch. Each file
   * expands independently: any read, hash, parse or validation failure
   * keeps that file's chunks, and retrieval never fails because expansion
   * did.
   */
  private async maybeExpandFullArticle(
    results: Array<{ fileId: string; filename: string; score: number }>,
    evidence: KnowledgeEvidence[],
  ): Promise<KnowledgeEvidence[]> {
    const baseUrl = this.options.articleBaseUrl;
    const articlesDir = this.options.articlesDir;
    if (!baseUrl || !articlesDir) return evidence;
    const minScore = this.options.fullArticleMinScore ?? 0.85;
    const maxFiles = this.options.fullArticleMaxFiles ?? 2;
    // The two official commission articles form one fee explanation. A
    // follow-up amount can rank the guest page at 0.84 and the host page at
    // 0.78; losing the worked example then invites unsupported arithmetic.
    // Select this verified source pair by file identity when either article
    // ranks first or remains a strong hit. Similarity scores are continuous:
    // a first-ranked trusted article at 0.799 must not lose its provenance.
    // Snapshot hash and live-batch checks still apply.
    const commissionFiles = new Set(['cuanto-cuesta.md', 'cuanto-cuesta-invitados.md']);
    const commissionPairRelevant = (results[0] !== undefined && commissionFiles.has(results[0].filename)) ||
      results.some((result) => commissionFiles.has(result.filename) && result.score >= 0.8);
    const seen = new Set<string>();
    const targets: Array<{ fileId: string; filename: string }> = [];
    for (const result of results) {
      if (targets.length >= maxFiles) break;
      if (seen.has(result.fileId)) continue;
      seen.add(result.fileId);
      if (result.score >= minScore ||
        (commissionPairRelevant && commissionFiles.has(result.filename))) {
        targets.push({ fileId: result.fileId, filename: result.filename });
      }
    }
    if (targets.length === 0) return evidence;
    const manifest = await this.loadSnapshotManifest();
    if (!manifest || !(await this.storeBatchMatches(manifest.batchId))) {
      return evidence;
    }
    const hashes = new Map(manifest.articles.map((article) => [article.slug, article.sha256]));
    const maxChars = this.options.fullArticleMaxChars ?? 10_000;
    const projections = await Promise.all(targets.map(async (target) => {
      const markdown = await this.readSnapshotArticle(target.filename, hashes);
      if (!markdown) return null;
      const projected = projectFullArticleForEvidence({
        markdown,
        filename: target.filename,
        baseUrl,
        maxChars,
      });
      return projected ? { fileId: target.fileId, projected } : null;
    }));
    const byFileId = new Map(
      projections
        .filter((projection): projection is NonNullable<typeof projection> => projection !== null)
        .map((projection) => [projection.fileId, projection.projected] as const),
    );
    if (byFileId.size === 0) return evidence;
    // The first chunk entry per expanded file carries the complete article;
    // later chunks of the same file stay as ranked context. Expanded entries
    // lead, longest first: near-tie sibling ranks are retrieval noise that
    // would flip the cited article run to run, while snapshot lengths are
    // stable, so length pins a deterministic citation target.
    const expanded = new Set<string>();
    const completed: KnowledgeEvidence[] = [];
    const rest: KnowledgeEvidence[] = [];
    for (const entry of evidence) {
      const projected = byFileId.get(entry.fileId);
      if (!projected || expanded.has(entry.fileId)) {
        rest.push(entry);
        continue;
      }
      expanded.add(entry.fileId);
      completed.push({
        ...entry,
        text: projected.text,
        fullArticle: true,
        sourceUrl: projected.sourceUrl,
      });
    }
    completed.sort((a, b) => b.text.length - a.text.length);
    return [...completed, ...rest];
  }

  private async loadSnapshotManifest(): Promise<KnowledgeSnapshotManifest | null> {
    if (this.snapshotManifest !== undefined) return this.snapshotManifest;
    const articlesDir = this.options.articlesDir;
    if (!articlesDir) {
      this.snapshotManifest = null;
      return null;
    }
    try {
      const raw = await readFile(path.join(articlesDir, 'manifest.json'), 'utf-8');
      const manifest = parseSnapshotManifest(JSON.parse(raw) as unknown);
      this.snapshotManifest = manifest?.source === KNOWLEDGE_SYNC_SOURCE ? manifest : null;
      return this.snapshotManifest;
    } catch {
      this.snapshotManifest = null;
      return null;
    }
  }

  /**
   * True while the live store reports exactly the snapshot batch for
   * official articles. The observed batch caches per gateway instance
   * (Lambda container); transitional states and list failures retry on the
   * next turn instead of caching. A resync without a redeploy therefore
   * disables expansion rather than grounding answers in stale text.
   */
  private async storeBatchMatches(manifestBatchId: string): Promise<boolean> {
    if (this.observedStoreBatch !== undefined) {
      return this.observedStoreBatch === manifestBatchId;
    }
    try {
      const batches = new Set<string>();
      for await (
        const file of this.client.vectorStores.files.list(this.options.vectorStoreId, { limit: 100 })
      ) {
        const attributes = file.attributes as Record<string, unknown> | null;
        if (
          attributes?.source === KNOWLEDGE_SYNC_SOURCE &&
          typeof attributes.batch_id === 'string'
        ) {
          batches.add(attributes.batch_id);
        }
      }
      if (batches.size !== 1) return false;
      const observed = [...batches][0] ?? null;
      this.observedStoreBatch = observed;
      return observed === manifestBatchId;
    } catch {
      return false;
    }
  }

  /**
   * Reads one snapshot article by search-result filename. Rejects unsafe
   * names and path escapes, and verifies the manifest hash so a corrupt or
   * partial bundle can never ground an answer. Null means keep chunks.
   */
  private async readSnapshotArticle(
    filename: string,
    hashes: ReadonlyMap<string, string>,
  ): Promise<string | null> {
    const articlesDir = this.options.articlesDir;
    if (!articlesDir || !SAFE_ARTICLE_FILENAME.test(filename)) return null;
    const root = path.resolve(articlesDir, 'articles');
    const resolved = path.resolve(root, filename);
    if (!resolved.startsWith(`${root}${path.sep}`)) return null;
    try {
      const markdown = await readFile(resolved, 'utf-8');
      const expected = hashes.get(filename.replace(/\.md$/u, ''));
      if (expected !== undefined) {
        const actual = crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
        if (actual !== expected) return null;
      }
      return markdown;
    } catch {
      return null;
    }
  }
}
