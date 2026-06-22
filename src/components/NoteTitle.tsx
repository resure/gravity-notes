import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';

import './NoteTitle.css';

export interface NoteTitleHandle {
    /** Move keyboard focus to the title input. */
    focus(): void;
    /** Focus the title and place the caret at the end (used by ↑-from-body). */
    focusAtEnd(): void;
    /** Focus and select the whole title (used when a new note opens). */
    select(): void;
}

interface NoteTitleProps {
    /** The committed title (file name without `.md`). */
    title: string;
    /** Read-only in preview mode. */
    readOnly?: boolean;
    /**
     * Commit a rename. Fired on blur (and on unmount if still dirty). May resolve `false` when the
     * rename was rejected (e.g. a name collision), so the field can revert to the committed title.
     */
    onCommit: (nextTitle: string) => void | Promise<boolean>;
    /** Move the caret to the start of the existing body (↓ or Tab). */
    onLeaveToBody: () => void;
    /** Open a fresh empty line at the top of the body and move the caret to it (Enter). */
    onEnter: () => void;
    /** Step back out to the list (Esc). */
    onEscape: () => void;
}

/**
 * The editable note title — a single-line, heading-styled input whose value is the file
 * name (minus `.md`). Edits stay local until committed: `onBlur` fires `onCommit` (which
 * renames the file), so moving to the body / clicking away / switching notes all commit.
 * `↓` moves the caret to the body start and `Enter` opens a new line atop the body; `Esc`
 * reverts and steps out. As a safety net for programmatic note switches that never blur, a
 * dirty draft is also committed on unmount.
 */
export const NoteTitle = forwardRef<NoteTitleHandle, NoteTitleProps>(function NoteTitle(
    {title, readOnly = false, onCommit, onLeaveToBody, onEnter, onEscape},
    ref,
) {
    const [draft, setDraft] = useState(title);
    const inputRef = useRef<HTMLInputElement>(null);

    // Latest values via refs, so the unmount-commit reads fresh data without re-subscribing.
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const titleRef = useRef(title);
    titleRef.current = title;
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    // True for the single blur that an Escape-revert triggers, so that blur doesn't commit
    // the cancelled draft. Any real edit (onChange) re-arms it.
    const revertedRef = useRef(false);

    // Sync the draft to a changed committed title (e.g. the sanitized result of a rename),
    // but only while unfocused — never clobber what the user is actively typing.
    useEffect(() => {
        if (document.activeElement !== inputRef.current) setDraft(title);
    }, [title]);

    useImperativeHandle(
        ref,
        () => ({
            focus() {
                inputRef.current?.focus();
            },
            focusAtEnd() {
                const el = inputRef.current;
                if (!el) return;
                el.focus();
                const end = el.value.length;
                el.setSelectionRange(end, end);
            },
            select() {
                inputRef.current?.select();
            },
        }),
        [],
    );

    // Commit a dirty draft on unmount (a programmatic switch may never blur the field).
    useEffect(() => {
        return () => {
            if (draftRef.current !== titleRef.current) onCommitRef.current(draftRef.current);
        };
    }, []);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            onEnter(); // open a new line atop the body → focuses it → blur commits
        } else if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
            event.preventDefault();
            // caret to the body start → focuses it → blur commits (Tab mirrors ↓ into the body)
            onLeaveToBody();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation(); // don't double-fire the editor pane's Esc handler
            revertedRef.current = true; // the blur this triggers must not commit the cancelled draft
            setDraft(title); // revert
            onEscape();
        }
    };

    return (
        <input
            ref={inputRef}
            className="note-title"
            type="text"
            aria-label="Note title"
            placeholder="Untitled"
            spellCheck={false}
            value={draft}
            readOnly={readOnly}
            onChange={(event) => {
                revertedRef.current = false; // a real edit re-arms commit-on-blur
                setDraft(event.target.value);
            }}
            onBlur={() => {
                // After an Escape-revert, the resulting blur must not commit the cancelled draft.
                if (revertedRef.current) {
                    revertedRef.current = false;
                    return;
                }
                // Unchanged → nothing to rename. This also stops a later blur from re-firing a
                // rename that was just reverted below (which would stack another error toast).
                if (draftRef.current === titleRef.current) return;
                void (async () => {
                    const applied = await onCommitRef.current(draftRef.current);
                    // A rejected rename (e.g. a name collision) leaves the file unchanged; snap the
                    // field back to the committed title so it matches the list.
                    if (applied === false) setDraft(titleRef.current);
                })();
            }}
            onKeyDown={onKeyDown}
        />
    );
});
