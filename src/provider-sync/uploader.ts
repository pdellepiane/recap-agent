import fs from 'node:fs';
import OpenAI from 'openai';
import type { ProviderSyncConfig } from './types';

export type ProviderUploadFile = {
  filePath: string;
  providerId: number;
  slug: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
  priceLevel: string | null;
};

export type ProviderUploadBatchResult = {
  batchId: string;
  vectorStoreId: string;
  fileIds: string[];
};

function attributeString(value: string | null): string {
  return value && value.length <= 512 ? value : '';
}

function attributeKey(value: string | null): string {
  return attributeString(
    value
      ? value
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : null,
  );
}

export class OpenAiProviderUploader {
  private readonly client: OpenAI;

  constructor(private readonly config: ProviderSyncConfig) {
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async uploadBatch(
    providerFiles: ProviderUploadFile[],
    batchId: string,
  ): Promise<ProviderUploadBatchResult> {
    const vectorStoreId = await this.ensureVectorStore();
    const fileIds = await this.mapWithConcurrency(
      providerFiles,
      8,
      async (provider, index) => {
      const uploaded = await this.client.files.create({
        file: fs.createReadStream(provider.filePath),
        purpose: 'assistants',
      });

        const vectorStoreFile = await this.client.vectorStores.files.create(vectorStoreId, {
        file_id: uploaded.id,
        attributes: {
          provider_id: provider.providerId,
          slug: attributeString(provider.slug),
          category: attributeString(provider.category),
          category_key: attributeString(provider.category),
          city: attributeString(provider.city),
          city_key: attributeKey(provider.city),
          country: attributeString(provider.country),
          country_key: attributeKey(provider.country),
          price_level: attributeString(provider.priceLevel),
          batch_id: batchId,
          source: 'recap-agent-provider-sync',
        },
      });

        if ((index + 1) % 25 === 0 || index + 1 === providerFiles.length) {
          console.log(`Queued ${index + 1}/${providerFiles.length} provider files`);
        }

        return vectorStoreFile.id;
      },
    );

    await this.pollFilesCompletion(vectorStoreId, fileIds);

    return {
      batchId,
      vectorStoreId,
      fileIds,
    };
  }

  async cleanupOldBatches(
    vectorStoreId: string,
    currentBatchId: string,
  ): Promise<void> {
    const allFiles = await this.client.vectorStores.files.list(vectorStoreId);
    const staleFiles = allFiles.data.filter((file) => {
      const attributes = file.attributes as Record<string, unknown> | null;
      return attributes?.batch_id !== currentBatchId;
    });

    for (const file of staleFiles) {
      await this.client.vectorStores.files.delete(file.id, {
        vector_store_id: vectorStoreId,
      });
    }
  }

  private async ensureVectorStore(): Promise<string> {
    if (this.config.vectorStoreId) {
      try {
        const existing = await this.client.vectorStores.retrieve(
          this.config.vectorStoreId,
        );
        return existing.id;
      } catch {
        console.log(`Provider vector store ${this.config.vectorStoreId} not found.`);
      }
    }

    const created = await this.client.vectorStores.create({
      name: this.config.vectorStoreName,
      metadata: {
        source: 'recap-agent-provider-sync',
      },
    });
    return created.id;
  }

  private async pollFilesCompletion(
    vectorStoreId: string,
    fileIds: string[],
  ): Promise<void> {
    const pending = new Set(fileIds);
    const startedAt = Date.now();
    const maxWaitMs = 4 * 60 * 1000;

    while (pending.size > 0) {
      if (Date.now() - startedAt > maxWaitMs) {
        throw new Error(`Provider vector files did not complete within ${maxWaitMs}ms`);
      }

      for (const fileId of Array.from(pending)) {
        const file = await this.client.vectorStores.files.retrieve(fileId, {
          vector_store_id: vectorStoreId,
        });

        if (file.status === 'completed') {
          pending.delete(fileId);
          continue;
        }

        if (file.status === 'failed' || file.status === 'cancelled') {
          throw new Error(`Provider vector file ${fileId} ${file.status}`);
        }
      }

      console.log(`Provider vector indexing pending: ${pending.size}/${fileIds.length}`);
      if (pending.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async mapWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    mapper: (item: TInput, index: number) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    const results: TOutput[] = [];
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item === undefined) {
          continue;
        }
        results[currentIndex] = await mapper(item, currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }
}
