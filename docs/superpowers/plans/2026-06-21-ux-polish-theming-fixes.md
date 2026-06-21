# UX Polish, Theming & Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the README "Small design things" (editor/theme polish) + the three bugs (F2, ⌘K, rename-collision) on the `remove-tabs-nvalt` branch, without regressing the nvALT flow.

**Architecture:** Logic changes are TDD'd (shortcut gating, F2 routing, rename collision, theme preference); visual changes (editor CSS, blue accent) are best-effort CSS verified by a manual Chromium smoke. One unified `inTyping` flag on shortcut bindings fixes both F2 and ⌘K. Theme uses Gravity UI's **native** `theme='system'` support (no custom matchMedia hook).

**Tech Stack:** React 18 + TypeScript (strict), Vite, Vitest + Testing Library + jsdom, Gravity UI (`@gravity-ui/uikit`, `@gravity-ui/markdown-editor`, `@gravity-ui/icons`), File System Access API behind `NoteStore`.

**Spec:** `docs/superpowers/specs/2026-06-21-ux-polish-theming-fixes-design.md`

**Conventions:** 4-space indent + single quotes (run `npm run lint:fix` after pasting the 2-space code blocks). `void promise()` for intentional unawaited promises. **Git safety:** stay on `remove-tabs-nvalt`; never run `git checkout`/`switch`/`reset`/`branch`/`stash`; only `git add <specific files>` + `git commit`. Do **not** stage `README.md` except where a task says so (it holds the user's WIP). End every commit message with:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## Task 1: Shortcut typing-gate + ⌘K fix

Add an `inTyping` flag to shortcut bindings so ⌘K yields to the editor's insert-link while editing, without changing any other shortcut's behavior. Pure logic.

**Files:**

- Modify: `src/shortcuts.ts`
- Modify: `src/hooks/useShortcuts.ts`
- Modify: `src/hooks/useShortcuts.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/hooks/useShortcuts.test.tsx`, add these two tests inside the `describe('useShortcuts', …)` block:

```tsx
it('does not focus search on mod+k while typing in an input', () => {
  const actions = makeActions();
  renderHook(() => useShortcuts(actions));
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  press({key: 'k', metaKey: true});
  expect(actions.focusSearch).not.toHaveBeenCalled();
});

it('still creates a note on ctrl+j while typing in an input', () => {
  const actions = makeActions();
  renderHook(() => useShortcuts(actions));
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  press({key: 'j', ctrlKey: true});
  expect(actions.createNote).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useShortcuts.test.tsx`
Expected: FAIL — `does not focus search…` fails (⌘K currently fires regardless of focus).

- [ ] **Step 3: Add the `inTyping` flag to the binding type + gate ⌘K**

In `src/shortcuts.ts`, extend `GlobalBinding` and set `inTyping: false` on the `mod+k` binding:

```ts
/** How a globally-handled shortcut maps to a key event. */
export interface GlobalBinding {
  /** 'mod' = ⌘/Ctrl combo; 'bare' = the key alone. */
  trigger: 'mod' | 'bare';
  /** `event.key` to match. For the 'mod' trigger the comparison is case-insensitive. */
  key: string;
  /** Which action to fire. */
  action: ShortcutAction;
  /** May fire while a typing surface (input/textarea/contenteditable) is focused. Default: mod→true, bare→false. */
  inTyping?: boolean;
}
```

And the `mod+k` row's `global`:

```ts
        global: {trigger: 'mod', key: 'k', action: 'focusSearch', inTyping: false},
```

- [ ] **Step 4: Apply the gate in the handler**

In `src/hooks/useShortcuts.ts`, replace the body of the `onKeyDown` loop so every binding respects `inTyping`:

```ts
const onKeyDown = (event: KeyboardEvent) => {
  if (event.repeat) return; // a held key shouldn't fire the action repeatedly
  const mod = event.metaKey || event.ctrlKey;
  const typing = isTypingTarget(document.activeElement);
  for (const {global: binding} of SHORTCUTS) {
    if (!binding) continue;
    const allowInTyping = binding.inTyping ?? binding.trigger === 'mod';
    if (typing && !allowInTyping) continue;
    if (binding.trigger === 'mod') {
      if (
        mod &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === binding.key.toLowerCase()
      ) {
        event.preventDefault();
        actionsRef.current[binding.action]();
        return;
      }
    } else if (event.key === binding.key) {
      event.preventDefault();
      actionsRef.current[binding.action]();
      return;
    }
  }
};
```

(The bare-key path no longer re-checks `isTypingTarget` inline — the unified `typing && !allowInTyping` guard above handles it, preserving the `?` gating because bare defaults to `inTyping: false`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useShortcuts.test.tsx`
Expected: PASS (all, including the existing `mod+k` from-body and `?`-gating tests).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/shortcuts.ts src/hooks/useShortcuts.ts src/hooks/useShortcuts.test.tsx
git commit -m "$(cat <<'EOF'
fix(shortcuts): add inTyping gate so cmd+K yields to the editor's insert-link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: F2 renames the selected note from anywhere

Make F2 a global shortcut that renames `nav.selectedId` via a new `NoteList.startRename(id)` handle, and remove the row-only F2 so there's a single path.

**Files:**

- Modify: `src/shortcuts.ts` (add the `renameSelected` action + F2 global binding)
- Modify: `src/hooks/useShortcuts.test.tsx` (extend `makeActions` + add an F2 test)
- Modify: `src/components/NoteList.tsx` (handle `startRename`; rename local helper; drop row F2)
- Modify: `src/components/NoteList.test.tsx`
- Modify: `src/components/Workspace.tsx` (wire `renameSelected`)
- Modify: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Write the failing shortcut test**

In `src/hooks/useShortcuts.test.tsx`, update `makeActions` to include the new action, and add an F2 test:

```tsx
function makeActions(): ShortcutActions {
  return {
    focusSearch: vi.fn(),
    createNote: vi.fn(),
    toggleEditorMode: vi.fn(),
    openHelp: vi.fn(),
    renameSelected: vi.fn(),
  };
}
```

```tsx
it('renames the selected note on F2, even while typing in an input', () => {
  const actions = makeActions();
  renderHook(() => useShortcuts(actions));
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  press({key: 'F2'});
  expect(actions.renameSelected).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useShortcuts.test.tsx`
Expected: FAIL — `renameSelected` is not a valid `ShortcutAction` yet (type error) / F2 has no binding.

- [ ] **Step 3: Add the action + F2 binding**

In `src/shortcuts.ts`:

```ts
/** The set of actions the global keyboard handler can invoke. */
export type ShortcutAction =
  | 'focusSearch'
  | 'createNote'
  | 'toggleEditorMode'
  | 'openHelp'
  | 'renameSelected';
```

And give the existing `f2` row a `global` binding (it was list-scoped before):

```ts
    {
        keys: 'f2',
        description: 'Rename selected note',
        group: 'Editing',
        global: {trigger: 'bare', key: 'F2', action: 'renameSelected', inTyping: true},
    },
```

- [ ] **Step 4: Run the shortcut test to verify it passes**

Run: `npx vitest run src/hooks/useShortcuts.test.tsx`
Expected: PASS. (`ShortcutActions` is `Record<ShortcutAction, () => void>`, so it now requires `renameSelected` — provided by `makeActions`.)

- [ ] **Step 5: Write the failing NoteList handle test**

In `src/components/NoteList.test.tsx`, add an import for `act` (from `@testing-library/react`) if not present, and replace the existing **"renames via F2 and commits on Enter"** test with a handle-driven one:

```tsx
it('renames via the startRename handle and commits on Enter', async () => {
  const user = userEvent.setup();
  const {ref, props} = setup({selectedId: 'Alpha.md'});
  act(() => {
    ref.current?.startRename('Alpha.md');
  });
  const input = screen.getByDisplayValue('Alpha');
  await user.clear(input);
  await user.type(input, 'Renamed{Enter}');
  expect(props.onRename).toHaveBeenCalledWith('Alpha.md', 'Renamed');
  expect(props.onRename).toHaveBeenCalledTimes(1);
});
```

The top imports become:

```tsx
import {createRef} from 'react';

import {act, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/NoteList.test.tsx`
Expected: FAIL — `startRename` is not on `NoteListHandle`.

- [ ] **Step 7: Implement `startRename` on NoteList + drop row F2**

In `src/components/NoteList.tsx`:

1. Extend the handle interface:

```ts
export interface NoteListHandle {
  /** Move keyboard focus to the selected row (used when leaving the editor). */
  focusSelected(): void;
  /** Begin inline-renaming the given note (used by the global F2 shortcut). */
  startRename(id: string): void;
}
```

2. Rename the local helper `startRename` → `beginRename` (to free the name for the handle). The definition:

```ts
const beginRename = (note: NoteMeta) => {
  setEditValue(note.title);
  setEditingId(note.id);
};
```

Update its two call sites — the double-click handler `onDoubleClick={() => beginRename(note)}` and the dropdown "Rename" item `action: () => beginRename(note)`.

3. Expand the imperative handle:

```ts
useImperativeHandle(
  ref,
  () => ({
    focusSelected() {
      if (focusableId) itemRefs.current.get(focusableId)?.focus();
    },
    startRename(id: string) {
      const note = notes.find((n) => n.id === id);
      if (note) beginRename(note);
    },
  }),
  [focusableId, notes],
);
```

4. In `onItemKeyDown`, **remove** the `case 'F2':` block entirely (F2 is now global).

- [ ] **Step 8: Run the NoteList tests to verify they pass**

Run: `npx vitest run src/components/NoteList.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing Workspace F2 test**

In `src/components/Workspace.test.tsx`, add inside `describe('Workspace — nvALT navigation', …)`:

```tsx
it('F2 renames the selected note', async () => {
  const user = userEvent.setup();
  renderWorkspace();
  await screen.findByRole('option', {name: /Beta/});
  await user.click(screen.getByRole('option', {name: /Beta/}));
  await waitFor(() =>
    expect(screen.getByRole('option', {name: /Beta/})).toHaveAttribute('aria-selected', 'true'),
  );
  await user.keyboard('{F2}');
  expect(await screen.findByDisplayValue('Beta')).toBeInTheDocument();
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run src/components/Workspace.test.tsx`
Expected: FAIL — F2 does nothing (Workspace doesn't wire `renameSelected` yet).

- [ ] **Step 11: Wire `renameSelected` in Workspace**

In `src/components/Workspace.tsx`, extend the `useShortcuts({...})` call:

```ts
useShortcuts({
  focusSearch: () => searchInputRef.current?.focus(),
  createNote: handleCreate,
  toggleEditorMode: () => editorRef.current?.toggleMode(),
  openHelp: () => setHelpOpen(true),
  renameSelected: () => {
    if (nav.selectedId) listRef.current?.startRename(nav.selectedId);
  },
});
```

- [ ] **Step 12: Run the full gate + commit**

```bash
npx vitest run src/components/Workspace.test.tsx
npm run typecheck && npm run lint && npm test && npm run build
git add src/shortcuts.ts src/hooks/useShortcuts.test.tsx src/components/NoteList.tsx src/components/NoteList.test.tsx src/components/Workspace.tsx src/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
fix(shortcuts): F2 renames the selected note from anywhere

Global F2 -> NoteList.startRename(selectedId); the row-local F2 handler is
removed so there is one path. Works regardless of where focus sits.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rename-to-existing is a no-op

Stop `rename` from auto-numbering when the target name is taken by a different note; return the note unchanged instead.

**Files:**

- Modify: `src/storage/fileSystemStore.ts`
- Modify: `src/storage/fileSystemStore.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/storage/fileSystemStore.test.ts`, add a `describe` block (the file already imports `FakeDirectoryHandle`, `asDirectoryHandle`, `FileSystemNoteStore`):

```ts
describe('rename — collisions', () => {
  it('renames to a free name', async () => {
    dir.seedFile('Old.md', 'body', 100);
    const meta = await store.rename('Old.md', 'New');
    expect(meta.id).toBe('New.md');
    expect((await store.get('New.md')).content).toBe('body');
    expect(await store.stat('Old.md')).toBeNull();
  });

  it('is a no-op when the target name is taken by another note', async () => {
    dir.seedFile('Old.md', 'mine', 100);
    dir.seedFile('Taken.md', 'theirs', 200);
    const meta = await store.rename('Old.md', 'Taken');
    // Unchanged: same id/title, no auto-numbered "Taken 2.md", both files intact.
    expect(meta.id).toBe('Old.md');
    expect(await store.stat('Old.md')).not.toBeNull();
    expect(await store.stat('Taken 2.md')).toBeNull();
    expect((await store.get('Old.md')).content).toBe('mine');
    expect((await store.get('Taken.md')).content).toBe('theirs');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/storage/fileSystemStore.test.ts`
Expected: FAIL — the no-op test fails (today it creates `Taken 2.md` and returns that id).

- [ ] **Step 3: Make rename no-op on collision**

In `src/storage/fileSystemStore.ts`, replace the body of `rename` so it checks for an existing target and does not auto-number:

```ts
    async rename(id: string, nextTitle: string): Promise<NoteMeta> {
        const base = sanitizeTitle(nextTitle);
        const nextName = base + MD_EXT;
        if (nextName === id) {
            return {id, title: titleFromFileName(id)};
        }
        // Renaming onto another note's name does nothing (no auto-numbered copy).
        if (await this.exists(nextName)) {
            return {id, title: titleFromFileName(id)};
        }
        // The File System Access API has no atomic rename: copy to the new file,
        // then delete the old one.
        const content = (await this.get(id)).content;
        const handle = await this.dir.getFileHandle(nextName, {create: true});
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        await this.dir.removeEntry(id);
        return {id: nextName, title: titleFromFileName(nextName), updatedAt: Date.now()};
    }
```

(`create` still uses `uniqueFileName` — auto-numbering is correct there.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/storage/fileSystemStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/storage/fileSystemStore.ts src/storage/fileSystemStore.test.ts
git commit -m "$(cat <<'EOF'
fix(storage): rename onto an existing note's name is a no-op

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Three-way Light / Dark / System theme

Replace the 2-way Sun/Moon toggle with a Light/Dark/System dropdown, using Gravity UI's **native** `theme='system'` (it resolves + live-tracks the OS scheme internally — no matchMedia hook needed).

**Files:**

- Create: `src/components/ThemeSwitcher.tsx`
- Create: `src/components/ThemeSwitcher.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Write the failing ThemeSwitcher test**

Create `src/components/ThemeSwitcher.test.tsx`:

```tsx
import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {ThemeSwitcher} from './ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('calls onChange with the chosen preference', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ThemeSwitcher pref="system" onChange={onChange} />);
    await user.click(screen.getByRole('button', {name: 'Theme'}));
    await user.click(await screen.findByRole('menuitem', {name: 'Dark'}));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ThemeSwitcher.test.tsx`
Expected: FAIL — `ThemeSwitcher` does not exist.

- [ ] **Step 3: Implement `ThemeSwitcher`**

Create `src/components/ThemeSwitcher.tsx`:

```tsx
import {Display, Moon, Sun} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon} from '@gravity-ui/uikit';

export type ThemePref = 'light' | 'dark' | 'system';

const OPTIONS: {value: ThemePref; label: string; icon: typeof Sun}[] = [
  {value: 'light', label: 'Light', icon: Sun},
  {value: 'dark', label: 'Dark', icon: Moon},
  {value: 'system', label: 'System', icon: Display},
];

interface ThemeSwitcherProps {
  pref: ThemePref;
  onChange: (pref: ThemePref) => void;
}

/** Header control to pick Light / Dark / System; System follows the OS scheme (handled by ThemeProvider). */
export function ThemeSwitcher({pref, onChange}: ThemeSwitcherProps) {
  const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[2];
  return (
    <DropdownMenu
      renderSwitcher={(props) => (
        <Button {...props} view="flat" size="m" title="Theme">
          <Icon data={current.icon} />
        </Button>
      )}
      items={OPTIONS.map((o) => ({
        text: o.label,
        iconStart: <Icon data={o.icon} />,
        action: () => onChange(o.value),
      }))}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ThemeSwitcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the preference in `App.tsx`**

Replace `src/App.tsx` with the 3-way preference (persisted; passed straight to `ThemeProvider`, which resolves `system`):

```tsx
import {useEffect, useState} from 'react';

import {
  MobileProvider,
  ThemeProvider,
  Toaster,
  ToasterComponent,
  ToasterProvider,
} from '@gravity-ui/uikit';

import {FolderGate} from './components/FolderGate';
import type {ThemePref} from './components/ThemeSwitcher';
import {Workspace} from './components/Workspace';
import {useNotesFolder} from './hooks/useNotesFolder';

const toaster = new Toaster();

const THEME_KEY = 'gravity-notes:theme';

function initialTheme(): ThemePref {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export function App() {
  const [themePref, setThemePref] = useState<ThemePref>(initialTheme);
  const folder = useNotesFolder();

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themePref);
  }, [themePref]);

  return (
    <ThemeProvider theme={themePref}>
      <MobileProvider>
        <ToasterProvider toaster={toaster}>
          {folder.state === 'ready' && folder.dir ? (
            <Workspace
              dir={folder.dir}
              folderName={folder.folderName}
              themePref={themePref}
              onChangeThemePref={setThemePref}
              onChangeFolder={() => void folder.forgetFolder()}
            />
          ) : (
            <FolderGate folder={folder} />
          )}
          <ToasterComponent />
        </ToasterProvider>
      </MobileProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Swap the header control in `Workspace.tsx`**

In `src/components/Workspace.tsx`:

1. Imports: drop `Moon, Sun` (now only used by `ThemeSwitcher`) and the `type Theme` (no longer used):

```ts
import {CircleQuestion, Folder} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, useToaster} from '@gravity-ui/uikit';
```

Add:

```ts
import {ThemeSwitcher, type ThemePref} from './ThemeSwitcher';
```

2. `WorkspaceProps`: replace the theme fields:

```ts
interface WorkspaceProps {
  dir: FileSystemDirectoryHandle;
  folderName: string | null;
  themePref: ThemePref;
  onChangeThemePref: (pref: ThemePref) => void;
  onChangeFolder: () => void;
}
```

3. Destructure `{dir, folderName, themePref, onChangeThemePref, onChangeFolder}` in the function signature.

4. In the header-right block, replace the theme toggle `<Button …><Icon data={theme === 'dark' ? Sun : Moon} /></Button>` with:

```tsx
<ThemeSwitcher pref={themePref} onChange={onChangeThemePref} />
```

- [ ] **Step 7: Update the Workspace test props**

In `src/components/Workspace.test.tsx`, in the `renderWorkspace` helper, change the two theme props:

```tsx
renderWithProviders(
  <Workspace
    dir={asDirectoryHandle(dir)}
    folderName="notes"
    themePref="light"
    onChangeThemePref={vi.fn()}
    onChangeFolder={vi.fn()}
  />,
);
```

- [ ] **Step 8: Run the full gate + commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/components/ThemeSwitcher.tsx src/components/ThemeSwitcher.test.tsx src/App.tsx src/components/Workspace.tsx src/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
feat(theme): three-way Light / Dark / System switcher

Uses Gravity UI's native theme="system" (resolves + tracks the OS scheme);
persists the preference. Header dropdown replaces the 2-way toggle.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Blue accent (manual-verify)

Re-brand Gravity's accent from yellow-orange to blue via CSS-variable overrides. No unit test — visual, verified in Task 7's smoke.

**Files:**

- Modify: `src/index.css`

- [ ] **Step 1: Override the brand variables**

Append to `src/index.css` (the `.g-root` theme element carries the brand vars; this loads after the uikit styles, so it wins). The private blue scale is theme-aware, so one block serves light + dark:

```css
/* Accent: blue instead of Gravity's default yellow-orange. The private blue scale
   resolves per-theme, so this serves both light and dark. (Visual — smoke-tested.) */
.g-root {
  --g-color-base-brand: var(--g-color-private-blue-550-solid);
  --g-color-base-brand-hover: var(--g-color-private-blue-600-solid);
  --g-color-base-selection: var(--g-color-private-blue-150);
  --g-color-base-selection-hover: var(--g-color-private-blue-200);
  --g-color-line-brand: var(--g-color-private-blue-550-solid);
  --g-color-text-brand: var(--g-color-private-blue-600-solid);
  --g-color-text-brand-heavy: var(--g-color-private-blue-700-solid);
  --g-color-text-link: var(--g-color-private-blue-550-solid);
  --g-color-text-link-hover: var(--g-color-private-blue-700-solid);
  --g-color-text-link-visited: var(--g-color-private-blue-700-solid);
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run typecheck && npm run lint && npm run build
git add src/index.css
git commit -m "$(cat <<'EOF'
style(theme): blue accent in place of the default yellow-orange

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(If the manual smoke in Task 7 turns up a stray yellow surface, add the matching `--g-color-*` var to this block.)

---

## Task 6: Editor presentation (manual-verify)

Smaller top padding, tighter line-height, dash bullets, checklist spacing, and a hidden toolbar/gear. CSS + props; the visual result is confirmed in Task 7's smoke.

**Files:**

- Modify: `src/components/Workspace.css` (the editor padding var)
- Modify: `src/components/EditorPane.tsx` (hide settings; import the new CSS)
- Create: `src/components/EditorPane.css`

- [ ] **Step 1: Shrink the top padding**

In `src/components/Workspace.css`, change the `.workspace__editor` custom property:

```css
/* Give the editing area breathing room. Smaller top gap; left/right/bottom unchanged. */
--g-md-editor-padding: 4px 16px 8px 16px;
```

- [ ] **Step 2: Hide the settings gear + import the editor CSS**

In `src/components/EditorPane.tsx`:

1. Add the stylesheet import near the top (after the editor import):

```ts
import './EditorPane.css';
```

2. Change the rendered editor to hide the settings gear and stop the (now-hidden) sticky toolbar:

```tsx
return (
  <div
    className="editor-pane"
    onKeyDown={(event) => {
      if (event.key === 'Escape') onEscape();
    }}
  >
    <MarkdownEditorView
      settingsVisible={false}
      stickyToolbar={false}
      autofocus={autofocus}
      editor={editor}
    />
  </div>
);
```

- [ ] **Step 3: Create `src/components/EditorPane.css`**

```css
/* Markdown-first surface: hide the formatting toolbar strip + the settings gear.
   (Selectors target the shipped @gravity-ui/markdown-editor classes.) */
.editor-pane .g-md-editor-sticky,
.editor-pane .g-md-toolbar {
  display: none;
}

/* Calmer reading rhythm. */
.editor-pane .g-md-editor {
  line-height: 1.45;
}

/* Apple-Notes-style short dashes for bullet lists (leave task lists alone). */
.editor-pane .g-md-editor ul:not(.contains-task-list) > li::marker {
  content: '–  ';
}

/* Breathing room between a checklist checkbox and its label. */
.editor-pane .g-md-editor li.task-list-item > input[type='checkbox'] {
  margin-inline-end: 8px;
}
```

- [ ] **Step 4: Build + commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/components/Workspace.css src/components/EditorPane.tsx src/components/EditorPane.css
git commit -m "$(cat <<'EOF'
style(editor): smaller top padding, tighter line-height, dash bullets, hidden toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(The line-height / dash-bullet / checklist selectors are best-effort against the editor's shipped
DOM — confirm and adjust them during the Task 7 smoke.)

---

## Task 7: Verification + docs

- [ ] **Step 1: Full automated gate**

```bash
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
```

Expected: format clean, typecheck clean, lint 0 errors, all tests pass, build OK.

- [ ] **Step 2: Manual Chromium smoke (human — the folder picker can't be automated)**

`npm run dev`, open in Chrome/Edge, pick a folder, and confirm:

1. **Editor:** less space above the first line (left padding unchanged); comfortable line-height; **no
   toolbar or settings gear**; bullet lists show short dashes; checklist items have a gap between the box
   and the label.
2. **Accent:** buttons / list selection / focus rings / links are **blue** (not yellow-orange) — check in
   **both** light and dark. (If a yellow spot remains, add its `--g-color-*` var to Task 5's block.)
3. **Theme:** the header dropdown offers Light / Dark / **System**; System follows the OS and flips live
   when you change the OS appearance; the choice survives reload.
4. **F2** renames the selected note whether focus is in the list or the editor.
5. **⌘K** inside the editor inserts a link (does not jump to search); ⌘K from the list focuses search.
6. **Rename** a note to an existing note's exact name → nothing happens (no ` 2` file); the title
   reverts.

- [ ] **Step 3: Strike the done items in `README.md`** (coordinate with the user's WIP — they edit this
      file live). Under "Small design things", remove the now-shipped items (top padding, line-height,
      dash bullets, checklist spacing, accent color, system theme, toolbar) and under "Bugs" remove F2 /
      ⌘K / rename-to-existing. Leave everything else untouched. Stage **only** `README.md` and commit:

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: strike the shipped design-polish + bug items from the README backlog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done — what this produced

- **Editor:** smaller top padding, tighter line-height, Apple-Notes dash bullets, checklist spacing, no
  toolbar/gear.
- **Theme:** blue accent (both modes) + a 3-way Light/Dark/System switcher (native Gravity `system`).
- **Bugs fixed:** F2 renames the selected note from anywhere; ⌘K yields to the editor's insert-link;
  renaming onto an existing name is a no-op.
- **Coverage:** logic is unit-tested (shortcut gate, F2 routing, rename collision, theme switcher);
  visual items verified by the Task 7 smoke.
