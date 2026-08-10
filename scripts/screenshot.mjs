#!/usr/bin/env node
/**
 * Regenerate the README's hero screenshots (`assets/sol-light.png` / `sol-dark.png`).
 *
 *   npm run dev            # in another shell — this drives the real app, not a mockup
 *   node scripts/screenshot.mjs
 *
 * Launches headless Chromium with remote debugging, seeds a small demo vault into the in-browser
 * backend over CDP, then captures 1280x800 at 2x in both themes. It exists because a hand-updated
 * screenshot silently rots: the README shipped the previous UI for a while after the redesign
 * because renaming the files was mistaken for replacing them.
 *
 * Node's global WebSocket (>= 22) is the only client needed — no Playwright, no Puppeteer.
 * Requires `chromium` on PATH (`brew install --cask chromium`).
 */
import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const PORT = 9333;
const URL_ = process.env.SOL_URL ?? 'http://localhost:5173';
const OUT = process.env.SOL_SHOT_OUT ?? new URL('../assets', import.meta.url).pathname;
const PROFILE = mkdtempSync(join(tmpdir(), 'sol-shot-'));
mkdirSync(OUT, {recursive: true});

const chrome = spawn('chromium', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1280,800',
    URL_,
]);
chrome.on('error', (e) => {
    console.error('spawn failed', e);
    process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
    for (let i = 0; i < 40; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const list = await res.json();
            const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) return page;
        } catch {
            /* not up yet */
        }
        await sleep(250);
    }
    throw new Error('devtools never came up');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => {
    ws.onopen = resolve;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    }
};
const send = (method, params = {}) =>
    new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({id: mid, method, params}));
    });

const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 2,
    mobile: false,
});
await sleep(1500);

const SEED = `(async () => {
  const open = (name, version, upgrade) => new Promise((res, rej) => {
    const r = indexedDB.open(name, version);
    if (upgrade) r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const db = await open('sol-data', 1, (d) => {
    d.createObjectStore('notes', {keyPath: 'id'});
    d.createObjectStore('kv');
    d.createObjectStore('attachments', {keyPath: 'id'});
    d.createObjectStore('trash', {keyPath: 'id'});
  });
  const notes = [
    ['Roadmap.md', 'Widen the block model so fewer notes fall back to raw source.\\n\\n## Next up\\n\\n- [x] Fence languages\\n- [ ] Headings past H3\\n- [ ] Table alignment\\n\\nThe round-trip guard in [[Block model]] is what makes this safe to do incrementally.\\n'],
    ['Block model.md', 'Each block is its own contentEditable — no ProseMirror anywhere.\\n\\nThe whole document re-serializes on every keystroke, so anything the parser reads imperfectly would be rewritten across the file on the first edit. That is why a note failing the round-trip check opens as source instead.\\n'],
    ['Work/Q3 plan.md', 'Ship the redesign, then the rename. Keep the vault format stable throughout — a folder opened by the old build has to keep working.\\n'],
    ['Work/Meeting notes.md', 'Talked through the gutter, the 58px row contract, and where the ⋯ should live.\\n'],
    ['Reading list.md', 'Books, essays, and things saved for later.\\n'],
    ['Attachments and images.md', 'Paste or drop an image and it lands in Attachments/ as a real file, referenced root-relatively.\\n'],
    ['Work/Interviews.md', 'Notes from the three conversations this week.\\n'],
    ['Recipes.md', 'The pasta one, the bread one, and the one with too much garlic.\\n'],
  ];
  await new Promise((res, rej) => {
    const tx = db.transaction(['notes','kv'], 'readwrite');
    const s = tx.objectStore('notes');
    let t = Date.now();
    for (const [id, content] of notes) s.put({id, content, updatedAt: t -= 5400000});
    tx.objectStore('kv').put({version:1, sort:'updated', pinned:['Roadmap.md'], created:{}, icons:{}, appearances:{}, active:'Roadmap.md', trashed:[]}, 'metadata');
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
  const wreq = indexedDB.open('sol', 1);
  await new Promise((res) => { wreq.onupgradeneeded = () => { const d = wreq.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
      if (!d.objectStoreNames.contains('workspaces')) d.createObjectStore('workspaces', {keyPath: 'id'}); };
    wreq.onsuccess = res; });
  const wdb = wreq.result;
  await new Promise((res) => {
    const tx = wdb.transaction(['workspaces','handles'], 'readwrite');
    tx.objectStore('workspaces').put({id:'indexeddb', backend:'indexeddb', name:'Notes', lastOpenedAt: Date.now()});
    tx.objectStore('handles').put('indexeddb', 'last-active-workspace');
    tx.oncomplete = res;
  });
  wdb.close();
  localStorage.setItem('sol:indexeddb:rail-open', 'true');
  return 'seeded';
})()`;

console.log('seed:', await evaluate(SEED));

for (const theme of ['light', 'dark']) {
    await evaluate(`localStorage.setItem('sol:theme', ${JSON.stringify(theme)})`);
    await send('Page.navigate', {url: URL_});
    await sleep(3500);
    const ready = await evaluate(
        `JSON.stringify({rows: document.querySelectorAll('[role=option]').length, title: document.querySelector('.note-title')?.value})`,
    );
    console.log(theme, ready);
    const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
    });
    writeFileSync(`${OUT}/sol-${theme}.png`, Buffer.from(shot.result.data, 'base64'));
}

ws.close();
chrome.kill();
rmSync(PROFILE, {recursive: true, force: true});
console.log(`wrote ${OUT}/sol-light.png and ${OUT}/sol-dark.png`);
process.exit(0);
