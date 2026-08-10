#!/usr/bin/env node
/**
 * Bump the app version across every source of truth, in lockstep:
 *   - package.json                 ("version")
 *   - package-lock.json            (BOTH the top-level and the "" package entry)
 *   - src-tauri/tauri.conf.json    ("version" — drives the bundle / .app / .dmg name)
 *   - src-tauri/Cargo.toml         ([package] version — the Rust crate)
 *   - src-tauri/gen/apple/app_iOS/Info.plist  (CFBundleShortVersionString + CFBundleVersion)
 *
 * The lockfile matters because `npm install` rewrites its name/version from package.json anyway:
 * leaving it stale makes the first install of every release dirty the tree, which trips the
 * release runbook's clean-tree preflight. The plist is generated once by `tauri ios init` and then
 * committed, so nothing else keeps it in step.
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
const lockPath = join(root, 'package-lock.json');
const plistPath = join(root, 'src-tauri', 'gen', 'apple', 'app_iOS', 'Info.plist');

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
 * Replace the first `count` matches of `re` (each shaped `$1<old-version>$2`) with the new version.
 *
 * The count is a guard, not a convenience: `package-lock.json` states this app's version twice, at
 * the very top, and then states a version for every dependency in the tree — a global replace
 * anchored only on the old literal rewrites every dependency that happens to sit on the same
 * number (13 of them at 1.0.0). Replacing exactly the first N occurrences is safe because both of
 * ours precede the dependency list.
 * @param {string} path - File to rewrite in place.
 * @param {RegExp} re - Matches the version literal with a capture group on each side.
 * @param {number} [count] - How many occurrences to replace (default 1).
 */
function patchFile(path, re, count = 1) {
    const src = readFileSync(path, 'utf8');
    let seen = 0;
    const out = src.replace(new RegExp(re, 'g'), (match, before, after) =>
        ++seen <= count ? `${before}${next}${after}` : match,
    );
    if (seen < count) {
        console.error(`error: expected ${count} version literal(s) in ${path}, found ${seen}`);
        process.exit(1);
    }
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
// The lockfile states OUR version twice — top level and the `""` package entry, both above the
// dependency list — and `npm install` rewrites both from package.json anyway.
patchFile(lockPath, /("version"\s*:\s*")[^"]*(")/, 2);
// The iOS plist: CFBundleShortVersionString and CFBundleVersion, adjacent and in that order.
patchFile(plistPath, new RegExp(`(<string>)${current.replace(/\./g, '\\.')}(</string>)`), 2);

console.error(
    `bumped ${current} -> ${next}  (package.json, package-lock.json, tauri.conf.json, Cargo.toml, Info.plist)`,
);
process.stdout.write(`${next}\n`); // stdout: the new version alone, for `$(...)` capture
