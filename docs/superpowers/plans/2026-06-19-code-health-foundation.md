# Code Health Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vitest, ESLint, Prettier, and GitHub Actions CI to Gravity Notes, and deliver end-to-end test coverage of the storage layer.

**Architecture:** Adopt the Gravity ecosystem's shared flat-config ESLint + Prettier presets, run tests with Vitest in a `node` environment, and cover the real `FileSystemNoteStore` through a small in-memory fake of the File System Access API. CI runs lint + format + typecheck + test + build on push/PR to `main`.

**Tech Stack:** Vitest 3.2.6, ESLint 9, `@gravity-ui/eslint-config` 4, `@gravity-ui/prettier-config` 1, Prettier 3, TypeScript 5.9, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-19-code-health-foundation-design.md`

**Note on TDD:** The storage code already exists, so its tests are *characterization tests* — they should PASS on first run, pinning current behavior. A failing characterization test means a real bug was found; stop and report it rather than editing the test to match.

---

## File overview

| File | Responsibility | Action |
| --- | --- | --- |
| `package.json` | Dev deps, scripts, Node engines | Modify |
| `.nvmrc` | Pin Node version for contributors | Create |
| `.gitignore` | Ignore coverage output | Modify |
| `prettier.config.js` | Re-export Gravity Prettier preset | Create |
| `.prettierignore` | Exclude build/lock artifacts from Prettier | Create |
| `eslint.config.js` | Flat ESLint config composing Gravity presets | Create |
| `vite.config.ts` | Add Vitest `test` block | Modify |
| `src/storage/fakeFileSystem.ts` | In-memory File System Access API fake for tests | Create |
| `src/storage/fileSystemStore.test.ts` | Storage-layer test suite | Create |
| `.github/workflows/ci.yml` | CI pipeline | Create |
| `CLAUDE.md` | Document the new commands | Modify |

---

## Task 1: Add dev dependencies and pin Node

**Files:**
- Modify: `package.json` (`devDependencies`, `typescript` version, add `engines`)
- Create: `.nvmrc`
- Modify: `.gitignore`

- [ ] **Step 1: Update `devDependencies` and bump TypeScript in `package.json`**

Replace the `devDependencies` block with (adds five tools, bumps `typescript`):

```json
  "devDependencies": {
    "@gravity-ui/eslint-config": "^4.3.1",
    "@gravity-ui/prettier-config": "^1.1.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/wicg-file-system-access": "^2023.10.5",
    "@vitejs/plugin-react": "^4.3.4",
    "eslint": "^9.18.0",
    "prettier": "^3.4.2",
    "sass": "^1.83.0",
    "typescript": "^5.9.2",
    "vite": "^5.4.11",
    "vitest": "^3.2.6"
  }
```

- [ ] **Step 2: Add an `engines` field to `package.json`**

Add this top-level key (e.g. after `"version"`):

```json
  "engines": {
    "node": ">=22"
  },
```

- [ ] **Step 3: Create `.nvmrc`**

```
24
```

- [ ] **Step 4: Add `coverage` to `.gitignore`**

The file should read:

```
node_modules/
dist/
coverage/
*.local
.DS_Store
```

- [ ] **Step 5: Install**

Run: `npm install`
Expected: completes without errors; `package-lock.json` updates. Peer-dependency warnings are acceptable, but there must be no `ERESOLVE` failure.

- [ ] **Step 6: Verify the toolchain resolved**

Run: `npm ls eslint prettier vitest typescript @gravity-ui/eslint-config @gravity-ui/prettier-config`
Expected: each prints a resolved version (eslint 9.x, vitest 3.2.x, typescript 5.9.x, the two Gravity configs). No `UNMET DEPENDENCY`.

- [ ] **Step 7: Confirm the app still builds with the new TypeScript**

Run: `npm run build`
Expected: `tsc` passes and Vite produces `dist/` with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .nvmrc .gitignore
git commit -m "chore: add lint/test tooling deps and pin node"
```

---

## Task 2: Configure ESLint + Prettier

**Files:**
- Create: `prettier.config.js`
- Create: `.prettierignore`
- Create: `eslint.config.js`
- Modify: `package.json` (add lint/format scripts)

- [ ] **Step 1: Create `prettier.config.js`**

```js
export {default} from '@gravity-ui/prettier-config';
```

- [ ] **Step 2: Create `.prettierignore`**

```
dist
coverage
package-lock.json
```

- [ ] **Step 3: Create `eslint.config.js`**

