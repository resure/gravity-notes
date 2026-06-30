//! Native filesystem backend for Gravity Notes' folder storage.
//!
//! The web File System Access API is unavailable in macOS WKWebView, so the
//! folder-of-`.md`-files backend is served by these commands instead. They are
//! deliberately thin primitives over `std::fs` — all the note semantics (canonical
//! body shape, unique-name resolution, case-only rename, conflict detection) live in
//! TypeScript (`src/storage/tauriStore.ts`), mirroring `FileSystemNoteStore` so the
//! rest of the app is backend-agnostic.
//!
//! `dir` is the absolute path to the user-picked folder; `name` is a note id — now a
//! POSIX-relative path that may include subfolders (`Work/Sub/Title.md`) — or the
//! `.gravity-notes.json` metadata sidecar. Every caller-supplied path is run through
//! `resolve_within`, which rejects any attempt to escape the picked folder: this is the
//! ONLY containment defense, since the custom `notes_*` commands are not covered by the
//! fs-plugin's scope allowlist. Times are returned as epoch-millisecond `f64`s to match
//! the web backend's `file.lastModified`.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

/// Note files end in `.md` (matched case-insensitively, like the web backend).
const MD_EXT: &str = ".md";
/// Marker file keeping a deliberately-empty folder alive (mirrors `FOLDER_MARKER` in noteText.ts).
const FOLDER_MARKER: &str = ".gnkeep";
/// The metadata sidecar — ignored by the empty-folder prune (it only ever lives at the root).
const METADATA_FILENAME: &str = ".gravity-notes.json";
/// Root-level media-attachments folder (mirrors `ATTACHMENTS_DIR` in noteText.ts). Excluded from the
/// note walk and folder tree — it's storage, not a user folder.
const ATTACHMENTS_DIR: &str = "Attachments";
/// Bytes of each file scanned for the list-preview snippet. Mirrors `PREVIEW_SCAN_BYTES`
/// in `src/storage/noteText.ts`; the preview text itself is derived TS-side.
const PREVIEW_SCAN_BYTES: u64 = 500;

/// A note (or the metadata sidecar) with its full contents.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteFull {
    name: String,
    modified_ms: f64,
    content: String,
}

/// A note with only the head of its body, for building the list preview cheaply.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteHead {
    name: String,
    modified_ms: f64,
    head: String,
}

/// One stored attachment, for the management view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentEntry {
    name: String,
    size: f64,
    modified_ms: f64,
}

fn is_md(name: &str) -> bool {
    name.to_lowercase().ends_with(MD_EXT)
}

/// Directory names never descended during the note/folder walks, at any depth: heavy non-note
/// trees a user can pull in by accidentally picking a project folder. Dot-directories (`.git`,
/// `.obsidian`, the `.trash`, …) are excluded by the leading-dot check in {@link is_skipped_dir}.
const SKIP_DIRS: &[&str] = &["node_modules"];

/// Whether a directory `name` should be skipped (not descended) by the recursive walks. Centralises
/// the dot-directory and {@link SKIP_DIRS} exclusions shared by `collect_md` and `collect_folders`.
/// Case-insensitive on `SKIP_DIRS`, mirroring the TS `isSkippedDir`/`isReservedSegment` (macOS and
/// the web Chromium target both sit on case-insensitive filesystems).
fn is_skipped_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name.to_lowercase().as_str())
}

/// Resolve a caller-supplied relative `name` to an absolute path inside `dir`, rejecting any
/// attempt to escape the picked notes folder. A lexical pass first refuses `../`, absolute paths,
/// and root/prefix components; then a filesystem pass ({@link confine_to_root}) refuses a path that
/// escapes via a *symlink* component — which the lexical check can't see. A not-yet-created nested
/// path (a brand-new note) resolves only as far as its real parent, so `notes_write` can still
/// create fresh folders.
fn resolve_within(dir: &str, name: &str) -> Result<PathBuf, String> {
    let rel = Path::new(name);
    if rel.is_absolute() {
        return Err(format!("invalid note path: \"{name}\""));
    }
    let mut out = PathBuf::from(dir);
    for component in rel.components() {
        match component {
            Component::Normal(segment) => out.push(segment),
            Component::CurDir => {}
            // ParentDir (..), RootDir, or a Windows prefix would escape the folder.
            _ => return Err(format!("invalid note path: \"{name}\"")),
        }
    }
    // Belt-and-suspenders: the lexical join above can't leave `dir`, but assert it anyway.
    if !out.starts_with(dir) {
        return Err(format!("invalid note path: \"{name}\""));
    }
    confine_to_root(dir, &out)?;
    Ok(out)
}

