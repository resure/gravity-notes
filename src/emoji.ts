/**
 * Note icons are emoji: the sidecar's `icons` map holds the literal character. Older builds also
 * stored Gravity icon names there (`"Star"`); those are kept on disk untouched but not shown.
 */

export interface EmojiItem {
    /** The literal emoji character (base skin tone), stored verbatim as the icon value. */
    char: string;
    name: string;
    /** Pre-lowercased fields for fast case-insensitive filtering. */
    lowerName: string;
    lowerKeywords: string[];
}

/** A stored icon value the app shows: anything but an ASCII component name from an older build. */
export function emojiIcon(value: string | undefined): string | null {
    if (!value || /^[A-Za-z][A-Za-z0-9]*$/.test(value)) return null;
    return value;
}

let emojisPromise: Promise<EmojiItem[]> | undefined;

/** The emoji catalog, loaded once and on demand so it stays out of the startup bundle. */
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

/** Filter by a trimmed, case-insensitive query against name and keywords. */
export function filterEmojis(query: string, emojis: EmojiItem[]): EmojiItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return emojis;
    return emojis.filter(
        (e) => e.lowerName.includes(q) || e.lowerKeywords.some((k) => k.includes(q)),
    );
}
