import {type ComponentProps, createRef} from 'react';

import {act, fireEvent, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {loadEmojis, loadIconCatalog} from '../icons';
import type {NoteMeta} from '../storage/types';
import {renderWithProviders} from '../test/render';

import {NoteList, type NoteListHandle, type NoteListProps} from './NoteList';

const selectRenders = vi.hoisted(() => ({count: 0}));

vi.mock('@gravity-ui/uikit', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@gravity-ui/uikit')>();
    return {
        ...actual,
        Select: (props: ComponentProps<typeof actual.Select>) => {
            selectRenders.count += 1;
            return <actual.Select {...props} />;
        },
    };
});

const layoutProperties = [
    'clientHeight',
    'offsetHeight',
    'clientWidth',
    'scrollHeight',
    'scrollTo',
];
const originalLayout = new Map(
    layoutProperties.map((property) => [
        property,
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, property),
    ]),
);

beforeEach(() => {
    for (const property of ['clientHeight', 'offsetHeight', 'clientWidth', 'scrollHeight']) {
        Object.defineProperty(HTMLElement.prototype, property, {
            configurable: true,
            get(this: HTMLElement) {
                if (!this.classList.contains('virtual-scroll')) {
                    return originalLayout.get(property)?.get?.call(this) ?? 0;
                }
                if (property === 'clientWidth') return 324;
                if (property === 'scrollHeight') {
                    return Math.max(
                        240,
                        parseFloat((this.firstElementChild as HTMLElement)?.style.height) || 0,
                    );
                }
                return 240;
            },
        });
    }
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value(this: HTMLElement, options: ScrollToOptions) {
            const top = Math.max(
                0,
                Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight),
            );
            if (top === this.scrollTop) return;
            this.scrollTop = top;
            this.dispatchEvent(new Event('scroll'));
        },
    });
});

afterEach(() => {
    for (const property of layoutProperties) {
        const original = originalLayout.get(property);
        if (original) Object.defineProperty(HTMLElement.prototype, property, original);
        else Reflect.deleteProperty(HTMLElement.prototype, property);
    }
});

function makeNotes(count = 80): NoteMeta[] {
    return Array.from({length: count}, (_, index) => ({
        id: `Note${String(index).padStart(3, '0')}.md`,
        title: `Note ${String(index).padStart(3, '0')}`,
        updatedAt: index + 1,
        preview: `Preview ${index}`,
    }));
}

function setup(overrides: Partial<NoteListProps> = {}) {
    let props: NoteListProps = {
        notes: makeNotes(),
        selectedId: 'Note000.md',
        query: '',
        scopeLabel: null,
        showCrumbs: false,
        searchInputRef: createRef<HTMLInputElement>(),
        onBrowse: vi.fn(),
        onCommit: vi.fn(),
        onEscapeList: vi.fn(),
        onCreate: vi.fn(),
        onRequestMove: vi.fn(),
        onDuplicate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        sortMode: 'updated',
        onSortChange: vi.fn(),
        pinnedIds: [],
        onTogglePin: vi.fn(),
        icons: {},
        onSetIcon: vi.fn(),
        showIcons: false,
        railOpen: false,
        onToggleRail: vi.fn(),
        onFocusRail: vi.fn(),
        ...overrides,
    };
    const ref = createRef<NoteListHandle>();
    const view = renderWithProviders(<NoteList ref={ref} {...props} />);
    const scroller = view.container.querySelector<HTMLDivElement>('.note-list__items');
    if (!scroller) throw new Error('Missing note scroller');
    const sizer = scroller.firstElementChild as HTMLElement;
    return {
        props,
        ref,
        scroller,
        sizer,
        rerender(next: Partial<NoteListProps>) {
            props = {...props, ...next};
            view.rerender(<NoteList ref={ref} {...props} />);
        },
    };
}

function scrollTo(scroller: HTMLElement, top: number) {
    act(() => scroller.scrollTo({top}));
}

function row(title: string) {
    return screen.getByRole('option', {name: new RegExp(title)});
}

