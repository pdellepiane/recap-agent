import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiKnowledgeUploader } from '../src/knowledge-sync/openai-uploader';

const openAiClientMock = vi.hoisted(() => ({
  files: {
    create: vi.fn(),
  },
  vectorStores: {
    retrieve: vi.fn(),
    create: vi.fn(),
    files: {
      list: vi.fn(),
      delete: vi.fn(),
    },
    fileBatches: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  },
}));

vi.mock('openai', () => ({
  default: vi.fn(() => openAiClientMock),
}));

const atcSource = 'notion_customer_service_templates';

describe('ATC supplemental FAQ knowledge sync cleanup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps non-ATC FAQ vector-store files while cleaning stale ATC files', async () => {
    openAiClientMock.vectorStores.files.list.mockResolvedValue({
      data: [
        { id: 'vsf-current-atc', attributes: { batch_id: 'kb-atc-current', source: atcSource } },
        { id: 'vsf-old-atc', attributes: { batch_id: 'kb-atc-old', source: atcSource } },
        { id: 'vsf-old-faq', attributes: { batch_id: 'kb-faq-old', source: 'recap-agent-knowledge-sync' } },
        { id: 'vsf-unscoped', attributes: { batch_id: 'legacy-faq-old' } },
      ],
    });
    openAiClientMock.vectorStores.files.delete.mockResolvedValue({ deleted: true });

    const uploader = new OpenAiKnowledgeUploader({
      baseUrl: 'https://sinenvolturas.tawk.help',
      outputDir: 'dist/knowledge-base-atc',
      openAiApiKey: 'test-key',
      vectorStoreName: 'Sin Envolturas Knowledge Base',
      vectorStoreId: 'vs_kb_test',
      cleanupScopeSource: atcSource,
    });

    await uploader.cleanupOldBatches('vs_kb_test', 'kb-atc-current');

    expect(openAiClientMock.vectorStores.files.delete).toHaveBeenCalledTimes(1);
    expect(openAiClientMock.vectorStores.files.delete).toHaveBeenCalledWith('vsf-old-atc', {
      vector_store_id: 'vs_kb_test',
    });
  });

  it('adds ATC source-scoping attributes to new supplemental uploads', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-atc-kb-'));
    const filePath = path.join(tempDir, 'sample.md');
    fs.writeFileSync(filePath, '# Sample ATC answer\n', 'utf-8');

    openAiClientMock.vectorStores.retrieve.mockResolvedValue({ id: 'vs_kb_test' });
    openAiClientMock.files.create.mockResolvedValue({ id: 'file_atc_1' });
    openAiClientMock.vectorStores.fileBatches.create.mockResolvedValue({ id: 'batch_atc_1' });
    openAiClientMock.vectorStores.fileBatches.retrieve.mockResolvedValue({ status: 'completed' });

    const uploader = new OpenAiKnowledgeUploader({
      baseUrl: 'https://sinenvolturas.tawk.help',
      outputDir: tempDir,
      openAiApiKey: 'test-key',
      vectorStoreName: 'Sin Envolturas Knowledge Base',
      vectorStoreId: 'vs_kb_test',
      uploadAttributes: {
        source: atcSource,
        source_kind: 'response_sample',
        channel: 'chat',
        status: 'Vigente',
      },
      cleanupScopeSource: atcSource,
    });

    await uploader.uploadBatch(
      [{ filePath, slug: 'sample', category: 'ATC', articleType: 'response_sample' }],
      'kb-atc-current',
    );

    expect(openAiClientMock.vectorStores.fileBatches.create).toHaveBeenCalledWith('vs_kb_test', {
      file_ids: ['file_atc_1'],
      attributes: {
        batch_id: 'kb-atc-current',
        source: atcSource,
        source_kind: 'response_sample',
        channel: 'chat',
        status: 'Vigente',
      },
    });
  });
});
