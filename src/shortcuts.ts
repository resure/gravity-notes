/** The set of actions the global keyboard handler can invoke. */
export type ShortcutAction =
    | 'createNote'
    | 'focusSearch'
    | 'selectNextNote'
    | 'selectPrevNote'
    | 'historyBack'
    | 'historyForward'
    | 'toggleSidebar'
    | 'toggleFolderRail'
    | 'peekSidebar'
    | 'toggleEditorMode'
    | 'togglePreview'
    | 'openHelp'
    | 'openSettings'
    | 'openNoteAppearance'
    | 'renameSelected'
    | 'moveSelected'
    | 'duplicateSelected'
    | 'deleteSelected'
    | 'openWorkspaces';

/**
 * The "open in a new window" chord — ⌘ (macOS) or Ctrl (Windows/Linux), no other modifier — on ↵
 * and on click alike. Shared by the note-list rows (⌘↵ / ⌘-click), the orb menu's recents +
 * "Open Folder…" items, and the ⌃R switcher, so the convention stays identical across every
 * surface (and Ctrl works off macOS). Shift is excluded so ⌘⇧↵ (the global new-note chord) still
 * bubbles. Structurally typed on the four modifier flags so it takes a React OR native mouse/
 * keyboard event without importing React's types.
 */
export function isOpenInNewWindowChord(event: {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
}): boolean {
    return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}

/** How a globally-handled shortcut maps to a key event. */
export interface GlobalBinding {
    /**
     * 'mod' = ⌘/Ctrl combo; 'ctrl' = the Control key specifically (⌘ absent — VS Code-style ⌃
     * chords, distinct from ⌘ on macOS); 'bare' = the key alone.
     */
    trigger: 'mod' | 'ctrl' | 'bare';
    /** `event.key` to match. For the 'mod' trigger the comparison is case-insensitive. */
    key: string;
    /**
     * Physical-key match (`event.code`), preferred over `key` when present. Required for
     * punctuation chords with Shift, where the shifted `event.key` differs from the base char
     * (e.g. ⌘⇧; reports `event.key === ':'`, not ';') — see the macOS shortcut memory.
     */
    code?: string;
    /** Which action to fire. */
    action: ShortcutAction;
    /** For a 'mod'/'ctrl' binding, also require Shift (default: Shift must be absent). */
    shift?: boolean;
    /** May fire while a typing surface (input/textarea/contenteditable) is focused. Default: mod/ctrl→true, bare→false. */
    inTyping?: boolean;
    /**
     * Handle in the capture phase and `stopPropagation`, so the key never reaches the editor. Needed
     * when the chord collides with an editor binding we must override — e.g. ⌘[/⌘] (history) shadow
     * the editor's own list outdent/indent (still reachable via Tab/⇧Tab).
     */
    capture?: boolean;
}

/** One row of the keyboard-shortcut help sheet, and (optionally) its global binding. */
export interface ShortcutDescriptor {
    /** Gravity <Hotkey> value, e.g. 'mod+j' or 'esc esc'. */
    keys: string;
    /** Human description shown in the help dialog. */
    description: string;
    /** Help-dialog grouping. */
    group: 'Navigation' | 'Editing' | 'General';
    /** Present when the global handler (useShortcuts) owns this key; absent for list-scoped keys. */
    global?: GlobalBinding;
    /**
     * Only meaningful in the desktop shell: hidden from the help dialog in the browser build, and
     * a `global` binding (if any) is skipped there by useShortcuts.
     */
    desktopOnly?: boolean;
}

