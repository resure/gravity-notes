import {Xmark} from '@gravity-ui/icons';
import {Button, Icon} from '@gravity-ui/uikit';

import './TabBar.css';

/** One open tab's display state. */
export interface TabDescriptor {
    id: string;
    title: string;
    /** True while the tab has a pending (debouncing) edit. */
    unsaved: boolean;
    /** True when the tab's note changed on disk underneath us. */
    conflict: boolean;
}

interface TabBarProps {
    tabs: TabDescriptor[];
    activeId: string | null;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
}

/**
 * Horizontal strip of open-note tabs. Click a tab to activate it; click its ×
 * to close it. A custom strip rather than Gravity's `Tabs` because each tab needs
 * its own close button — a separate interactive element that a `Tab`-as-button
 * can't cleanly nest.
 */
export function TabBar({tabs, activeId, onActivate, onClose}: TabBarProps) {
    return (
        <div className="tab-bar" role="tablist" aria-label="Open notes">
            {tabs.map((tab) => {
                const isActive = tab.id === activeId;
                return (
                    <div
                        key={tab.id}
                        className={`tab-bar__tab${isActive ? ' tab-bar__tab_active' : ''}`}
                        onAuxClick={(e) => {
                            if (e.button === 1) {
                                e.preventDefault();
                                onClose(tab.id);
                            }
                        }}
                    >
                        {/* Marker is a sibling of the tab button so it stays out of the
                            tab's accessible name but remains its own labelled element. */}
                        {tab.conflict && (
                            <span
                                className="tab-bar__marker tab-bar__marker_conflict"
                                role="img"
                                aria-label="Changed on disk"
                            />
                        )}
                        {!tab.conflict && tab.unsaved && (
                            <span
                                className="tab-bar__marker tab-bar__marker_unsaved"
                                role="img"
                                aria-label="Unsaved changes"
                            />
                        )}
                        <button
                            type="button"
                            className="tab-bar__label"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => onActivate(tab.id)}
                        >
                            <span className="tab-bar__title">{tab.title}</span>
                        </button>
                        <Button
                            view="flat"
                            size="s"
                            className="tab-bar__close"
                            aria-label={`Close ${tab.title}`}
                            onClick={() => onClose(tab.id)}
                        >
                            <Icon data={Xmark} size={14} />
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}
