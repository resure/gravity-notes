import {Display, Moon, Sun} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon} from '@gravity-ui/uikit';

export type ThemePref = 'light' | 'dark' | 'system';

const OPTIONS: {value: ThemePref; label: string; icon: typeof Sun}[] = [
    {value: 'light', label: 'Light', icon: Sun},
    {value: 'dark', label: 'Dark', icon: Moon},
    {value: 'system', label: 'System', icon: Display},
];

interface ThemeSwitcherProps {
    pref: ThemePref;
    onChange: (pref: ThemePref) => void;
}

/** Header control to pick Light / Dark / System; System follows the OS scheme (handled by ThemeProvider). */
export function ThemeSwitcher({pref, onChange}: ThemeSwitcherProps) {
    const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[2];
    return (
        <DropdownMenu
            renderSwitcher={(props) => (
                <Button {...props} view="flat" size="m" title="Theme">
                    <Icon data={current.icon} />
                </Button>
            )}
            items={OPTIONS.map((o) => ({
                text: o.label,
                iconStart: <Icon data={o.icon} />,
                action: () => onChange(o.value),
            }))}
        />
    );
}
