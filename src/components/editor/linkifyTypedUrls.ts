import {type ExtensionBuilder} from '@gravity-ui/markdown-editor';
import {InputRule} from 'prosemirror-inputrules';

/**
 * Marks the URL being disallowed from re-linking: already a link, inline code, or a wiki link.
 * (Block code is excluded by the rule's `inCodeMark` option, mirroring the wiki-link input rule.)
 */
const DISALLOWED_MARKS = new Set(['link', 'code', 'wiki_link']);

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
                        const url = match[1];
                        const from = end - url.length; // the trailing \s is the char being typed
                        if (from < start) return null; // defensive: boundary math went sideways
                        // Don't relink text that is already a link / code / wiki link. `marksAcross`
                        // isn't needed — a URL is one text run; the marks at its start describe it.
                        const marks = state.doc.resolve(from + 1).marks();
                        if (marks.some((mark) => DISALLOWED_MARKS.has(mark.type.name))) {
                            return null;
                        }
                        return (
                            state.tr
                                .addMark(from, end, markType.create({href: url, 'raw-link': true}))
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
