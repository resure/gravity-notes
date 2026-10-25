import {
    EDITOR_FONTS,
    type EditorFont,
    type Settings,
    TEXT_WIDTHS,
    type TextWidth,
} from '../hooks/useSettings';
import {Dialog} from '../ui/Dialog';
import {Switch} from '../ui/Switch';
import {ToggleGroup} from '../ui/ToggleGroup';

import './SettingsDialog.css';

/**
 * Labels keyed by the full union (`Record` exhaustiveness), and options DERIVED from the canonical
 * value arrays — the same arrays `oneOf` validates persisted values against. A new union member
 * fails typecheck here until it's labeled, and then appears in the strip automatically; the strip
 * can never silently offer less than storage accepts.
 */
const FONT_LABELS: Record<EditorFont, string> = {sans: 'Sans', serif: 'Serif', mono: 'Mono'};
const WIDTH_LABELS: Record<TextWidth, string> = {
    narrow: 'Narrow',
    normal: 'Default',
    wide: 'Wide',
    unlimited: 'Unlimited',
};

const FONT_OPTIONS = EDITOR_FONTS.map((value) => ({value, content: FONT_LABELS[value]}));
const WIDTH_OPTIONS = TEXT_WIDTHS.map((value) => ({value, content: WIDTH_LABELS[value]}));

interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
    settings: Settings;
    setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/**
 * App preferences (⌘, / the orb menu) — §08. Label left, value right, and NO Save button:
 * every control commits on change and the app repaints live behind the scrim. Per-note overrides
 * live in the note's own ⋯ menu, beside the note.
 */
export function SettingsDialog({open, onClose, settings, setSetting}: SettingsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} title="Settings" width={520}>
            <section className="settings">
                <h3 className="settings__section-label">Editor</h3>
                <div className="settings__row">
                    <span className="settings__label">Show editor toolbar</span>
                    <Switch
                        aria-label="Show editor toolbar"
                        checked={settings.showEditorToolbar}
                        onChange={(value) => setSetting('showEditorToolbar', value)}
                    />
                </div>
                <div className="settings__row">
                    <span className="settings__label">
                        Show note icons <span className="settings__tag">Experimental</span>
                    </span>
                    <Switch
                        aria-label="Show note icons"
                        checked={settings.showNoteIcons}
                        onChange={(value) => setSetting('showNoteIcons', value)}
                    />
                </div>
                <div className="settings__row">
                    <span className="settings__label">Check spelling</span>
                    <Switch
                        aria-label="Check spelling"
                        checked={settings.spellcheck}
                        onChange={(value) => setSetting('spellcheck', value)}
                    />
                </div>
            </section>
            <section className="settings">
                {/* A label, not a heading: 10px mono caps over a hairline, the same object the
                    folder rail and the note list use over a group. */}
                <h3 className="settings__section-label">Appearance</h3>
                <div className="settings__row">
                    <span className="settings__label">Editor font</span>
                    <ToggleGroup
                        aria-label="Editor font"
                        options={FONT_OPTIONS}
                        value={settings.editorFont}
                        onChange={(value) => setSetting('editorFont', value)}
                    />
                </div>
                <div className="settings__row">
                    <span className="settings__label">Text width</span>
                    <ToggleGroup
                        aria-label="Text width"
                        options={WIDTH_OPTIONS}
                        value={settings.textWidth}
                        onChange={(value) => setSetting('textWidth', value)}
                    />
                </div>
                <p className="settings__note">
                    A single note can depart from this in its own ⋯ menu, where “Default” inherits
                    what is set here.
                </p>
            </section>
        </Dialog>
    );
}
