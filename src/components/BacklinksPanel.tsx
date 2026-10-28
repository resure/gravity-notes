import {useEffect, useState} from 'react';

import {ChevronRight} from '../icons/icons';
import type {BacklinkSource} from '../wikiLinks';

import './BacklinksPanel.css';

const COLLAPSED_KEY = 'gravity-notes:backlinks-collapsed';

interface BacklinksPanelProps {
    /** Notes that link to the open note (already ranked); the panel hides itself when empty. */
    backlinks: BacklinkSource[];
    /** Open a linking note (records history like any other navigation). */
    onOpen: (id: string) => void;
}

/**
 * "Linked references" under the editor: the notes that point at the open note via a `[[wiki link]]`,
 * each with the context around the link. A 40px bar at the foot of the pane that opens to at most
 * 300px of its own scroll; collapsible (persisted) and hidden entirely when there are none.
 * Clicking a source opens it. Backlink data + the corpus live in Workspace (see useBacklinks).
 */
export function BacklinksPanel({backlinks, onOpen}: BacklinksPanelProps) {
    const [collapsed, setCollapsed] = useState(
        () => localStorage.getItem(COLLAPSED_KEY) === 'true',
    );
    // Persist collapse state via an effect rather than inside the setCollapsed updater, which React
    // is free to run twice (e.g. under <StrictMode>).
    useEffect(() => {
        localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    }, [collapsed]);
    if (backlinks.length === 0) return null;

    const count = backlinks.reduce((sum, source) => sum + source.contexts.length, 0);
    const toggle = () => setCollapsed((prev) => !prev);

    return (
        <section className="backlinks" aria-label="Linked references">
            <button
                type="button"
                className="backlinks__header"
                onClick={toggle}
                aria-expanded={!collapsed}
            >
                <ChevronRight size={12} className="backlinks__caret" />
                <span>
                    <strong className="backlinks__count">{count}</strong> linked{' '}
                    {count === 1 ? 'reference' : 'references'}
                </span>
            </button>
            {collapsed ? null : (
                <ul className="backlinks__list">
                    {backlinks.map((source) => (
                        <li key={source.note.id} className="backlinks__item">
                            <button
                                type="button"
                                className="backlinks__source"
                                onClick={() => onOpen(source.note.id)}
                            >
                                {source.note.title}
                            </button>
                            {source.contexts.map((context, i) => (
                                <div key={`${source.note.id}:${i}`} className="backlinks__context">
                                    {context}
                                </div>
                            ))}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
