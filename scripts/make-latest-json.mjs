#!/usr/bin/env node
/**
 * Generate the Tauri updater's `latest.json` manifest from a freshly-built, signed updater bundle.
 *
 *   node scripts/make-latest-json.mjs <version> <sigPath> <tarballUrl> <outPath>
 *
 * The updater (configured in `src-tauri/tauri.conf.json` → `plugins.updater`) fetches this file from
 * the GitHub release's "latest" download URL, compares `version` against the running app, and — if
 * newer — downloads `platforms.darwin-aarch64.url` and verifies it against `signature` (the contents
 * of the `.app.tar.gz.sig` Tauri emitted) using the committed public key. The signature is over the
 * tarball BYTES, so the tarball may be renamed but must not otherwise be modified after the build.
 *
 * `notes` is taken from the most recent CHANGELOG.md section so the in-app "what's new" matches the
 * GitHub release. Built with `JSON.stringify` (not string-templated) so the long base64 signature
 * and multi-line notes are escaped correctly. Times come from the wall clock at run time.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const [, , version, sigPath, tarballUrl, outPath] = process.argv;
if (!version || !sigPath || !tarballUrl || !outPath) {
    console.error('usage: make-latest-json.mjs <version> <sigPath> <tarballUrl> <outPath>');
    process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const signature = readFileSync(sigPath, 'utf8').trim();
if (!signature) {
    console.error(`error: signature file is empty: ${sigPath}`);
    process.exit(1);
}

/**
 * The body of the most recent CHANGELOG.md section (between the first `## [` header and the next
 * `## ` header), for the updater's release-notes view. Falls back to the bare version string.
 */
function changelogNotes() {
    try {
        const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('\n');
        const start = lines.findIndex((l) => l.startsWith('## ['));
        if (start === -1) return `Gravity Notes v${version}`;
        // Guard against a CHANGELOG whose top section lags package.json (separate manual bumps): only
        // use the notes when the section's version matches the build, else don't ship the prior one's.
        const headerVersion = /^##\s*\[([^\]]+)\]/.exec(lines[start])?.[1]?.trim();
        if (headerVersion !== version) {
            console.error(
                `warning: CHANGELOG top section is [${headerVersion ?? '?'}] but building ${version}; using a generic note`,
            );
            return `Gravity Notes v${version}`;
        }
        let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
        if (end === -1) end = lines.length;
        const body = lines
            .slice(start + 1, end)
            .join('\n')
            .trim();
        return body || `Gravity Notes v${version}`;
    } catch {
        return `Gravity Notes v${version}`;
    }
}

const manifest = {
    version,
    notes: changelogNotes(),
    pub_date: new Date().toISOString(),
    // arm64-only build — see `tauri:build` (aarch64). Add `darwin-x86_64` here if a universal/Intel
    // build is ever shipped.
    platforms: {
        'darwin-aarch64': {signature, url: tarballUrl},
    },
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.error(`wrote ${outPath}  (darwin-aarch64, ${signature.length}-byte signature)`);