/// Reject a resolved path whose deepest *existing* ancestor escapes the (canonicalized) root via a
/// symlink. The lexical check in {@link resolve_within} only inspects path text, so a symlink named
/// e.g. `Esc` -> `/outside` lets `Esc/file.md` pass while `fs::write`/`read`/`remove` follow the link
/// out of the folder. Here we canonicalize the deepest path component that actually exists (the
/// target itself, if present; otherwise walk up to its real parent) and require it still sits inside
/// the canonicalized root — closing the symlink-escape hole while still allowing brand-new paths.
fn confine_to_root(dir: &str, out: &Path) -> Result<(), String> {
    let canon_root = fs::canonicalize(dir).map_err(stringify)?;
    let mut probe: &Path = out;
    loop {
        match fs::canonicalize(probe) {
            Ok(real) => {
                return if real.starts_with(&canon_root) {
                    Ok(())
                } else {
                    Err(format!("invalid note path: \"{}\"", out.display()))
                };
            }
            // This component doesn't exist yet — step up to its parent and resolve that instead.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => match probe.parent() {
                Some(parent) => probe = parent,
                None => return Ok(()),
            },
            Err(err) => return Err(err.to_string()),
        }
    }
}

/// Whether two paths resolve to the same real file. Used so a case-only rename (`note.md` ->
/// `Note.md`) on a case-insensitive filesystem isn't mistaken for clobbering a *different* note.
fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

/// Epoch milliseconds of a file's mtime; `0.0` if the platform can't report it.
fn modified_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Write bytes durably: write a sibling temp file, then atomically rename it over the
/// target (same-filesystem rename is atomic on macOS), so a crash mid-write never
/// truncates the original. Replaces the web backend's `createWritable()`/`close()`
/// atomicity guarantee, which `writeTextFile`-style APIs lack.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = tmp_sibling(path);
    fs::write(&tmp, bytes)?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(&tmp);
            Err(err)
        }
    }
}

/// `<path>.gn-tmp` next to the target. The suffix isn't `.md`, so listings ignore it
/// even while it transiently exists.
fn tmp_sibling(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".gn-tmp");
    match path.parent() {
        Some(parent) => parent.join(name),
        None => PathBuf::from(name),
    }
}

/// Move `from` to `to`, falling back to copy-then-delete if a plain rename fails (e.g. EXDEV
/// across mount points). Within one picked folder a rename is atomic and mtime-preserving; the
/// fallback exists only for the cross-device edge. The original rename error is surfaced if the
/// fallback also fails.
fn rename_or_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            if fs::copy(from, to).is_ok() {
                let _ = fs::remove_file(from);
                Ok(())
            } else {
                Err(rename_err)
            }
        }
    }
}

/// One markdown note found by the recursive walk: its forward-slash path relative to the root,
/// mtime, and the requested slice of its body (head for previews, or the whole file).
struct Found {
    rel: String,
    modified_ms: f64,
    body: String,
}

/// Recursively collect `.md` files under `current`, returning ids relative to `root` with `/`
/// separators. Skips dot-directories (`.git`, `.obsidian`, …) and never follows symlinks (so the
/// walk can't escape the folder or loop). Non-`.md` entries — the sidecar, `.gnkeep`, `*.gn-tmp`,
/// `*.rename-tmp` — are filtered by `is_md`. `full` reads the whole body; otherwise just the head.
fn collect_md(root: &Path, current: &Path, full: bool, out: &mut Vec<Found>) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            if is_skipped_dir(&name) {
                continue;
            }
            // The root Attachments/ folder holds media, not notes — don't descend it.
            if current == root && name == ATTACHMENTS_DIR {
                continue;
            }
            collect_md(root, &entry.path(), full, out)?;
        } else if file_type.is_file() && is_md(&name) {
            let path = entry.path();
            let meta = entry.metadata()?;
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let body = if full {
                String::from_utf8_lossy(&fs::read(&path)?).into_owned()
            } else {
                let mut buf = Vec::new();
                fs::File::open(&path)?
                    .take(PREVIEW_SCAN_BYTES)
                    .read_to_end(&mut buf)?;
                String::from_utf8_lossy(&buf).into_owned()
            };
            out.push(Found {
                rel,
                modified_ms: modified_ms(&meta),
                body,
            });
        }
    }
    Ok(())
}

/// List every `.md` file (recursively, with subfolder paths) with its mtime and a head slice.
#[tauri::command]
fn notes_list(dir: String) -> Result<Vec<NoteHead>, String> {
    let mut found = Vec::new();
    collect_md(Path::new(&dir), Path::new(&dir), false, &mut found).map_err(stringify)?;
    Ok(found
        .into_iter()
        .map(|f| NoteHead {
            name: f.rel,
            modified_ms: f.modified_ms,
            head: f.body,
        })
        .collect())
}

/// Read every `.md` file (recursively) with full content — feeds the full-text search corpus.
#[tauri::command]
fn notes_read_all(dir: String) -> Result<Vec<NoteFull>, String> {
    let mut found = Vec::new();
    collect_md(Path::new(&dir), Path::new(&dir), true, &mut found).map_err(stringify)?;
    Ok(found
        .into_iter()
        .map(|f| NoteFull {
            name: f.rel,
            modified_ms: f.modified_ms,
            content: f.body,
        })
        .collect())
}

