import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import type { KnowledgeBaseSyncConfig } from './types';

export class OpenAiKnowledgeUploader {
  private readonly client: OpenAI;

  constructor(private readonly config: KnowledgeBaseSyncConfig) {
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async upload(filePath: string): Promise<{ fileId: string; vectorStoreId: string }> {
    const fileName = path.basename(filePath);

    const uploadedFile = await this.client.files.create({
      file: fs.createReadStream(filePath),
      purpose: 'assistants',
    });

    console.log(`Uploaded file ${fileName}: ${uploadedFile.id}`);

    const vectorStoreId = await this.ensureVectorStore();

    await this.client.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, {
      files: [fs.createReadStream(filePath)],
    });

    console.log(`Added file to vector store ${vectorStoreId}`);

    return {
      fileId: uploadedFile.id,
      vectorStoreId,
    };
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
}
