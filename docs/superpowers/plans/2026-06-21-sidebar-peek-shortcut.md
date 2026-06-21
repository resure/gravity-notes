# Sidebar Peek Shortcut (⌘⇧') + Drop the Toggle Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transient, keyboard-triggered peek of the collapsed sidebar (⌘⇧' slides it in as an overlay and focuses the list; closes on Esc / opening a note / click-outside), and remove the top-bar toggle button's "selected" highlight.

**Architecture:** A non-persisted `peeked` boolean joins `collapsed` in `Workspace`; it's valid only while collapsed (an effect enforces the invariant). A new descriptor-driven `peekSidebar` action (⌘⇧' = `mod+shift+'`, matched on the `"` char) sets it. A `workspace__body_peeked` modifier turns the collapsed sidebar from `display:none` into a slid-in absolute overlay. `NoteList` is untouched — the peek reuses its focus/commit/escape behavior.

**Tech Stack:** React 18 + TypeScript (strict), `@gravity-ui/uikit` + `@gravity-ui/icons`, Gravity theme CSS vars, Vitest + Testing Library (the markdown editor is mocked in jsdom).

---

## File structure

- `src/components/TopBar.tsx` — **modify** (Task 1): remove `selected` from the toggle button and the now-unused `collapsed` prop.
- `src/components/TopBar.test.tsx` — **modify** (Task 1): drop `collapsed` from the setup props.
- `src/components/Workspace.tsx` — **modify** (Task 1: stop passing `collapsed` to `TopBar`; Task 3: peek state + effects, wire `peekSidebar`, wrap the list `onCommit`/`onEscapeList`, body modifier).
- `src/components/Workspace.test.tsx` — **modify** (Task 1: drop the `aria-pressed` assertions; Task 3: add peek tests).
- `src/shortcuts.ts` — **modify** (Task 2): `peekSidebar` action + `mod+shift+'` descriptor.
- `src/hooks/useShortcuts.test.tsx` — **modify** (Task 2): `makeActions` + the ⌘⇧' test.
- `src/components/Workspace.css` — **modify** (Task 4): re-add `position: relative`; the off-screen overlay + `_peeked` slide-in.
- `CLAUDE.md` — **modify** (Task 5): roadmap bullet.

Tasks 1–2 are independent; Task 2 leaves the project type-broken (Workspace must supply `peekSidebar`) until Task 3, which restores a clean typecheck. Task 4 is CSS-only; Task 5 is docs + verification.

---

## Task 1: Remove the toggle's "selected" highlight

The top-bar toggle passes `selected={!collapsed}` (Gravity renders `aria-pressed` from it and styles the button "on"). The user wants no highlight. Removing `selected` leaves `collapsed` unused inside `TopBar`, so we remove that prop from `TopBar` entirely (interface + destructure + the `Workspace`/test call sites — no dead props). The `aria-pressed` round-trip assertions in the Workspace test go too. The existing collapse/persist test still guards the toggle.

**Files:**
- Modify: `src/components/TopBar.tsx`, `src/components/Workspace.tsx`
- Test: `src/components/Workspace.test.tsx`, `src/components/TopBar.test.tsx`

- [ ] **Step 1: Drop the `aria-pressed` assertions from the Workspace test**

In `src/components/Workspace.test.tsx`, the test `'toggles the sidebar from the top bar and persists it'` currently reads:

```tsx
    it('toggles the sidebar from the top bar and persists it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        const toggle = screen.getByLabelText('Toggle sidebar');
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        // Expanded → the toggle reads as pressed.
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        await user.click(toggle);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('true');
        // Collapsed → the toggle reads as not pressed.
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await user.click(toggle);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('false');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });
```

Replace it with (drop the three `aria-pressed` assertions + their two comments; keep `toggle` for the clicks):

```tsx
    it('toggles the sidebar from the top bar and persists it', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        const toggle = screen.getByLabelText('Toggle sidebar');
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        await user.click(toggle);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('true');
        await user.click(toggle);
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).toBeNull(),
        );
        expect(localStorage.getItem('gravity-notes:sidebar-collapsed')).toBe('false');
    });
```

- [ ] **Step 2: Remove `selected` + the `collapsed` prop from `TopBar`**

In `src/components/TopBar.tsx`:

(a) In `TopBarProps`, remove the `collapsed` field + its doc comment. It currently reads:

