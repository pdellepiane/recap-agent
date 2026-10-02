import crypto from 'node:crypto';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parse } from 'node-html-parser';
import { z } from 'zod';

export const HELPER_SOURCE = 'recap-agent-faq-helper';
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export class DocumentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const documentSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(200), filename: z.string(),
  contentType: z.string(), indexFilename: z.string(), createdAt: z.string(),
  status: z.enum(['draft', 'publishing', 'indexing', 'published', 'failed', 'deleting', 'deleted']),
  fileId: z.string().optional(), error: z.string().optional(), operationStartedAt: z.string().optional(),
});
export type DocumentRecord = z.infer<typeof documentSchema>;
export type StoredDocument = { document: DocumentRecord; revision: string };
export interface DocumentStorage {
  list(): Promise<DocumentRecord[]>;
  get(id: string): Promise<StoredDocument | null>;
  save(document: DocumentRecord, revision?: string): Promise<void>;
  write(id: string, kind: 'original' | 'index', data: Buffer, contentType: string): Promise<void>;
  read(id: string, kind: 'original' | 'index'): Promise<Buffer>;
  removeContent(id: string): Promise<void>;
}
export type IndexedFile = { id: string; status: string; filename?: string; attributes?: Record<string, string | number | boolean> | null };
export interface DocumentIndex {
  list(): Promise<IndexedFile[]>;
  get(fileId: string): Promise<IndexedFile>;
  upload(data: Buffer, filename: string): Promise<string>;
  attach(fileId: string, attributes: Record<string, string>): Promise<void>;
  detach(fileId: string): Promise<void>;
  removeFile(fileId: string): Promise<void>;
  content(fileId: string): Promise<string>;
}
export type DocumentSummary = {
  id: string; title: string; status: string; origin: 'helper' | 'tawk' | 'other';
  canDelete: boolean; canPublish: boolean; createdAt: string;
};

export function prepareDocument(input: unknown): { record: DocumentRecord; original: Buffer; indexed: Buffer; preview: string } {
  const result = z.object({ title: z.string().trim().min(1).max(200), filename: z.string().min(1).max(180), data: z.string().min(1).max(4_194_304) }).safeParse(input);
  if (!result.success) throw new DocumentError(400, 'Provide a title, a filename and a file up to 3 MiB.');
  const { title, filename, data } = result.data;
  if (filename !== path.basename(filename) || [...filename].some(character => character.charCodeAt(0) < 32)) throw new DocumentError(400, 'Invalid filename.');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)) throw new DocumentError(400, 'Invalid file encoding.');
  const original = Buffer.from(data, 'base64');
  if (!original.length || original.length > MAX_UPLOAD_BYTES) throw new DocumentError(413, 'The file must be between 1 byte and 3 MiB.');
  const extension = path.extname(filename).toLowerCase();
  let text: string | null = null;
  let contentType = 'text/plain; charset=utf-8';
  if (extension === '.pdf') {
    if (!original.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new DocumentError(400, 'This is not a valid PDF.');
    contentType = 'application/pdf';
  } else if (extension === '.docx' || extension === '.pptx') {
    let total = 0;
    const archive = unzipSync(original, { filter(file) {
      const selected = extension === '.docx' ? file.name === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/u.test(file.name);
      if (!selected) return false;
      total += file.originalSize;
      if (total > 8 * 1024 * 1024) throw new DocumentError(413, 'Document text exceeds the extraction limit.');
      return true;
    } });
    const entries = Object.entries(archive).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
    text = entries.map(([, bytes]) => {
      const xml = parse(Buffer.from(bytes).toString('utf8'));
      const paragraphs = xml.querySelectorAll(extension === '.docx' ? 'w\\:p' : 'a\\:p');
      return paragraphs.map(p => p.querySelectorAll(extension === '.docx' ? 'w\\:t' : 'a\\:t').map(t => t.text).join('')).join('\n');
    }).join('\n\n');
    contentType = extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  } else if (['.txt', '.md', '.html'].includes(extension)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(original); }
    catch { throw new DocumentError(400, 'Text files must use UTF-8 encoding.'); }
    if (extension === '.html') {
      const html = parse(text); html.querySelectorAll('script,style').forEach(node => node.remove()); text = html.structuredText;
    }
  } else { throw new DocumentError(400, 'Use PDF, DOCX, PPTX, TXT, Markdown or HTML.'); }
  if (text !== null && (!text.trim() || text.includes('\u0000'))) throw new DocumentError(400, 'No readable document text was found.');
  const id = crypto.randomUUID();
  const indexed = text === null ? original : Buffer.from(`# ${title}\n\n${text}`, 'utf8');
  if (indexed.length > MAX_UPLOAD_BYTES) throw new DocumentError(413, 'Extracted text exceeds 3 MiB.');
  return { record: { id, title, filename, contentType, indexFilename: `helper-${id}${text === null ? '.pdf' : '.txt'}`, createdAt: new Date().toISOString(), status: 'draft' }, original, indexed, preview: text ?? '' };
}

