# Next-Session Kickoff — Richer Editing (roadmap slice 4)

A handoff for resuming in a fresh session. Read it together with `CLAUDE.md` and the slice-3b
spec/plan before starting.

## Where things stand (as of 2026-06-20)

- Branch: `main`, clean, **pushed**. Four roadmap slices are merged:
  - **Slice 1 — Code health foundation** (PR #1): Vitest, ESLint, Prettier, CI, storage tests.
  - **Slice 2 — Robustness & data safety** (PR #2): optimistic-concurrency `save`/`stat`/`ConflictError`,
    conflict banner, refocus detection, beforeunload warning.
  - **Slice 3a — Core UX & navigation** (PR #3): title search + highlight, keyboard shortcuts +
    help dialog, inline rename, listbox roving-tabindex a11y, jsdom + Testing Library foundation.
  - **Slice 3b — Sort & pinning** (this session): sort modes (updated/title/created) + pinned notes,
    persisted in a `.gravity-notes.json` folder dotfile via `NoteStore.readMetadata`/`writeMetadata`;
    ordering moved to a pure `orderNotes`; folded in the help-dialog/shortcut-descriptor polish.
    **92 tests across 10 files.** Spec: `docs/superpowers/specs/2026-06-20-sort-pinning-design.md`;
    plan: `docs/superpowers/plans/2026-06-20-sort-pinning.md`.
- Commands unchanged: `npm run dev | build | preview | test | test:watch | lint | lint:fix | format
| format:check | typecheck`.
- All gates green at merge: lint (0 errors), format:check, typecheck, 92 tests, production build.
- **Not yet done for 3b:** a real-browser manual smoke (3a had a Playwright + injected-in-memory-folder
  smoke). 3b's behavior is covered by component/hook tests, but no end-to-end browser pass was run.
  Worth a quick manual check (sort switch, pin/unpin, reload persistence, `.gravity-notes.json`
  appearing in the folder) before or during slice 4.

## This slice's scope

**Richer editing — wire up the installed-but-unused editor extensions.** The roadmap names: **Mermaid,
LaTeX, tabs, cuts, code highlighting.** Today the editor runs a near-stock config with none of these.

### Current editor shape (the touchpoints)

- `src/components/EditorPane.tsx` — wraps `@gravity-ui/markdown-editor`. The whole config is:
  ```ts
  const editor = useMarkdownEditor({md: {html: false}, initial: {markup: note.content, mode: 'wysiwyg'}}, [note.id]);
  // ...
  return <MarkdownEditorView stickyToolbar autofocus editor={editor} />;
  ```
  The editor instance is re-created per note id; edits flow back through the `change` event +
  `getValue()`. A `toggleMode()` imperative handle flips wysiwyg/markup (used by ⌘/Ctrl+/). **No
  extensions, no markdown-it plugins, raw HTML disabled (`md.html: false`).**
- `src/main.tsx` — imports the base markdown-editor stylesheets (`styles`, `markdown`, `list`,
  `yc-colors`, `yc-file`, `yc-table`, `yc-table-cell-bg`, `yfm-overrides`, `yfm-themes`). **Extension
  CSS (KaTeX, Mermaid, the @diplodoc YFM extension styles) is NOT imported yet** — wiring an extension
  will usually mean adding its stylesheet here too.
- `package.json` already depends on the extension packages (installed, unused): `@diplodoc/cut-extension`,
  `@diplodoc/file-extension`, `@diplodoc/folding-headings-extension`, `@diplodoc/html-extension`,
  `@diplodoc/latex-extension`, `@diplodoc/mermaid-extension`, `@diplodoc/quote-link-extension`,
  `@diplodoc/tabs-extension`, `@diplodoc/transform`, plus `katex`, `highlight.js`, `lowlight`,
  `markdown-it`. **No `@diplodoc/*` is imported anywhere in `src/` today** (verified by grep).
- `src/components/EditorPane.test.tsx` — the heavy editor is **mocked** in jsdom (`vi.mock('@gravity-ui/
markdown-editor', ...)`); it cannot be deep-rendered in jsdom. The 3a spec explicitly put "deep
  editor-internals tests" out of scope. Plan your verification accordingly (see below).

## Open design questions (resolve via brainstorming; do NOT pre-decide)

- **Extension-registration API.** How does `@gravity-ui/markdown-editor` accept extensions? Investigate
  `useMarkdownEditor`'s options (likely an `extensions`/`extraExtensions` builder using its
  `ExtensionsManager`, plus markdown-it plugins via the `md`/`mdOpts` path for markup-mode preview).
  Each @diplodoc extension typically ships **both** a ProseMirror piece (WYSIWYG) and a markdown-it
  plugin (markup render) — confirm you wire both so a construct survives a wysiwyg⇄markup round-trip.
- **Which extensions, and in what order.** Mermaid + LaTeX (KaTeX) + code highlighting are the
  high-value, self-contained ones; tabs + cuts are YFM block syntaxes. Decide the set and sequencing —
  likely one extension (or a small cluster) per task, each with its CSS + a smoke check.
- **Raw HTML / security.** `md.html` is currently `false`. The `@diplodoc/html-extension` re-enables
  HTML and sanitizes. Decide whether raw HTML is in scope at all (local-first single-user lowers the
  risk, but XSS-in-your-own-notes is still a footgun) and, if so, the sanitization story.
- **Runtime libs & async.** Mermaid and KaTeX render at runtime; confirm how the extensions load them
  (bundled vs dynamic import) and whether anything needs an async/`useEffect` hook. Watch bundle size —
  the build already warns about >500 kB chunks; consider `manualChunks`/lazy-loading for Mermaid.
- **Code highlighting.** `lowlight`/`highlight.js` are installed; the markdown-editor has its own code
  block handling. Decide whether to use the editor's built-in highlight wiring or a @diplodoc/transform
  path, and which language grammars to include (all of highlight.js is heavy).
- **Markup serialization fidelity.** Notes are plain `.md` on disk. Verify each extension serializes
  back to standard/YFM markdown that round-trips cleanly (and that a note authored elsewhere still opens).
- **Testing strategy.** The editor can't mount in jsdom (it's mocked). Options: unit-test any pure
  "build the extensions list" helper you extract; and/or stand up a **real-browser (Playwright) smoke**
  like 3a — render a note containing mermaid/LaTeX/a fenced code block/a tab/cut and assert the rendered
  output. Decide the bar during brainstorming.

## Process to follow in the fresh session

1. Read this doc, `CLAUDE.md`, and the 3b spec/plan.
2. (Optional but recommended) do the deferred 3b real-browser smoke first, to confirm the merged
   feature works end-to-end.
3. Invoke **superpowers:brainstorming** → resolve the extension set, the registration approach, the
   HTML/security and testing questions with the user → write the spec to
   `docs/superpowers/specs/YYYY-MM-DD-richer-editing-design.md` and commit.
4. Invoke **superpowers:writing-plans** → bite-sized TDD plan in `docs/superpowers/plans/`.
5. Create a feature branch (e.g. `richer-editing`) from up-to-date `origin/main` (or commit the docs on
   the branch) to avoid the local-main divergence trap.
6. Execute with **superpowers:subagent-driven-development** (fresh subagent per task + spec/quality
   review each); commit per task.
7. Verify `lint && format:check && typecheck && test && build` + a real editor smoke, push, and finish
   with **superpowers:finishing-a-development-branch**.

## Conventions reminder

4-space indent + single quotes (Gravity Prettier); ESLint enforces formatting on JS/TS; **Prettier also
checks `.md`** (run `npm run format` on new docs — `format:check` is in CI; note that Prettier reformats
fenced code blocks inside markdown to 2-space, so source files still need 4-space via `lint:fix`);
automatic JSX runtime; `void promise()` marks intentional unawaited promises; errors surface through the
toaster (`onError` in `Workspace`); keep persistence behind the `NoteStore` seam.

## Pointers

- Specs: `…/specs/2026-06-19-code-health-foundation-design.md`,
  `…-robustness-data-safety-design.md`, `…/specs/2026-06-20-core-ux-navigation-design.md`,
  `…/specs/2026-06-20-sort-pinning-design.md`.
- Plans: `…/plans/2026-06-19-*`, `…/plans/2026-06-20-core-ux-navigation.md`,
  `…/plans/2026-06-20-sort-pinning.md`.
- Merged: PR #1 (code health), PR #2 (robustness), PR #3 (core UX 3a), and slice 3b (sort & pinning,
  merged to `main` this session).
- After slice 5 (image attachments), a tail dependency-trim pass removes any editor extensions left
  unused after (4)/(5).
