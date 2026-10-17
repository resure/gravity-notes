import {forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef} from 'react';

/** What the pane asks of the raw-Markdown surface, whichever editor draws it. */
export interface SourceHandle {
    focus(): void;
    blur(): void;
    moveCursor(to: 'start' | 'end'): void;
    /** The caret alone, at the start of an empty first line: Backspace there leaves for the title. */
    atEmptyFirstLine(): boolean;
}

export interface SourceSurfaceProps {
    /**
     * The text to start from, read once at mount (the surface is keyed per editing session). A
     * getter, not a value: CodeMirror replaces the loading textarea later, after edits made in it
     * that never re-rendered the parent.
     */
    readValue(): string;
    onChange(text: string): void;
    autoFocus?: boolean;
}

// Set while the loading fallback holds focus, so CodeMirror can take it over when it replaces it.
export const fallbackFocus = {held: false};

/** The plain textarea: what source mode shows while CodeMirror loads, and in tests. */
export const TextareaSource = forwardRef<SourceHandle, SourceSurfaceProps>(function TextareaSource(
    {readValue, onChange, autoFocus},
    ref,
) {
    const markupRef = useRef<HTMLTextAreaElement>(null);

    /**
     * Grow the textarea to its content, so the PANE scrolls it — exactly as it scrolls the blocks.
     *
     * A textarea doesn't size itself, and a fixed box inside a scrolling pane gives a long note two
     * scrollbars and one usable screenful: flipping to source on a 180-line note showed its first
     * 20 lines with the rest reachable only by scrolling inside the box, while the pane below it sat
     * empty. The two surfaces read as different notes.
     */
    const autosize = useCallback(() => {
        const element = markupRef.current;
        if (!element) return;
        // Both writes are load-bearing: `auto` is what lets the box SHRINK, so the measurement that
        // follows has to be written back even when it matches — skipping it leaves the textarea at
        // its default two rows.
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight}px`;
    }, []);

    // On the way in, and whenever the box's WIDTH changes — a resized window, a dragged divider or a
    // different text width all re-wrap the text, which is what decides the height.
    useLayoutEffect(() => {
        const element = markupRef.current;
        if (autoFocus) element?.focus();
        // Runs while the textarea is still in the document, so it can still be asked.
        return () => {
            fallbackFocus.held = document.activeElement === element;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at mount
    }, []);

    useLayoutEffect(() => {
        autosize();
        const element = markupRef.current;
        if (!element?.parentElement || typeof ResizeObserver === 'undefined') return undefined;
        let lastWidth = element.clientWidth;
        // The PARENT is observed, never the textarea: observing the element whose height this
        // callback sets is a feedback loop.
        const observer = new ResizeObserver(() => {
            const width = element.clientWidth;
            if (width === lastWidth) return;
            lastWidth = width;
            autosize();
        });
        observer.observe(element.parentElement);
        return () => observer.disconnect();
    }, [autosize]);

    useImperativeHandle(ref, () => ({
        focus: () => markupRef.current?.focus(),
        blur: () => markupRef.current?.blur(),
        moveCursor(to) {
            const markup = markupRef.current;
            if (!markup) return;
            const at = to === 'start' ? 0 : markup.value.length;
            markup.setSelectionRange(at, at);
        },
        atEmptyFirstLine() {
            const markup = markupRef.current;
            if (!markup || document.activeElement !== markup) return false;
            // Collapsed, or ⌘A on a note whose first line is blank also starts at 0 — and the pane
            // would then hand Backspace to the title instead of deleting the selection, swallowing
            // a select-all-and-delete entirely.
            if (markup.selectionStart !== markup.selectionEnd) return false;
            return markup.selectionStart === 0 && markup.value.split('\n')[0] === '';
        },
    }));

    return (
        <textarea
            ref={markupRef}
            className="block-editor-markup"
            aria-label="Markdown source"
            // Unset so it inherits Settings › Check spelling from the pane wrapper, the way the
            // blocks surface does — the setting covers both modes.
            defaultValue={readValue()}
            onChange={(event) => {
                onChange(event.target.value);
                autosize();
            }}
        />
    );
});
