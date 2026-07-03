import type {ReactNode} from 'react';

import {Popup, SegmentedRadioGroup, Text} from '@gravity-ui/uikit';

import type {NoteAppearance} from '../hooks/useSettings';

import {FONT_OPTIONS_WS, WIDTH_OPTIONS_WS} from './appearanceControls';

import './NoteAppearancePopover.css';

interface NoteAppearancePopoverProps {
    open: boolean;
    /** The `⋯` trigger button the popover anchors to (null before it mounts). */
    anchor: HTMLElement | null;
    onClose: () => void;
    noteAppearance: NoteAppearance;
    onSet: <K extends keyof NoteAppearance>(key: K, value: NoteAppearance[K]) => void;
    onReset: () => void;
    /** True when at least one field overrides its inherited value — shows the Reset affordance. */
    overridden: boolean;
    /** Active workspace label, for the "Overrides …" subtext. */
    workspaceLabel: string | null;
}

/**
 * The per-note "Note appearance" popover: three segmented pickers (editor font, accent, text width),
 * each `Default`-first (inherit the workspace/app value), plus a Reset that clears all overrides.
 * Anchored to the `⋯` trigger in the editor header; Esc / outside-click close it (Gravity `Popup`).
 */
export function NoteAppearancePopover({
    open,
    anchor,
    onClose,
    noteAppearance,
    onSet,
    onReset,
    overridden,
    workspaceLabel,
}: NoteAppearancePopoverProps) {
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
            <div className="note-appearance">
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

                <ControlGroup
                    label="Editor font"
                    options={FONT_OPTIONS_WS}
                    value={noteAppearance.editorFont}
                    onUpdate={(value) => onSet('editorFont', value)}
                />
                <ControlGroup
                    label="Text width"
                    options={WIDTH_OPTIONS_WS}
                    value={noteAppearance.textWidth}
                    onUpdate={(value) => onSet('textWidth', value)}
                />
            </div>
        </Popup>
    );
}

interface ControlGroupProps<T extends string> {
    label: string;
    options: {value: T; content: ReactNode}[];
    value: T;
    onUpdate: (value: T) => void;
}

function ControlGroup<T extends string>({label, options, value, onUpdate}: ControlGroupProps<T>) {
    return (
        <div className="note-appearance__group">
            <Text color="secondary" className="note-appearance__label">
                {label}
            </Text>
            <SegmentedRadioGroup
                size="s"
                width="max"
                options={options}
                value={value}
                onUpdate={onUpdate}
                aria-label={label}
            />
        </div>
    );
}
