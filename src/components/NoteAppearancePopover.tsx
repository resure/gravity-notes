import {Popup, Text} from '@gravity-ui/uikit';

import {type NoteAppearance, isNoteAppearanceOverridden} from '../hooks/useSettings';

import {AppearanceChoiceRow, FONT_OPTIONS_WS, WIDTH_OPTIONS_WS} from './appearanceControls';

import './NoteAppearancePopover.css';

interface NoteAppearancePopoverProps {
    open: boolean;
    /** The ⋯ button (top bar) the popover anchors to; null before it mounts. */
    anchor: HTMLElement | null;
    onClose: () => void;
    noteAppearance: NoteAppearance;
    onSet: <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => void;
    onReset: () => void;
    /** Active workspace label, for the "Overrides …" subtext. */
    workspaceLabel: string | null;
}

/**
 * The per-note "Note appearance" popover: two segmented pickers (editor font, text width), each
 * `Default`-first (inherit the workspace/app value), plus a Reset that clears all overrides. Anchored
 * to the ⋯ button at the top bar's right edge; Esc / outside-click close it (Gravity `Popup`). Because
 * the anchor IS the toggle button, floating-ui excludes it from outside-press, so a click on it just
 * toggles (no double-fire to guard against).
 */
export function NoteAppearancePopover({
    open,
    anchor,
    onClose,
    noteAppearance,
    onSet,
    onReset,
    workspaceLabel,
}: NoteAppearancePopoverProps) {
    // Derived here rather than threaded down as a prop — it's a pure function of `noteAppearance`.
    const overridden = isNoteAppearanceOverridden(noteAppearance);
    return (
        <Popup
            open={open}
            anchorElement={anchor}
            placement="bottom-end"
            hasArrow
            onOpenChange={(isOpen) => {
                if (!isOpen) onClose();
            }}
        >
            {/* The trigger advertises aria-haspopup="dialog" (TopBar), so a dialog role must actually
                appear in the tree when it opens — Gravity Popup emits none by default. */}
            <div className="note-appearance" role="dialog" aria-label="Note appearance">
                <div className="note-appearance__head">
                    <div className="note-appearance__titles">
                        <Text variant="subheader-1">Note appearance</Text>
                        <Text color="secondary" className="note-appearance__subtext">
                            Overrides {workspaceLabel ? `“${workspaceLabel}”` : 'the app'}.
                            “Default” inherits.
                        </Text>
                    </div>
                    {overridden ? (
                        <button type="button" className="note-appearance__reset" onClick={onReset}>
                            Reset
                        </button>
                    ) : null}
                </div>

                <AppearanceChoiceRow
                    layout="stack"
                    label="Editor font"
                    options={FONT_OPTIONS_WS}
                    value={noteAppearance.editorFont}
                    onUpdate={(value) => onSet('editorFont', value)}
                />
                <AppearanceChoiceRow
                    layout="stack"
                    label="Text width"
                    options={WIDTH_OPTIONS_WS}
                    value={noteAppearance.textWidth}
                    onUpdate={(value) => onSet('textWidth', value)}
                />
            </div>
        </Popup>
    );
}