describe('NoteList scroll window', () => {
    it('windows notes and files across their boundary without rendering the toolbar on scroll', () => {
        const {props, scroller, sizer} = setup({
            files: Array.from({length: 8}, (_, index) => ({
                id: `Report${index}.pdf`,
                name: `Report${index}.pdf`,
            })),
        });
        expect(screen.getAllByRole('option').length).toBeLessThan(25);
        expect(screen.queryByText('Note 079')).not.toBeInTheDocument();
        expect(screen.queryByText('Report0.pdf')).not.toBeInTheDocument();
        expect(sizer.style.height).toBe('4224px');
        expect(selectRenders.count).toBeGreaterThan(0);
        selectRenders.count = 0;

        scrollTo(scroller, 77 * 48);

        expect(row('Note 079').parentElement).toHaveStyle({
            height: '48px',
            transform: 'translateY(3792px)',
        });
        const files = screen.getByRole('list', {name: 'Other files'});
        expect(within(files).getByText('Report0.pdf').closest('[role="listitem"]')).toHaveStyle({
            transform: 'translateY(3840px)',
        });
        expect(within(files).getAllByRole('listitem')).toHaveLength(8);
        expect(screen.getAllByRole('option').length).toBeLessThan(25);
        fireEvent.click(within(files).getByText('Report0.pdf'));
        expect(props.onBrowse).not.toHaveBeenCalled();
        expect(props.onCommit).not.toHaveBeenCalled();

        scrollTo(scroller, 0);

        expect(screen.queryByText('Report0.pdf')).not.toBeInTheDocument();
        expect(screen.queryByText('Note 079')).not.toBeInTheDocument();
        expect(selectRenders.count).toBe(0);
    });

    it('focuses an unmounted note after scrolling it in and keeps keyboard navigation working', async () => {
        const {props, ref, scroller} = setup();
        expect(screen.queryByText('Note 060')).not.toBeInTheDocument();

        act(() => ref.current?.focusRow('Note060.md'));

        await waitFor(() => expect(row('Note 060')).toHaveFocus());
        expect(scroller.scrollTop).toBeGreaterThan(0);
        fireEvent.keyDown(row('Note 060'), {key: 'ArrowDown'});
        expect(props.onBrowse).toHaveBeenCalledWith('Note061.md');
        expect(row('Note 061')).toHaveFocus();

        scrollTo(scroller, 0);
        expect(screen.queryByText('Note 060')).not.toBeInTheDocument();
        act(() => ref.current?.focusRow('Note075.md'));
        await waitFor(() => expect(row('Note 075')).toHaveFocus());
        fireEvent.keyDown(row('Note 075'), {key: 'Enter'});
        expect(props.onCommit).toHaveBeenCalledWith('Note075.md');
    });

    it('keeps an open action menu anchored through scroll and closes it when its note is filtered out', async () => {
        const {scroller, rerender, props} = setup();
        const anchorRow = row('Note 005');
        fireEvent.click(within(anchorRow).getByRole('button', {name: 'Note actions'}));
        await screen.findByRole('menu');

        scrollTo(scroller, 50 * 48);

        expect(row('Note 005')).toBe(anchorRow);
        expect(screen.queryByText('Note 006')).not.toBeInTheDocument();
        expect(screen.getByRole('menu')).toBeInTheDocument();
        rerender({
            notes: props.notes.filter((note) => note.id !== 'Note005.md'),
            query: 'filtered',
        });
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(screen.queryByText('Note 005')).not.toBeInTheDocument();
    });

    it('keeps an open icon picker anchored through scroll and closes it when its note is filtered out', async () => {
        await Promise.all([loadEmojis(), loadIconCatalog()]);
        const {scroller, rerender, props} = setup({showIcons: true});
        const anchorRow = row('Note 005');
        fireEvent.click(within(anchorRow).getByRole('button', {name: 'Set note icon'}));
        await screen.findByRole('listbox', {name: 'Pick an icon'});

        scrollTo(scroller, 50 * 48);

        expect(row('Note 005')).toBe(anchorRow);
        expect(screen.queryByText('Note 006')).not.toBeInTheDocument();
        expect(screen.getByRole('listbox', {name: 'Pick an icon'})).toBeInTheDocument();
        rerender({
            notes: props.notes.filter((note) => note.id !== 'Note005.md'),
            query: 'filtered',
        });
        await waitFor(() =>
            expect(screen.queryByRole('listbox', {name: 'Pick an icon'})).not.toBeInTheDocument(),
        );
        expect(screen.queryByText('Note 005')).not.toBeInTheDocument();
    });

    it('recomputes mixed row offsets after folder lines and sort order change', () => {
        const notes = makeNotes().map((note, index) => ({
            ...note,
            id: index % 2 ? `Work/${note.id}` : note.id,
        }));
        const {scroller, sizer, rerender} = setup({notes});
        scrollTo(scroller, 800);
        expect(sizer.style.height).toBe('3840px');

        rerender({showCrumbs: true});

        expect(sizer.style.height).toBe('4480px');
        expect(row('Note 020').parentElement).toHaveStyle({height: '48px'});
        expect(row('Note 021').parentElement).toHaveStyle({height: '64px'});
        rerender({notes: [...notes].reverse(), sortMode: 'title-desc'});
        scrollTo(scroller, 0);
        expect(row('Note 079').parentElement).toHaveStyle({
            height: '64px',
            transform: 'translateY(0px)',
        });
        expect(row('Note 078').parentElement).toHaveStyle({
            height: '48px',
            transform: 'translateY(64px)',
        });
        expect(row('Note 000')).toHaveAttribute('tabindex', '0');

        rerender({showCrumbs: false});

        expect(sizer.style.height).toBe('3840px');
        expect(row('Note 078').parentElement).toHaveStyle({
            height: '48px',
            transform: 'translateY(48px)',
        });
    });
});
