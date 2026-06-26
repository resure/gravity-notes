/** The set of actions the global keyboard handler can invoke. */
export type ShortcutAction =
    | 'createNote'
    | 'focusSearch'
    | 'selectNextNote'
    | 'selectPrevNote'
    | 'toggleSidebar'
    | 'toggleFolderRail'
    | 'peekSidebar'
    | 'toggleEditorMode'
    | 'togglePreview'
    | 'openHelp'
    | 'renameSelected'
    | 'moveSelected';

/** How a globally-handled shortcut maps to a key event. */
export interface GlobalBinding {
    /** 'mod' = ⌘/Ctrl combo; 'bare' = the key alone. */
    trigger: 'mod' | 'bare';
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
    /** For a 'mod' binding, also require Shift (default: Shift must be absent). */
    shift?: boolean;
    /** May fire while a typing surface (input/textarea/contenteditable) is focused. Default: mod→true, bare→false. */
    inTyping?: boolean;
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
        keys: 'enter',
        description: 'Edit the selected note (in the title → jump to the body)',
        group: 'Navigation',
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
        description: 'Toggle WYSIWYG / Markup',
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
    {keys: 'mod+shift+k', description: 'Insert link (in the editor)', group: 'Editing'},
    {
        keys: 'f2',
        description: 'Rename selected note',
        group: 'Editing',
        global: {trigger: 'bare', key: 'F2', action: 'renameSelected', inTyping: true},
    },
    {
        keys: 'mod+shift+m',
        description: 'Move selected note to a folder',
        group: 'Editing',
        // 'm' is a letter, so the shifted event.key ('M') matches case-insensitively — no code needed.
        global: {trigger: 'mod', key: 'm', action: 'moveSelected', shift: true},
    },
    {
        keys: 'mod+/',
        description: 'Show this help',
        group: 'General',
        global: {trigger: 'mod', key: '/', action: 'openHelp'},
    },
];

/** Help-dialog group order. */
export const SHORTCUT_GROUPS: ShortcutDescriptor['group'][] = ['Navigation', 'Editing', 'General'];
