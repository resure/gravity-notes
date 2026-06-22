//! Native filesystem backend for Gravity Notes' folder storage.
//!
//! The web File System Access API is unavailable in macOS WKWebView, so the
//! folder-of-`.md`-files backend is served by these commands instead. They are
//! deliberately thin primitives over `std::fs` — all the note semantics (canonical
//! body shape, unique-name resolution, case-only rename, conflict detection) live in
//! TypeScript (`src/storage/tauriStore.ts`), mirroring `FileSystemNoteStore` so the
//! rest of the app is backend-agnostic.
//!
//! `dir` is the absolute path to the user-picked folder; `name` is a note id
//! (`<Title>.md`) or the `.gravity-notes.json` metadata sidecar. Times are returned as
//! epoch-millisecond `f64`s to match the web backend's `file.lastModified`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
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

fn entry_path(dir: &str, name: &str) -> PathBuf {
    Path::new(dir).join(name)
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

/// List `.md` files with their mtime and a head slice (for previews) — one directory scan.
#[tauri::command]
fn notes_list(dir: String) -> Result<Vec<NoteHead>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(stringify)? {
        let entry = entry.map_err(stringify)?;
        let meta = entry.metadata().map_err(stringify)?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_md(&name) {
            continue;
        }
        let file = fs::File::open(entry.path()).map_err(stringify)?;
        let mut buf = Vec::new();
        file.take(PREVIEW_SCAN_BYTES)
            .read_to_end(&mut buf)
            .map_err(stringify)?;
        out.push(NoteHead {
            name,
            modified_ms: modified_ms(&meta),
            head: String::from_utf8_lossy(&buf).into_owned(),
        });
    }
    Ok(out)
}

/// Read every `.md` file with full content — feeds the full-text search corpus.
#[tauri::command]
fn notes_read_all(dir: String) -> Result<Vec<NoteFull>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(stringify)? {
        let entry = entry.map_err(stringify)?;
        let meta = entry.metadata().map_err(stringify)?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_md(&name) {
            continue;
        }
        let bytes = fs::read(entry.path()).map_err(stringify)?;
        out.push(NoteFull {
            name,
            modified_ms: modified_ms(&meta),
            content: String::from_utf8_lossy(&bytes).into_owned(),
        });
    }
    Ok(out)
}

/// Read a single file, or `None` if it doesn't exist (used for `get` and the metadata sidecar).
#[tauri::command]
fn notes_read_opt(dir: String, name: String) -> Result<Option<NoteFull>, String> {
    let path = entry_path(&dir, &name);
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

/// Write a file atomically and return its new mtime.
#[tauri::command]
fn notes_write(dir: String, name: String, content: String) -> Result<f64, String> {
    let path = entry_path(&dir, &name);
    write_atomic(&path, content.as_bytes()).map_err(stringify)?;
    let meta = fs::metadata(&path).map_err(stringify)?;
    Ok(modified_ms(&meta))
}

/// Atomically rename `from` to `to` and return `to`'s mtime. Collision and case-only-rename
/// handling lives in TS; here `from` and `to` are always distinct names.
#[tauri::command]
fn notes_rename(dir: String, from: String, to: String) -> Result<f64, String> {
    let to_path = entry_path(&dir, &to);
    fs::rename(entry_path(&dir, &from), &to_path).map_err(stringify)?;
    let meta = fs::metadata(&to_path).map_err(stringify)?;
    Ok(modified_ms(&meta))
}

#[tauri::command]
fn notes_remove(dir: String, name: String) -> Result<(), String> {
    fs::remove_file(entry_path(&dir, &name)).map_err(stringify)
}

/// Whether a name exists in the folder. Case-insensitive on macOS's default filesystem,
/// matching the web backend's collision check.
#[tauri::command]
fn notes_exists(dir: String, name: String) -> Result<bool, String> {
    Ok(entry_path(&dir, &name).exists())
}

/// A note's current mtime in epoch ms, or `None` if it no longer exists.
#[tauri::command]
fn notes_stat(dir: String, name: String) -> Result<Option<f64>, String> {
    match fs::metadata(entry_path(&dir, &name)) {
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
