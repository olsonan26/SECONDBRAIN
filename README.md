# Secondbrain

A private, shared workspace for connected knowledge, cited research, and evidence-backed writing.

## Workspace

- Interactive brain graph with extracted, inferred, and ambiguous relationships.
- Ranked passage search with exact source, page, and line references.
- Optional OpenRouter or direct DeepSeek synthesis with citation checks and a separate source-support review.
- Shared article drafts, revision conflict protection, styled editorial previews, rich-text copying with bold/headings/spacing (including unsaved edits), Markdown export, and research workflows. Clipboard formatting is preserved in compatible rich-text destinations; plain-text apps receive readable text instead.
- Blog drafts have generated, source-checked headlines and self-contained prose. Citation mappings remain in the separate review section, not the reader-facing body or copy/export. Older model drafts receive a non-destructive clean presentation; outlines remain labeled as research outlines.
- Owner and member accounts, authenticated source access, and private cloud storage.
- PDF, Word, Markdown, text, and Graphify JSON imports.

## Separate brains

Use the **Active brain** selector to switch libraries. The **+** button lets the owner create a brain (for example, Astrology); new brains start empty and are shared with Peter. Import files only after selecting the intended brain. Each brain has separate source text, passages, graph, original uploads, drafts, and workflow history. Questions and article generation search only that brain; an empty brain never falls back to another library. Model credentials and writing guidance remain shared workspace settings.

The original library remains in **Main brain**, using its existing private storage paths without moving or rewriting the data. New brains use independent UUID-based storage namespaces. `?brain=<id>` URLs can be bookmarked/shared; sign-in preserves the selected brain, and switching warns about unsaved article edits and clears the previous brain's client state. The public repository still contains no private knowledge or credentials.

Brain data API calls carry `?brain=<id>` too. Omitting it retains the legacy Main brain behavior; invalid, unknown, or duplicate brain parameters fail closed. Original downloads and draft revision writes are checked within the same selected namespace.

The public repository contains application code only. Documents, generated indexes, uploaded originals, credentials, and test artifacts are excluded from Git and deployment uploads.

## Local setup

Requires Node.js 24.

```sh
npm ci
npm run setup:local
npm run dev
```

Local access details are generated into the ignored `ACCESS-PRIVATE.txt` file. Preserve `.env.local`; changing its session secret also changes the encryption key for stored model credentials.

Import an existing Graph Brain Studio bundle:

```sh
npm run import:brain -- --bundle /absolute/path/to/brain-bundle.json
```

This creates the ignored `private/corpus.json`. The importer preserves source text and citation coordinates and records recovered-snapshot limitations.

## Private Vercel deployment

1. Link this checkout to the intended Vercel project.
2. Connect a **private** Vercel Blob store and make its credentials available to the project.
3. Configure `BRAIN_SESSION_SECRET` and `BRAIN_USERS_JSON` from the private local environment through Vercel's secret settings.
4. Upload the local corpus with `npm run publish:library` after pulling the storage environment locally. It uploads directly to private Blob, never to GitHub or a public URL.
5. Deploy with `vercel --prod` and verify sign-in, source retrieval, and member permissions.

The application deliberately refuses production writes without private cloud storage. Configure the API provider in owner-only Settings; these settings are shared by both accounts and the API key is encrypted before storage. Choose **OpenRouter** for OpenRouter keys/credits, with model ID `deepseek/deepseek-v4.1-flash-1017`, or **DeepSeek** for a direct DeepSeek key, with model ID `deepseek-flash`. Keys and balances are not interchangeable. Both generation and evidence review use the selected provider. Until a model is connected, the app returns retrieved evidence and evidence outlines, labeled accordingly. A saved key alone does not confirm successful authentication.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser tests require a running local server and the private local accounts. Model source-support checks improve traceability but do not replace reviewing cited passages before publication.