```ts
    onChangeThemePref: (pref: ThemePref) => void;
    /** Whether the notes sidebar is collapsed. */
    collapsed: boolean;
    /** Toggle the sidebar collapsed/docked. */
    onToggleCollapsed: () => void;
```

→

```ts
    onChangeThemePref: (pref: ThemePref) => void;
    /** Toggle the sidebar collapsed/docked. */
    onToggleCollapsed: () => void;
```

(b) In the `TopBar` function's destructured params, remove `collapsed,`. It currently includes:

```tsx
    onChangeThemePref,
    collapsed,
    onToggleCollapsed,
    saveLabel,
```

→

```tsx
    onChangeThemePref,
    onToggleCollapsed,
    saveLabel,
```

(c) Remove `selected={!collapsed}` from the toggle `Button` and trim the comment to just the label note. It currently reads:

```tsx
            {/* "Toggle sidebar" (not "…notes…") so the label doesn't match the folder
                button's /notes/i query in Workspace.test. `selected` (not a raw
                aria-pressed, which Gravity's Button overwrites with its own) is what
                renders aria-pressed — pressed = sidebar shown. */}
            <Button
                view="flat"
                size="m"
                className="topbar__sidebar-toggle"
                onClick={onToggleCollapsed}
                aria-label="Toggle sidebar"
                title="Toggle sidebar (⌘')"
                selected={!collapsed}
            >
                <Icon data={LayoutSideContent} />
            </Button>
```

→

```tsx
            {/* "Toggle sidebar" (not "…notes…") so the label doesn't match the folder
                button's /notes/i query in Workspace.test. */}
            <Button
                view="flat"
                size="m"
                className="topbar__sidebar-toggle"
                onClick={onToggleCollapsed}
                aria-label="Toggle sidebar"
                title="Toggle sidebar (⌘')"
            >
                <Icon data={LayoutSideContent} />
            </Button>
```

- [ ] **Step 3: Stop passing `collapsed` to `TopBar` in `Workspace`**

In `src/components/Workspace.tsx`, the `<TopBar>` element passes `collapsed`. It currently includes:

```tsx
                onChangeThemePref={onChangeThemePref}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
```

→ (remove the `collapsed` line; the `Workspace`'s own `collapsed` state stays — it's still used by the body className and `toggleCollapsed`):

```tsx
                onChangeThemePref={onChangeThemePref}
                onToggleCollapsed={toggleCollapsed}
```

- [ ] **Step 4: Drop `collapsed` from the `TopBar` test setup**

In `src/components/TopBar.test.tsx`, the shared `setup`/props object passes `collapsed: false` alongside `onToggleCollapsed: vi.fn()`. Read the file, find that props object, and remove the `collapsed: false,` line (leave `onToggleCollapsed: vi.fn(),`). This is required because `TopBarProps` no longer declares `collapsed` (excess-property typecheck error otherwise).

- [ ] **Step 5: Verify green**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass — the toggle test no longer references `aria-pressed`, the button renders no `selected`/`aria-pressed`, `TopBar`/`Workspace` no longer reference the removed prop, typecheck is clean, ESLint reports 0 errors (pre-existing warnings OK).

- [ ] **Step 6: Commit**

```bash
git add src/components/TopBar.tsx src/components/TopBar.test.tsx src/components/Workspace.tsx src/components/Workspace.test.tsx
git commit -m "style(topbar): drop the sidebar toggle's selected highlight"
```

End the message with a blank line then:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## Task 2: `peekSidebar` shortcut (⌘⇧')

**Files:**
- Modify: `src/shortcuts.ts`
- Test: `src/hooks/useShortcuts.test.tsx`

- [ ] **Step 1: Update the tests**

In `src/hooks/useShortcuts.test.tsx`, add `peekSidebar` to `makeActions` (after `toggleSidebar`):

```ts
        toggleSidebar: vi.fn(),
        peekSidebar: vi.fn(),
```

Add this test (anywhere among the existing `it(...)` blocks):

```ts
    it('peeks the sidebar on ctrl+shift+doublequote (and does not toggle)', () => {
        const actions = makeActions();
        renderHook(() => useShortcuts(actions));
        // Shift+apostrophe emits the double-quote character; that + shift is the ⌘⇧' binding.
        press({key: '"', ctrlKey: true, shiftKey: true});
        expect(actions.peekSidebar).toHaveBeenCalledTimes(1);
        expect(actions.toggleSidebar).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useShortcuts.test.tsx`
