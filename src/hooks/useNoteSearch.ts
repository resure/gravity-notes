import {useMemo, useState} from 'react';

import type {NoteMeta} from '../storage/types';

/**
 * Single match predicate — title-only today. A future body matcher slots in
 * here without touching the hook or the UI.
 */
export function noteMatches(note: NoteMeta, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return note.title.toLowerCase().includes(q);
}

export interface UseNoteSearch {
    query: string;
    setQuery: (query: string) => void;
    /** `notes` filtered by `query`, original order preserved. */
    filteredNotes: NoteMeta[];
}

/** Owns the search query and derives the filtered note list (pure, no I/O). */
export function useNoteSearch(notes: NoteMeta[]): UseNoteSearch {
    const [query, setQuery] = useState('');
    const filteredNotes = useMemo(() => {
        if (!query.trim()) return notes;
        return notes.filter((note) => noteMatches(note, query));
    }, [notes, query]);
    return {query, setQuery, filteredNotes};
}
