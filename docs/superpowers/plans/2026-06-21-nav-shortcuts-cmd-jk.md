# Global ⌘J/⌘K Note Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ⌘J/⌘K browse to the next/previous note from anywhere (preview semantics, like ↓/↑ in the list), move insert-link to ⇧⌘K, and move new-note to ⌘Enter.

**Architecture:** The global shortcut layer is descriptor-driven — `SHORTCUTS` (`src/shortcuts.ts`) is the single source of truth for both `useShortcuts` (the document-level handler) and the help dialog. We add two `mod` bindings + two action names, relocate new-note to `mod+enter`, free ⌘K by re-binding the editor's link key via the supported `wysiwygConfig.extensionOptions.link.linkKey` option, and wire a `browseRelative` helper in `Workspace` that reuses the existing browse-and-focus-row path.

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/markdown-editor` (v15.41.0, `linkKey` option), Vitest + Testing Library.

---

## File structure

- `src/shortcuts.ts` — **modify**: `ShortcutAction` union + `SHORTCUTS` descriptors (the SSOT).
- `src/hooks/useShortcuts.test.tsx` — **modify**: new/changed binding tests + `makeActions`.
- `src/hooks/useShortcuts.ts` — **no change** (descriptor-driven; `ShortcutActions` auto-derives).
- `src/components/Workspace.tsx` — **modify**: `browseRelative` helper + wire the two actions.
- `src/components/Workspace.test.tsx` — **modify**: ⌘J/⌘K/⌘Enter integration tests.
- `src/components/EditorPane.tsx` — **modify**: one `wysiwygConfig` line (re-bind link to ⇧⌘K).
- `src/components/ShortcutsDialog.test.tsx` — **verify** it still passes (likely no change).
- `CLAUDE.md` — **modify**: roadmap note (Task 4).

---

## Task 1: `shortcuts.ts` — actions + descriptors

**Files:**
- Modify: `src/shortcuts.ts`
- Test: `src/hooks/useShortcuts.test.tsx`

- [ ] **Step 1: Update the tests**

In `src/hooks/useShortcuts.test.tsx`, update `makeActions` to include the two new actions — replace:

```ts
function makeActions(): ShortcutActions {
    return {
        createNote: vi.fn(),
        toggleEditorMode: vi.fn(),
        togglePreview: vi.fn(),
        openHelp: vi.fn(),
        renameSelected: vi.fn(),
    };
}
```

with:

```ts
function makeActions(): ShortcutActions {
    return {
        createNote: vi.fn(),
        selectNextNote: vi.fn(),
        selectPrevNote: vi.fn(),
        toggleEditorMode: vi.fn(),
        togglePreview: vi.fn(),
        openHelp: vi.fn(),
        renameSelected: vi.fn(),
    };
}
```

Replace the `'creates a note on ctrl+j'` test with three tests (next/prev nav + the relocated create):

```ts
    it('selects the next note on ctrl+j', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        expect(actions.selectNextNote).toHaveBeenCalledTimes(1);
        expect(actions.createNote).not.toHaveBeenCalled();
    });

    it('selects the previous note on ctrl+k', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'k', ctrlKey: true});
        expect(actions.selectPrevNote).toHaveBeenCalledTimes(1);
    });

    it('creates a note on ctrl+enter', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'Enter', ctrlKey: true});
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });
```

Update the auto-repeat test (it uses ctrl+j, which now navigates) — replace the whole block:

```ts
    it('ignores auto-repeat so a held key fires once', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        press({key: 'j', ctrlKey: true, repeat: true});
        press({key: 'j', ctrlKey: true, repeat: true});
        expect(actions.createNote).toHaveBeenCalledTimes(1);
    });
```

with:

```ts
    it('ignores auto-repeat so a held key fires once', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        press({key: 'j', ctrlKey: true});
        press({key: 'j', ctrlKey: true, repeat: true});
        press({key: 'j', ctrlKey: true, repeat: true});
        expect(actions.selectNextNote).toHaveBeenCalledTimes(1);
    });