The default export of `@gravity-ui/eslint-config` is base + TypeScript rules; `/client` adds React + browser globals; `/import-order`, `/a11y`, and `/prettier` add their respective rule sets (`/prettier` enables `eslint-plugin-prettier`, so ESLint also enforces formatting). The three override blocks below resolve known clashes with the existing code: parameter properties (used in `FileSystemNoteStore`), triple-slash references (required in `vite-env.d.ts`), and the deliberate CSS import order in `main.tsx`.

```js
import baseConfig from '@gravity-ui/eslint-config';
import a11yConfig from '@gravity-ui/eslint-config/a11y';
import clientConfig from '@gravity-ui/eslint-config/client';
import importOrderConfig from '@gravity-ui/eslint-config/import-order';
import prettierConfig from '@gravity-ui/eslint-config/prettier';

export default [
  {ignores: ['dist', 'coverage']},
  ...baseConfig,
  ...clientConfig,
  ...importOrderConfig,
  ...a11yConfig,
  ...prettierConfig,
  {
    rules: {
      // Parameter properties are an idiomatic, deliberate choice in our store classes.
      '@typescript-eslint/parameter-properties': 'off',
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      // Ambient type references (e.g. vite/client) can only be pulled in via triple-slash.
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  {
    files: ['src/main.tsx'],
    rules: {
      // The stylesheet import order here is intentional (CSS cascade); don't reorder it.
      'import/order': 'off',
    },
  },
];
```

- [ ] **Step 4: Add lint/format scripts to `package.json`**

Add these entries to `"scripts"`:

```json
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
```

- [ ] **Step 5: Auto-format the codebase to the Gravity Prettier style**

Run: `npm run format`
Expected: Prettier rewrites files to the shared style (quotes, spacing, trailing commas). Review the diff — it should be formatting-only, no logic changes.

- [ ] **Step 6: Auto-fix lint issues (mainly import ordering)**

Run: `npm run lint:fix`
Expected: import statements get reordered/grouped per the Gravity convention; command exits cleanly or leaves only items needing manual attention.

- [ ] **Step 7: Verify lint is clean**

Run: `npm run lint`
Expected: exits 0 with **0 errors**. Warnings (e.g. `no-non-null-assertion` on `request.transaction!` and `document.getElementById('root')!`) are acceptable. If any *error* remains beyond the three handled overrides, fix it at the source or, only if it's a justified false positive, add a narrowly-scoped override block to `eslint.config.js` mirroring the style above.

- [ ] **Step 8: Verify formatting check passes and the app still builds**

Run: `npm run format:check`
Expected: "All matched files use Prettier code style!"

