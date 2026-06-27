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

/// Resolve a caller-supplied relative `name` to an absolute path inside `dir`, rejecting any
/// attempt to escape the picked notes folder. A purely *lexical* check (no filesystem access), so
/// it validates a path whose parent directories don't exist yet — letting `notes_write` create a
/// brand-new nested folder while still refusing `../`, absolute paths, and root/prefix components.
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
    Ok(out)
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
            if name.starts_with('.') {
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
    Ok(Some(NoteFull {
        name,
        modified_ms: modified_ms(&meta),
        content: String::from_utf8_lossy(&bytes).into_owned(),
    }))
}

/// Write a file atomically, creating any missing parent folders, and return its new mtime.
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

/// Remove an empty folder: drop its `.gnkeep`, then remove the (now-empty) directory.
#[tauri::command]
fn notes_remove_dir(dir: String, path: String) -> Result<(), String> {
    let folder = resolve_within(&dir, &path)?;
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
        if name.starts_with('.') {
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

fn stringify(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
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
            notes_create_folder,
            notes_remove_dir,
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

        let mut ids: Vec<String> = notes_list(s(&dir)).unwrap().into_iter().map(|n| n.name).collect();
        ids.sort();
        assert_eq!(ids, vec!["Inbox.md", "Work/Roadmap.md", "Work/Sub/Deep.md"]);

        let mut all: Vec<String> = notes_read_all(s(&dir)).unwrap().into_iter().map(|n| n.name).collect();
        all.sort();
        assert_eq!(all, vec!["Inbox.md", "Work/Roadmap.md", "Work/Sub/Deep.md"]);

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
    fn write_into_a_not_yet_existent_nested_dir_succeeds_without_canonicalizing() {
        // The lexical guard must validate a path whose parent doesn't exist yet (no fs::canonicalize
        // of the target), so create_dir_all can then make it.
        let dir = temp_dir();
        let path = resolve_within(&s(&dir), "A/B/C/Deep.md").unwrap();
        assert!(path.starts_with(&dir));
        assert!(!path.exists());
        notes_write(s(&dir), "A/B/C/Deep.md".into(), "ok".into()).unwrap();
        assert!(path.is_file());

        let _ = fs::remove_dir_all(&dir);
    }
}