```

Replace the `'still creates a note on ctrl+j while typing in an input'` test with:

```ts
    it('still navigates on ctrl+j while typing in an input', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        press({key: 'j', ctrlKey: true});
        expect(actions.selectNextNote).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useShortcuts.test.tsx`
Expected: FAIL — `selectNextNote`/`selectPrevNote` are never called (ctrl+j still maps to `createNote`); `createNote` not fired on ctrl+enter.

- [ ] **Step 3: Add the action names**

In `src/shortcuts.ts`, replace the `ShortcutAction` type:

```ts
export type ShortcutAction =
    | 'createNote'
    | 'toggleEditorMode'
    | 'togglePreview'
    | 'openHelp'
    | 'renameSelected';
```

with:

```ts
export type ShortcutAction =
    | 'createNote'
    | 'selectNextNote'
    | 'selectPrevNote'
    | 'toggleEditorMode'
    | 'togglePreview'
    | 'openHelp'
    | 'renameSelected';
```

- [ ] **Step 4: Update the descriptors**

In `src/shortcuts.ts`, in the `SHORTCUTS` array, add the two nav bindings right after the `down` row:

```ts
    {keys: 'down', description: 'Preview next note (or j)', group: 'Navigation'},
    {
        keys: 'mod+j',
        description: 'Next note (works while editing)',
        group: 'Navigation',
        global: {trigger: 'mod', key: 'j', action: 'selectNextNote'},
    },
    {
        keys: 'mod+k',
        description: 'Previous note (works while editing)',
        group: 'Navigation',
        global: {trigger: 'mod', key: 'k', action: 'selectPrevNote'},
    },
```

Update the comment above the `esc esc` row (⌘K is no longer reserved for the editor) — replace:

```ts
    // No global binding: focusing search is the tail of the Esc ladder (escapeList focuses
    // the search box). ⌘K is deliberately left to the editor's insert-link command.
    {keys: 'esc esc', description: 'Focus search', group: 'Navigation'},
```

with:

```ts
    // No global binding: focusing search is the tail of the Esc ladder (escapeList focuses
    // the search box).
    {keys: 'esc esc', description: 'Focus search', group: 'Navigation'},
```

Replace the `mod+j` → New-note descriptor:

```ts
    {
        keys: 'mod+j',
        description: 'New note',
        group: 'Editing',
        global: {trigger: 'mod', key: 'j', action: 'createNote'},
    },
```

with the relocated `mod+enter`:

```ts
    {
        keys: 'mod+enter',
        description: 'New note',
        group: 'Editing',
        global: {trigger: 'mod', key: 'Enter', action: 'createNote'},
    },
```

Add a display-only help row for the relocated link key, right after the `mod+shift+p` (toggle preview) descriptor:

```ts
    {
        keys: 'mod+shift+p',
        description: 'Toggle read-only preview',
        group: 'Editing',
        global: {trigger: 'mod', key: 'p', action: 'togglePreview', shift: true},
    },
    {keys: 'mod+shift+k', description: 'Insert link (in the editor)', group: 'Editing'},
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useShortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean — `ShortcutActions` (`Record<ShortcutAction, () => void>`) now requires the two new keys, which `makeActions` provides. (`Workspace.tsx` is updated in Task 2; if you run this before Task 2 it will report `Workspace.tsx` is missing `selectNextNote`/`selectPrevNote` — that's expected until Task 2.)

- [ ] **Step 7: Commit**

```bash
git add src/shortcuts.ts src/hooks/useShortcuts.test.tsx
git commit -m "feat(shortcuts): ⌘J/⌘K nav actions + new-note on ⌘Enter"
```

---

## Task 2: `Workspace` — browseRelative + wiring

**Files:**
- Modify: `src/components/Workspace.tsx`
- Test: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Write the failing integration tests**

In `src/components/Workspace.test.tsx`, add these tests at the end of the `describe('Workspace — nvALT navigation', …)` block (before its closing `});`). The seeded notes are `Alpha` (updatedAt 100) and `Beta` (updatedAt 200), so updated-desc order is `[Beta, Alpha]`.

```tsx
    it('navigates to the next/previous note with ⌘J / ⌘K', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        await user.keyboard('{Meta>}j{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        await user.keyboard('{Meta>}k{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('⌘J navigates even while the title field is focused', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Beta/});
        await user.click(screen.getByRole('option', {name: /Beta/}));
        await waitFor(() => expect(screen.queryByText(/Select a note/)).not.toBeInTheDocument());
        screen.getByLabelText('Note title').focus();
        await user.keyboard('{Meta>}j{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Alpha/})).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
    });

    it('creates a note with ⌘Enter', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await user.keyboard('{Meta>}{Enter}{/Meta}');
        await waitFor(() =>
            expect(screen.getByRole('option', {name: /Untitled/})).toBeInTheDocument(),
        );
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: FAIL — the ⌘J/⌘K tests fail because `Workspace` doesn't wire `selectNextNote`/`selectPrevNote` yet (⌘J/⌘K do nothing). (The ⌘Enter test already passes once Task 1 is committed — `createNote` stays wired to `handleCreate`; only its key moved.)

- [ ] **Step 3: Add `browseRelative` and wire the actions**

In `src/components/Workspace.tsx`, add `browseRelative` right after the `enterList` callback:

```ts
    // Enter the list from the search box (↓/↑): preview the row and move DOM focus onto it.
    const enterList = useCallback(
        (id: string) => {
            nav.browse(id);
            listRef.current?.focusRow(id);
        },
        [nav],
    );

    // ⌘J / ⌘K: browse to the next / previous note in the current list, from anywhere. Mirrors
    // ↓/↑ in the list (preview + focus the row); clamps at the ends; picks the first/last when
    // nothing is selected yet.
    const browseRelative = useCallback(
        (delta: number) => {
            const ids = filteredNotes.map((n) => n.id);
            if (ids.length === 0) return;
            const current = nav.selectedId;
            let index: number;
            if (current && ids.includes(current)) {
                index = Math.min(Math.max(ids.indexOf(current) + delta, 0), ids.length - 1);
            } else {
                index = delta > 0 ? 0 : ids.length - 1;
            }
            const target = ids[index];
            if (target) enterList(target);
        },
        [filteredNotes, nav, enterList],
    );
```

In the `useShortcuts({…})` call, add the two actions after `createNote`:

```ts
    useShortcuts({
        createNote: handleCreate,
        selectNextNote: () => browseRelative(1),
        selectPrevNote: () => browseRelative(-1),
        toggleEditorMode: () => editorRef.current?.toggleMode(),
        togglePreview: () => setPreviewMode((p) => !p),
        openHelp: () => setHelpOpen(true),
        renameSelected: () => {
            if (nav.selectedId) listRef.current?.startRename(nav.selectedId);
        },
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: PASS (the three new tests + all existing nvALT tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (`Workspace` now provides `selectNextNote`/`selectPrevNote`).

- [ ] **Step 6: Commit**

```bash
git add src/components/Workspace.tsx src/components/Workspace.test.tsx
git commit -m "feat(workspace): wire ⌘J/⌘K global note navigation"
```

---

## Task 3: `EditorPane` — free ⌘K by re-binding link to ⇧⌘K

**Files:**
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Add the `wysiwygConfig` link re-bind**

In `src/components/EditorPane.tsx`, replace the `useMarkdownEditor` options:

```ts
    const editor = useMarkdownEditor(
        {
            md: {html: false},
            initial: {markup: note.content, mode: 'wysiwyg'},
        },
        [],
    );
```

with:

```ts
    const editor = useMarkdownEditor(
        {
            md: {html: false},
            initial: {markup: note.content, mode: 'wysiwyg'},
            // Move insert-link off ⌘K to ⇧⌘K so ⌘K is free for global note navigation.
            wysiwygConfig: {extensionOptions: {link: {linkKey: 'Mod-Shift-k'}}},
        },
        [],
    );
```

- [ ] **Step 2: Verify tests + types still pass**

Run: `npm test -- src/components/EditorPane.test.tsx && npm run typecheck`
Expected: PASS / clean. (The editor is mocked in tests, so the config is inert there; this is verified for real in Task 4's manual smoke test.)

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat(editor): re-bind insert-link to ⇧⌘K, freeing ⌘K for navigation"
```

---

## Task 4: Verify help dialog, docs, and manual smoke

**Files:**
- Verify: `src/components/ShortcutsDialog.test.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Confirm the help-dialog test passes unchanged**

The dialog renders from `SHORTCUTS`; the new rows have unique descriptions and the strings the test asserts (`'Edit the selected note (in the title → jump to the body)'`, `'Editor → list, then close (or clear search)'`) are unchanged.

Run: `npm test -- src/components/ShortcutsDialog.test.tsx`
Expected: PASS. If it fails because two descriptors now share identical text, give one a distinct description and re-run (none should — `'New note'` appears once).

- [ ] **Step 2: Update the `CLAUDE.md` roadmap**

In `CLAUDE.md`, under roadmap item 3, add a sub-bullet after the in-editor title-field entry:

```markdown
   - ✅ **Global ⌘J/⌘K navigation** — ⌘J/⌘K browse next/prev from anywhere (preview semantics);
     insert-link relocated to ⇧⌘K via the editor's `linkKey` option; new-note moved to ⌘Enter.
     Spec: `docs/superpowers/specs/2026-06-21-nav-shortcuts-cmd-jk-design.md`.
```

- [ ] **Step 3: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all green — full Vitest suite passes, ESLint clean (Prettier included), `tsc` + Vite build succeed.

- [ ] **Step 4: Manual Chromium smoke test**

Run `npm run dev`, open in Chrome, pick a folder, and verify:
- **⌘J / ⌘K** move the selection/preview to the next / previous note — including **while the editor is focused** (focus jumps to the list row; the note previews). They stop at the ends (no wrap).
- **⌘K does NOT open a link popup** anymore; **⇧⌘K opens the link form** in the editor.
- **⌘Enter** creates a new note (caret lands in its title) — including from within the editor.
- The help dialog (`?`) lists the ⌘J / ⌘K / ⌘Enter / ⇧⌘K rows.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(shortcuts): roadmap note for global ⌘J/⌘K navigation"
```

---

## Self-review notes (for the implementer)

- **`mod` bindings fire while typing by default.** `useShortcuts` computes `allowInTyping = binding.inTyping ?? binding.trigger === 'mod'`, so ⌘J/⌘K/⌘Enter work inside the editor/inputs without setting `inTyping` explicitly. They also `preventDefault`, so ⌘J won't trigger the browser's download shelf.
- **Navigation reuses the proven path.** `browseRelative` → `enterList` → `nav.browse` (which flushes the outgoing note's pending edit in `useNotes.open`) → `listRef.focusRow`. No new save/flush logic.
- **The link re-bind is config, not code we can unit-test** (the editor is mocked in jsdom and can't mount for real). Its correctness rests on the Task 4 manual smoke test.
- **README is intentionally untouched** — it has unrelated uncommitted user edits.
