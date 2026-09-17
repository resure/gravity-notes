import {createRef} from 'react';

import {fireEvent, render} from '@testing-library/react';
import {act} from 'react-dom/test-utils';
import {describe, expect, it, vi} from 'vitest';

import type {Note} from '../storage/types';

import {BlockEditorBody, type BlockEditorBodyHandle} from './BlockEditorBody';

function note(id: string, content: string): Note {
    return {id, title: id.replace(/\.md$/, ''), content, updatedAt: 1};
}

describe('BlockEditorBody — the raw-Markdown escape hatch', () => {
    /**
     * The pane is not keyed, so this component (and its ⌘⇧; mode flag) survives a note switch. The
     * textarea is uncontrolled, and once the user has typed in it the browser sets its dirty-value
     * flag — after which the HTML spec says a changed `defaultValue` is IGNORED. So switching notes
     * in markup mode left note A's source on screen under note B's title, and the next keystroke
     * autosaved A's body into B's file. Keying the textarea on the session forces the remount that
     * makes the new note's text actually appear.
     */
    it('shows the new note after a switch made while in markup mode', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        const props = {
            preview: false,
            onChange,
            onUploadFile: async () => '',
            onOpenWikiLink: () => {},
            wikiNotes: [],
        };

        const {rerender} = render(
            <BlockEditorBody ref={ref} note={note('A.md', 'AAA body')} sessionId={1} {...props} />,
        );

        act(() => ref.current!.toggleMode());
        const textarea = () => document.querySelector<HTMLTextAreaElement>('.block-editor-markup')!;
        expect(textarea().value).toBe('AAA body');

        // Type, so the textarea's dirty-value flag is set — this is what made `defaultValue` inert.
        act(() => {
            textarea().value = 'AAA edited';
            textarea().dispatchEvent(new Event('input', {bubbles: true}));
        });
        onChange.mockClear();

        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('B.md', 'BBB other note')}
                sessionId={2}
                {...props}
            />,
        );

        expect(textarea().value).toBe('BBB other note');
        // …and crucially, the switch itself must not report A's text as an edit to B.
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('BlockEditorBody — leaving the raw view', () => {
    const props = {
        preview: false,
        onUploadFile: async () => '',
        onOpenWikiLink: () => {},
        wikiNotes: [],
    };
    const textarea = () => document.querySelector<HTMLTextAreaElement>('.block-editor-markup');

    /**
     * `forceSource` is decided once per load, from the file on disk — but the textarea is fully
     * editable. A note that loaded clean can be given frontmatter here, and re-entering blocks would
     * parse it, drop what the model can't hold, and autosave the loss. The way back is therefore
     * guarded against the LIVE buffer, not against the note as loaded.
     */
    it('refuses to re-enter blocks when the hand-edited source cannot round-trip', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const onChange = vi.fn();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={onChange}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        expect(textarea()).not.toBeNull();

        // Frontmatter: the parser reads `---` as a divider and the keys as paragraphs.
        // fireEvent.change, not a raw `input`: React 18 tracks the last value it set, so assigning
        // `.value` directly makes it think nothing changed and onChange never runs.
        act(() => {
            fireEvent.change(textarea()!, {target: {value: '---\ntitle: x\n---\n\nplain body'}});
        });

        act(() => ref.current!.toggleMode());
        // Still on source, and now saying why.
        expect(textarea()).not.toBeNull();
        expect(document.querySelector('.block-editor-source__notice')?.textContent).toMatch(
            /can’t represent/,
        );
    });

    it('releases the latch once the source round-trips again', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={vi.fn()}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        act(() => {
            fireEvent.change(textarea()!, {target: {value: '#### too deep'}});
        });
        act(() => ref.current!.toggleMode()); // refused — latched on source
        expect(textarea()).not.toBeNull();

        // Undo the offending edit: the blocks surface has to come back, or the latch would strand
        // the user on the textarea for the rest of the session.
        act(() => {
            fireEvent.change(textarea()!, {target: {value: 'plain body again'}});
        });
        act(() => ref.current!.toggleMode());
        expect(textarea()).toBeNull();
    });

    it('does not carry the latch into the next note', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        const {rerender} = render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={vi.fn()}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        act(() => {
            fireEvent.change(textarea()!, {target: {value: '#### too deep'}});
        });
        act(() => ref.current!.toggleMode());
        expect(textarea()).not.toBeNull();

        // This component is NOT keyed, so it outlives the switch — the latch has to be cleared by
        // hand or note B opens on the textarea blaming edits the user never made to it.
        rerender(
            <BlockEditorBody
                ref={ref}
                note={note('B.md', 'a totally clean body')}
                sessionId={2}
                onChange={vi.fn()}
                {...props}
            />,
        );
        // `markup` deliberately survives a switch, so B is on the textarea either way — the thing
        // the reset fixes is the NOTICE, which otherwise blames B for edits made in A.
        expect(document.querySelector('.block-editor-source__notice')).toBeNull();
        act(() => ref.current!.toggleMode()); // B opened in markup (that flag does persist)
        expect(textarea()).toBeNull();
    });

    it('still returns to blocks when the source edit round-trips cleanly', () => {
        const ref = createRef<BlockEditorBodyHandle>();
        render(
            <BlockEditorBody
                ref={ref}
                note={note('A.md', 'plain body')}
                sessionId={1}
                onChange={vi.fn()}
                {...props}
            />,
        );

        act(() => ref.current!.toggleMode());
        act(() => {
            fireEvent.change(textarea()!, {target: {value: 'plain body, edited'}});
        });
        act(() => ref.current!.toggleMode());

        expect(textarea()).toBeNull();
        expect(document.querySelector('.gn-block-editor')).not.toBeNull();
    });
});
