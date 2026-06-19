# Code Health Foundation — Design

- **Date:** 2026-06-19
- **Status:** Approved (pending final spec review)
- **Sub-project:** 1 of 5 in the Gravity Notes improvement roadmap

## Context

Gravity Notes is a local-first Markdown note-taking app (Gravity UI + `@gravity-ui/markdown-editor`,
notes stored as `.md` files via the File System Access API). The codebase is clean and well-structured,
but has **no automated tests, no linter, no formatter config, and no CI**. The storage layer
(`src/storage/fileSystemStore.ts`) holds the most logic-heavy, highest-risk code (unique-filename
resolution, copy-then-delete rename, title sanitizing, list sorting) and is entirely untested.

This sub-project is sequenced **first** in the roadmap because it makes every later workstream
(Robustness, Core UX, Richer editing, Image attachments) verifiable and test-first on a lint-clean base.

## Goal

Stand up testing, linting, formatting, and CI, and deliver real end-to-end coverage of the storage layer.

### Success criteria

- `npm test`, `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run build` all pass
  locally and in CI.
- `FileSystemNoteStore` is covered end-to-end via an in-memory File System Access fake.
- A GitHub Actions workflow runs green on push / PR to `main`.

## Decisions (with rationale)

| Decision                | Choice                                                            | Rationale                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint/format config      | `@gravity-ui/eslint-config@^4` + `@gravity-ui/prettier-config@^1` | The whole app is Gravity UI; the shared flat-config is idiomatic, maintained, and batteries-included (react-hooks, jsx-a11y, import-order, security). |
| ESLint major            | Pin `eslint@^9`                                                   | The Gravity config targets the ESLint 9 ecosystem (`@eslint/js@^9`). ESLint 10 just shipped and is unverified against the config.                     |
| TypeScript              | Bump `^5.6.3` → `^5.9`                                            | Satisfies the config's `typescript@^5.8.3` peer dependency. Low-risk minor bump.                                                                      |
| Test runner             | Vitest                                                            | Native Vite integration; reuses the existing build pipeline and config.                                                                               |
| Storage testing         | In-memory fake of the File System Access API                      | Tests the **real** store end-to-end (rename, unique-naming, sort), where bugs actually hide — not just extracted pure helpers.                        |
| Test environment        | `node`                                                            | Node 24 (local + CI) provides `DOMException` and `File` as globals, which the store/fake rely on. No DOM needed for storage tests.                    |
| Node version            | 24 (`.nvmrc` + CI), `engines.node >=22`                           | Matches the local dev environment; avoids "works on my machine" drift.                                                                                |
| Component/React testing | Deferred                                                          | Added in the Core UX slice when a component first needs it. Avoids standing up jsdom + Testing Library before it's used (YAGNI).                      |
| Dependency trimming     | Deferred to roadmap tail                                          | Whether to keep Mermaid/LaTeX/`@diplodoc/file-extension` depends on the Richer-editing and Attachments decisions.                                     |

## Detailed design

### Dependencies & version changes

Add to `devDependencies`:

- `vitest`
- `eslint@^9` (pinned major)
- `@gravity-ui/eslint-config@^4`
- `@gravity-ui/prettier-config@^1`
- `prettier@^3`

Change:

- `typescript`: `^5.6.3` → `^5.9`

Add to `package.json`:

- `"engines": { "node": ">=22" }`

### Config files

- **`eslint.config.js`** (flat config): composes the Gravity presets appropriate for a browser React +
  TypeScript app — `client` (browser globals) + `react` + `typescript` + `import-order` + `a11y` +
  `prettier`. `ignores`: `dist/`, `coverage/`, `node_modules/`. The exact import surface (which named
  exports / sub-paths to spread) will be confirmed against the installed package version during
  implementation rather than guessed here; the Gravity config exposes sub-path exports
  (`./base`, `./client`, `./react`, `./typescript`, `./import-order`, `./a11y`, `./prettier`).
- **`prettier.config.js`**: re-exports `@gravity-ui/prettier-config`.
- **`.prettierignore`**: `dist/`, `coverage/`, `package-lock.json`.
- **`vite.config.ts`**: change the `defineConfig` import from `vite` to `vitest/config` and add:
  ```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  }
  ```
  No `globals` — test files import `describe`/`it`/`expect` from `vitest` explicitly so `tsconfig`
  needs no extra global types.
