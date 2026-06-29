#!/usr/bin/env node
/**
 * Bump the app version across all three sources of truth, in lockstep:
 *   - package.json                 ("version")
 *   - src-tauri/tauri.conf.json    ("version" — drives the bundle / .app / .dmg name)
 *   - src-tauri/Cargo.toml         ([package] version — the Rust crate)
 *
 *   node scripts/bump-version.mjs [major|minor|patch|X.Y.Z]      (default: minor)
 *
 * Each file is edited with a TARGETED replace of just the version literal, so all other
 * formatting is left byte-for-byte intact (stays Prettier-clean — no JSON array reflow).
 * Prints a human note on stderr and the NEW version alone on stdout (last line), so the
 * /release skill can capture it with `$(node scripts/bump-version.mjs ...)`.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bump = (process.argv[2] ?? 'minor').trim();

const pkgPath = join(root, 'package.json');
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');

const current = String(JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '');
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!parts) {
    console.error(`error: package.json version is not X.Y.Z: "${current}"`);
    process.exit(1);
}
const [maj, min, pat] = parts.slice(1).map(Number);

let next;
if (/^\d+\.\d+\.\d+$/.test(bump)) next = bump;
else if (bump === 'major') next = `${maj + 1}.0.0`;
else if (bump === 'minor') next = `${maj}.${min + 1}.0`;
else if (bump === 'patch') next = `${maj}.${min}.${pat + 1}`;
else {
    console.error(`error: bump must be major | minor | patch | X.Y.Z (got "${bump}")`);
    process.exit(1);
}

/**
 * Replace the first `re` match (shaped `$1<old-version>$2`) with the new version.
 * @param {string} path - File to rewrite in place.
 * @param {RegExp} re - Matches the version literal with a capture group on each side.
 */
function patchFile(path, re) {
    const src = readFileSync(path, 'utf8');
    const out = src.replace(re, `$1${next}$2`);
    if (out === src && current !== next) {
        console.error(`error: version literal not found in ${path}`);
        process.exit(1);
    }
    writeFileSync(path, out);
}

// JSON: the first top-level `"version": "X.Y.Z"` (package.json / tauri.conf.json).
patchFile(pkgPath, /("version"\s*:\s*")[^"]*(")/);
patchFile(confPath, /("version"\s*:\s*")[^"]*(")/);
// TOML: only the [package] section's version (`[^[]*?` can't cross into the next section).
patchFile(cargoPath, /(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/);

console.error(`bumped ${current} -> ${next}  (package.json, tauri.conf.json, Cargo.toml)`);
process.stdout.write(`${next}\n`); // stdout: the new version alone, for `$(...)` capture
