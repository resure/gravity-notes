import {FileText} from '@gravity-ui/icons';
import type {IconData} from '@gravity-ui/uikit';

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

export interface IconCatalog {
    /** Every Gravity icon, sorted by component name. */
    all: IconItem[];
    /** Component name → icon data, for O(1) resolution. */
    byName: Map<string, IconData>;
}

// The full @gravity-ui/icons set (~1500 components) + its metadata.json weighs ~110 KB gzip, and most
// launches never render a custom icon (notes default to the File icon) — so load it as a SEPARATE chunk
// on demand: the first time a component-name icon is rendered (see useIcon in IconPicker) or the picker
// opens. Emojis (non-ASCII values) render with no catalog at all. `catalogVersion` bumps once loaded so
// useSyncExternalStore subscribers re-render and swap the File placeholder → the real icon.
let catalog: IconCatalog | null = null;
let catalogPromise: Promise<IconCatalog> | null = null;
let catalogVersion = 0;
const catalogListeners = new Set<() => void>();

/** Lazily load (once) the Gravity icon catalog + its search metadata. Memoized; notifies subscribers. */
export function loadIconCatalog(): Promise<IconCatalog> {
    if (!catalogPromise) {
        catalogPromise = Promise.all([
            import('@gravity-ui/icons'),
            import('@gravity-ui/icons/metadata.json'),
        ]).then(([iconsMod, metaMod]) => {
            const gravityIcons = iconsMod as unknown as Record<string, IconData>;
            const meta = metaMod as {default?: {icons: IconMeta[]}; icons?: IconMeta[]};
            const metaIcons = meta.default?.icons ?? meta.icons ?? [];
            const byComponentName = new Map(metaIcons.map((m) => [m.componentName, m]));
            const all: IconItem[] = Object.entries(gravityIcons)
                .filter(([name]) => name !== 'default' && name !== '__esModule')
                .map(([name, data]) => {
                    const iconMeta = byComponentName.get(name);
                    return {
                        name,
                        data,
                        meta: iconMeta,
                        lowerName: name.toLowerCase(),
                        lowerMeta: iconMeta?.name.toLowerCase() ?? '',
                        lowerKeywords: iconMeta?.keywords.map((k) => k.toLowerCase()) ?? [],
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name));
            catalog = {all, byName: new Map(all.map((i) => [i.name, i.data]))};
            catalogVersion += 1;
            for (const listener of catalogListeners) listener();
            return catalog;
        });
    }
    return catalogPromise;
}

/** The loaded catalog, or null until {@link loadIconCatalog} resolves. */
export function getIconCatalog(): IconCatalog | null {
    return catalog;
}

/** Subscribe to catalog-load (for `useSyncExternalStore`); returns an unsubscribe. */
export function subscribeIconCatalog(onChange: () => void): () => void {
    catalogListeners.add(onChange);
    return () => {
        catalogListeners.delete(onChange);
    };
}

/** A snapshot that changes once the catalog loads (`useSyncExternalStore` getSnapshot). */
export function getIconCatalogVersion(): number {
    return catalogVersion;
}

/** A stored icon value resolved for rendering: either a Gravity icon or a literal emoji. */
export type ResolvedIcon = {kind: 'icon'; data: IconData} | {kind: 'emoji'; char: string};

/** Gravity component names are ASCII PascalCase (e.g. `"Star"`); emoji are their literal (non-ASCII) char. */
const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
export function isComponentName(value: string): boolean {
    return COMPONENT_NAME.test(value);
}

/**
 * Resolve a stored icon value for display. A component-name value renders as its Gravity icon once the
 * catalog has loaded (the File icon until then, or if the name is unknown); any other non-empty value is
 * a literal emoji character, rendered immediately (no catalog needed). Unset → the default File icon.
 */
export function resolveIcon(value?: string): ResolvedIcon {
    if (!value) return {kind: 'icon', data: FileText};
    if (isComponentName(value)) {
        return {kind: 'icon', data: catalog?.byName.get(value) ?? FileText};
    }
    return {kind: 'emoji', char: value};
}

/** Resolve a component name to its icon data, falling back to the File icon when unset/unknown/unloaded. */
export function iconByName(name?: string): IconData {
    return (name ? catalog?.byName.get(name) : undefined) ?? FileText;
}

/** Filter a catalog list by a trimmed, case-insensitive query (matches component name, meta name, or keywords). */
export function filterIcons(query: string, icons: IconItem[]): IconItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return icons;
    return icons.filter(
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
