import {Display, Moon, Sun} from '@gravity-ui/icons';

export type ThemePref = 'light' | 'dark' | 'system';

/** Light / Dark / System, in menu order. System follows the OS scheme (handled by ThemeProvider). */
export const THEME_OPTIONS: {value: ThemePref; label: string; icon: typeof Sun}[] = [
    {value: 'light', label: 'Light', icon: Sun},
    {value: 'dark', label: 'Dark', icon: Moon},
    {value: 'system', label: 'System', icon: Display},
];