/** Single source of truth for both the global handler and the help dialog. */
export const SHORTCUTS: ShortcutDescriptor[] = [
    {keys: 'up', description: 'Preview previous note (or k)', group: 'Navigation'},
    {keys: 'down', description: 'Preview next note (or j)', group: 'Navigation'},
    {
        keys: 'mod+j',
        description: 'Preview next note (works while editing)',
        group: 'Navigation',
        global: {trigger: 'mod', key: 'j', action: 'selectNextNote'},
    },
    {
        keys: 'mod+k',
        description: 'Preview previous note (works while editing)',
        group: 'Navigation',
        global: {trigger: 'mod', key: 'k', action: 'selectPrevNote'},
    },
    {
        keys: 'mod+[',
        description: 'Go back (previously viewed note)',
        group: 'Navigation',
        // Match the physical Bracket key (layout-independent) and grab it in the capture phase so the
        // editor's ⌘[ list-outdent never also fires — outdent stays on ⇧Tab.
        global: {
            trigger: 'mod',
            key: '[',
            code: 'BracketLeft',
            action: 'historyBack',
            capture: true,
        },
    },
    {
        keys: 'mod+]',
        description: 'Go forward (next viewed note)',
        group: 'Navigation',
        global: {
            trigger: 'mod',
            key: ']',
            code: 'BracketRight',
            action: 'historyForward',
            capture: true,
        },
    },
    {
        keys: 'enter',
        description: 'Edit the selected note (in the title → jump to the body)',
        group: 'Navigation',
    },
    {
        keys: 'mod+enter',
        description: 'Open the selected note in a new window (or ⌘-click it)',
        group: 'Navigation',
        // List-scoped: handled by the focused row in NoteList, like plain Enter — no global binding.
        desktopOnly: true,
    },
    {
        keys: 'mod+0',
        description: 'Show this workspace’s main window',
        group: 'Navigation',
        // Bound NATIVELY (Window ▸ Main Window carries the CmdOrCtrl+0 accelerator — see
        // build_menu in src-tauri/src/lib.rs), so it works from any window regardless of focus;
        // this row exists for discoverability only.
        desktopOnly: true,
    },
    {keys: 'esc', description: 'Editor → list, then close (or clear search)', group: 'Navigation'},
    // No global binding: focusing search is the tail of the Esc ladder (escapeList focuses
    // the search box).
    {keys: 'esc esc', description: 'Focus search', group: 'Navigation'},
    {
        keys: 'mod+l',
        description: 'Jump to the search box',
        group: 'Navigation',
        // ⌘L is reserved by browsers (focus the address bar), so it's effective in the desktop app.
        global: {trigger: 'mod', key: 'l', action: 'focusSearch'},
    },
    {
        keys: 'mod+\\',
        description: 'Toggle the sidebar',
        group: 'Navigation',
        global: {trigger: 'mod', key: '\\', action: 'toggleSidebar'},
    },
    {
        keys: 'mod+shift+\\',
        description: 'Toggle the folder rail',
        group: 'Navigation',
        // Match the physical Backslash key: with Shift held, event.key is '|' on US/UK layouts,
        // so a key-based match would never fire. Sibling of ⌘\ (which toggles the whole sidebar).
        global: {
            trigger: 'mod',
            key: '\\',
            code: 'Backslash',
            action: 'toggleFolderRail',
            shift: true,
        },
    },
    {
        keys: "mod+'",
        description: 'Peek the sidebar / focus the list (again to close)',
        group: 'Navigation',
        global: {trigger: 'mod', key: "'", action: 'peekSidebar'},
    },
    {
        keys: 'ctrl+r',
        description: 'Switch workspace (recent folders)',
        group: 'Navigation',
        // The Control key specifically — VS Code's "Open Recent" chord on macOS. ⌘R stays free
        // (it's browser reload in the web build). On Windows/Linux web this shadows the reload
        // shortcut, exactly as VS Code-web does. Match the physical key (layout-independent).
        global: {trigger: 'ctrl', key: 'r', code: 'KeyR', action: 'openWorkspaces', inTyping: true},
    },
    {
        keys: 'mod+shift+enter',
        description: 'New note',
        group: 'Editing',
        global: {trigger: 'mod', key: 'Enter', action: 'createNote', shift: true},
    },
    {
        keys: 'mod+n',
        description: 'New note',
        group: 'Editing',
        // ⌘N is reserved by browsers (new window), so this chord is effective in the desktop app;
        // ⌘⇧↵ is the cross-target equivalent.
        global: {trigger: 'mod', key: 'n', action: 'createNote'},
    },
    {
        keys: 'mod+shift+;',
        description: 'Toggle blocks / Markdown source',
        group: 'Editing',
        // Match the physical Semicolon key: with Shift held, event.key is ':' on US/UK layouts,
        // so a key-based match would never fire.
        global: {
            trigger: 'mod',
            key: ';',
            code: 'Semicolon',
            action: 'toggleEditorMode',
            shift: true,
        },
    },
    {
        keys: 'mod+shift+p',
        description: 'Toggle read-only preview',
        group: 'Editing',
        global: {trigger: 'mod', key: 'p', action: 'togglePreview', shift: true},
    },
    {
        keys: 'mod+shift+i',
        description: 'This note’s menu (appearance, file actions)',
        group: 'Editing',
        // 'i' is a letter, so the shifted event.key ('I') matches case-insensitively — no code needed.
        global: {trigger: 'mod', key: 'i', action: 'openNoteAppearance', shift: true},
    },
    {
        keys: 'f2',
        description: 'Rename selected note',
        group: 'Editing',
        global: {trigger: 'bare', key: 'F2', action: 'renameSelected', inTyping: true},
    },
    {
        keys: 'mod+shift+m',
        description: 'Move selected note to a folder (from the list)',
        group: 'Editing',
        // 'm' is a letter, so the shifted event.key ('M') matches case-insensitively — no code needed.
        // inTyping:false scopes this to the list: the chord is a typing-surface chord elsewhere, so
        // firing the move dialog from the editor too opened both at once (see the gotcha memory).
        global: {trigger: 'mod', key: 'm', action: 'moveSelected', shift: true, inTyping: false},
    },
    {
        keys: 'mod+d',
        description: 'Duplicate selected note',
        group: 'Editing',
        // ⌘D is reserved by browsers (bookmark); the handler preventDefaults it, so it's most
        // dependable in the desktop app — like ⌘N.
        global: {trigger: 'mod', key: 'd', action: 'duplicateSelected'},
    },
    {
        keys: 'mod+shift+backspace',
        description: 'Delete selected note (asks to confirm)',
        group: 'Editing',
        // Backspace is unaffected by Shift, so a key match is enough; fires while editing too, but
        // the confirm dialog guards against an accidental delete.
        global: {trigger: 'mod', key: 'Backspace', action: 'deleteSelected', shift: true},
    },
    {
        keys: 'mod+/',
        description: 'Show this help',
        group: 'General',
        global: {trigger: 'mod', key: '/', action: 'openHelp'},
    },
    {
        keys: 'mod+,',
        description: 'Open settings',
        group: 'General',
        // Match by physical key: ⌘, has no Shift, but `code` is layout-independent and robust.
        global: {trigger: 'mod', key: ',', code: 'Comma', action: 'openSettings'},
    },
];

/** Help-dialog group order. */
export const SHORTCUT_GROUPS: ShortcutDescriptor['group'][] = ['Navigation', 'Editing', 'General'];
