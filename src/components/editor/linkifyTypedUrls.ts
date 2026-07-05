import {type ExtensionBuilder} from '@gravity-ui/markdown-editor';
import {InputRule} from 'prosemirror-inputrules';

/**
 * Marks the URL being disallowed from re-linking: already a link, inline code, or a wiki link.
 * (Block code is excluded by the rule's `inCodeMark` option, mirroring the wiki-link input rule.)
 */
const DISALLOWED_MARKS = new Set(['link', 'code', 'wiki_link']);

/**
 * Drop trailing punctuation the greedy `[^\s]+` swallowed, mirroring linkify-it's parse rules
 * (a `,`/`.`/`;`/… before whitespace is sentence punctuation, and an unbalanced `)` closes prose,
 * not the URL) — so a typed link's boundary matches what a reload's parse-path linkify produces,
 * and ⌘-click never opens `https://example.com,`.
 */
function trimTrailingPunctuation(url: string): string {
    let end = url.length;
    for (; end > 0; end--) {
        const char = url[end - 1];
        if ('.,;:!?'.includes(char)) continue;
        if (char === ')') {
            const body = url.slice(0, end);
            const opens = body.split('(').length - 1;
            const closes = body.split(')').length - 1;
            if (closes > opens) continue; // unbalanced — prose, not part of the URL
        }
        break;
    }
    return url.slice(0, end);
}

/**
 * Typing-time linkify: turn a just-typed bare `https://…` into a real link the moment whitespace
 * follows it. The load-time linkify (`md.linkify` + fuzzy off, see EditorPane) only runs at PARSE,
 * so without this a URL typed into an open note stayed plain text until the note was reloaded.
 *
 * The mark is created with the editor's `raw-link` attr, which its serializer honors by emitting
 * the BARE url — so a typed link round-trips byte-identical on disk (no `<url>` wrapping, unlike
 * parse-path links). Explicit http(s) only, mirroring the fuzzy-off parse config: a bare
 * `Notes.md` must never become a link.
 */
export function linkifyTypedUrls(builder: ExtensionBuilder): void {
    builder.addInputRules(({schema}) => {
        const markType = schema.marks.link;
        if (!markType) return {rules: []};
        return {
            rules: [
                new InputRule(
                    // A URL right before the caret, terminated by the whitespace being typed. The
                    // leading boundary keeps `foohttps://…` from matching mid-word.
                    /(?:^|\s)(https?:\/\/[^\s]+)(\s)$/,
                    (state, match, start, end) => {
                        // Only at a collapsed caret. When the typed whitespace REPLACES a
                        // selection, `end` is the selection END while the matched text sits
                        // before the selection START — the offsets below would mark the wrong
                        // span, and returning a transaction would supersede the default
                        // replace-selection insertion (leaving the selected text undeleted).
                        if (!state.selection.empty) return null;
                        const url = trimTrailingPunctuation(match[1]);
                        if (!/^https?:\/\/[^\s]/.test(url)) return null; // trimmed to a bare scheme
                        const from = end - match[1].length; // the trailing \s is the char being typed
                        if (from < start) return null; // defensive: boundary math went sideways
                        // The DOM-change input path can hand the rule a multi-char replacement
                        // (autocorrect); mark only what is verifiably in the doc at these offsets.
                        if (state.doc.textBetween(from, end) !== match[1]) return null;
                        // Don't relink text that is already a link / code / wiki link. `marksAcross`
                        // isn't needed — a URL is one text run; the marks at its start describe it.
                        const marks = state.doc.resolve(from + 1).marks();
                        if (marks.some((mark) => DISALLOWED_MARKS.has(mark.type.name))) {
                            return null;
                        }
                        return (
                            state.tr
                                .addMark(
                                    from,
                                    from + url.length, // trimmed punctuation stays outside the mark
                                    markType.create({href: url, 'raw-link': true}),
                                )
                                // The rule's transaction REPLACES the default insertion, so type the
                                // whitespace ourselves — outside the mark (no stored mark carried).
                                .insertText(match[2], end)
                                .removeStoredMark(markType)
                        );
                    },
                    // Never inside code blocks — same option the wiki-link input rule uses.
                    {inCodeMark: false},
                ),
            ],
        };
    });
}
