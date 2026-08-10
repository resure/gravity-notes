import {
    EDITOR_FONTS,
    type EditorFont,
    type Settings,
    TEXT_WIDTHS,
    type TextWidth,
} from '../hooks/useSettings';
import {Dialog} from '../ui/Dialog';
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
 * App preferences (⌘, / the orb menu) — §08.
 *
 * One section, because there is only one kind of setting left: the two engine rows configured a
 * rich editor that no longer exists, theme lives in the orb menu, and per-note overrides live in
 * the note's own ⋯ menu, beside the note. 620px with a 150px label column, and NO Save button —
 * every control commits on change and the app repaints live behind a 22% scrim, which is the whole
 * argument for a dialog you can see past.
 */
export function SettingsDialog({open, onClose, settings, setSetting}: SettingsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} title="Settings" width={620}>
            <section className="settings">
                {/* A label, not a heading: 10px mono caps over a hairline, the same object the
                    folder rail and the note list use over a group. It keeps the dialog from
                    reading as a settings *page*. */}
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