Expected: FAIL — `peekSidebar` is not a known action (⌘⇧" fires nothing).

- [ ] **Step 3: Add the action + descriptor**

In `src/shortcuts.ts`, add `'peekSidebar'` to the `ShortcutAction` union (after `'toggleSidebar'`):

```ts
export type ShortcutAction =
    | 'createNote'
    | 'selectNextNote'
    | 'selectPrevNote'
    | 'toggleSidebar'
    | 'peekSidebar'
    | 'toggleEditorMode'
    | 'togglePreview'
    | 'openHelp'
    | 'renameSelected';
```

In the `SHORTCUTS` array, add the peek descriptor right after the `mod+'` (Toggle the sidebar) descriptor:

```ts
    {
        keys: "mod+'",
        description: 'Toggle the sidebar',
        group: 'Navigation',
        global: {trigger: 'mod', key: "'", action: 'toggleSidebar'},
    },
    {
        keys: "mod+shift+'",
        description: 'Peek the collapsed sidebar',
        group: 'Navigation',
        global: {trigger: 'mod', key: '"', action: 'peekSidebar', shift: true},
    },
```

(`event.key` for ⌘⇧' is the double-quote `"`; `shift: true` requires Shift, which also makes it disjoint from the no-shift ⌘' toggle.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useShortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shortcuts.ts src/hooks/useShortcuts.test.tsx
git commit -m "feat(shortcuts): ⌘⇧' peeks the collapsed sidebar"
```

End the message with the `Co-Authored-By` trailer (blank line first), as in Task 1.

(Note: a whole-project `npm run typecheck` now reports `Workspace.tsx` is missing the `peekSidebar`
action — that's expected and fixed in Task 3. Don't insist on a clean full typecheck for this task;
only the scoped test command matters here.)

---

## Task 3: Workspace peek wiring + tests

**Files:**
- Modify: `src/components/Workspace.tsx`
- Test: `src/components/Workspace.test.tsx`

- [ ] **Step 1: Add `fireEvent` to the test imports**

In `src/components/Workspace.test.tsx`, the first import is:

```tsx
import {screen, waitFor, within} from '@testing-library/react';
```

Change it to:

```tsx
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
```

- [ ] **Step 2: Write the failing peek tests**

In `src/components/Workspace.test.tsx`, inside the `describe('Workspace — nvALT navigation', …)` block, add a small helper as the first statement after the existing `afterEach`:

```tsx
    // Collapse the sidebar, then fire ⌘⇧' to peek it. A direct keyDown avoids userEvent's
    // keyboard-layout mapping of the `"` character. Resolves once the peek class is present.
    async function collapseThenPeek(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByLabelText('Toggle sidebar'));
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).not.toBeNull(),
        );
        fireEvent.keyDown(document, {key: '"', metaKey: true, shiftKey: true});
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_peeked')).not.toBeNull(),
        );
    }
```

Then add these six tests (e.g. right after the `'restores the collapsed sidebar from localStorage'` test):

```tsx
    it("⌘⇧' peeks the collapsed sidebar", async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        expect(document.querySelector('.workspace__body_peeked')).not.toBeNull();
    });

    it("⌘⇧' does nothing while the sidebar is docked", async () => {
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        expect(document.querySelector('.workspace__body_collapsed')).toBeNull();
        fireEvent.keyDown(document, {key: '"', metaKey: true, shiftKey: true});
        expect(document.querySelector('.workspace__body_peeked')).toBeNull();
    });

    it('Esc closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        // Focus is on a list row; Esc there closes the peek.
        await user.keyboard('{Escape}');
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it('opening a note closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        // Enter on the focused row commits (opens) the note → closes the peek.
        await user.keyboard('{Enter}');
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it('clicking outside the sidebar closes the peek', async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(document.querySelector('.workspace__body_peeked')).toBeNull());
    });

    it("docking with ⌘' clears the peek", async () => {
        const user = userEvent.setup();
        renderWorkspace();
        await screen.findByRole('option', {name: /Alpha/});
        await collapseThenPeek(user);
        await user.keyboard("{Meta>}'{/Meta}");
        await waitFor(() =>
            expect(document.querySelector('.workspace__body_collapsed')).toBeNull(),
        );
        expect(document.querySelector('.workspace__body_peeked')).toBeNull();
    });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- src/components/Workspace.test.tsx`
Expected: FAIL — there is no peek behavior yet (`.workspace__body_peeked` never appears, so `collapseThenPeek`'s `waitFor` times out).

- [ ] **Step 4: Add the peek state + effects**

In `src/components/Workspace.tsx`, find the collapsed-state block:

```tsx
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
    useEffect(() => {
        localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    }, [collapsed]);
    const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
