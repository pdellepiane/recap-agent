import fs from 'node:fs';
import OpenAI from 'openai';
import type { KnowledgeBaseSyncConfig } from './types';

export type UploadBatchResult = {
  batchId: string;
  vectorStoreId: string;
  fileIds: string[];
};

export type KnowledgeUploadFile = {
  filePath: string;
  slug: string;
  category: string;
  articleType: string;
};

export type KnowledgeStoreAudit = {
  source: string;
  currentBatchFileCount: number;
  staleSourceFileCount: number;
  duplicateCurrentSlugs: string[];
};

export class OpenAiKnowledgeUploader {
  private readonly client: OpenAI;
  private static readonly defaultSource = 'recap-agent-knowledge-sync';

  constructor(private readonly config: KnowledgeBaseSyncConfig) {
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async uploadBatch(
    articleFiles: KnowledgeUploadFile[],
    batchId: string,
  ): Promise<UploadBatchResult> {
    const vectorStoreId = await this.ensureVectorStore();

    // Upload each file to the OpenAI Files API
    const uploadedFiles: Array<{
      id: string;
      slug: string;
      category: string;
      articleType: string;
    }> = [];
    for (const article of articleFiles) {
      const uploaded = await this.client.files.create({
        file: fs.createReadStream(article.filePath),
        purpose: 'assistants',
      });
      uploadedFiles.push({
        id: uploaded.id,
        slug: article.slug,
        category: article.category,
        articleType: article.articleType,
      });
    }

    console.log(`Uploaded ${uploadedFiles.length} files to OpenAI Files API`);

    // Add files to vector store as a batch with attributes
    const fileBatch = await this.client.vectorStores.fileBatches.create(vectorStoreId, {
      files: uploadedFiles.map((file) => ({
        file_id: file.id,
        attributes: {
          batch_id: batchId,
          source: this.uploadSource(),
          slug: this.attributeString(file.slug),
          category: this.attributeString(file.category),
          article_type: this.attributeString(file.articleType),
          ...this.config.uploadAttributes,
        },
      })),
    });

    console.log(`Created vector store file batch ${fileBatch.id} in ${vectorStoreId}`);

    // Poll until the batch is completed
    await this.pollBatchCompletion(vectorStoreId, fileBatch.id);

    return {
      batchId,
      vectorStoreId,
      fileIds: uploadedFiles.map((f) => f.id),
    };
  }

  async cleanupOldBatches(vectorStoreId: string, currentBatchId: string): Promise<void> {
    const allFiles = [];
    for await (const file of this.client.vectorStores.files.list(
      vectorStoreId,
      { limit: 100 },
    )) {
      allFiles.push(file);
    }

    const cleanupSource =
      this.config.cleanupScopeSource ?? this.uploadSource();

    const filesToDelete = allFiles.filter((file) => {
      const attributes = file.attributes as Record<string, unknown> | null;
      if (
        !attributes ||
        attributes.source !== cleanupSource ||
        attributes.batch_id === currentBatchId
      ) {
        return false;
      }
      return true;
    });

    if (filesToDelete.length === 0) {
      console.log('No old vector store files to clean up');
      return;
    }

    console.log(`Cleaning up ${filesToDelete.length} old vector store files from previous batches`);

    for (const file of filesToDelete) {
      await this.client.vectorStores.files.delete(file.id, {
        vector_store_id: vectorStoreId,
      });
      console.log(`Deleted vector store file ${file.id}`);
    }
  }

  async auditCurrentBatch(
    vectorStoreId: string,
    currentBatchId: string,
  ): Promise<KnowledgeStoreAudit> {
    const source = this.config.cleanupScopeSource ?? this.uploadSource();
    const sourceFiles: Array<{ batchId: unknown; slug: unknown }> = [];
    for await (const file of this.client.vectorStores.files.list(
      vectorStoreId,
      { limit: 100 },
    )) {
      const attributes = file.attributes as Record<string, unknown> | null;
      if (attributes?.source === source) {
        sourceFiles.push({
          batchId: attributes.batch_id,
          slug: attributes.slug,
        });
      }
    }

    const currentFiles = sourceFiles.filter(
      (file) => file.batchId === currentBatchId,
    );
    const slugCounts = new Map<string, number>();
    for (const file of currentFiles) {
      if (typeof file.slug !== 'string' || file.slug.length === 0) {
        continue;
      }
      slugCounts.set(file.slug, (slugCounts.get(file.slug) ?? 0) + 1);
    }

    return {
      source,
      currentBatchFileCount: currentFiles.length,
      staleSourceFileCount: sourceFiles.length - currentFiles.length,
      duplicateCurrentSlugs: Array.from(slugCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([slug]) => slug)
        .sort(),
    };
  }

  async waitForCleanCurrentBatch(args: {
    vectorStoreId: string;
    currentBatchId: string;
    expectedFileCount: number;
    maxWaitMs?: number;
  }): Promise<KnowledgeStoreAudit> {
    const maxWaitMs = args.maxWaitMs ?? 60_000;
    const startedAt = Date.now();
    let audit = await this.auditCurrentBatch(
      args.vectorStoreId,
      args.currentBatchId,
    );
    while (
      (audit.currentBatchFileCount !== args.expectedFileCount ||
        audit.staleSourceFileCount !== 0 ||
        audit.duplicateCurrentSlugs.length > 0) &&
      Date.now() - startedAt < maxWaitMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      audit = await this.auditCurrentBatch(
        args.vectorStoreId,
        args.currentBatchId,
      );
    }
    return audit;
  }

  private async ensureVectorStore(): Promise<string> {
    if (this.config.vectorStoreId) {
      try {
        const existing = await this.client.vectorStores.retrieve(this.config.vectorStoreId);
        if (existing) {
          console.log(`Using existing vector store: ${existing.id}`);
          return existing.id;
        }
      } catch {
        console.log(`Vector store ${this.config.vectorStoreId} not found, creating new one.`);
      }
    }

    const created = await this.client.vectorStores.create({
      name: this.config.vectorStoreName,
    });

    console.log(`Created new vector store: ${created.id}`);
    return created.id;
  }

  private uploadSource(): string {
    const configuredSource = this.config.uploadAttributes?.source;
    return typeof configuredSource === 'string'
      ? configuredSource
      : OpenAiKnowledgeUploader.defaultSource;
  }

  private attributeString(value: string): string {
    return value.slice(0, 512);
  }

  private async pollBatchCompletion(vectorStoreId: string, batchId: string): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes
    const intervalMs = 5000; // 5 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const batch = await this.client.vectorStores.fileBatches.retrieve(batchId, { vector_store_id: vectorStoreId });
      console.log(`Batch ${batchId} status: ${batch.status}`);

      if (batch.status === 'completed') {
        return;
      }
      if (batch.status === 'failed' || batch.status === 'cancelled') {
        throw new Error(`Vector store file batch ${batchId} ${batch.status}`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Vector store file batch ${batchId} did not complete within ${maxWaitMs}ms`);
  }
}
