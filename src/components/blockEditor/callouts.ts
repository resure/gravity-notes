/**
 * Callout kinds — Obsidian's vocabulary, because that is what reaches disk: a callout is written as
 * `> [!warning]`, and the kind is the word inside the brackets. The icon is therefore not a property
 * of the block at all; it is what this app draws for the kind the file already names, which is why
 * the picker offers kinds rather than emoji (an emoji would have nowhere to be saved).
 *
 * A note may carry a kind nobody here lists — Obsidian allows any word, and custom ones are common —
 * so an unknown kind keeps its name and gets the default icon rather than being rewritten.
 */

export interface CalloutKind {
    /** The word inside `[!…]`. */
    kind: string;
    label: string;
    icon: string;
}

export const CALLOUT_KINDS: CalloutKind[] = [
    {kind: 'note', label: 'Note', icon: '📝'},
    {kind: 'info', label: 'Info', icon: 'ℹ️'},
    {kind: 'tip', label: 'Tip', icon: '💡'},
    {kind: 'success', label: 'Success', icon: '✅'},
    {kind: 'question', label: 'Question', icon: '❓'},
    {kind: 'warning', label: 'Warning', icon: '⚠️'},
    {kind: 'failure', label: 'Failure', icon: '❌'},
    {kind: 'danger', label: 'Danger', icon: '🛑'},
    {kind: 'bug', label: 'Bug', icon: '🐞'},
    {kind: 'example', label: 'Example', icon: '📋'},
    {kind: 'quote', label: 'Quote', icon: '💬'},
];

/** Obsidian's aliases, so a file written there shows the icon its author meant. */
const ALIASES: Record<string, string> = {
    abstract: 'note',
    summary: 'note',
    tldr: 'note',
    todo: 'info',
    hint: 'tip',
    important: 'tip',
    check: 'success',
    done: 'success',
    help: 'question',
    faq: 'question',
    caution: 'warning',
    attention: 'warning',
    fail: 'failure',
    missing: 'failure',
    error: 'danger',
    cite: 'quote',
};

function resolve(kind: string | undefined): CalloutKind | undefined {
    const name = (kind ?? 'note').toLowerCase();
    return CALLOUT_KINDS.find((item) => item.kind === (ALIASES[name] ?? name));
}

export function calloutIcon(kind: string | undefined): string {
    return resolve(kind)?.icon ?? '💡';
}

export function calloutLabel(kind: string | undefined): string {
    return resolve(kind)?.label ?? kind ?? 'Note';
}

/** The shape the shared picker takes, beside its source — as `languages.ts` does. */
export const CALLOUT_ITEMS = CALLOUT_KINDS.map((item) => ({
    value: item.kind,
    label: item.label,
    icon: item.icon,
}));
