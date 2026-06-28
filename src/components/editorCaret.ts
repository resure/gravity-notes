/**
 * True when the current DOM selection's caret sits on the first visual line of `container`.
 * Decides whether ArrowUp in the body should hand off to the title. Works for both the
 * WYSIWYG (ProseMirror) and Markup (CodeMirror) contenteditables since it measures the live
 * DOM selection. Layout-based (getBoundingClientRect), so it's covered by manual/Chromium
 * testing rather than jsdom; EditorPane tests mock this module.
 */
export function isCaretOnFirstLine(container: HTMLElement): boolean {
    const win = container.ownerDocument.defaultView;
    const sel = win?.getSelection();
    if (!sel || sel.rangeCount === 0) return false;

    const caret = sel.getRangeAt(0).cloneRange();
    caret.collapse(true);
    const caretTop = rangeTop(caret);
    if (caretTop === null) return false;

    // The first line's top = the first block child's top, measured off the *element* rect — not a
    // range collapsed at the content start, which WebKit gives a bogus (0,0) rect (that made this
    // always false: the caret was never recognized as the first line). Measuring against the real
    // first line — instead of the wrapper's top plus a line-height guess — also stops a wrapper's
    // larger inherited line-height from wrongly counting line 2+ as the first line. The content
    // line-height drives the tolerance.
    const editable = container.querySelector<HTMLElement>('[contenteditable="true"]') ?? container;
    const firstBlock = editable.firstElementChild ?? editable;
    const firstTop = firstBlock.getBoundingClientRect().top;

    const lineHeight = parseFloat(win ? win.getComputedStyle(editable).lineHeight : '') || 20;
    // On the first line when the caret is within half a line of that first line's top.
    return caretTop - firstTop < lineHeight * 0.5;
}

/** Top of a collapsed range's caret rect, or null when it carries no usable layout info. */
function rangeTop(range: Range): number | null {
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0].top;
    const rect = range.getBoundingClientRect();
    // A fully-zeroed rect means "no layout" (e.g. an empty editable) — unmeasurable.
    if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.width === 0) return null;
    return rect.top;
}
