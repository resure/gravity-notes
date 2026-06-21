/** The set of actions the global keyboard handler can invoke. */
export type ShortcutAction = 'createNote' | 'toggleEditorMode' | 'openHelp' | 'renameSelected';

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
    {keys: 'enter', description: 'Edit the selected note', group: 'Navigation'},
    {keys: 'esc', description: 'Editor → list, then close (or clear search)', group: 'Navigation'},
    // No global binding: focusing search is the tail of the Esc ladder (escapeList focuses
    // the search box). ⌘K is deliberately left to the editor's insert-link command.
    {keys: 'esc esc', description: 'Focus search', group: 'Navigation'},
    {
        keys: 'mod+j',
        description: 'New note',
        group: 'Editing',
        global: {trigger: 'mod', key: 'j', action: 'createNote'},
    },
    {
        keys: 'mod+/',
        description: 'Toggle WYSIWYG / Markup',
        group: 'Editing',
        global: {trigger: 'mod', key: '/', action: 'toggleEditorMode'},
    },
    {
        keys: 'f2',
        description: 'Rename selected note',
        group: 'Editing',
        global: {trigger: 'bare', key: 'F2', action: 'renameSelected', inTyping: true},
    },
    {
        keys: '?',
        description: 'Show this help',
        group: 'General',
        global: {trigger: 'bare', key: '?', action: 'openHelp'},
    },
];

/** Help-dialog group order. */
export const SHORTCUT_GROUPS: ShortcutDescriptor['group'][] = ['Navigation', 'Editing', 'General'];
