import type {ReactNode} from 'react';

/**
 * Wrap the first case-insensitive occurrence of `query` in `name` with a highlight `<mark>`.
 * Shared by the filter-list dialogs (workspace switcher, move-to picker); each passes its own
 * `<mark>` className so the highlight tint matches the surrounding dialog.
 */
export function highlightMatch(name: string, query: string, className: string): ReactNode {
    if (!query) return name;
    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return name;
    return (
        <>
            {name.slice(0, idx)}
            <mark className={className}>{name.slice(idx, idx + query.length)}</mark>
            {name.slice(idx + query.length)}
        </>
    );
}
