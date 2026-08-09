/**
 * Scope a flat stylesheet under a single root class.
 *
 * The block editor's stylesheet was written for an app that owned the whole page, so it uses
 * generic class names (`.page`, `.content`, `.block`). Dropping it into Gravity Notes unscoped
 * would let those rules reach anything in the app that happens to match, so every selector is
 * rewritten to sit under the editor's own root — `.editor-root` becomes the scope class itself,
 * everything else becomes a descendant of it.
 *
 * Deliberately a one-shot codemod, not part of the build: the scoped file is committed, so what
 * ships is the CSS you can read.
 *
 * ⚠️ DO NOT RE-RUN IT ON `editor.css`. The `startsWith(scope)` guard below makes a second pass look
 * harmless, and it isn't: the file has since been hand-edited with ANCESTOR-scoped rules
 * (`.g-root_theme_dark …`), which this script would rewrite into `.gn-block-editor .g-root_theme_dark …`.
 * The theme class lives on the Gravity ROOT, above the editor, so every dark-theme remapping would
 * simply stop matching — and nothing would fail loudly; the editor would just render light-mode ink
 * on a dark background. It is kept as provenance for how the vendored stylesheet was scoped.
 *
 * Usage: node scripts/scope-css.mjs <file> <root-class> <original-root-selector>
 */
import {readFileSync, writeFileSync} from 'node:fs';

const [file, scope, originalRoot] = process.argv.slice(2);
if (!file || !scope || !originalRoot) {
    console.error('usage: scope-css.mjs <file> <root-class> <original-root-selector>');
    process.exit(1);
}

const source = readFileSync(file, 'utf8');

/**
 * Rewrite one comma-separated selector list so every part sits under `.scope`.
 * @param list
 */
function scopeSelector(list) {
    return list
        .split(',')
        .map((raw) => {
            const selector = raw.trim();
            if (!selector || selector.startsWith('@') || selector.startsWith(scope))
                return selector;
            // The root element carries the scope class itself, so its own rules attach directly.
            if (selector === originalRoot) return scope;
            if (selector.startsWith(`${originalRoot} `)) {
                return `${scope}${selector.slice(originalRoot.length)}`;
            }
            if (
                selector.startsWith(`${originalRoot}:`) ||
                selector.startsWith(`${originalRoot}.`)
            ) {
                return `${scope}${selector.slice(originalRoot.length)}`;
            }
            return `${scope} ${selector}`;
        })
        .join(',\n');
}

/**
 * Walk top-level blocks. `:root`, `@keyframes`, and `@font-face` are left alone (they define
 * variables/animations, not element rules); `@media` bodies are scoped recursively.
 * @param css
 */
function scopeBlock(css) {
    let out = '';
    let index = 0;
    while (index < css.length) {
        const brace = css.indexOf('{', index);
        if (brace === -1) {
            out += css.slice(index);
            break;
        }
        const prelude = css.slice(index, brace);
        // Comments and blank lines ride in front of a rule's selector — keep them verbatim and
        // scope only the selector text, or the comment ends up glued into the selector. (A comment
        // *inside* a selector list would defeat this; the stylesheet has none.)
        const commentEnd = prelude.lastIndexOf('*/');
        const head = commentEnd === -1 ? '' : prelude.slice(0, commentEnd + 2);
        const rest = commentEnd === -1 ? prelude : prelude.slice(commentEnd + 2);
        const before = head + rest.slice(0, rest.length - rest.trimStart().length);
        const selector = rest.trim();
        const end = matchingBrace(css, brace);
        const body = css.slice(brace + 1, end);

        if (selector.startsWith('@media') || selector.startsWith('@supports')) {
            out += `${before}${selector} {${scopeBlock(body)}}`;
        } else if (
            selector === ':root' ||
            selector.startsWith('@keyframes') ||
            selector.startsWith('@font-face')
        ) {
            out += `${before}${selector} {${body}}`;
        } else {
            out += `${before}${scopeSelector(selector)} {${body}}`;
        }
        index = end + 1;
    }
    return out;
}

/**
 * Index of the `}` closing the `{` at `open`.
 * @param css
 * @param open
 */
function matchingBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return css.length - 1;
}

writeFileSync(file, scopeBlock(source));
console.log(`scoped ${file} under ${scope}`);
