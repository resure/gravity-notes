# Sidebar Toggle Rework + Editor Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's hover-peek with an always-visible top-bar `LayoutSideContent` toggle + a ⌘' shortcut (collapsed = hidden, no overlay), unpin the note title so it scrolls with the content, and add ~300px of end-of-note scroll room.

**Architecture:** The `collapsed` state + localStorage persistence stay in `Workspace`; they now flow to `TopBar` (which renders the toggle) instead of `NoteList`. A new `toggleSidebar` shortcut action (⌘' = `mod+'`) rides the existing descriptor system. The editor title is unpinned by moving the scroll to the outer `.editor-pane`; the end padding comes from the editor's content-padding variable.

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/uikit` + `@gravity-ui/icons` (`LayoutSideContent`), Gravity theme CSS vars, Vitest + Testing Library.

---

## File structure

- `src/shortcuts.ts` — **modify**: `ShortcutAction` += `toggleSidebar`; add the `mod+'` descriptor.
- `src/hooks/useShortcuts.test.tsx` — **modify**: `makeActions` + ⌘' tests.
- `src/components/TopBar.tsx` — **modify**: `collapsed`/`onToggleCollapsed` props + the toggle button.
- `src/components/Workspace.tsx` — **modify**: pass props to `TopBar` (not `NoteList`); drop the reveal button; wire `toggleSidebar`.
- `src/components/Workspace.css` — **modify**: replace the overlay/peek/reveal CSS with `display: none`; also (Task 3) the editor end-padding var.
- `src/components/Workspace.test.tsx` — **modify**: replace the 3 sidebar tests.
- `src/components/NoteList.tsx` — **modify**: remove the toggle button + props + `Chevron*` imports.
- `src/components/NoteList.test.tsx` — **modify**: drop the reverted props from `setup`.
- `src/components/EditorPane.css` — **modify**: unpin the title (outer scroll).
- `CLAUDE.md` — **modify**: roadmap (Task 4).

---

## Task 1: `toggleSidebar` shortcut (⌘')

**Files:**
- Modify: `src/shortcuts.ts`
- Test: `src/hooks/useShortcuts.test.tsx`

- [ ] **Step 1: Update the tests**

In `src/hooks/useShortcuts.test.tsx`, add `toggleSidebar` to `makeActions` (after `selectPrevNote`):

```ts
        selectPrevNote: vi.fn(),
        toggleSidebar: vi.fn(),
```

Add two tests (anywhere among the existing `it(...)` blocks):

```ts
    it('toggles the sidebar on ctrl+apostrophe', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: "'", ctrlKey: true});
        expect(actions.toggleSidebar).toHaveBeenCalledTimes(1);
    });

    it('still toggles the sidebar on ctrl+apostrophe while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: "'", ctrlKey: true});
        expect(actions.toggleSidebar).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useShortcuts.test.tsx`
Expected: FAIL — `toggleSidebar` is not a known action (ctrl+' fires nothing).

- [ ] **Step 3: Add the action + descriptor**

In `src/shortcuts.ts`, add `'toggleSidebar'` to the `ShortcutAction` union (after `'selectPrevNote'`):

```ts
export type ShortcutAction =
    | 'createNote'
    | 'selectNextNote'
    | 'selectPrevNote'
    | 'toggleSidebar'
    | 'toggleEditorMode'
    | 'togglePreview'
    | 'openHelp'
    | 'renameSelected';
```

In the `SHORTCUTS` array, add this descriptor right after the `esc esc` row:

```ts
    {keys: 'esc esc', description: 'Focus search', group: 'Navigation'},
    {
        keys: "mod+'",
        description: 'Toggle the sidebar',
        group: 'Navigation',
        global: {trigger: 'mod', key: "'", action: 'toggleSidebar'},
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useShortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shortcuts.ts src/hooks/useShortcuts.test.tsx
git commit -m "feat(shortcuts): ⌘' toggles the sidebar"
```

(Note: a whole-project `npm run typecheck` now reports `Workspace.tsx` is missing the `toggleSidebar`
action — that's expected and fixed in Task 2. Don't run/insist on a clean full typecheck for this task.)

---

## Task 2: Top-bar toggle + Workspace/NoteList rework

This task is atomic (the type system links these files): it adds the top-bar toggle, rewires `Workspace`, and reverts the `NoteList` toggle together so the project type-checks again.

**Files:**
- Modify: `src/components/TopBar.tsx`, `src/components/Workspace.tsx`, `src/components/Workspace.css`, `src/components/NoteList.tsx`
- Test: `src/components/Workspace.test.tsx`, `src/components/NoteList.test.tsx`

- [ ] **Step 1: Write the failing Workspace tests**

In `src/components/Workspace.test.tsx`, replace the three existing sidebar tests (`'collapses the sidebar and persists it'`, `'restores the collapsed sidebar from localStorage'`, `'re-docks the sidebar from the pin toggle'`) with these three:

```tsx
    it('toggles the sidebar from the top bar and persists it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        await user.click(screen.getByLabelText('Toggle sidebar'));
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('true');
        await user.click(screen.getByLabelText('Toggle sidebar'));
        await waitFor(() => expect(document.querySelector('.workspace__body_collapsed')).toBeNull());
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('false');
    });

    it("toggles the sidebar with ⌘'", async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        await user.keyboard("{Meta>}'{/Meta}");
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
    });

    it('restores the collapsed sidebar from localStorage', async () => {
        localStorage.setItem('gravity-notes:sidebar-collapsed', 'true');
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull();
    });
```

(The `afterEach` that clears `gravity-notes:sidebar-collapsed` is already in this describe block — keep it.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: FAIL — there is no "Toggle sidebar" button yet.

- [ ] **Step 3: Add the toggle button to `TopBar`**

In `src/components/TopBar.tsx`, add `LayoutSideContent` to the icon import:

```ts
import {CircleQuestion, Folder, LayoutSideContent} from '@gravity-ui/icons';
```

Add two props to `TopBarProps` (place them right after `onChangeThemePref`):

```ts
    onChangeThemePref: (pref: ThemePref) => void;
    /** Whether the notes sidebar is collapsed. */
    collapsed: boolean;
    /** Toggle the sidebar collapsed/docked. */
    onToggleCollapsed: () => void;
```

Add `collapsed` and `onToggleCollapsed` to the destructured props in the `TopBar` function signature.

Render the toggle as the FIRST child of `<header className="topbar">` (before the search `TextInput`):

```tsx
        <header className="topbar">
            <Button
                view="flat"
                size="m"
                className="topbar__sidebar-toggle"
                onClick={onToggleCollapsed}
                aria-label="Toggle sidebar"
                title="Toggle sidebar (⌘')"
                aria-pressed={!collapsed}
            >
                <Icon data={LayoutSideContent} />
            </Button>
            <TextInput
                className="topbar__search"
                ...
```

- [ ] **Step 4: Rewire `Workspace` (pass to TopBar, drop the reveal button, wire the shortcut)**

In `src/components/Workspace.tsx`, add `toggleSidebar` to the `useShortcuts({…})` call (after `selectPrevNote`):

```ts
        selectNextNote: () => browseRelative(1),
        selectPrevNote: () => browseRelative(-1),
        toggleSidebar: toggleCollapsed,
```

Pass the two props to `<TopBar>` (add after `onChangeThemePref`):

```tsx
                onChangeThemePref={onChangeThemePref}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
```

Replace the body wrapper + reveal button + sidebar opening:

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
```

with (drop the reveal button):

```tsx
            <div className={'workspace__body' + (collapsed ? ' workspace__body_collapsed' : '')}>
                <aside className="workspace__sidebar">
                    <NoteList
```

Remove the two NoteList props — delete these lines from the `<NoteList>` element:

```tsx
                        collapsed={collapsed}
                        onToggleCollapsed={toggleCollapsed}
```

- [ ] **Step 5: Simplify the collapsed CSS in `Workspace.css`**

In `src/components/Workspace.css`, revert `.workspace__body` to drop the now-unneeded stacking context — replace:

```css
.workspace__body {
    display: flex;
    flex: 1;
    min-height: 0;
    /* Stacking context for the collapsed-sidebar overlay (see below). */
    position: relative;
}
```

with:

```css
.workspace__body {
    display: flex;
    flex: 1;
    min-height: 0;
}
```

Replace the entire collapsed-overlay block (the comment + `.workspace__body_collapsed .workspace__sidebar` overlay rule, the `:hover ~` / `:focus-visible ~` / `:hover` peek rules, and the `.workspace__sidebar-reveal` / `:hover` / `:focus-visible` rules) with a single rule:

```css
/* Collapsed: the sidebar is simply hidden (kept mounted) and the editor fills the width. */
.workspace__body_collapsed .workspace__sidebar {
    display: none;
}
```

- [ ] **Step 6: Revert the `NoteList` toggle**

In `src/components/NoteList.tsx`, remove `ChevronLeft`/`ChevronRight` — replace the multi-line icon import:

```ts
import {
    ChevronLeft,
    ChevronRight,
    Ellipsis,
    Pencil,
    Pin,
    PinFill,
    PinSlash,
    Plus,
    TrashBin,
} from '@gravity-ui/icons';
```

with the single line (Prettier collapses the 7 remaining names to one line — write it as one line to avoid a `prettier/prettier` error):

```ts
import {Ellipsis, Pencil, Pin, PinFill, PinSlash, Plus, TrashBin} from '@gravity-ui/icons';
```

Remove the two props from `NoteListProps`:

```ts
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
    /** Whether the sidebar is collapsed (changes the toolbar toggle's icon/label). */
    collapsed: boolean;
    /** Toggle the sidebar between docked and collapsed. */
    onToggleCollapsed: () => void;
}
```

→

```ts
    pinnedIds: readonly string[];
    onTogglePin: (id: string) => void;
}
```

Remove `collapsed,` and `onToggleCollapsed,` from the destructured props in the `NoteList` function signature.

Remove the toggle `<Button>` from the toolbar — delete this block (the first child of `.note-list__toolbar`):

```tsx
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
```

(The `<Select>` becomes the first child of `.note-list__toolbar` again.)

In `src/components/NoteList.test.tsx`, remove the two reverted entries from the `setup` `props` object:

```ts
        pinnedIds: [],
        onTogglePin: vi.fn(),
        collapsed: false,
        onToggleCollapsed: vi.fn(),
        ...overrides,
```

→

```ts
        pinnedIds: [],
        onTogglePin: vi.fn(),
        ...overrides,
```

- [ ] **Step 7: Run the tests + full suite + typecheck**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green / clean — the three new Workspace sidebar tests pass, `NoteList` tests pass without the reverted props, and the whole project type-checks (Workspace now provides `toggleSidebar` and the TopBar props; NoteList no longer requires the reverted props).

- [ ] **Step 8: Commit**

```bash
git add src/components/TopBar.tsx src/components/Workspace.tsx src/components/Workspace.css src/components/NoteList.tsx src/components/Workspace.test.tsx src/components/NoteList.test.tsx
git commit -m "feat(sidebar): top-bar LayoutSideContent toggle + ⌘'; drop the hover-peek"
```

---

## Task 3: Unpin the title + end-of-note scroll room

**Files:**
- Modify: `src/components/EditorPane.css`, `src/components/Workspace.css`

Pure-CSS/layout; the gate is lint + build, then the manual smoke test (the title-scroll restructure is confirmed live). NOTE: `EditorPane.css` carries an uncommitted user tweak (`line-height: 1.3` on the `:where(p, li)` rule) — **preserve it** (do not revert); it rides along in this commit.

- [ ] **Step 1: Move the scroll to `.editor-pane` so the title scrolls away**

In `src/components/EditorPane.css`, change the `.editor-pane` rule to make the pane the scroll container — replace:

```css
.editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
```

with:

```css
.editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* The pane is the scroller, so the title (its first child) scrolls away with the body. */
    overflow-y: auto;
}
```

And change `.editor-pane__body` so it grows to content (no internal scroll) — replace:

```css
.editor-pane__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}
```

with:

```css
.editor-pane__body {
    /* Grow to fill a short note (whole area stays click-to-focus); a tall note overflows the
       pane, which scrolls — carrying the title up out of view. */
    flex: 1 0 auto;
}
```

- [ ] **Step 2: Add ~300px end-of-note scroll room**

In `src/components/Workspace.css`, change the editor content padding on `.workspace__editor` — replace:

```css
    --g-md-editor-padding: 4px 16px 8px 16px;
