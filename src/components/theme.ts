export type ThemePref = 'light' | 'dark' | 'system';

/**
 * Light / Dark / System, in menu order. System follows the OS scheme — App resolves it and stamps
 * the answer on `<html data-theme>`, so a CSS rule never has to be written twice.
 */
export const THEME_OPTIONS: {value: ThemePref; label: string}[] = [
    {value: 'light', label: 'Light'},
    {value: 'dark', label: 'Dark'},
    {value: 'system', label: 'System'},
];
