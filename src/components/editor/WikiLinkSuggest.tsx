import {List, Popup, type PopupPlacement} from '@gravity-ui/uikit';

import {dirname} from '../../storage/noteText';
import type {NoteMeta} from '../../storage/types';

import type {WikiLinkSuggestState} from './wikiLinkExtension';

import './wikiLink.css';

const ITEM_HEIGHT = 32; // px
const MAX_VISIBLE = 8;
const PLACEMENT: PopupPlacement = ['bottom-start', 'top-start'];

/**
 * The `[[` note-picker popup. Pure presentation: the editor's suggest plugin owns the trigger, the
 * ranked items, and the keyboard (↑/↓/Enter/Tab/Esc); this just renders the list anchored under the
 * `[[`, and reports mouse picks / outside-clicks back through the state's callbacks.
 */
export function WikiLinkSuggest({state}: {state: WikiLinkSuggestState | null}) {
    if (!state) return null;
    const {items, activeIndex, anchor, choose, close} = state;
    return (
        <Popup
            open
            anchorElement={anchor}
            placement={PLACEMENT}
            onOpenChange={(open) => {
                if (!open) close();
            }}
        >
            <List<NoteMeta>
                className="wiki-suggest-popup"
                items={items}
                filterable={false}
                sortable={false}
                virtualized={false}
                itemHeight={ITEM_HEIGHT}
                itemsHeight={Math.min(items.length, MAX_VISIBLE) * ITEM_HEIGHT}
                activeItemIndex={activeIndex}
                onItemClick={(_item, index) => choose(index)}
                renderItem={(note) => {
                    const folder = dirname(note.id);
                    return (
                        <div className="wiki-suggest-popup__item">
                            <span className="wiki-suggest-popup__title">{note.title}</span>
                            {folder ? (
                                <span className="wiki-suggest-popup__path">{folder}</span>
                            ) : null}
                        </div>
                    );
                }}
            />
        </Popup>
    );
}
