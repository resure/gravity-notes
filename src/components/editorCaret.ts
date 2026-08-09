/**
 * True when the current DOM selection's caret sits on the first visual line of `container`.
 * Decides whether ArrowUp in the body should hand off to the title. Engine-agnostic — it measures
 * the live DOM selection rather than any editor's model. Layout-based (getBoundingClientRect), so
 * it's covered by manual/Chromium testing rather than jsdom; EditorPane tests mock this module.
 */
export function isCaretOnFirstLine(container: HTMLElement): boolean {
    const win = container.ownerDocument.defaultView;
    const sel = win?.getSelection();
    if (!sel || sel.rangeCount === 0) return false;

    // The first line's top = the first block child's top, measured off the *element* rect — not a
    // range collapsed at the content start, which WebKit gives a bogus (0,0) rect (that made this
    // always false: the caret was never recognized as the first line). Measuring against the real
    // first line — instead of the wrapper's top plus a line-height guess — also stops a wrapper's
    // larger inherited line-height from wrongly counting line 2+ as the first line. The content
    // line-height drives the tolerance.
    const editable = container.querySelector<HTMLElement>('[contenteditable="true"]') ?? container;
    const firstBlock = editable.firstElementChild ?? editable;

    const caret = sel.getRangeAt(0).cloneRange();
    caret.collapse(true);
    const caretTop = rangeTop(caret);
    if (caretTop === null) {
        // An empty line gives the caret no rect at all (getClientRects() empty, bounding rect
        // all-zero — WebKit and Chromium both). Can't measure — fall back to structure. Without
        // this, ArrowUp off an empty first line (e.g. a blank note, or a note that opens with a
        // blank row) never hands off to the title. Containment is tested on the collapsed range
        // start — like the measured path above — not sel.anchorNode, which sits at the far end
        // of a backward selection (Shift+ArrowUp from a lower block onto the first line).
        if (!firstBlock.contains(caret.startContainer)) return false;
        // Inside the first block, "no rect" can also mean an empty line further down: the empty
        // continuation line after a hard break (`<p>text<br>|</p>`, the Shift+Enter shape), or
        // an empty paragraph/item deeper in a compound first block (a leading list/blockquote —
        // block boundaries break lines without any <br>). Handing off from those would steal
        // ArrowUp from moving up within the block. First line ⇔ nothing renders a line break
        // between the block start and the caret; comparePoint((node, 0)) < 0 ⇔ the node starts
        // strictly before the caret.
        for (const br of firstBlock.querySelectorAll('br')) {
            // A block's TRAILING <br> is the browser's rendering placeholder, not a line break the
            // user typed: it marks the END of the caret's own line, never an earlier one (a caret
            // can only sit past it at the same document position — `text<br>|`, still that line).
            // Every real soft break has content after it, so this only ever skips the placeholder.
            if (br.parentElement?.lastChild === br) continue;
            if (caret.comparePoint(br, 0) < 0) return false;
        }
        for (const el of firstBlock.querySelectorAll(LINE_BREAKING_BLOCKS)) {
            // A block that closed before the caret (starts before it, doesn't contain it) ends a
            // visual line at its boundary.
            if (caret.comparePoint(el, 0) < 0 && !el.contains(caret.startContainer)) return false;
        }
        return true;
    }

    const firstTop = firstBlock.getBoundingClientRect().top;

    const lineHeight = parseFloat(win ? win.getComputedStyle(editable).lineHeight : '') || 20;
    // On the first line when the caret is within half a line of that first line's top.
    return caretTop - firstTop < lineHeight * 0.5;
}

/**
 * Elements whose closing edge ends a visual line, unlike inline marks (em/strong/a/code spans).
 * Table cells are absent on purpose — cells sit side by side on one line; the row breaks it.
 */
const LINE_BREAKING_BLOCKS =
    'p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, pre, div, table, thead, tbody, tr, figure, hr';

/** Top of a collapsed range's caret rect, or null when it carries no usable layout info. */
function rangeTop(range: Range): number | null {
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0].top;
    const rect = range.getBoundingClientRect();
    // A fully-zeroed rect means "no layout" (e.g. an empty editable) — unmeasurable.
    if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.width === 0) return null;
    return rect.top;
}
