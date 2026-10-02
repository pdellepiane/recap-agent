import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import OpenAI, { toFile } from 'openai';
import { DocumentError, documentSchema } from './documents';
import type { DocumentIndex, DocumentRecord, DocumentStorage, IndexedFile, StoredDocument } from './documents';

export class S3DocumentStorage implements DocumentStorage {
  private readonly client = new S3Client({ region: 'us-east-1' });
  constructor(private readonly bucket: string) {}
  private key(id: string, suffix: string): string { return `documents/${id}/${suffix}`; }
  async get(id: string): Promise<StoredDocument | null> {
    try {
      const value = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id, 'record.json') }));
      if (!value.Body || !value.ETag) throw new Error('Document record is incomplete.');
      return { document: documentSchema.parse(JSON.parse(await value.Body.transformToString()) as unknown), revision: value.ETag };
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') return null;
      throw error;
    }
  }
  async list(): Promise<DocumentRecord[]> {
    const records: DocumentRecord[] = [];
    let continuation: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'documents/', ContinuationToken: continuation }));
      for (const item of page.Contents ?? []) {
        if (!item.Key?.endsWith('/record.json')) continue;
        const stored = await this.get(item.Key.split('/')[1]);
        if (stored) records.push(stored.document);
      }
      continuation = page.NextContinuationToken;
    } while (continuation);
    return records;
  }
  async save(document: DocumentRecord, revision?: string): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(document.id, 'record.json'), Body: JSON.stringify(document), ContentType: 'application/json', ...(revision ? { IfMatch: revision } : {}) }));
    } catch (error) {
      if (error instanceof Error && (error.name === 'PreconditionFailed' || error.name === 'ConditionalRequestConflict')) throw new DocumentError(409, 'Document changed. Refresh before trying again.');
      throw error;
    }
  }
  async write(id: string, kind: 'original' | 'index', data: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(id, kind), Body: data, ContentType: contentType }));
  }
  async read(id: string, kind: 'original' | 'index'): Promise<Buffer> {
    const value = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id, kind) }));
    if (!value.Body) throw new Error('Document content is missing.');
    return Buffer.from(await value.Body.transformToByteArray());
  }
  async removeContent(id: string): Promise<void> {
    for (const kind of ['original', 'index']) await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id, kind) }));
  }
}

export class OpenAiDocumentIndex implements DocumentIndex {
  private readonly client: OpenAI;
  private readonly filenames = new Map<string, string>();
  constructor(apiKey: string, private readonly storeId: string) { this.client = new OpenAI({ apiKey, timeout: 25_000, maxRetries: 1 }); }
  async list(): Promise<IndexedFile[]> {
    const files: IndexedFile[] = [];
    for await (const file of this.client.vectorStores.files.list(this.storeId, { limit: 100 })) files.push(file);
    for (let i = 0; i < files.length; i += 5) {
      await Promise.all(files.slice(i, i + 5).map(async file => {
        if (file.attributes?.title || file.attributes?.slug) return;
        let filename = this.filenames.get(file.id);
        if (!filename) { filename = (await this.client.files.retrieve(file.id)).filename; this.filenames.set(file.id, filename); }
        file.filename = filename;
      }));
    }
    return files;
  }
  async get(fileId: string): Promise<IndexedFile> {
    try {
      const file = await this.client.vectorStores.files.retrieve(fileId, { vector_store_id: this.storeId });
      return { ...file, filename: this.filenames.get(fileId) };
    }
    catch (error) { if (error instanceof OpenAI.APIError && error.status === 404) throw new DocumentError(404, 'Document not found.'); throw error; }
  }
  async upload(data: Buffer, filename: string): Promise<string> {
    return (await this.client.files.create({ file: await toFile(data, filename), purpose: 'assistants' })).id;
  }
  async attach(fileId: string, attributes: Record<string, string>): Promise<void> {
    await this.client.vectorStores.files.create(this.storeId, { file_id: fileId, attributes });
  }
  async detach(fileId: string): Promise<void> { await this.client.vectorStores.files.delete(fileId, { vector_store_id: this.storeId }); }
  async removeFile(fileId: string): Promise<void> {
    try { await this.client.files.delete(fileId); }
    catch (error) { if (!(error instanceof OpenAI.APIError && error.status === 404)) throw error; }
  }
  async content(fileId: string): Promise<string> {
    const text: string[] = []; let bytes = 0;
    for await (const part of this.client.vectorStores.files.content(fileId, { vector_store_id: this.storeId })) {
      if (!part.text) continue;
      text.push(part.text); bytes += part.text.length;
      if (bytes > 200_000) { text.push('\n[Preview limited to the first 200,000 characters.]'); break; }
    }
    return text.join('\n\n');
  }
}
