import {useEffect, useState} from 'react';

import {Collapsible} from '@base-ui/react/collapsible';

import {ChevronRight} from '../ui/icons';
import type {BacklinkSource} from '../wikiLinks';

import './BacklinksPanel.css';

const COLLAPSED_KEY = 'sol:backlinks-collapsed';

interface BacklinksPanelProps {
    /** Notes that link to the open note (already ranked); the panel hides itself when empty. */
    backlinks: BacklinkSource[];
    /** Open a linking note (records history like any other navigation). */
    onOpen: (id: string) => void;
}

/**
 * "Linked references", as §04's bottom bar: a 40px strip pinned to the foot of the editor pane that
 * opens to at most 300px of its own scroll. Closed it is one line of text — which is the point, on a
 * surface whose whole job is the note above it.
 *
 * A Base UI Collapsible rather than a hand-rolled toggle: it owns the panel's height animation and
 * the trigger/panel aria pairing. Hidden entirely when the note has no backlinks; the collapse state
 * persists, because whether you work with references open is a habit, not a per-note choice.
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

    return (
        <Collapsible.Root
            open={!collapsed}
            onOpenChange={(open) => setCollapsed(!open)}
            render={<section className="backlinks" aria-label="Linked references" />}
        >
            <Collapsible.Trigger className="backlinks__header">
                <ChevronRight size={12} className="backlinks__caret" />
                <span>
                    <strong className="backlinks__count">{count}</strong> linked{' '}
                    {count === 1 ? 'reference' : 'references'}
                </span>
            </Collapsible.Trigger>
            <Collapsible.Panel className="backlinks__panel">
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
            </Collapsible.Panel>
        </Collapsible.Root>
    );
}
