import fs from 'node:fs';
import OpenAI from 'openai';
import type { KnowledgeBaseSyncConfig } from './types';

export type UploadBatchResult = {
  batchId: string;
  vectorStoreId: string;
  fileIds: string[];
};

export class OpenAiKnowledgeUploader {
  private readonly client: OpenAI;

  constructor(private readonly config: KnowledgeBaseSyncConfig) {
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async uploadBatch(
    articleFiles: Array<{ filePath: string; slug: string; category: string; articleType: string }>,
    batchId: string,
  ): Promise<UploadBatchResult> {
    const vectorStoreId = await this.ensureVectorStore();

    // Upload each file to the OpenAI Files API
    const uploadedFiles: Array<{ id: string; slug: string }> = [];
    for (const article of articleFiles) {
      const uploaded = await this.client.files.create({
        file: fs.createReadStream(article.filePath),
        purpose: 'assistants',
      });
      uploadedFiles.push({ id: uploaded.id, slug: article.slug });
    }

    console.log(`Uploaded ${uploadedFiles.length} files to OpenAI Files API`);

    // Add files to vector store as a batch with attributes
    const fileBatch = await this.client.vectorStores.fileBatches.create(vectorStoreId, {
      file_ids: uploadedFiles.map((f) => f.id),
      attributes: {
        batch_id: batchId,
        source: 'recap-agent-knowledge-sync',
      },
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
    const allFiles = await this.client.vectorStores.files.list(vectorStoreId);

    const filesToDelete = allFiles.data.filter(
      (f) => f.attributes && (f.attributes as Record<string, string>)['batch_id'] !== currentBatchId,
    );

    if (filesToDelete.length === 0) {
      console.log('No old vector store files to clean up');
      return;
    }

    console.log(`Cleaning up ${filesToDelete.length} old vector store files from previous batches`);

    for (const file of filesToDelete) {
      try {
        await this.client.vectorStores.files.delete(file.id, { vector_store_id: vectorStoreId });
        console.log(`Deleted vector store file ${file.id}`);
      } catch (error) {
        console.error(`Failed to delete vector store file ${file.id}:`, error instanceof Error ? error.message : String(error));
      }
    }
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
