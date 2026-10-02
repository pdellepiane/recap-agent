import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { DocumentError, DocumentService, HELPER_SOURCE, prepareDocument } from '../src/knowledge-admin/documents';
import type { DocumentRecord, DocumentStorage, DocumentIndex, IndexedFile, StoredDocument } from '../src/knowledge-admin/documents';
import { projectFullArticleForEvidence } from '../src/runtime/knowledge-retrieval-gateway';
import { resolveAdminRoute } from '../src/knowledge-admin/handler';

class MemoryStorage implements DocumentStorage {
  records = new Map<string, StoredDocument>(); contents = new Map<string, Buffer>(); version = 0;
  async list(): Promise<DocumentRecord[]> { return [...this.records.values()].map(r => r.document); }
  async get(id: string): Promise<StoredDocument | null> { return this.records.get(id) ?? null; }
  async save(document: DocumentRecord, revision?: string): Promise<void> {
    if (revision && revision !== this.records.get(document.id)?.revision) throw new DocumentError(409, 'Conflict');
    this.records.set(document.id, { document: { ...document }, revision: String(++this.version) });
  }
  async write(id: string, kind: 'original' | 'index', data: Buffer): Promise<void> { this.contents.set(id + kind, data); }
  async read(id: string, kind: 'original' | 'index'): Promise<Buffer> { const data = this.contents.get(id + kind); if (!data) throw new Error('Missing'); return data; }
  async removeContent(id: string): Promise<void> { this.contents.delete(id + 'index'); this.contents.delete(id + 'original'); }
}
function setup() {
  const storage = new MemoryStorage(); const files = new Map<string, IndexedFile>();
  const index = {
    list: vi.fn(async () => [...files.values()]),
    get: vi.fn(async (id: string) => { const file = files.get(id); if (!file) throw new DocumentError(404, 'Not found'); return file; }),
    upload: vi.fn(async () => 'file_new'),
    attach: vi.fn(async (id: string, attributes: Record<string, string>) => { files.set(id, { id, attributes, status: 'in_progress' }); }),
    detach: vi.fn(async (id: string) => { files.delete(id); }),
    removeFile: vi.fn(async () => undefined),
    content: vi.fn(async () => 'Original article text'),
  } satisfies DocumentIndex;
  return { storage, index, files, service: new DocumentService(storage, index) };
}
const upload = (text = 'Policy: first confirm the delivery address.') => ({ title: 'Shipping policy', filename: 'shipping.txt', data: Buffer.from(text).toString('base64') });

