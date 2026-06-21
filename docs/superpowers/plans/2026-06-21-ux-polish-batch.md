# UX Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship nine small-to-medium UX/theming items: 24h/`DD.MM.YY` list time, top-bar search-left + folder-right, amber links, a collapsible sidebar (hover-peek + pin), checklist spacing, +1px line-height, a trailing blank line on save, dark code-block color, and a neutral-grey dark background.

**Architecture:** Mostly isolated CSS/logic tweaks plus one medium feature (collapsible sidebar = presentational state in `Workspace` + a toggle in `NoteList`'s toolbar + a CSS hover-peek overlay, persisted in `localStorage`). Pure-logic items (list time, trailing newline, sidebar wiring) are TDD'd; pure-visual items (colors, line-height, checklist, layout) ship as CSS verified by lint/build + a final manual Chromium smoke test (the colors are tuned live).

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/uikit` + `@gravity-ui/icons`, Gravity theme CSS variables, Vitest + Testing Library, File System Access API behind `NoteStore`.

---

## File structure

- `src/components/NoteList.tsx` — **modify**: export + rewrite `formatNoteDate`; add the sidebar toggle button to the toolbar.
- `src/components/NoteList.test.tsx` — **modify**: `formatNoteDate` unit tests.
- `src/storage/fileSystemStore.ts` — **modify**: `canonicalBody` helper; `save`/`rename` write `\n\n`.
- `src/storage/fileSystemStore.test.ts` — **modify**: trailing-`\n\n` assertions.
- `src/index.css` — **modify**: amber links, dark code-block color, neutral-grey dark background.
- `src/components/EditorPane.css` — **modify**: line-height 1.25; checklist indent/alignment.
- `src/components/TopBar.tsx` + `TopBar.css` — **modify**: search-left, folder-right layout.
- `src/components/Workspace.tsx` + `Workspace.css` — **modify**: collapsed state + persistence + overlay/reveal.
- `src/components/Workspace.test.tsx` — **modify**: collapse/restore tests.
- `CLAUDE.md` — **modify**: roadmap (Task 7).

---

## Task 1: List time format (24h / DD.MM.YY)

**Files:**
- Modify: `src/components/NoteList.tsx` (the `formatNoteDate` function)
- Test: `src/components/NoteList.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/NoteList.test.tsx`, change the import to pull in `formatNoteDate`:

```ts
import {NoteList, type NoteListHandle, type NoteListProps, formatNoteDate} from './NoteList';
```

Add this describe block at the top level of the file (after the existing `NOTES` constant / `setup` helper, before or after the other `describe`s):

```ts
describe('formatNoteDate', () => {
    it('shows 24-hour time for today', () => {
        const today = new Date();
        today.setHours(14, 32, 0, 0);
        expect(formatNoteDate(today.getTime())).toBe('14:32');
    });

    it('zero-pads the morning hours', () => {
        const today = new Date();
        today.setHours(9, 5, 0, 0);
        expect(formatNoteDate(today.getTime())).toBe('09:05');
    });

    it('shows DD.MM.YY for any other day', () => {
        const past = new Date(2024, 0, 5, 9, 0, 0); // 5 Jan 2024
        expect(formatNoteDate(past.getTime())).toBe('05.01.24');
    });

    it('returns an empty string when there is no timestamp', () => {
        expect(formatNoteDate(undefined)).toBe('');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/NoteList.test.tsx`
Expected: FAIL — `formatNoteDate` is not exported (import error / undefined).

- [ ] **Step 3: Export and rewrite `formatNoteDate`**

In `src/components/NoteList.tsx`, replace the existing function:

```ts
/** Compact list date: time for today, "Jun 20" within the year, otherwise a full date. */
function formatNoteDate(ts: number | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }
    if (d.getFullYear() === now.getFullYear()) {
        return d.toLocaleDateString([], {month: 'short', day: 'numeric'});
    }
    return d.toLocaleDateString([], {year: 'numeric', month: 'short', day: 'numeric'});
}
```

with:

```ts
/** Compact list date: 24-hour time for today, otherwise `DD.MM.YY`. Exported for unit tests. */
export function formatNoteDate(ts: number | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    return `${dd}.${mo}.${yy}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/NoteList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/NoteList.tsx src/components/NoteList.test.tsx
git commit -m "feat(list): 24h time today, DD.MM.YY otherwise"
```

---

## Task 2: Trailing blank line on save

**Files:**
- Modify: `src/storage/fileSystemStore.ts`
- Test: `src/storage/fileSystemStore.test.ts`

- [ ] **Step 1: Update the failing tests**

In `src/storage/fileSystemStore.test.ts`, update the two save tests to expect a trailing blank line. Replace `'writes a trailing newline and strips it back off on read'`:

```ts
        it('writes a trailing newline and strips it back off on read', async () => {
            dir.seedFile('Ideas.md', 'x', 10);

            await store.save('Ideas.md', 'no newline', 10);

            // The file on disk ends with exactly one newline...
            const onDisk = await (await dir.getFileHandle('Ideas.md')).getFile();
            expect(await onDisk.text()).toBe('no newline\n');
            // ...while get() returns the canonical body the editor round-trips (no trailing newline).
            expect((await store.get('Ideas.md')).content).toBe('no newline');
        });
```

with:

```ts
        it('ends the saved file with a blank line and strips it back off on read', async () => {
            dir.seedFile('Ideas.md', 'x', 10);

            await store.save('Ideas.md', 'no newline', 10);

            // The file on disk ends with a real blank line (two newlines)...
            const onDisk = await (await dir.getFileHandle('Ideas.md')).getFile();
            expect(await onDisk.text()).toBe('no newline\n\n');
            // ...while get() returns the canonical body the editor round-trips (no trailing newline).
            expect((await store.get('Ideas.md')).content).toBe('no newline');
        });
```

Replace `'collapses multiple trailing newlines to a single one on save'`:

```ts
        it('collapses multiple trailing newlines to a single one on save', async () => {
            dir.seedFile('Ideas.md', 'x', 10);

            await store.save('Ideas.md', 'body\n\n\n', 10);

            const onDisk = await (await dir.getFileHandle('Ideas.md')).getFile();
            expect(await onDisk.text()).toBe('body\n');
        });
```

with:

```ts
        it('normalizes any trailing newlines to a single blank line on save', async () => {
            dir.seedFile('Ideas.md', 'x', 10);

            await store.save('Ideas.md', 'body\n\n\n', 10);

            const onDisk = await (await dir.getFileHandle('Ideas.md')).getFile();
            expect(await onDisk.text()).toBe('body\n\n');
        });
```

In the `describe('rename', …)` block, update the canonical-newline test. Replace:

```ts
        it('writes the canonical single trailing newline to the renamed file', async () => {
            dir.seedFile('Old.md', 'body', 5);

            await store.rename('Old.md', 'New');

            // store.get() strips trailing newlines (so read the raw file): a rename must leave it
            // in the same "exactly one trailing newline" shape save() produces.
            const handle = await dir.getFileHandle('New.md');
            const raw = await (await handle.getFile()).text();
            expect(raw).toBe('body\n');
        });
```

with:

```ts
        it('writes the canonical trailing blank line to the renamed file', async () => {
            dir.seedFile('Old.md', 'body', 5);

            await store.rename('Old.md', 'New');

            // store.get() strips trailing newlines (so read the raw file): a rename must leave it
            // in the same canonical "blank line at EOF" shape save() produces.
            const handle = await dir.getFileHandle('New.md');
            const raw = await (await handle.getFile()).text();
            expect(raw).toBe('body\n\n');
        });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/storage/fileSystemStore.test.ts`
Expected: FAIL — the on-disk text is `…\n`, not `…\n\n`.

- [ ] **Step 3: Add `canonicalBody` and use it in save + rename**

In `src/storage/fileSystemStore.ts`, add the helper right after `stripTrailingNewlines`:

```ts
/** Trailing newlines are insignificant in Markdown; drop them for a canonical body. */
function stripTrailingNewlines(text: string): string {
    return text.replace(/\n+$/, '');
}

/** Canonical on-disk body: the body followed by a single blank line at EOF. */
function canonicalBody(content: string): string {
    return stripTrailingNewlines(content) + '\n\n';
}
```

In `save`, replace:

```ts
        // Always end the file with exactly one trailing newline (the editor serializes none).
        await writable.write(stripTrailingNewlines(content) + '\n');
```

with:

```ts
        // End the file with a blank line at EOF (the editor serializes no trailing newline).
        await writable.write(canonicalBody(content));
```

In `rename`, replace:

```ts
        // Write the same canonical "exactly one trailing newline" shape save() produces, so a
        // rename doesn't silently strip the file's trailing newline (renames are frequent now
        // that editing the title renames the file).
        await writable.write(stripTrailingNewlines(content) + '\n');
```

with:

```ts
        // Write the same canonical shape save() produces (a blank line at EOF), so a rename
        // doesn't change the file's trailing whitespace (renames are frequent now that editing
        // the title renames the file).
        await writable.write(canonicalBody(content));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/storage/fileSystemStore.test.ts`
Expected: PASS (incl. the existing `'strips trailing newlines from the body on read'` and `'round-trips content through save'`, which still hold — `get` strips all trailing newlines).

- [ ] **Step 5: Commit**

```bash
git add src/storage/fileSystemStore.ts src/storage/fileSystemStore.test.ts
git commit -m "feat(storage): end saved notes with a trailing blank line"
```

---

## Task 3: Theme colors — amber links, dark code, neutral-grey dark bg

**Files:**
- Modify: `src/index.css`

These are visual; verification is `npm run lint` + `npm run build` here, and the live Chromium smoke test in Task 7 (where the exact shades are tuned).

- [ ] **Step 1: Amber link colors (both themes)**

In `src/index.css`, replace the three link variables under `.g-root_theme_light`:

```css
    --g-color-text-link: var(--g-color-private-black-900-solid);
    --g-color-text-link-hover: var(--g-color-private-black-1000-solid);
    --g-color-text-link-visited: var(--g-color-private-black-700-solid);
```

with:

```css
    --g-color-text-link: #c2650f;
    --g-color-text-link-hover: #9e520c;
    --g-color-text-link-visited: #8a4a12;
```

And under `.g-root_theme_dark`, replace:

```css
    --g-color-text-link: var(--g-color-private-white-1000-solid);
    --g-color-text-link-hover: var(--g-color-private-white-850-solid);
    --g-color-text-link-visited: var(--g-color-private-white-700-solid);
```

with:

```css
    --g-color-text-link: #e08a2b;
    --g-color-text-link-hover: #f0a050;
    --g-color-text-link-visited: #c2752a;
```

- [ ] **Step 2: Neutral-grey dark background + readable dark code color**

In `src/index.css`, inside the `.g-root_theme_dark { … }` block, add these overrides (after the existing variables, before the closing brace):

```css
    /* Neutralize the warm cast of the dark base surfaces toward grey. Tuned live. */
    --g-color-base-background: #1f1f1f;
    --g-color-base-generic: #2a2a2a;
    --g-color-base-generic-hover: #333333;
```

Then add, at the END of `src/index.css` (outside the theme blocks), a dark-theme code color rule:

```css
/* Code text was washing out in dark mode; force a readable foreground on inline + fenced code
   (both the WYSIWYG body and the read-only .yfm preview). Background left as-is. Tuned live. */
.g-root_theme_dark .g-md-editor code,
.g-root_theme_dark .g-md-editor pre,
.g-root_theme_dark .note-preview .yfm code,
.g-root_theme_dark .note-preview .yfm pre {
    color: var(--g-color-text-primary);
}
```

- [ ] **Step 3: Verify it builds and lints**

Run: `npm run lint && npm run build`
Expected: clean — no CSS/Prettier errors, build succeeds. (Visual correctness is confirmed in Task 7's smoke test, where you adjust the exact greys/amber/code color in dark mode.)

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "style(theme): amber links, neutral-grey dark bg, readable dark code"
```

---

## Task 4: Editor typography — line-height + checklist

**Files:**
- Modify: `src/components/EditorPane.css`

- [ ] **Step 1: Bump line-height 1.2 → 1.25**

In `src/components/EditorPane.css`, change the two `line-height: 1.2;` declarations to `1.25`:

```css
.editor-pane .g-md-editor.ProseMirror.yfm {
    line-height: 1.25;
}

.editor-pane .g-md-editor.ProseMirror.yfm :where(p, li) {
    margin-top: 0;
    margin-bottom: 1px;
    line-height: 1.25;
}
```

- [ ] **Step 2: Tighten checklist indent + align the checkbox**

In `src/components/EditorPane.css`, the existing checklist rule sets only the checkbox margin-right. Replace:

```css
/* Breathing room between a checklist checkbox and its label. The editor ships
   `.yfm-editor .g-md-checkbox__input { margin-right: 5px }`; the extra `.g-md-editor`
   here outranks it so the wider gap wins regardless of stylesheet order. */
.editor-pane .g-md-editor .g-md-checkbox__input[type='checkbox'] {
    margin-right: 10px;
}
```

with:

```css
/* Breathing room between a checklist checkbox and its label, plus vertical centering against
   the first text line. */
.editor-pane .g-md-editor .g-md-checkbox__input[type='checkbox'] {
    margin-right: 10px;
    margin-top: 0;
    vertical-align: middle;
}

/* Checklist rows should indent like the dashed (bulleted) lists — the checkbox box adds extra
   width, so pull the row's content left to match. Tuned live against a bulleted list. */
.editor-pane .g-md-editor ul > li:has(.g-md-checkbox) {
    margin-left: -2px;
}
```

- [ ] **Step 3: Verify it builds and lints**

Run: `npm run lint && npm run build`
Expected: clean. (The checklist indent/alignment px and the line-height are confirmed/adjusted in Task 7's smoke test, comparing a checklist against a dashed list.)

- [ ] **Step 4: Commit**

```bash
git add src/components/EditorPane.css
git commit -m "style(editor): +1px line-height; tighter, aligned checklist rows"
```

---

## Task 5: Top-bar layout — search-left, folder-right

**Files:**
- Modify: `src/components/TopBar.tsx`, `src/components/TopBar.css`

- [ ] **Step 1: Move the folder button into the right cluster**

In `src/components/TopBar.tsx`, replace the returned JSX (the `<header className="topbar">…</header>`):

```tsx
    return (
        <header className="topbar">
            <div className="topbar__folder-zone">
                <Button
                    view="flat"
                    size="l"
                    className="topbar__folder"
                    onClick={onChangeFolder}
                    title="Change folder"
                >
                    <Icon data={Folder} size={16} />
                    <span className="topbar__folder-name">{folderName ?? 'Folder'}</span>
                </Button>
            </div>

            <div className="topbar__main">
                <TextInput
                    className="topbar__search"
                    controlRef={searchInputRef}
                    value={query}
                    onUpdate={onQueryChange}
                    placeholder="Search or create a note…"
                    hasClear
                    onKeyDown={onSearchKeyDown}
                />
                <Text color="secondary" className="topbar__save">
                    {saveLabel}
                </Text>
                <ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
                <Button view="flat" size="m" onClick={onOpenHelp} title="Keyboard shortcuts (?)">
                    <Icon data={CircleQuestion} />
                </Button>
            </div>
        </header>
    );
```

with (search spans from the left; folder joins theme + help on the right):

```tsx
    return (
        <header className="topbar">
            <TextInput
                className="topbar__search"
                controlRef={searchInputRef}
                value={query}
                onUpdate={onQueryChange}
                placeholder="Search or create a note…"
                hasClear
                onKeyDown={onSearchKeyDown}
            />
            <Text color="secondary" className="topbar__save">
                {saveLabel}
            </Text>
            <Button
                view="flat"
                size="m"
                className="topbar__folder"
                onClick={onChangeFolder}
                title="Change folder"
            >
                <Icon data={Folder} size={16} />
                <span className="topbar__folder-name">{folderName ?? 'Folder'}</span>
            </Button>
            <ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
            <Button view="flat" size="m" onClick={onOpenHelp} title="Keyboard shortcuts (?)">
                <Icon data={CircleQuestion} />
            </Button>
        </header>
    );
```

- [ ] **Step 2: Update the top-bar CSS**

Replace the entire contents of `src/components/TopBar.css` with:

```css
.topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--g-color-line-generic);
    flex-shrink: 0;
}

/* The search is the hero: it fills from the left up to the right-hand controls. */
.topbar__search {
    flex: 1;
    min-width: 0;
}

.topbar__save {
    flex-shrink: 0;
    white-space: nowrap;
}

.topbar__folder {
    gap: 6px;
    flex-shrink: 0;
    max-width: 220px;
}

.topbar__folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 3: Verify tests, lint, build**

Run: `npm test -- src/components/TopBar.test.tsx src/components/Workspace.test.tsx && npm run lint && npm run build`
Expected: PASS / clean. The existing top-bar tests target the search input by placeholder and the folder button by its name, both of which still exist, so they pass. (Layout looks confirmed in Task 7's smoke test.)

- [ ] **Step 4: Commit**

```bash
git add src/components/TopBar.tsx src/components/TopBar.css
git commit -m "feat(topbar): full-width search; folder button on the right"
```

---

## Task 6: Collapsible sidebar (hover-peek + pin)

**Files:**
- Modify: `src/components/Workspace.tsx`, `src/components/Workspace.css`, `src/components/NoteList.tsx`
- Test: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/Workspace.test.tsx`, add these tests at the end of the `describe('Workspace — nvALT navigation', …)` block (before its closing `});`):

```tsx
    it('collapses the sidebar and persists it', async () => {
        const user = userEvent.setup();
        localStorage.removeItem('gravity-notes:sidebar-collapsed');
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        // Docked: no reveal handle.
        expect(screen.queryByLabelText('Show notes')).not.toBeInTheDocument();
        await user.click(screen.getByLabelText('Collapse sidebar'));
        // Collapsed: the left-edge reveal handle appears and the state is persisted.
        await screen.findByLabelText('Show notes');
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('true');
        localStorage.removeItem('gravity-notes:sidebar-collapsed');
    });

    it('restores the collapsed sidebar from localStorage', async () => {
        localStorage.setItem('gravity-notes:sidebar-collapsed', 'true');
        renderWorkspace();
        await screen.findByLabelText('Show notes');
        localStorage.removeItem('gravity-notes:sidebar-collapsed');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: FAIL — there is no "Collapse sidebar" / "Show notes" affordance yet.

- [ ] **Step 3: Add collapsed state + persistence + layout to `Workspace`**

In `src/components/Workspace.tsx`, add the storage key constant near the top (after the imports, before the component) :

```ts
const SIDEBAR_KEY = 'gravity-notes:sidebar-collapsed';
```

Inside the `Workspace` component, add state alongside the other `useState`s (e.g. after `const [previewMode, setPreviewMode] = useState(false);`):

```ts
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
    useEffect(() => {
        localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    }, [collapsed]);
    const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
```

Replace the `workspace__body` wrapper opening + the sidebar `<aside>`:

```tsx
            <div className="workspace__body">
                <aside className="workspace__sidebar">
                    <NoteList
                        ref={listRef}
                        notes={filteredNotes}
                        selectedId={nav.selectedId}
                        query={query}
                        searchInputRef={searchInputRef}
                        onBrowse={nav.browse}
                        onCommit={nav.commit}
                        onEscapeList={nav.escapeToSearch}
                        onCreate={handleCreate}
                        onRename={handleRename}
                        onDelete={handleDelete}
                        sortMode={notes.metadata.sort}
                        onSortChange={notes.setSortMode}
                        pinnedIds={notes.metadata.pinned}
                        onTogglePin={notes.togglePin}
                    />
                </aside>
```

with (add the collapsed modifier, the reveal button, and the two new `NoteList` props):

```tsx
            <div className={'workspace__body' + (collapsed ? ' workspace__body_collapsed' : '')}>
                {collapsed ? (
                    <button
                        type="button"
                        className="workspace__sidebar-reveal"
                        aria-label="Show notes"
                    />
                ) : null}
                <aside className="workspace__sidebar">
                    <NoteList
                        ref={listRef}
                        notes={filteredNotes}
                        selectedId={nav.selectedId}
                        query={query}
                        searchInputRef={searchInputRef}
                        onBrowse={nav.browse}
                        onCommit={nav.commit}
                        onEscapeList={nav.escapeToSearch}
                        onCreate={handleCreate}
                        onRename={handleRename}
                        onDelete={handleDelete}
                        sortMode={notes.metadata.sort}
                        onSortChange={notes.setSortMode}
                        pinnedIds={notes.metadata.pinned}
                        onTogglePin={notes.togglePin}
                        collapsed={collapsed}
                        onToggleCollapsed={toggleCollapsed}
                    />
                </aside>
```

Confirm `useEffect` and `useCallback` are already imported in `Workspace.tsx` (they are — `import {useCallback, useEffect, useMemo, useRef, useState} from 'react';`).

- [ ] **Step 4: Add the toggle button to the `NoteList` toolbar**

In `src/components/NoteList.tsx`, add the two icons to the existing `@gravity-ui/icons` import:

```ts
import {ChevronLeft, ChevronRight, Ellipsis, Pencil, Pin, PinFill, PinSlash, Plus, TrashBin} from '@gravity-ui/icons';
```

Add the two props to `NoteListProps` (after `onTogglePin`):

```ts
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
    /** Whether the sidebar is collapsed (changes the toolbar toggle's icon/label). */
    collapsed: boolean;
    /** Toggle the sidebar between docked and collapsed. */
    onToggleCollapsed: () => void;
```

Add `collapsed` and `onToggleCollapsed` to the destructured props in the `NoteList` function signature (alongside `pinnedIds`, `onTogglePin`).

In the toolbar JSX, add the toggle button as the FIRST child of `.note-list__toolbar`:

```tsx
            <div className="note-list__toolbar">
                <Button
                    view="flat"
                    size="m"
                    className="note-list__collapse"
                    onClick={onToggleCollapsed}
                    aria-label={collapsed ? 'Pin sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Pin sidebar' : 'Collapse sidebar'}
                >
                    <Icon data={collapsed ? ChevronRight : ChevronLeft} />
                </Button>
                <Select
                    className="note-list__sort"
                    ...
```

(Leave the existing `<Select>` and New `<Button>` as they are — just insert the toggle button before the `<Select>`.)

`collapsed` and `onToggleCollapsed` are now **required** `NoteList` props, so update the test's prop factory: in `src/components/NoteList.test.tsx`, in the `setup` helper's `props` object, add these two entries (e.g. right after `onTogglePin: vi.fn(),`):

```ts
        collapsed: false,
        onToggleCollapsed: vi.fn(),
```

- [ ] **Step 5: Add the collapse/peek CSS**

Append to `src/components/Workspace.css`:

```css
/* Collapsed sidebar: it leaves the flow (editor fills the width) and becomes a hover overlay.
   A slim left-edge button reveals it; hovering the button or the panel slides it in. */
.workspace__body {
    position: relative;
}

.workspace__body_collapsed .workspace__sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 10;
    transform: translateX(-100%);
    transition: transform 0.15s ease;
    box-shadow: 0 0 16px rgba(0, 0, 0, 0.25);
}

.workspace__body_collapsed .workspace__sidebar-reveal:hover ~ .workspace__sidebar,
.workspace__body_collapsed .workspace__sidebar-reveal:focus-visible ~ .workspace__sidebar,
.workspace__body_collapsed .workspace__sidebar:hover {
    transform: translateX(0);
}

.workspace__sidebar-reveal {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 10px;
    z-index: 11;
    padding: 0;
    border: none;
    cursor: pointer;
    background: var(--g-color-line-generic);
    opacity: 0.4;
    transition: opacity 0.15s ease;
}

.workspace__sidebar-reveal:hover {
    opacity: 0.8;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: PASS (collapse/restore tests + all existing nvALT tests).

- [ ] **Step 7: Typecheck + full suite + lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: clean / all green — `NoteList.test.tsx`'s `setup` props now include `collapsed`/`onToggleCollapsed` (added in Step 4), so typecheck and the existing `NoteList` tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/Workspace.tsx src/components/Workspace.css src/components/NoteList.tsx src/components/Workspace.test.tsx
git commit -m "feat(sidebar): collapsible with hover-peek overlay + pin toggle"
```

---

## Task 7: Docs + full verification + manual smoke

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the `CLAUDE.md` roadmap**

In `CLAUDE.md`, under roadmap item 3, add a sub-bullet after the ⌘J/⌘K entry:

```markdown
   - ✅ **UX polish batch** — 24h/`DD.MM.YY` list time, full-width search with the folder button on
     the right, amber links, a collapsible sidebar (hover-peek overlay + pin toggle, localStorage-
     persisted), tighter line-height/checklist spacing, a trailing blank line on save, and neutral-grey
     dark theming (readable code blocks).
     Spec: `docs/superpowers/specs/2026-06-21-ux-polish-batch-design.md`.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all green — full Vitest suite passes, ESLint clean, `tsc` + Vite build succeed.

- [ ] **Step 3: Manual Chromium smoke test**

Run `npm run dev`, open in Chrome, pick a folder, and verify (tuning the live-adjusted values as needed):
- **List time:** today's notes show `HH:mm` (24h); older notes show `DD.MM.YY`.
- **Top bar:** the search fills from the left; the folder button sits at the right next to theme + help.
- **Links:** a markdown link renders in darkish amber (both light and dark) — adjust the hexes in `index.css` if too bright/dark.
- **Sidebar:** the toolbar toggle collapses it (editor fills the width); a slim left-edge strip reveals it as an overlay on hover; the toggle (now "Pin") re-docks it; the state survives a reload.
- **Checklist vs dashed list:** the checklist rows line up with the dashed-list rows and the checkbox is vertically centered with its text — adjust the `margin-left` / checkbox alignment if off.
- **Line height:** body text has a touch more breathing room.
- **Trailing blank line:** save a note, then check the `.md` file on disk ends with a blank line.
- **Dark theme:** the background reads as neutral grey (not warm); code blocks have readable text — adjust the grey / code color in `index.css` if needed.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: roadmap note for the UX polish batch"
```

---

## Self-review notes (for the implementer)

- **`formatNoteDate` uses manual `getHours/getMinutes` and `getDate/getMonth/getFullYear`** for guaranteed 24-hour / `DD.MM.YY` output independent of the runtime locale (locale-dependent `toLocaleTimeString` could emit AM/PM).
- **Trailing `\n\n` is safe for round-trips:** `get` strips all trailing newlines, so the editor loads exactly what it serializes — no save-on-open. Autosave is debounced, so re-writing identical bytes never fires on its own.
- **The collapsed sidebar stays mounted** (only CSS-translated off-screen), so the list rows + the toolbar toggle remain in the DOM while collapsed — that's why the peek is pure CSS and the tests can still query the toggle.
- **Tasks 3, 4, 5 have no unit tests** (pure CSS/layout); their gate is lint + build here and the manual smoke test in Task 7. The exact amber/grey/code-color/checklist values are explicitly tuned live.
- **README is intentionally untouched** — it carries unrelated uncommitted user edits.