Run: `npm run build`
Expected: build succeeds (formatting/import-order changes didn't break anything).

- [ ] **Step 9: Commit**

```bash
git add eslint.config.js prettier.config.js .prettierignore package.json
git add -u
git commit -m "chore: add eslint + prettier via gravity shared configs"
```

---

## Task 3: Wire up Vitest

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json` (add test scripts)

- [ ] **Step 1: Replace `vite.config.ts` with a Vitest-aware config**

Importing `defineConfig` from `vitest/config` (instead of `vite`) types the `test` block. `node` environment is correct because the storage tests use only `DOMException`/`File` (Node 20+ globals), no DOM.

```ts
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Add test scripts to `package.json`**

Add to `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc",
```

- [ ] **Step 3: Verify the runner is wired (no tests yet)**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0 with "No test files found, exiting with code 0".

- [ ] **Step 4: Verify lint + build still pass with the new config**

Run: `npm run lint && npm run build`
Expected: both pass (the rewritten `vite.config.ts` is lint-clean and builds).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts package.json
git commit -m "chore: add vitest runner config"
```

---

## Task 4: Cover the storage layer

**Files:**
- Create: `src/storage/fakeFileSystem.ts`
- Create: `src/storage/fileSystemStore.test.ts`

- [ ] **Step 1: Create the in-memory File System Access fake**

`src/storage/fakeFileSystem.ts` — implements only the methods `FileSystemNoteStore` calls (`values`, `getFileHandle`, `removeEntry`, `getFile`, `createWritable`). `lastModified` advances on each write via a monotonic clock; `seedFile` accepts an explicit value for deterministic sort tests.

```ts
/**
 * In-memory stand-in for the File System Access API, implementing only the
 * subset that {@link FileSystemNoteStore} touches. Construct the store in tests
 * with `new FileSystemNoteStore(asDirectoryHandle(dir))`.
 */

interface FakeFile {
  content: string;
  lastModified: number;
}

class FakeFileHandle {
  readonly kind = 'file';

  constructor(
    readonly name: string,
    private readonly file: FakeFile,
    private readonly tick: () => number,
  ) {}

  async getFile() {
    const file = this.file;
    const name = this.name;
    return {
      name,
      get lastModified() {
        return file.lastModified;
      },
      async text() {
        return file.content;
      },
    };
  }

  async createWritable() {
    const file = this.file;
    const tick = this.tick;
    let buffer = '';
    return {
      async write(contents: string) {
        buffer += contents;
      },
      async close() {
        file.content = buffer;
        file.lastModified = tick();
      },
    };
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory';

  private clock = 1000;
  private readonly fileEntries = new Map<string, FakeFile>();
  private readonly dirEntries = new Map<string, FakeDirectoryHandle>();

  constructor(readonly name = 'notes') {}

  /** Seed a file. `lastModified` defaults to a monotonic tick when omitted. */
  seedFile(name: string, content: string, lastModified?: number) {
    this.fileEntries.set(name, {
      content,
      lastModified: lastModified ?? ++this.clock,
    });
  }

  /** Seed a subdirectory, to verify the store ignores non-file entries. */
  seedSubdir(name: string) {
    this.dirEntries.set(name, new FakeDirectoryHandle(name));
  }

  async *values(): AsyncGenerator<FakeFileHandle | FakeDirectoryHandle> {
    for (const [name, file] of this.fileEntries) {
      yield new FakeFileHandle(name, file, () => ++this.clock);
    }
    for (const subdir of this.dirEntries.values()) {
      yield subdir;
    }
  }

  async getFileHandle(name: string, options?: {create?: boolean}): Promise<FakeFileHandle> {
    let file = this.fileEntries.get(name);
    if (!file) {
      if (!options?.create) {
        throw new DOMException(`${name} not found`, 'NotFoundError');
      }
      file = {content: '', lastModified: ++this.clock};
      this.fileEntries.set(name, file);
    }
    return new FakeFileHandle(name, file, () => ++this.clock);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.fileEntries.delete(name)) {
      throw new DOMException(`${name} not found`, 'NotFoundError');
    }
  }
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
  return fake as unknown as FileSystemDirectoryHandle;
}
```

- [ ] **Step 2: Create the storage test suite**

`src/storage/fileSystemStore.test.ts`:

```ts
import {beforeEach, describe, expect, it} from 'vitest';

import {asDirectoryHandle, FakeDirectoryHandle} from './fakeFileSystem';
import {FileSystemNoteStore} from './fileSystemStore';

describe('FileSystemNoteStore', () => {
  let dir: FakeDirectoryHandle;
  let store: FileSystemNoteStore;

  beforeEach(() => {
    dir = new FakeDirectoryHandle();
    store = new FileSystemNoteStore(asDirectoryHandle(dir));
  });

  describe('list', () => {
    it('returns .md files newest-first with derived titles', async () => {
      dir.seedFile('Alpha.md', '# Alpha', 100);
      dir.seedFile('Beta.md', '# Beta', 300);
      dir.seedFile('Gamma.md', '# Gamma', 200);

      const metas = await store.list();

      expect(metas.map((m) => m.title)).toEqual(['Beta', 'Gamma', 'Alpha']);
      expect(metas[0]).toMatchObject({id: 'Beta.md', title: 'Beta', updatedAt: 300});
    });

    it('ignores non-markdown files and directories', async () => {
      dir.seedFile('note.md', 'hi', 1);
      dir.seedFile('image.png', 'x', 2);
      dir.seedFile('README.txt', 'x', 3);
      dir.seedSubdir('attachments');

      const metas = await store.list();

      expect(metas.map((m) => m.id)).toEqual(['note.md']);
    });
  });

  describe('get and save', () => {
    it('reads a note body and title', async () => {
      dir.seedFile('Ideas.md', 'first line', 10);

      const note = await store.get('Ideas.md');

      expect(note).toMatchObject({id: 'Ideas.md', title: 'Ideas', content: 'first line'});
    });

    it('round-trips content through save', async () => {
      dir.seedFile('Ideas.md', 'old', 10);

      await store.save('Ideas.md', 'new body');

      expect((await store.get('Ideas.md')).content).toBe('new body');
    });
  });

  describe('create', () => {
    it('creates an empty note with the given title', async () => {
      const meta = await store.create('Shopping');

      expect(meta).toMatchObject({id: 'Shopping.md', title: 'Shopping'});
      expect((await store.get('Shopping.md')).content).toBe('');
    });

    it('resolves title collisions with a numeric suffix', async () => {
      await store.create('Untitled');
      const second = await store.create('Untitled');
      const third = await store.create('Untitled');

      expect(second.id).toBe('Untitled 2.md');
      expect(third.id).toBe('Untitled 3.md');
    });

    it('replaces filename-illegal characters with spaces', async () => {
      const meta = await store.create('a/b:c*d?');

      expect(meta.id).toBe('a b c d.md');
    });

    it('strips control characters', async () => {
      const meta = await store.create('tab\tnote');

      expect(meta.id).toBe('tab note.md');
    });

    it('falls back to Untitled for an empty title', async () => {
      const meta = await store.create('   ');

      expect(meta.id).toBe('Untitled.md');
    });
  });

  describe('rename', () => {
    it('is a no-op when the title is unchanged', async () => {
      dir.seedFile('Note.md', 'body', 5);

      const meta = await store.rename('Note.md', 'Note');

      expect(meta.id).toBe('Note.md');
      expect((await store.get('Note.md')).content).toBe('body');
    });

    it('moves content to the new file and removes the old one', async () => {
      dir.seedFile('Old.md', 'keep me', 5);

      const meta = await store.rename('Old.md', 'New');

      expect(meta.id).toBe('New.md');
      expect((await store.get('New.md')).content).toBe('keep me');
      await expect(store.get('Old.md')).rejects.toThrow();
    });

    it('resolves collisions when renaming onto an existing title', async () => {
      dir.seedFile('Old.md', 'a', 5);
      dir.seedFile('Taken.md', 'b', 6);

      const meta = await store.rename('Old.md', 'Taken');

      expect(meta.id).toBe('Taken 2.md');
    });
  });

  describe('remove', () => {
    it('deletes the note file', async () => {
      dir.seedFile('Gone.md', 'x', 1);

      await store.remove('Gone.md');

      await expect(store.get('Gone.md')).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: all tests PASS (they characterize the existing store). If any FAILS, you've found a real bug — stop and report it; do not weaken the test.

- [ ] **Step 4: Verify lint + typecheck cover the new files cleanly**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 with no errors for `fakeFileSystem.ts` or `fileSystemStore.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/storage/fakeFileSystem.ts src/storage/fileSystemStore.test.ts
git commit -m "test: cover FileSystemNoteStore via in-memory fs fake"
```

---

## Task 5: Add CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Run the exact CI sequence locally**

Run: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
Expected: every step passes in order. This mirrors what CI will execute.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, format, typecheck, test, build on push/PR"
```

---

## Task 6: Document commands and final verification

**Files:**
- Modify: `CLAUDE.md` (Commands section)

- [ ] **Step 1: Update the Commands section in `CLAUDE.md`**

Replace the `## Commands` section (including the "being added" note) with:

```markdown
## Commands

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # type-check (tsc, noEmit) + production build
npm run preview      # preview the production build

npm test             # run the Vitest suite once
npm run test:watch   # watch mode
npm run lint         # ESLint (Gravity flat config; also enforces Prettier on JS/TS)
npm run lint:fix     # ESLint with autofix
npm run format       # Prettier write (covers CSS/MD/JSON too)
npm run format:check # Prettier check (used in CI)
npm run typecheck    # tsc (noEmit)
```
```

- [ ] **Step 2: Final full verification**

Run: `npm ci && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
Expected: clean install plus every check passing — the complete CI pipeline, green locally.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document test/lint/format commands in CLAUDE.md"
```

- [ ] **Step 4: Push and open a PR so CI runs**

```bash
git push -u origin code-health-foundation
gh pr create --fill --base main
```

Expected: the PR's CI check (`verify`) runs and goes green. Confirm before considering the slice done.

---

## Self-review

- **Spec coverage:** deps + version bumps (Task 1), `.nvmrc`/`engines`/`.gitignore` (Task 1), ESLint + Prettier with the anticipated cleanup overrides (Task 2), Vitest config + scripts (Task 3), storage test suite via in-memory fake (Task 4), CI on push/PR to `main` with Node 24 (Task 5), CLAUDE.md command docs (Task 6). Out-of-scope items (stylelint, pre-commit hooks, component testing, coverage thresholds, dep trimming) are intentionally excluded. ✓
- **Placeholder scan:** every file has complete content; the only conditional is Task 2 Step 7 (residual lint errors), which gives concrete handling guidance rather than a placeholder. ✓
- **Type/name consistency:** `FakeDirectoryHandle`, `asDirectoryHandle`, `seedFile`, `seedSubdir`, `values`, `getFileHandle`, `removeEntry` are defined in Task 4 Step 1 and used identically in Step 2. Script names (`test`, `lint`, `format:check`, `typecheck`) match across Tasks 2/3/5/6 and the CI workflow. ✓
