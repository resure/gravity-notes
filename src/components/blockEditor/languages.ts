/**
 * The languages the code-block picker offers.
 *
 * The token is what reaches disk — a fenced block's info string (```` ```ts ````) — so it has to be
 * the spelling other tools highlight by, not a pretty name. The list is deliberately short: it is a
 * picker, not a registry, and a note that arrives with a token we don't list (`jsonc`, `nix`) keeps
 * it and shows it verbatim rather than being quietly reset to plain text.
 */

export interface LanguageOption {
    /** The fence info string. Empty means a plain fence with no language. */
    token: string;
    label: string;
}

export const LANGUAGES: LanguageOption[] = [
    {token: '', label: 'Plain text'},
    {token: 'bash', label: 'Bash'},
    {token: 'c', label: 'C'},
    {token: 'cpp', label: 'C++'},
    {token: 'csharp', label: 'C#'},
    {token: 'css', label: 'CSS'},
    {token: 'diff', label: 'Diff'},
    {token: 'docker', label: 'Dockerfile'},
    {token: 'go', label: 'Go'},
    {token: 'graphql', label: 'GraphQL'},
    {token: 'html', label: 'HTML'},
    {token: 'java', label: 'Java'},
    {token: 'js', label: 'JavaScript'},
    {token: 'json', label: 'JSON'},
    {token: 'kotlin', label: 'Kotlin'},
    {token: 'lua', label: 'Lua'},
    {token: 'markdown', label: 'Markdown'},
    {token: 'php', label: 'PHP'},
    {token: 'python', label: 'Python'},
    {token: 'ruby', label: 'Ruby'},
    {token: 'rust', label: 'Rust'},
    {token: 'scss', label: 'SCSS'},
    {token: 'sql', label: 'SQL'},
    {token: 'swift', label: 'Swift'},
    {token: 'toml', label: 'TOML'},
    {token: 'ts', label: 'TypeScript'},
    {token: 'tsx', label: 'TSX'},
    {token: 'xml', label: 'XML'},
    {token: 'yaml', label: 'YAML'},
];

/** What the block's own button shows. An unlisted token is its own label. */
export function languageLabel(token: string | undefined): string {
    if (!token) return 'Plain text';
    return LANGUAGES.find((item) => item.token === token)?.label ?? token;
}

export function filterLanguages(query: string): LanguageOption[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return LANGUAGES;
    return LANGUAGES.filter(
        (item) =>
            item.label.toLowerCase().includes(needle) || item.token.toLowerCase().includes(needle),
    );
}