export class DocumentService {
  constructor(private readonly storage: DocumentStorage, private readonly index: DocumentIndex, private readonly originalTitles: Record<string, string> = {}) {}
  private publicationActive(record: DocumentRecord): boolean {
    return record.status === 'publishing' && (!record.operationStartedAt || Date.now() - Date.parse(record.operationStartedAt) < 5 * 60_000);
  }
  private async required(id: string): Promise<StoredDocument> {
    if (!z.string().uuid().safeParse(id).success) throw new DocumentError(404, 'Document not found.');
    const stored = await this.storage.get(id);
    if (!stored || stored.document.status === 'deleted') throw new DocumentError(404, 'Document not found.');
    return stored;
  }
  async list(): Promise<DocumentSummary[]> {
    const [records, files] = await Promise.all([this.storage.list(), this.index.list()]);
    const summaries: DocumentSummary[] = [];
    for (const record of records) {
      if (record.status === 'deleted') continue;
      const file = files.find(f => f.id === record.fileId);
      let status: string = record.status;
      if (record.status === 'publishing' && !this.publicationActive(record)) status = 'failed';
      if (record.status === 'indexing') status = file?.status === 'completed' ? 'published' : file?.status === 'failed' || file?.status === 'cancelled' ? 'failed' : 'indexing';
      summaries.push({ id: record.id, title: record.title, status, origin: 'helper', canDelete: !this.publicationActive(record), canPublish: record.status === 'draft', createdAt: record.createdAt });
    }
    for (const file of files) {
      if (file.attributes?.source === HELPER_SOURCE) continue;
      const slug = String(file.attributes?.slug ?? '');
      const title = String(file.attributes?.title ?? (file.attributes?.source === 'recap-agent-knowledge-sync' ? this.originalTitles[slug] : undefined) ?? (slug || file.filename?.replace(/\.[^.]+$/u, '') || file.id)).replace(/-/gu, ' ');
      summaries.push({ id: `original-${file.id}`, title, status: file.status === 'completed' ? 'published' : file.status, origin: file.attributes?.source === 'recap-agent-knowledge-sync' ? 'tawk' : 'other', canDelete: false, canPublish: false, createdAt: '' });
    }
    return summaries.sort((a, b) => a.title.localeCompare(b.title));
  }
  async create(input: unknown): Promise<DocumentRecord> {
    let prepared: ReturnType<typeof prepareDocument>;
    try { prepared = prepareDocument(input); }
    catch (error) { if (error instanceof DocumentError) throw error; throw new DocumentError(400, 'This document could not be read. Export it again or upload readable text.'); }
    const { record, original, indexed } = prepared;
    await this.storage.write(record.id, 'original', original, record.contentType);
    await this.storage.write(record.id, 'index', indexed, record.indexFilename.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
    await this.storage.save(record);
    return record;
  }
  async preview(id: string): Promise<{ title: string; text: string; pdf: boolean; error?: string }> {
    if (id.startsWith('original-')) {
      const fileId = id.slice(9); const file = await this.index.get(fileId);
      if (file.attributes?.source === HELPER_SOURCE) throw new DocumentError(404, 'Document not found.');
      const raw = await this.index.content(fileId);
      const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/u);
      let title = String(file.attributes?.title ?? file.attributes?.slug ?? file.filename ?? file.id);
      if (file.attributes?.source === 'recap-agent-knowledge-sync' && frontmatter) {
        const encodedTitle = frontmatter[1].match(/^title: ("(?:[^"\\]|\\.)*")$/mu)?.[1];
        if (encodedTitle) { const parsed: unknown = JSON.parse(encodedTitle); if (typeof parsed === 'string') title = parsed; }
        return { title, text: raw.slice(frontmatter[0].length).trim(), pdf: false };
      }
      return { title, text: raw, pdf: false };
    }
    const { document } = await this.required(id);
    const text = document.indexFilename.endsWith('.pdf') ? '' : (await this.storage.read(id, 'index')).toString('utf8');
    return { title: document.title, text, pdf: document.indexFilename.endsWith('.pdf'), ...(document.error ? { error: document.error } : {}) };
  }
  async original(id: string): Promise<{ data: Buffer; contentType: string }> {
    const { document } = await this.required(id);
    return { data: await this.storage.read(id, 'original'), contentType: document.contentType };
  }
  async publish(id: string): Promise<DocumentRecord> {
    const stored = await this.required(id);
    if (stored.document.status !== 'draft') throw new DocumentError(409, 'This document has already been submitted. Refresh its indexing status.');
    let record: DocumentRecord = { ...stored.document, status: 'publishing', operationStartedAt: new Date().toISOString() };
    await this.storage.save(record, stored.revision);
    try {
      const data = await this.storage.read(id, 'index');
      const fileId = await this.index.upload(data, record.indexFilename);
      record = { ...record, fileId }; await this.storage.save(record);
      await this.index.attach(fileId, { source: HELPER_SOURCE, document_id: id, title: record.title, citation: 'none' });
      record = { ...record, status: 'indexing' }; await this.storage.save(record);
      return record;
    } catch {
      record = { ...record, status: 'failed', error: 'Publication failed. Delete this draft and add it again; it has not been marked published.' };
      await this.storage.save(record); throw new DocumentError(502, record.error ?? 'Publication failed.');
    }
  }
  async remove(id: string): Promise<void> {
    const stored = await this.required(id);
    if (this.publicationActive(stored.document)) throw new DocumentError(409, 'Publication is in progress. Wait before deleting.');
    if (stored.document.fileId) {
      let file: IndexedFile | null = null;
      try { file = await this.index.get(stored.document.fileId); }
      catch (error) { if (!(error instanceof DocumentError && error.status === 404)) throw error; }
      if (file && (file.attributes?.source !== HELPER_SOURCE || file.attributes.document_id !== id)) throw new DocumentError(403, 'Only documents owned by this helper can be deleted.');
      await this.storage.save({ ...stored.document, status: 'deleting' }, stored.revision);
      if (file) await this.index.detach(stored.document.fileId);
      await this.index.removeFile(stored.document.fileId);
    }
    if (!stored.document.fileId) await this.storage.save({ ...stored.document, status: 'deleting' }, stored.revision);
    await this.storage.removeContent(id);
    await this.storage.save({ ...stored.document, status: 'deleted' });
  }
}