describe('internal FAQ document helper', () => {
  it('adds independent durable drafts without publishing or replacing existing documents', async () => {
    const { service, storage, index } = setup();
    const a = await service.create(upload()); const b = await service.create(upload('Another policy'));
    expect(a.id).not.toBe(b.id); expect(storage.records.size).toBe(2); expect(index.upload).not.toHaveBeenCalled();
    expect((await service.preview(a.id)).text).toContain('confirm the delivery address');
    expect((await service.original(a.id)).data.toString()).toContain('Policy:');
  });
  it('publishes once into the helper namespace with no citation URL or administration text in model content', async () => {
    const { service, index, storage, files } = setup(); const draft = await service.create(upload());
    expect((await service.publish(draft.id)).status).toBe('indexing');
    expect(index.attach).toHaveBeenCalledWith('file_new', { source: HELPER_SOURCE, document_id: draft.id, title: draft.title, citation: 'none' });
    expect((await storage.read(draft.id, 'index')).toString()).not.toContain(HELPER_SOURCE);
    await expect(service.publish(draft.id)).rejects.toMatchObject({ status: 409 }); expect(index.upload).toHaveBeenCalledTimes(1);
    expect((await service.list())[0].status).toBe('indexing');
    const file = files.get('file_new'); if (!file) throw new Error('Missing file'); file.status = 'completed';
    expect((await service.list())[0].status).toBe('published');
  });
  it('fails honestly when publication fails and keeps the original for deletion', async () => {
    const { service, index, storage } = setup(); const draft = await service.create(upload());
    vi.mocked(index.attach).mockRejectedValue(new Error('Provider failure'));
    await expect(service.publish(draft.id)).rejects.toMatchObject({ status: 502 });
    expect((await storage.get(draft.id))?.document.status).toBe('failed'); expect((await service.list())[0].status).toBe('failed');
    await service.remove(draft.id); expect(index.removeFile).toHaveBeenCalledWith('file_new');
  });
  it('protects original Tawk/ATC files against deletion even through direct API identifiers', async () => {
    const { service, files, index } = setup();
    files.set('file_tawk', { id: 'file_tawk', status: 'completed', attributes: { source: 'recap-agent-knowledge-sync', slug: 'politica-de-envios' } });
    files.set('file_atc', { id: 'file_atc', status: 'completed', attributes: { source: 'notion_customer_service_templates' } });
    const list = await service.list(); expect(list.every(d => !d.canDelete && !d.canPublish)).toBe(true);
    await expect(service.remove('original-file_tawk')).rejects.toMatchObject({ status: 404 });
    expect(index.detach).not.toHaveBeenCalled(); expect(index.removeFile).not.toHaveBeenCalled();
    expect((await service.preview('original-file_tawk')).text).toBe('Original article text');
  });
  it('shows the original title and body without frontmatter metadata', async () => {
    const { service, files, index } = setup();
    files.set('file_tawk', { id: 'file_tawk', status: 'completed', attributes: { source: 'recap-agent-knowledge-sync', slug: 'article' } });
    index.content.mockResolvedValue('---\ntitle: "Original title"\nslug: article\nsource_url: "https://sinenvolturas.tawk.help/article/article"\n---\nOriginal facts.');
    expect(await service.preview('original-file_tawk')).toEqual({ title: 'Original title', text: 'Original facts.', pdf: false });
  });

  it('checks ownership before deletion and does not delete a different source even with a corrupted pointer', async () => {
    const { service, storage, files, index } = setup(); const draft = await service.create(upload());
    await storage.save({ ...draft, fileId: 'file_tawk' });
    files.set('file_tawk', { id: 'file_tawk', status: 'completed', attributes: { source: 'recap-agent-knowledge-sync' } });
    await expect(service.remove(draft.id)).rejects.toMatchObject({ status: 403 }); expect(index.detach).not.toHaveBeenCalled();
  });
  it('deletes only its document, its index association and stored content', async () => {
    const { service, storage, index } = setup(); const draft = await service.create(upload()); await service.publish(draft.id);
    await service.remove(draft.id); expect(index.detach).toHaveBeenCalledWith('file_new');
    expect(storage.contents.size).toBe(0); expect(await service.list()).toEqual([]);
  });
  it('rejects concurrent publication using the record revision', async () => {
    const { service, index } = setup(); const draft = await service.create(upload());
    const result = await Promise.allSettled([service.publish(draft.id), service.publish(draft.id)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(index.upload).toHaveBeenCalledTimes(1);
  });
  it('deterministically extracts DOCX paragraphs and PPTX slides in numeric order', () => {
    const word = zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:document>') });
    const docx = prepareDocument({ title: 'Word', filename: 'word.docx', data: Buffer.from(word).toString('base64') });
    expect(docx.preview).toBe('First paragraph\nSecond paragraph');
    const slides = zipSync({ 'ppt/slides/slide10.xml': strToU8('<a:p><a:t>Tenth</a:t></a:p>'), 'ppt/slides/slide2.xml': strToU8('<a:p><a:t>Second</a:t></a:p>') });
    expect(prepareDocument({ title: 'Slides', filename: 'slides.pptx', data: Buffer.from(slides).toString('base64') }).preview).toBe('Second\n\nTenth');
  });
  it('rejects invalid encodings, unreadable text, fake PDFs and traversal filenames', () => {
    for (const input of [{ ...upload(), filename: '../x.txt' }, { ...upload(), data: 'invalid!' }, upload(''), { ...upload(), filename: 'fake.pdf' }]) expect(() => prepareDocument(input)).toThrow();
  });
  it('allows a timed-out publication to be cleaned up rather than locking it indefinitely', async () => {
    const { service, storage } = setup(); const draft = await service.create(upload());
    await storage.save({ ...draft, status: 'publishing', operationStartedAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    expect((await service.list())[0]).toMatchObject({ status: 'failed', canDelete: true });
    await service.remove(draft.id); expect(await service.list()).toEqual([]);
  });
  it('never gives a helper file an original linked-article citation', () => {
    const draft = prepareDocument(upload());
    const markdown = '---\ntitle: "Article"\nslug: article\nsource_url: "https://sinenvolturas.tawk.help/article/article"\n---\nFacts';
    expect(projectFullArticleForEvidence({ markdown, filename: draft.record.indexFilename, baseUrl: 'https://sinenvolturas.tawk.help', maxChars: 10000 })).toBeNull();
  });

  it('serves only the exact opaque path and rejects a guessed or empty path', () => {
    expect(resolveAdminRoute('/unguessable/api/documents', 'unguessable')).toBe('api/documents');
    expect(resolveAdminRoute('/api/documents', 'unguessable')).toBeNull(); expect(resolveAdminRoute('//', '')).toBeNull();
    expect(resolveAdminRoute('/unguessable-extra/', 'unguessable')).toBeNull();
  });
});