- **`tsconfig.json`**: no structural change. It already `include`s `src`, so `*.test.ts` and the fake
  typecheck automatically under the existing `strict` settings.
- **`.gitignore`**: add `coverage/`.
- **`.nvmrc`**: `24`.

### npm scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc",
  "build": "tsc && vite build"
}
```

(`typecheck` is `tsc` because `tsconfig.json` already sets `noEmit: true`. `build` is unchanged.)

### Storage test suite

**`src/storage/fakeFileSystem.ts`** — an in-memory implementation of the File System Access API subset
the store uses:

- `FakeDirectoryHandle`: `values()` (async iterator over entries), `getFileHandle(name, {create?})`
  (throws `new DOMException('...', 'NotFoundError')` when missing and not creating), `removeEntry(name)`.
- `FakeFileHandle`: `kind`, `name`, `getFile()` (returns an object with `text()`, `lastModified`, `name`),
  `createWritable()` → writable with `write(contents)` and `close()`.
- Test ergonomics: seed initial files and set/advance `lastModified` deterministically so list-sort
  assertions are stable.

**`src/storage/fileSystemStore.test.ts`** — covers:

- `list()`: filters out non-`.md` files and directories; sorts by `updatedAt` descending; maps
  `title` from file name.
- `get()`: returns content + title; round-trips with `save()`.
- `create()`: default `Untitled.md`; collision resolves to `Untitled 2.md`; illegal characters
  (`/ \ : * ? " < > |`) replaced with spaces; control characters stripped; empty/whitespace title →
  `Untitled`.
- `save()`: persists the body; subsequent `get()` returns it.
- `rename()`: same-name is a no-op; rename to a new name copies content then deletes the old file and
  returns a new id; rename into an existing name resolves to `<name> 2`.
- `remove()`: deletes the entry.
- `uniqueFileName`: increments past 2 (`3`, `4`, ...) when multiple collisions exist.

### CI workflow

**`.github/workflows/ci.yml`**:

- Triggers: `push` and `pull_request` targeting `main`.
- Job: `ubuntu-latest`, `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 24` and npm
  cache enabled.
- Steps (in order): `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` →
  `npm test` → `npm run build`.
- Single Node version for now; a version matrix is a trivial later addition.

### One-time cleanup

The first run of the Gravity config may surface violations (import ordering, jsx-a11y, the existing
`no-control-regex` disable now backed by a real rule). Fix them so `main` lands lint-clean. The
existing code is already close to Gravity style, so this is expected to be small.

## Testing strategy

The storage test suite is the deliverable, not an afterthought. All store behavior is exercised through
the fake in the `node` Vitest environment and runs in CI via `vitest run`. Later slices add their own
tests (Robustness extends the storage tests; Core UX introduces component testing).

## Risks & mitigations

- **TS 5.6 → 5.9 bump** — low risk; `npm run build` after the bump confirms no new type errors.
- **ESLint pinned to 9, not 10** — intentional for Gravity-config compatibility; revisit when the config
  supports 10.
- **Gravity config strictness** — may require the one-time cleanup pass above; scoped and expected.
- **Node globals in tests** (`DOMException`, `File`) — available on Node 20+; local and CI are on 24.

## Out of scope (YAGNI for this slice)

- Stylelint / CSS linting (`@gravity-ui/stylelint-config` exists; add later if desired).
- Pre-commit hooks (husky / lint-staged) — CI enforces instead.
- React/component testing (jsdom + Testing Library) — added in the Core UX slice.
- Coverage thresholds / reporting tooling.
- Dependency trimming — deferred to the roadmap tail.

## Implementation order

1. Dependencies + version bumps + `engines` + `.nvmrc`.
2. Config files (eslint, prettier, vitest via `vite.config.ts`, `.gitignore`).
3. npm scripts.
4. Fake + storage test suite (red → green).
5. One-time lint cleanup pass.
6. CI workflow.
7. Verify all scripts pass locally, then confirm CI green.
