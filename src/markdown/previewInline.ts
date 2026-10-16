import {matchYfmMark} from './inline';

interface InlineState {
    src: string;
    pos: number;
    posMax: number;
    tokens: unknown[];
    env: unknown;
    md: {inline: {parse(text: string, md: unknown, env: unknown, tokens: unknown[]): void}};
    push(type: string, tag: string, nesting: number): unknown;
}

export function previewInline(md: {
    inline: {
        ruler: {
            before(
                name: string,
                rule: string,
                parse: (state: InlineState, silent: boolean) => boolean,
            ): void;
        };
    };
}): void {
    md.inline.ruler.before('emphasis', 'gravity_yfm_marks', (state, silent) => {
        const match = matchYfmMark(state.src, state.pos);
        if (!match || match.end > state.posMax) return false;
        if (!silent) {
            state.push('gravity_yfm_open', match.tag, 1);
            state.md.inline.parse(match.inner, state.md, state.env, state.tokens);
            state.push('gravity_yfm_close', match.tag, -1);
        }
        state.pos = match.end;
        return true;
    });
}
