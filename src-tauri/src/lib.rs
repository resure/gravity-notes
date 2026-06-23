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
    let meta = fs::metadata(&to_path).map_err(stringify)?;
    Ok(modified_ms(&meta))
}

#[tauri::command]
fn notes_remove(dir: String, name: String) -> Result<(), String> {
    let path = resolve_within(&dir, &name)?;
    fs::remove_file(path).map_err(stringify)
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
            notes_exists,
            notes_stat,
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
