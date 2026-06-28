import {useEffect, useRef, useState} from 'react';

import {Button, Popup, type PopupPlacement, TextInput} from '@gravity-ui/uikit';

import {dirname} from '../../storage/noteText';
import type {NoteMeta} from '../../storage/types';
import {suggestWikiTargets} from '../../wikiLinks';

import type {WikiLinkTooltipState} from './wikiLinkExtension';

import './wikiLink.css';

const PLACEMENT: PopupPlacement = ['bottom-start', 'top-start'];
const LIMIT = 6;

interface WikiLinkTooltipProps {
    /** Pushed by the editor while the caret is in a link; null hides the tooltip. */
    state: WikiLinkTooltipState | null;
    /** Notes for the re-target picker. */
    notes: NoteMeta[];
    /** Open note id, for same-folder suggestion ranking. */
    currentId: string;
}

/**
 * The wiki-link counterpart of the editor's URL-link tooltip: while the caret sits in a `[[link]]`,
 * a popup shows the target with Open / Edit / Unlink. "Edit" turns it into a small note picker
 * (reusing `suggestWikiTargets`) that re-targets the link on pick. Visibility + the link's range are
 * owned by the editor plugin (see wikiLinkExtension); this is presentation + the re-target field.
 */
export function WikiLinkTooltip({state, notes, currentId}: WikiLinkTooltipProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Leaving the link (or moving to a different one) drops back to info mode.
    const anchor = state?.anchor ?? null;
    const target = state?.target ?? '';
    useEffect(() => {
        setEditing(false);
    }, [anchor, target]);

    // Focus + select the field when edit mode opens.
    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);

    if (!state) return null;

    const suggestions = editing ? suggestWikiTargets(draft, notes, currentId, LIMIT) : [];

    const startEdit = () => {
        setDraft(target);
        setActiveIdx(0);
        setEditing(true);
    };
    const cancelEdit = () => {
        setEditing(false);
        state.refocus();
    };
    const commit = (title: string) => {
        setEditing(false);
        state.setTarget(title);
    };

    return (
        <Popup
            open
            anchorElement={state.anchor}
            placement={PLACEMENT}
            onOpenChange={(next) => {
                if (!next && editing) cancelEdit();
            }}
        >
            <div className="wiki-tooltip">
                {editing ? (
                    <div className="wiki-tooltip__edit">
                        <TextInput
                            controlRef={inputRef}
                            size="s"
                            value={draft}
                            placeholder="Note title…"
                            onUpdate={(value) => {
                                setDraft(value);
                                setActiveIdx(0);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commit(suggestions[activeIdx]?.title ?? draft);
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelEdit();
                                } else if (event.key === 'ArrowDown' && suggestions.length) {
                                    event.preventDefault();
                                    setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
                                } else if (event.key === 'ArrowUp' && suggestions.length) {
                                    event.preventDefault();
                                    setActiveIdx((i) => Math.max(i - 1, 0));
                                }
                            }}
                        />
                        {suggestions.length > 0 ? (
                            <div className="wiki-tooltip__list">
                                {suggestions.map((note, i) => {
                                    const folder = dirname(note.id);
                                    return (
                                        <button
                                            key={note.id}
                                            type="button"
                                            className={
                                                'wiki-tooltip__option' +
                                                (i === activeIdx
                                                    ? ' wiki-tooltip__option_active'
                                                    : '')
                                            }
                                            onMouseEnter={() => setActiveIdx(i)}
                                            onMouseDown={(event) => {
                                                event.preventDefault(); // commit before the input blurs
                                                commit(note.title);
                                            }}
                                        >
                                            <span className="wiki-tooltip__option-title">
                                                {note.title}
                                            </span>
                                            {folder ? (
                                                <span className="wiki-tooltip__option-path">
                                                    {folder}
                                                </span>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="wiki-tooltip__info">
                        <span
                            className={
                                'wiki-tooltip__target' +
                                (state.broken ? ' wiki-tooltip__target_broken' : '')
                            }
                            title={state.target}
                        >
                            {state.target}
                        </span>
                        <div className="wiki-tooltip__actions">
                            <Button size="s" view="action" onClick={() => state.open()}>
                                {state.broken ? 'Create' : 'Open'}
                            </Button>
                            <Button size="s" view="flat" onClick={startEdit}>
                                Edit
                            </Button>
                            <Button size="s" view="flat" onClick={() => state.unlink()}>
                                Unlink
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Popup>
    );
}