```

Insert the peek state + three effects immediately after it (the `listRef` they use is declared above, near the other refs):

```tsx
    // Transient overlay reveal of the collapsed sidebar (⌘⇧'); not persisted. Only meaningful
    // while collapsed — the invariant effect clears it whenever the sidebar is docked.
    const [peeked, setPeeked] = useState(false);
    useEffect(() => {
        if (!collapsed && peeked) setPeeked(false);
    }, [collapsed, peeked]);
    // When the peek opens, move focus into the list so arrow / ⌘J⌘K nav works immediately.
    useEffect(() => {
        if (peeked) listRef.current?.focusSelected();
    }, [peeked]);
    // While peeked, a mousedown anywhere outside the sidebar closes it (e.g. clicking the editor).
    useEffect(() => {
        if (!peeked) return;
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (
                target instanceof Node &&
                !document.querySelector('.workspace__sidebar')?.contains(target)
            ) {
                setPeeked(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [peeked]);
```

- [ ] **Step 5: Wire the `peekSidebar` shortcut**

In the `useShortcuts({…})` call, add `peekSidebar` right after `toggleSidebar`:

```tsx
        toggleSidebar: toggleCollapsed,
        peekSidebar: () => {
            if (collapsed) setPeeked(true);
        },
```

- [ ] **Step 6: Close the peek on commit / Esc from the list**

In the `<NoteList … />` element, change the three handlers:

```tsx
                        onBrowse={nav.browse}
                        onCommit={nav.commit}
                        onEscapeList={nav.escapeToSearch}
```

to:

```tsx
                        onBrowse={nav.browse}
                        onCommit={(id) => {
                            nav.commit(id);
                            setPeeked(false);
                        }}
                        onEscapeList={() => {
                            setPeeked(false);
                            nav.escapeToSearch();
                        }}
```

(`setPeeked(false)` is a no-op when not peeked. `onBrowse` is intentionally NOT wrapped, so arrow-previewing keeps the peek open.)

- [ ] **Step 7: Add the body modifier**

Change the body wrapper:

```tsx
            <div className={'workspace__body' + (collapsed ? ' workspace__body_collapsed' : '')}>
```

to:

```tsx
            <div
                className={
                    'workspace__body' +
                    (collapsed ? ' workspace__body_collapsed' : '') +
                    (collapsed && peeked ? ' workspace__body_peeked' : '')
                }
            >
```

- [ ] **Step 8: Run the tests + full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green — the six new peek tests pass, the whole project type-checks again (Workspace now provides `peekSidebar`), and ESLint reports 0 errors (pre-existing warnings OK).

- [ ] **Step 9: Commit**

```bash
git add src/components/Workspace.tsx src/components/Workspace.test.tsx
git commit -m "feat(sidebar): ⌘⇧' peek overlay — focus the list; close on Esc/open/click-out"
```

End the message with the `Co-Authored-By` trailer (blank line first).

---

## Task 4: Overlay CSS (slide-in peek)

Pure-CSS; the editor is mocked in tests, so the slide/shadow is visual-only — the gate is lint + build, then the manual smoke test in Task 5.

**Files:**
- Modify: `src/components/Workspace.css`

- [ ] **Step 1: Re-add the stacking context to `.workspace__body`**

In `src/components/Workspace.css`, the rule currently reads:

```css
.workspace__body {
    display: flex;
    flex: 1;
    min-height: 0;
}
```

Replace it with (re-adds `position: relative` to anchor the absolute overlay):

```css
.workspace__body {
    display: flex;
    flex: 1;
    min-height: 0;
    /* Anchors the absolutely-positioned collapsed-sidebar overlay (see below). */
    position: relative;
}
```

- [ ] **Step 2: Replace the `display:none` collapsed rule with the overlay + peek**

In `src/components/Workspace.css`, the collapsed rule currently reads:

```css
/* Collapsed: the sidebar is simply hidden (kept mounted) and the editor fills the width. */
.workspace__body_collapsed .workspace__sidebar {
    display: none;
}
```

Replace it with:

```css
/* Collapsed: the sidebar leaves the flow as an off-screen overlay so the editor fills the width.
   It stays mounted, but visibility:hidden keeps it out of the tab order until peeked. */
.workspace__body_collapsed .workspace__sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 5;
    transform: translateX(-100%);
    visibility: hidden;
    transition:
        transform 0.15s ease,
        visibility 0.15s ease;
    box-shadow: 0 0 16px rgba(0, 0, 0, 0.25);
}

/* Peeked (⌘⇧'): slide the overlay in and make it focusable. The rule sits AFTER the collapsed
   rule so its transform/visibility win at equal specificity. */
.workspace__body_peeked .workspace__sidebar {
    transform: translateX(0);
    visibility: visible;
}
```

- [ ] **Step 3: Verify it builds, lints, and tests pass**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: `npm run format` normalizes any CSS whitespace (e.g. the multi-value `transition`) so `format:check` would pass; ESLint clean; all tests green (no test asserts these CSS values); `tsc` + Vite build succeed. After `npm run format`, run `git diff src/components/Workspace.css` to confirm only the intended rules changed (and `git status` shows only `Workspace.css` + the always-present `README.md`).

- [ ] **Step 4: Commit**

```bash
git add src/components/Workspace.css
git commit -m "style(sidebar): slide-in overlay for the ⌘⇧' peek"
```

End the message with the `Co-Authored-By` trailer (blank line first).

---

## Task 5: Docs + full verification + manual smoke

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the `CLAUDE.md` roadmap**

In `CLAUDE.md`, under roadmap item 3, the current last sub-bullet is the "Sidebar toggle + editor scroll" entry, which ends with:

```
     Spec: `docs/superpowers/specs/2026-06-21-sidebar-toggle-editor-scroll-design.md`.
```

…immediately followed by `4. ⬜ **Richer editing**`. Insert this new sub-bullet between them (match the 3-space `- ✅` indent and 5-space continuation):

```markdown
   - ✅ **Sidebar peek shortcut** — ⌘⇧' slides the collapsed sidebar in as a transient overlay and
     focuses the list (close on Esc / opening a note / click-outside); the top-bar toggle dropped its
     "selected" highlight.
     Spec: `docs/superpowers/specs/2026-06-21-sidebar-peek-shortcut-design.md`.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all green — full Vitest suite passes, ESLint clean, `tsc` + Vite build succeed.

- [ ] **Step 3: Manual Chromium smoke test**

Run `npm run dev`, open in Chrome, pick a folder, and verify:
- **⌘'** collapses the sidebar (editor fills the width). Then **⌘⇧'** slides it back in as an overlay
  over the editor, with focus in the list — arrow / ⌘J⌘K move the highlight while it stays open.
- The peek **closes** on **Esc** (focus back to search), on **Enter** to open a note (the overlay
  slides away to reveal the editor), and on a **click in the editor** (outside the sidebar).
- **⌘⇧' does nothing while the sidebar is docked.** Docking (⌘' or the top-bar button) while peeked
  clears the peek.
- The top-bar toggle button shows **no "selected" highlight** anymore.
- Tune the slide/shadow/z-index in `Workspace.css` if the feel is off. If your keyboard's
  shifted-apostrophe isn't `"`, adjust the descriptor `key` in `src/shortcuts.ts`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: roadmap note for the sidebar peek shortcut"
```

End the message with the `Co-Authored-By` trailer (blank line first).

---

## Self-review notes (for the implementer)

- **Preserve `README.md`** — it has unrelated uncommitted user changes. Never stage it; each commit
  stages only the files listed in that task.
- **Task 2 is intentionally type-broken in isolation** (the `ShortcutActions` record requires
  `peekSidebar`); Task 3 supplies it. Don't "fix" `Workspace.tsx` inside Task 2.
- **⌘⇧' is matched on the `"` character** (Shift+apostrophe), not `'` — the `shift: true` flag plus
  the different `event.key` keep it disjoint from the ⌘' toggle. The Workspace tests fire a direct
  `fireEvent.keyDown(document, {key: '"', metaKey: true, shiftKey: true})` to avoid userEvent's
  layout mapping.
- **The peek reuses `NoteList` as-is.** Closing on commit/Esc is done by wrapping the props the
  `Workspace` passes; `onBrowse` is deliberately left unwrapped so arrow-preview keeps the peek open.
- **`peeked` is never persisted** (no `localStorage`, not in the dotfile) — a reload starts un-peeked.
- **The `_peeked` CSS rule must come after the `_collapsed` rule** (equal specificity → source order
  decides) so the slid-in transform/visibility win.
- **Run `npm run format` in Task 4** so the multi-value `transition` matches Prettier before
  `format:check`/CI sees it.
