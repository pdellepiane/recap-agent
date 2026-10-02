# Adding durable documents to FAQ knowledge

**Document edition:** 30 September 2026. **Status:** internal helper implemented; operation and scope are described below.

## Implemented internal helper

The small helper implements **list, add draft, preview, publish and delete**. There is no update or replacement operation. Original Tawk files and other imported files are read-only. Helper additions receive independent IDs and the `recap-agent-faq-helper` ingestion namespace; the existing FAQ and ATC resync cleanup does not delete that namespace.

The page and API run in a dedicated development Lambda; originals, indexable content and publication records are retained in a private encrypted S3 bucket. Secrets Manager holds the existing OpenAI API binding and a generated opaque URL path. There is no login page or separate user credential. Possession of the unlisted URL grants management access; the application rejects other paths. API mutation requests must carry the same-origin custom action header. The page disables referrer transmission and does not log its access path or document contents.

The FAQ vector store remains OpenAI-hosted, as in the existing agent. The upload page, management API and durable document storage are AWS resources. No provider-store configuration is used.

## Editor workflow

1. Open the internal link and inspect the document titles. Filter by title when needed.
2. Choose **Add a new document**, select a file or paste text, and confirm the title.
3. Choose **Add draft and preview**. This stores the original and prepared index content without exposing it to retrieval.
4. Inspect the preview and choose **Publish this document**. Indexing is asynchronous; the list refreshes while a file is indexing. Only a completed index association displays as published.
5. Delete a helper-added document from the list or preview. The API verifies its registry record, index source and document ID before removing it. Tawk articles have no publish/delete controls and cannot be deleted through a forged API request.

For a revised document, add the new document and delete the old one deliberately. There is no implicit replacement by filename or title. Concurrent publication attempts use a conditional record write to prevent duplicate uploads. A failed publication remains visible and can be deleted; an interrupted publication becomes deletable after a five-minute lease; the helper never marks a failed ingestion published.

## Formats and previews

The first version accepts PDF, DOCX, PPTX, UTF-8 plain text, Markdown and HTML, with a 3 MiB limit. Text is rendered inertly in the preview. DOCX paragraphs and PPTX slides are extracted deterministically, with bounded ZIP extraction; HTML scripts/styles are discarded. PDFs use the browser's original-file preview and are indexed as PDFs. The helper does not run an LLM to classify, summarize or convert uploaded documents.

Scanned/image-only PDFs and images are not OCR-supported by this small implementation. Supply a document containing readable text. Spreadsheets and legacy binary Word files are not supported. OpenAI's supported formats are documented in its [file-search guide](https://developers.openai.com/api/docs/guides/tools-file-search#supported-files).

## Deterministic source behavior

The helper does not ask for a source URL and does not create a user-facing source link. Its index files have generated, collision-free `helper-<UUID>.txt` or `.pdf` names and contain document content, not administration instructions. Publication ownership and lifecycle metadata remain outside model evidence.

The existing agent's deterministic `Fuente:` footer continues to use only validated complete original help-center articles and their canonical URLs. Helper files cannot match the packaged original-article filename/snapshot validation and do not acquire that footer. No prompt or conversational routing change is required. A link deliberately present inside a document remains part of that document's factual content; the helper does not rewrite customer-facing model prose.

## Deployment and operation

Deploy with `npm run deploy:knowledge-admin`. The script verifies STS account `684516060775` through `se-dev` in `us-east-1`, derives the FAQ store and OpenAI secret from the development runtime stack, packages the helper and deploys `infra/cloudformation/knowledge-admin.yaml`. It never creates a replacement FAQ store or changes the production runtime.

The internal URL is saved in the ignored `.artifacts/knowledge-admin/access.json` with owner-only file permissions. Do not commit or include it in public documents. The generated URL path is held in Secrets Manager; no credential prompt is shown to users.

Deletion detaches only the owned file and removes its durable content. The registry retains a deletion record. Vector-store removal is eventually consistent, so an already-started retrieval can briefly observe the previous file. A helper cannot make that upstream operation instantaneous.

## Validation

`tests/knowledge-admin.test.ts` covers independent drafts, prepared previews, publication status, duplicate publication, failures, exact URL matching, ownership checks and deletion. `tests/knowledge-sync-atc-cleanup.test.ts` proves that FAQ and ATC cleanup preserve helper additions. Existing original-article retrieval and coverage-registry checks run alongside them. These deterministic checks do not claim a new conversational quality result.
