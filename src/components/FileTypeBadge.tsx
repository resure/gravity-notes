import {isMarkdownFile} from '../storage/noteText';

import './FileTypeBadge.css';

export function FileTypeBadge({id}: {id: string}) {
    if (isMarkdownFile(id)) return null;
    return (
        <span className="file-type-badge" aria-label="Plain text file" title={id}>
            {id.toLowerCase().endsWith('.txt') ? 'TXT' : 'TEXT'}
        </span>
    );
}
