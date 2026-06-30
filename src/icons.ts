import {FileText} from '@gravity-ui/icons';
import * as gravityIcons from '@gravity-ui/icons';
import type {IconData} from '@gravity-ui/uikit';

import iconsMetadata from '@gravity-ui/icons/metadata.json';

export interface IconMeta {
    name: string;
    style: string;
    svgName: string;
    componentName: string;
    keywords: string[];
}

export interface IconItem {
    name: string;
    data: IconData;
    meta?: IconMeta;
    /** Pre-lowercased fields for fast case-insensitive filtering (not serialized). */
    lowerName: string;
    lowerMeta: string;
    lowerKeywords: string[];
}

const byComponentName = new Map(
    (iconsMetadata.icons as IconMeta[]).map((m) => [m.componentName, m]),
);

export const allIcons: IconItem[] = Object.entries(gravityIcons as Record<string, IconData>)
    .map(([name, data]) => {
        const meta = byComponentName.get(name);
        return {
            name,
            data,
            meta,
            lowerName: name.toLowerCase(),
            lowerMeta: meta?.name.toLowerCase() ?? '',
            lowerKeywords: meta?.keywords.map((k) => k.toLowerCase()) ?? [],
        };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

const dataByName = new Map(allIcons.map((i) => [i.name, i.data]));

/** A stored icon value resolved for rendering: either a Gravity icon or a literal emoji. */
export type ResolvedIcon = {kind: 'icon'; data: IconData} | {kind: 'emoji'; char: string};

/**
 * Resolve a stored icon value for display. Gravity component names (ASCII PascalCase) live in the
 * catalog; any other non-empty value is treated as a literal emoji character (stored verbatim in the
 * metadata sidecar). Falls back to the File icon when unset or an unknown component name.
 */
export function resolveIcon(value?: string): ResolvedIcon {
    if (value) {
        const data = dataByName.get(value);
        if (data) return {kind: 'icon', data};
        if (!dataByName.has(value)) return {kind: 'emoji', char: value};
    }
    return {kind: 'icon', data: FileText};
}

/** Resolve a stored component name to its icon data, falling back to the File icon when unset/unknown. */
export function iconByName(name?: string): IconData {
    return (name && dataByName.get(name)) || FileText;
}

/** Filter the catalog by a trimmed, case-insensitive query (matches component name or keywords). */
export function filterIcons(query: string): IconItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return allIcons;
    return allIcons.filter(
        (i) =>
            i.lowerName.includes(q) ||
            i.lowerMeta.includes(q) ||
            i.lowerKeywords.some((k) => k.includes(q)),
    );
}

export interface EmojiItem {
    /** The literal emoji character (skins[0].native), e.g. `"😀"`. Stored verbatim as the icon value. */
    char: string;
    /** Human-readable name, e.g. `"Grinning Face"`. */
    name: string;
    /** Pre-lowercased fields for fast case-insensitive filtering (not serialized). */
    lowerName: string;
    lowerKeywords: string[];
}

let emojisPromise: Promise<EmojiItem[]> | undefined;

/**
 * Lazily load the emoji catalog from `@emoji-mart/data` (kept out of the initial bundle via dynamic
 * `import()`). Iterated in category order for a natural layout; base skin tone only. Memoized.
 */
export function loadEmojis(): Promise<EmojiItem[]> {
    if (!emojisPromise) {
        emojisPromise = import('@emoji-mart/data').then((mod) => {
            const data = (mod.default ?? mod) as import('@emoji-mart/data').EmojiMartData;
            const items: EmojiItem[] = [];
            for (const category of data.categories) {
                for (const id of category.emojis) {
                    const emoji = data.emojis[id];
                    const char = emoji?.skins[0]?.native;
                    if (!char) continue;
                    items.push({
                        char,
                        name: emoji.name,
                        lowerName: emoji.name.toLowerCase(),
                        lowerKeywords: emoji.keywords.map((k) => k.toLowerCase()),
                    });
                }
            }
            return items;
        });
    }
    return emojisPromise;
}

/** Filter emojis by a trimmed, case-insensitive query (matches name or keyword/alias). */
export function filterEmojis(query: string, emojis: EmojiItem[]): EmojiItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return emojis;
    return emojis.filter(
        (e) => e.lowerName.includes(q) || e.lowerKeywords.some((k) => k.includes(q)),
    );
}
