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
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    const caretRect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const lineHeight = parseFloat(win ? win.getComputedStyle(container).lineHeight : '') || 20;
    // Within ~¾ of a line of the content top counts as the first line.
    return caretRect.top - containerRect.top < lineHeight * 0.75;
}