```

with:

```css
    /* ~300px bottom room so you can write near the end and scroll past the last line; the
       padding is inside the editor content, so clicking it lands the caret at the end. */
    --g-md-editor-padding: 4px 16px 300px 16px;
```

- [ ] **Step 3: Verify it builds, lints, and tests pass**

Run: `npm run lint && npm test && npm run build`
Expected: clean / all green (no test asserts these CSS values; the editor is mocked in component tests). The visual result — the title scrolling away and the end room — is confirmed in Task 4's smoke test, where the exact 300px / scroll behavior is tuned.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditorPane.css src/components/Workspace.css
git commit -m "style(editor): unpin the title (scrolls with content) + ~300px end room"
```

(This commit also captures the pending `line-height: 1.3` tweak in `EditorPane.css` — that's intended.)

---

## Task 4: Docs + full verification + manual smoke

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the `CLAUDE.md` roadmap**

In `CLAUDE.md`, under roadmap item 3, add a sub-bullet after the "UX polish batch" entry:

```markdown
   - ✅ **Sidebar toggle + editor scroll** — replaced the sidebar hover-peek with an always-visible
     top-bar `LayoutSideContent` toggle + a ⌘' shortcut (collapsed simply hides it); unpinned the note
     title so it scrolls with the content, with ~300px of end-of-note scroll room.
     Spec: `docs/superpowers/specs/2026-06-21-sidebar-toggle-editor-scroll-design.md`.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all green — full Vitest suite passes, ESLint clean, `tsc` + Vite build succeed.

- [ ] **Step 3: Manual Chromium smoke test**

Run `npm run dev`, open in Chrome, pick a folder, and verify:
- The **top-left toggle** (LayoutSideContent icon) collapses the sidebar (editor fills the width) and
  brings it back — and **⌘'** does the same from anywhere, including mid-edit. No overlay, no hover.
- The collapsed state **survives a reload**.
- The **note title scrolls away** as you scroll a long note (it's no longer pinned), and there's
  comfortable **room past the last line** — clicking that empty space drops the caret at the end. Tune
  the `300px` / scroll feel in `EditorPane.css` / `Workspace.css` if needed.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: roadmap note for the sidebar toggle + editor scroll"
```

---

## Self-review notes (for the implementer)

- **The toggle button is named "Toggle sidebar" (no "notes")** on purpose — a "…notes…" name would
  collide with the existing `getByRole('button', {name: /notes/i})` (folder button) query in the
  "Escape from the top bar" Workspace test.
- **`mod` bindings fire while typing** (`useShortcuts`), so ⌘' works from the editor; it also
  `preventDefault`s. ⌘' is free (the editor's blockquote shortcut is ⌘⇧.).
- **Task 2 is atomic** because the props/actions are type-linked across `shortcuts`/`TopBar`/`Workspace`/
  `NoteList`; splitting it further would leave the project type-broken between commits.
- **Collapsed keeps the sidebar mounted** (`display: none`), so the list state survives a collapse and
  jsdom still sees it — that's why the tests assert the `.workspace__body_collapsed` class +
  localStorage, not the absence of the list.
- **Item 5 (unpin title) is the risky bit** — if the editor fights the outer scroll, the smoke test will
  show it; the fallback is a wrapper that contains the title + editor and scrolls them together.
- **README + the pending `EditorPane.css` 1.3 tweak are the user's** — preserve the 1.3 (Task 3), don't
  touch README.