/// List the `.md` files directly inside `dir/sub` (non-recursive), each with its name and mtime.
/// Backs the trash view: the `.trash/` area is a dot-directory the recursive note walk deliberately
/// skips, so it needs its own lister. Ids are returned relative to the root (`sub/<leaf>`, or just
/// `<leaf>` when `sub` is empty), matching `notes_list`. Bodies are NOT read (the trash view shows
/// only title/folder/age). An absent folder yields an empty list, not an error.
#[tauri::command]
fn notes_list_dir(dir: String, sub: String) -> Result<Vec<NoteHead>, String> {
    let base = resolve_within(&dir, &sub)?;
    let mut out = Vec::new();
    let entries = match fs::read_dir(&base) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(err) => return Err(err.to_string()),
    };
    let prefix = sub.trim_end_matches('/');
    for entry in entries {
        let entry = entry.map_err(stringify)?;
        let file_type = entry.file_type().map_err(stringify)?;
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_md(&name) {
            continue;
        }
        let meta = entry.metadata().map_err(stringify)?;
        // Join under `prefix`, but avoid a leading '/' when `sub` is empty (a general-primitive guard).
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        out.push(NoteHead {
            name: rel,
            modified_ms: modified_ms(&meta),
            head: String::new(),
        });
    }
    Ok(out)
}

