import fs from 'node:fs';
import path from 'node:path';
import { ProviderCatalogFetcher } from './fetcher';
import { formatProviderToMarkdown } from './formatter';
import { OpenAiProviderUploader } from './uploader';
import type { ProviderSyncConfig } from './types';

export type ProviderSyncResult = {
  providersFetched: number;
  batchId: string;
  fileIds: string[];
  vectorStoreId: string;
};

function safeFileName(providerId: number, slug: string | null): string {
  const safeSlug = (slug ?? `provider-${providerId}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${providerId}-${safeSlug || 'provider'}.md`;
}

export async function runProviderSync(
  config: ProviderSyncConfig,
  options: { skipUpload?: boolean } = {},
): Promise<ProviderSyncResult> {
  fs.mkdirSync(config.outputDir, { recursive: true });

  const fetcher = new ProviderCatalogFetcher(config.providerBaseUrl);
  const providers = await fetcher.fetchAllProviders();
  const providerFiles = providers.map((provider) => {
    const formatted = formatProviderToMarkdown(provider);
    const filePath = path.join(
      config.outputDir,
      safeFileName(provider.id, provider.slug ?? null),
    );
    fs.writeFileSync(filePath, formatted.markdown, 'utf-8');
    return {
      filePath,
      providerId: formatted.metadata.providerId,
      slug: formatted.metadata.slug,
      category: formatted.metadata.category,
      city: formatted.metadata.city,
      country: formatted.metadata.country,
      priceLevel: formatted.metadata.priceLevel,
    };
  });

  const batchId = `providers-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
  if (options.skipUpload) {
    return {
      providersFetched: providers.length,
      batchId,
      fileIds: [],
      vectorStoreId: config.vectorStoreId ?? 'not-uploaded',
    };
  }

  const uploader = new OpenAiProviderUploader(config);
  const result = await uploader.uploadBatch(providerFiles, batchId);
  await uploader.cleanupOldBatches(result.vectorStoreId, batchId);

  return {
    providersFetched: providers.length,
    batchId: result.batchId,
    fileIds: result.fileIds,
    vectorStoreId: result.vectorStoreId,
  };
}