/// Recursively delete `dir/path` and everything under it; a missing path is a no-op. Backs
/// `emptyTrash` (one atomic remove of `.trash/`), so a partial-failure can't leave a half-emptied
/// trash. Containment-guarded like every other path argument.
#[tauri::command]
fn notes_remove_dir_all(dir: String, path: String) -> Result<(), String> {
    let target = resolve_within(&dir, &path)?;
    match fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

/// Read a single file, or `None` if it doesn't exist (used for `get` and the metadata sidecar).
#[tauri::command]
fn notes_read_opt(dir: String, name: String) -> Result<Option<NoteFull>, String> {
    let path = resolve_within(&dir, &name)?;
    let meta = match fs::metadata(&path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
    };
    let bytes = fs::read(&path).map_err(stringify)?;
    // Strict UTF-8 decode for a single-note load: a lossy decode would silently replace invalid
    // bytes with U+FFFD, and the next autosave would then write that corruption back over the
    // original file. Surfacing an error instead keeps the note from opening-then-clobbering. (The
    // recursive corpus/preview reads stay lossy — they're search-only and never written back, and a
    // preview head slice can legitimately cut a multi-byte char at the byte boundary.)
    let content =
        String::from_utf8(bytes).map_err(|_| format!("\"{name}\" is not valid UTF-8 text"))?;
    Ok(Some(NoteFull {
        name,
        modified_ms: modified_ms(&meta),
        content,
    }))
}

/// Write a file atomically, creating any missing parent folders, and return its new mtime.
///
/// Optimistic-concurrency note: the conflict check lives in `tauriStore.save` (stat, compare to the
/// caller's baseline, then write). Like the web `FileSystemNoteStore` — which also can't write
/// atomically-with-a-check — there's a small stat→write window where a concurrent external edit
/// could be lost. This is an accepted, backend-agnostic limitation (the on-disk file is never
/// truncated thanks to {@link write_atomic}); it isn't re-checked here.
#[tauri::command]
fn notes_write(dir: String, name: String, content: String) -> Result<f64, String> {
    let path = resolve_within(&dir, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(stringify)?;
    }
    write_atomic(&path, content.as_bytes()).map_err(stringify)?;
    let meta = fs::metadata(&path).map_err(stringify)?;
    Ok(modified_ms(&meta))
}

/// Rename/move `from` to `to` (creating `to`'s parent folders) and return `to`'s mtime. Both
/// paths are containment-checked. `from` and `to` may live in different folders — this also backs
/// a cross-folder move. Collision and case-only-rename handling lives in TS; here they're distinct.
#[tauri::command]
fn notes_rename(dir: String, from: String, to: String) -> Result<f64, String> {
    let from_path = resolve_within(&dir, &from)?;
    let to_path = resolve_within(&dir, &to)?;
    // Refuse to clobber a *different* existing file. The TS layer pre-checks collisions, but make
    // the primitive itself non-destructive (a no-clobber rename). A case-only rename (note.md ->
    // Note.md) on a case-insensitive FS resolves both sides to the same inode — that's allowed (it's
    // how the case actually changes); the TS side routes it through a distinct temp name anyway.
    if to_path.exists() && !same_file(&from_path, &to_path) {
        return Err(format!("\"{to}\" already exists"));
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(stringify)?;
    }
    rename_or_copy(&from_path, &to_path).map_err(stringify)?;
    // Moving the last note out of a folder leaves it empty: prune the source's now-empty ancestors
    // (a folder kept alive by a .gnkeep marker survives). The destination keeps the moved file.
    if let Some(parent) = from_path.parent() {
        prune_empty_ancestors(Path::new(&dir), parent);
    }
    let meta = fs::metadata(&to_path).map_err(stringify)?;
    Ok(modified_ms(&meta))
}

#[tauri::command]
fn notes_remove(dir: String, name: String) -> Result<(), String> {
    let path = resolve_within(&dir, &name)?;
    fs::remove_file(&path).map_err(stringify)?;
    if let Some(parent) = path.parent() {
        prune_empty_ancestors(Path::new(&dir), parent);
    }
    Ok(())
}

/// Write a binary media attachment atomically, creating any missing parent folders (e.g. the
/// `Attachments/` folder on first use). The collision-free name is resolved TS-side via `notes_exists`.
#[tauri::command]
fn attachment_write(dir: String, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = resolve_within(&dir, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(stringify)?;
    }
    write_atomic(&target, &bytes).map_err(stringify)
}

/// Read a binary media attachment's bytes, or `None` if it no longer exists (mapped to a not-found
/// on the TS side, like `notes_read_opt`).
#[tauri::command]
fn attachment_read(dir: String, name: String) -> Result<Option<Vec<u8>>, String> {
    let path = resolve_within(&dir, &name)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

/// List every file in the root `Attachments/` folder (non-recursive; dotfiles skipped), with size
/// and mtime — for the management view. An absent folder yields an empty list.
#[tauri::command]
fn attachment_list(dir: String) -> Result<Vec<AttachmentEntry>, String> {
    let folder = Path::new(&dir).join(ATTACHMENTS_DIR);
    let mut out = Vec::new();
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(err) => return Err(err.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(stringify)?;
        let meta = entry.metadata().map_err(stringify)?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        out.push(AttachmentEntry {
            name,
            size: meta.len() as f64,
            modified_ms: modified_ms(&meta),
        });
    }
    Ok(out)
}

/// Delete a media attachment by its path; a missing file is a no-op (the management view may race a
/// concurrent delete). Containment-guarded like every other path argument.
#[tauri::command]
fn attachment_remove(dir: String, name: String) -> Result<(), String> {
    let path = resolve_within(&dir, &name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

/// Whether `dir` holds nothing worth keeping: no `.md`, no `.gnkeep`, no subdirectory. The sidecar
/// is ignored; an in-flight temp (`*.gn-tmp`/`*.rename-tmp`) marks the dir BUSY (kept), so a prune
/// can't race a concurrent write. Anything else (a note, a marker, a subdir) keeps the folder.
fn is_prunable(dir: &Path) -> bool {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == METADATA_FILENAME {
            continue;
        }
        // A note, the .gnkeep marker, a subdirectory, or an in-flight temp all keep the folder.
        return false;
    }
    true
}

/// Remove now-empty folders from `start` up toward `root` (never removing `root` itself). Stops at
/// the first folder that is kept (holds a note, a `.gnkeep`, a subdir, or an in-flight temp).
fn prune_empty_ancestors(root: &Path, start: &Path) {
    let mut dir = start.to_path_buf();
    while dir != root && dir.starts_with(root) {
        if !is_prunable(&dir) || fs::remove_dir(&dir).is_err() {
            break;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
}

/// Create an (initially empty) folder and keep it alive with a `.gnkeep` marker.
#[tauri::command]
fn notes_create_folder(dir: String, path: String) -> Result<(), String> {
    let folder = resolve_within(&dir, &path)?;
    fs::create_dir_all(&folder).map_err(stringify)?;
    write_atomic(&folder.join(FOLDER_MARKER), b"").map_err(stringify)
}

/// Remove an empty folder: drop its `.gnkeep`, then remove the (now-empty) directory. Emptiness is
/// checked *first* (only the marker may remain): otherwise dropping `.gnkeep` and then failing
/// `remove_dir` on a non-empty folder would strip the keep-alive marker off a folder left in place.
/// A missing folder is a no-op.
#[tauri::command]
fn notes_remove_dir(dir: String, path: String) -> Result<(), String> {
    let folder = resolve_within(&dir, &path)?;
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(stringify)?;
        if entry.file_name() != FOLDER_MARKER {
            return Err(format!("\"{path}\" is not empty"));
        }
    }
    let _ = fs::remove_file(folder.join(FOLDER_MARKER));
    fs::remove_dir(&folder).map_err(stringify)
}

/// Move (or rename) a folder and everything under it from `from` to `to`: create `to`'s parent,
/// rename the directory (atomic within the one picked folder), then prune `from`'s now-empty
/// ancestors. Rejects an existing `to` (collision is also pre-checked TS-side). Both paths are
/// containment-guarded.
#[tauri::command]
fn notes_move_dir(dir: String, from: String, to: String) -> Result<(), String> {
    let from_path = resolve_within(&dir, &from)?;
    let to_path = resolve_within(&dir, &to)?;
    if to_path.exists() {
        return Err(format!("\"{to}\" already exists"));
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(stringify)?;
    }
    fs::rename(&from_path, &to_path).map_err(stringify)?;
    if let Some(parent) = from_path.parent() {
        prune_empty_ancestors(Path::new(&dir), parent);
    }
    Ok(())
}

/// Every folder (recursively) relative to the root, including deliberately-empty `.gnkeep` ones.
#[tauri::command]
fn notes_list_folders(dir: String) -> Result<Vec<String>, String> {
    let root = Path::new(&dir);
    let mut out = Vec::new();
    collect_folders(root, root, &mut out).map_err(stringify)?;
    Ok(out)
}

fn collect_folders(root: &Path, current: &Path, out: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_skipped_dir(&name) {
            continue;
        }
        // The root Attachments/ folder is media storage, not a user folder — hide it from the tree.
        if current == root && name == ATTACHMENTS_DIR {
            continue;
        }
        let path = entry.path();
        out.push(
            path.strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/"),
        );
        collect_folders(root, &path, out)?;
    }
    Ok(())
}

/// Whether a name exists in the folder. Case-insensitive on macOS's default filesystem,
/// matching the web backend's collision check.
#[tauri::command]
fn notes_exists(dir: String, name: String) -> Result<bool, String> {
    Ok(resolve_within(&dir, &name)?.exists())
}

/// A note's current mtime in epoch ms, or `None` if it no longer exists.
#[tauri::command]
fn notes_stat(dir: String, name: String) -> Result<Option<f64>, String> {
    match fs::metadata(resolve_within(&dir, &name)?) {
        Ok(meta) => Ok(Some(modified_ms(&meta))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

/// Reveal a note, folder, or attachment in the OS file manager (macOS Finder), selecting it inside
/// its parent. `name` is a store id / folder path / attachment ref, containment-checked like every
/// other path argument. A missing path is reported rather than launching the file manager on nothing.
#[tauri::command]
fn reveal_path(dir: String, name: String) -> Result<(), String> {
    let path = resolve_within(&dir, &name)?;
    if !path.exists() {
        return Err(format!("\"{name}\" no longer exists"));
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(stringify)?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Finder could not reveal \"{name}\""))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("reveal is only supported on macOS".to_string())
    }
}

fn stringify(err: impl std::fmt::Display) -> String {
    err.to_string()
}

/// Open an external link in the user's default browser (macOS `open`). WKWebView won't navigate to
/// external origins on its own, so ⌘-click on a note's link routes here. Restricted to web/mail/tel
/// schemes so a crafted note can't shell out to a local file or app URL.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    const ALLOWED: [&str; 4] = ["http://", "https://", "mailto:", "tel:"];
    if !ALLOWED.iter().any(|scheme| url.starts_with(scheme)) {
        return Err(format!("refusing to open \"{url}\""));
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(&url)
            .status()
            .map_err(stringify)?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("could not open \"{url}\""))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("open is only supported on macOS".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // The custom title bar (titleBarStyle "Overlay") is taller than the standard macOS one,
            // so the traffic lights sit too high/left by default. Nudge them down + right to center
            // them in our bar; decorum re-applies the inset on resize/fullscreen. (x = right, y = down.)
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_decorum::WebviewWindowExt;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_traffic_lights_inset(16.0, 20.0);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS convention: the red close button / ⌘W hides the window and leaves the app
            // running in the Dock + menu bar, rather than quitting. ⌘Q still quits (ExitRequested).
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested {api, ..} = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            notes_list,
            notes_list_dir,
            notes_read_all,
            notes_read_opt,
            notes_write,
            notes_rename,
            notes_remove,
            attachment_write,
            attachment_read,
            attachment_list,
            attachment_remove,
            notes_exists,
            notes_stat,
            reveal_path,
            open_external,
            notes_create_folder,
            notes_remove_dir,
            notes_remove_dir_all,
            notes_move_dir,
            notes_list_folders,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS: clicking the Dock icon (Reopen) re-shows the hidden window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {..} = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A fresh, unique temp directory for one test (removed at the end).
    fn temp_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("gravity-notes-test-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn writes_and_reads_a_nested_note_creating_folders() {
        let dir = temp_dir();
        notes_write(s(&dir), "Work/Sub/Note.md".into(), "hello".into()).unwrap();

        // The intermediate folders were created and the file is readable by its path-id.
        let read = notes_read_opt(s(&dir), "Work/Sub/Note.md".into()).unwrap().unwrap();
        assert_eq!(read.content, "hello");
        assert!(dir.join("Work").join("Sub").join("Note.md").is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_and_read_all_recurse_returning_forward_slash_ids() {
        let dir = temp_dir();
        notes_write(s(&dir), "Inbox.md".into(), "a".into()).unwrap();
        notes_write(s(&dir), "Work/Roadmap.md".into(), "b".into()).unwrap();
        notes_write(s(&dir), "Work/Sub/Deep.md".into(), "c".into()).unwrap();
        // Non-.md and dot-dir contents must be ignored by the walk.
        fs::write(dir.join(".gravity-notes.json"), "{}").unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden").join("Secret.md"), "x").unwrap();
        // node_modules is skipped at every depth — picking a project folder must not pull in deps.
        fs::create_dir_all(dir.join("node_modules").join("pkg")).unwrap();
        fs::write(dir.join("node_modules").join("README.md"), "dep").unwrap();
        fs::write(dir.join("node_modules").join("pkg").join("Index.md"), "dep").unwrap();
        fs::create_dir_all(dir.join("Work").join("node_modules")).unwrap();
        fs::write(dir.join("Work").join("node_modules").join("Nested.md"), "dep").unwrap();

        let mut ids: Vec<String> = notes_list(s(&dir)).unwrap().into_iter().map(|n| n.name).collect();
        ids.sort();
        assert_eq!(ids, vec!["Inbox.md", "Work/Roadmap.md", "Work/Sub/Deep.md"]);

        let mut all: Vec<String> = notes_read_all(s(&dir)).unwrap().into_iter().map(|n| n.name).collect();
        all.sort();
        assert_eq!(all, vec!["Inbox.md", "Work/Roadmap.md", "Work/Sub/Deep.md"]);

        // node_modules is absent from the folder tree too (at root and nested under Work/).
        let folders = notes_list_folders(s(&dir)).unwrap();
        assert!(
            !folders.iter().any(|f| f.contains("node_modules")),
            "node_modules leaked into the folder tree: {folders:?}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_md_files_in_a_named_subdir_and_excludes_it_from_the_main_walk() {
        let dir = temp_dir();
        // The trash op is just a rename into `.trash/` (a dot-directory).
        notes_write(s(&dir), ".trash/A.md".into(), "aaa".into()).unwrap();
        notes_write(s(&dir), ".trash/B.md".into(), "bbb".into()).unwrap();
        // A non-.md file in the same folder is ignored by the lister.
        fs::write(dir.join(".trash").join("note.txt"), "x").unwrap();
        // A root note, to exercise the empty-`sub` (no leading slash) path.
        notes_write(s(&dir), "Root.md".into(), "r".into()).unwrap();

        let mut ids: Vec<String> = notes_list_dir(s(&dir), ".trash".into())
            .unwrap()
            .into_iter()
            .map(|n| n.name)
            .collect();
        ids.sort();
        assert_eq!(ids, vec![".trash/A.md", ".trash/B.md"]);

        // Empty `sub` lists the root directly, with NO leading slash on the ids.
        assert_eq!(
            notes_list_dir(s(&dir), "".into())
                .unwrap()
                .into_iter()
                .map(|n| n.name)
                .collect::<Vec<_>>(),
            vec!["Root.md"]
        );

        // The dot-directory is invisible to the recursive note + folder walks (Root.md aside).
        assert_eq!(
            notes_list(s(&dir)).unwrap().into_iter().map(|n| n.name).collect::<Vec<_>>(),
            vec!["Root.md"]
        );
        assert!(notes_list_folders(s(&dir)).unwrap().is_empty());
        // A missing subdir lists as empty rather than erroring; traversal is still rejected.
        assert!(notes_list_dir(s(&dir), "Nope".into()).unwrap().is_empty());
        assert!(notes_list_dir(s(&dir), "../..".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_dir_all_recursively_clears_a_folder_and_noops_when_absent() {
        let dir = temp_dir();
        notes_write(s(&dir), ".trash/A.md".into(), "a".into()).unwrap();
        notes_write(s(&dir), ".trash/Sub/B.md".into(), "b".into()).unwrap();
        // A non-.md straggler that a per-file purge loop would miss but remove_dir_all clears.
        fs::write(dir.join(".trash").join("note.txt"), "x").unwrap();
        assert!(dir.join(".trash").exists());

        notes_remove_dir_all(s(&dir), ".trash".into()).unwrap();
        assert!(!dir.join(".trash").exists());
        // Idempotent: removing an absent dir is a no-op; traversal is rejected.
        assert!(notes_remove_dir_all(s(&dir), ".trash".into()).is_ok());
        assert!(notes_remove_dir_all(s(&dir), "../escape".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn moves_a_note_across_folders() {
        let dir = temp_dir();
        notes_write(s(&dir), "Inbox/Note.md".into(), "keep".into()).unwrap();

        notes_rename(s(&dir), "Inbox/Note.md".into(), "Archive/Note.md".into()).unwrap();

        assert!(notes_stat(s(&dir), "Inbox/Note.md".into()).unwrap().is_none());
        let moved = notes_read_opt(s(&dir), "Archive/Note.md".into()).unwrap().unwrap();
        assert_eq!(moved.content, "keep");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_path_traversal_on_every_argument() {
        let dir = temp_dir();
        notes_write(s(&dir), "Note.md".into(), "safe".into()).unwrap();

        // A relative escape, an embedded escape, and an absolute path are all refused.
        assert!(notes_write(s(&dir), "../evil.md".into(), "x".into()).is_err());
        assert!(notes_write(s(&dir), "Work/../../evil.md".into(), "x".into()).is_err());
        assert!(notes_read_opt(s(&dir), "../../etc/passwd".into()).is_err());
        assert!(notes_stat(s(&dir), "/etc/passwd".into()).is_err());

        // notes_rename guards BOTH arguments: a malicious destination must not move the source out.
        assert!(notes_rename(s(&dir), "Note.md".into(), "../escaped.md".into()).is_err());
        assert!(notes_rename(s(&dir), "../escaped.md".into(), "Note.md".into()).is_err());
        assert!(notes_stat(s(&dir), "Note.md".into()).unwrap().is_some());
        // Nothing was written outside the folder.
        assert!(!dir.parent().unwrap().join("evil.md").exists());
        assert!(!dir.parent().unwrap().join("escaped.md").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_and_lists_an_empty_folder_kept_by_its_marker() {
        let dir = temp_dir();
        notes_create_folder(s(&dir), "Projects".into()).unwrap();

        assert!(dir.join("Projects").join(FOLDER_MARKER).is_file());
        assert_eq!(notes_list_folders(s(&dir)).unwrap(), vec!["Projects"]);
        // The marker keeps it out of the note listing.
        assert!(notes_list(s(&dir)).unwrap().is_empty());

        notes_remove_dir(s(&dir), "Projects".into()).unwrap();
        assert!(!dir.join("Projects").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_the_last_note_prunes_an_implicit_folder_but_keeps_a_marked_one() {
        let dir = temp_dir();
        // An implicit folder (no marker) and a deliberately-empty one (marker).
        notes_write(s(&dir), "Work/Note.md".into(), "x".into()).unwrap();
        notes_create_folder(s(&dir), "Keep".into()).unwrap();
        notes_write(s(&dir), "Keep/Temp.md".into(), "y".into()).unwrap();

        // Deleting Work's only note prunes the now-empty Work/ entirely.
        notes_remove(s(&dir), "Work/Note.md".into()).unwrap();
        assert!(!dir.join("Work").exists());

        // Deleting Keep's only note leaves Keep/ alive — its .gnkeep marker is content.
        notes_remove(s(&dir), "Keep/Temp.md".into()).unwrap();
        assert!(dir.join("Keep").is_dir());
        assert!(dir.join("Keep").join(FOLDER_MARKER).is_file());
        assert_eq!(notes_list_folders(s(&dir)).unwrap(), vec!["Keep"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn moving_the_last_note_out_prunes_nested_empty_ancestors() {
        let dir = temp_dir();
        notes_write(s(&dir), "A/B/C/Note.md".into(), "x".into()).unwrap();

        notes_rename(s(&dir), "A/B/C/Note.md".into(), "Note.md".into()).unwrap();

        // A, A/B, A/B/C were all left empty by the move and pruned up to (not including) the root.
        assert!(!dir.join("A").exists());
        assert!(dir.join("Note.md").is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn moves_a_folder_subtree_and_prunes_the_old_parent() {
        let dir = temp_dir();
        notes_write(s(&dir), "Work/A.md".into(), "a".into()).unwrap();
        notes_write(s(&dir), "Work/Sub/B.md".into(), "b".into()).unwrap();

        notes_move_dir(s(&dir), "Work".into(), "Archive/Work".into()).unwrap();

        // The whole subtree moved under Archive/, and the now-empty Work/ was pruned.
        assert!(!dir.join("Work").exists());
        assert!(dir.join("Archive").join("Work").join("A.md").is_file());
        assert!(dir.join("Archive").join("Work").join("Sub").join("B.md").is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_dir_rejects_an_existing_destination() {
        let dir = temp_dir();
        notes_write(s(&dir), "Work/A.md".into(), "a".into()).unwrap();
        notes_write(s(&dir), "Archive/B.md".into(), "b".into()).unwrap();

        assert!(notes_move_dir(s(&dir), "Work".into(), "Archive".into()).is_err());
        assert!(dir.join("Work").join("A.md").is_file()); // source intact

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn attachment_round_trips_and_rejects_traversal() {
        let dir = temp_dir();
        let bytes = vec![0u8, 1, 2, 254, 255];

        // Writing the first attachment creates the Attachments/ folder; read returns the same bytes.
        attachment_write(s(&dir), "Attachments/pic.png".into(), bytes.clone()).unwrap();
        assert!(dir.join("Attachments").join("pic.png").is_file());
        let read = attachment_read(s(&dir), "Attachments/pic.png".into()).unwrap();
        assert_eq!(read, Some(bytes));

        // A missing attachment reads as None (mapped to not-found TS-side), not an error.
        assert_eq!(attachment_read(s(&dir), "Attachments/missing.png".into()).unwrap(), None);

        // Both arguments are containment-guarded.
        assert!(attachment_write(s(&dir), "../evil.png".into(), vec![1]).is_err());
        assert!(attachment_read(s(&dir), "../../etc/passwd".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn attachment_list_and_remove() {
        let dir = temp_dir();
        // No folder yet → empty list, not an error.
        assert!(attachment_list(s(&dir)).unwrap().is_empty());

        attachment_write(s(&dir), "Attachments/cat.png".into(), vec![1, 2, 3]).unwrap();
        attachment_write(s(&dir), "Attachments/dog.gif".into(), vec![9]).unwrap();
        // A dotfile in the folder must be ignored by the listing.
        fs::write(dir.join("Attachments").join(".keep"), b"").unwrap();

        let mut names: Vec<String> =
            attachment_list(s(&dir)).unwrap().into_iter().map(|a| a.name).collect();
        names.sort();
        assert_eq!(names, vec!["cat.png", "dog.gif"]);
        let cat = attachment_list(s(&dir)).unwrap().into_iter().find(|a| a.name == "cat.png").unwrap();
        assert_eq!(cat.size, 3.0);

        attachment_remove(s(&dir), "Attachments/cat.png".into()).unwrap();
        let names: Vec<String> =
            attachment_list(s(&dir)).unwrap().into_iter().map(|a| a.name).collect();
        assert_eq!(names, vec!["dog.gif"]);
        // Removing a missing file is a no-op; traversal is rejected.
        assert!(attachment_remove(s(&dir), "Attachments/gone.png".into()).is_ok());
        assert!(attachment_remove(s(&dir), "../escape.png".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn attachments_folder_is_hidden_from_notes_and_folder_listings() {
        let dir = temp_dir();
        notes_write(s(&dir), "Note.md".into(), "x".into()).unwrap();
        attachment_write(s(&dir), "Attachments/pic.png".into(), vec![1, 2, 3]).unwrap();
        // A stray .md inside Attachments/ must not be picked up as a note.
        fs::write(dir.join("Attachments").join("Stray.md"), "nope").unwrap();

        let notes: Vec<String> = notes_list(s(&dir)).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(notes, vec!["Note.md"]);
        assert!(notes_list_folders(s(&dir)).unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_into_a_not_yet_existent_nested_dir_succeeds_via_ancestor_confinement() {
        // A path whose parents don't exist yet must still validate, so create_dir_all can make it.
        // confine_to_root doesn't canonicalize the (non-existent) target — it climbs to the deepest
        // *existing* ancestor (here, the root) and confines against that, then returns the lexical join.
        let dir = temp_dir();
        let path = resolve_within(&s(&dir), "A/B/C/Deep.md").unwrap();
        assert!(path.starts_with(&dir));
        assert!(!path.exists());
        notes_write(s(&dir), "A/B/C/Deep.md".into(), "ok".into()).unwrap();
        assert!(path.is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reveal_rejects_traversal_and_missing_paths() {
        // Both error cases return before the platform "open" call, so this never launches Finder.
        let dir = temp_dir();
        notes_write(s(&dir), "Note.md".into(), "x".into()).unwrap();

        // A path escaping the picked folder is refused by the containment guard.
        assert!(reveal_path(s(&dir), "../../Applications".into()).is_err());
        // An in-bounds path that doesn't exist is reported, not launched on nothing.
        assert!(reveal_path(s(&dir), "Nope.md".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_paths_that_escape_through_an_in_root_symlink() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir();
        // A sibling directory OUTSIDE the picked folder, holding a secret.
        let outside = temp_dir();
        fs::write(outside.join("secret.md"), "secret").unwrap();
        // A symlink *inside* the picked folder pointing at that outside directory. Lexically,
        // `escape/...` looks contained; only resolving the link reveals the escape.
        symlink(&outside, dir.join("escape")).unwrap();

        // Reading through the symlink (existing target) is refused.
        assert!(notes_read_opt(s(&dir), "escape/secret.md".into()).is_err());
        assert!(reveal_path(s(&dir), "escape/secret.md".into()).is_err());
        // Writing through the symlink (non-existent target, parent is the link) is refused too, and
        // nothing lands outside the folder.
        assert!(notes_write(s(&dir), "escape/evil.md".into(), "x".into()).is_err());
        assert!(attachment_write(s(&dir), "escape/evil.png".into(), vec![1]).is_err());
        assert!(!outside.join("evil.md").exists());
        assert!(!outside.join("evil.png").exists());

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn rename_refuses_to_clobber_a_different_note() {
        let dir = temp_dir();
        notes_write(s(&dir), "A.md".into(), "aaa".into()).unwrap();
        notes_write(s(&dir), "B.md".into(), "bbb".into()).unwrap();

        // Renaming A onto the existing, distinct B must fail and leave both intact.
        assert!(notes_rename(s(&dir), "A.md".into(), "B.md".into()).is_err());
        assert_eq!(notes_read_opt(s(&dir), "A.md".into()).unwrap().unwrap().content, "aaa");
        assert_eq!(notes_read_opt(s(&dir), "B.md".into()).unwrap().unwrap().content, "bbb");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_dir_refuses_a_non_empty_folder_and_keeps_its_marker() {
        let dir = temp_dir();
        notes_create_folder(s(&dir), "Keep".into()).unwrap();
        notes_write(s(&dir), "Keep/Note.md".into(), "x".into()).unwrap();

        // The folder still holds a note, so removal is refused — and the .gnkeep marker survives.
        assert!(notes_remove_dir(s(&dir), "Keep".into()).is_err());
        assert!(dir.join("Keep").join(FOLDER_MARKER).is_file());
        assert!(dir.join("Keep").join("Note.md").is_file());
        // A missing folder is a no-op.
        assert!(notes_remove_dir(s(&dir), "Nope".into()).is_ok());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_a_non_utf8_note_errors_instead_of_corrupting_it() {
        let dir = temp_dir();
        // Invalid UTF-8 bytes (a lone 0xFF) — a lossy decode would replace them with U+FFFD and the
        // next save would write that corruption back. We surface an error instead.
        fs::write(dir.join("Latin1.md"), [0x68, 0x69, 0xff]).unwrap();
        assert!(notes_read_opt(s(&dir), "Latin1.md".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
