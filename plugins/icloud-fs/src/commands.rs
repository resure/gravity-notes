use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::IcloudFsExt;
use crate::Result;

/// Present the native folder picker; resolves with the picked folder's path + a security-scoped
/// bookmark (or `cancelled: true`). The frontend then opens a `TauriNoteStore` on the path.
#[command]
pub(crate) async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<PickFolderResponse> {
    app.icloud_fs().pick_folder()
}

/// Re-resolve a saved bookmark on launch, re-granting access and returning the folder's current
/// path (bookmarks survive the folder moving, so the path may differ from last time).
#[command]
pub(crate) async fn resolve_bookmark<R: Runtime>(
    app: AppHandle<R>,
    payload: ResolveBookmarkRequest,
) -> Result<ResolveBookmarkResponse> {
    app.icloud_fs().resolve_bookmark(payload)
}

/// Coordinated read of one note (downloads it first if iCloud evicted its content).
#[command]
pub(crate) async fn read_note<R: Runtime>(
    app: AppHandle<R>,
    payload: ReadNoteRequest,
) -> Result<ReadNoteResponse> {
    app.icloud_fs().read_note(payload)
}

/// Coordinated + atomic write of one note.
#[command]
pub(crate) async fn write_note<R: Runtime>(
    app: AppHandle<R>,
    payload: WriteNoteRequest,
) -> Result<WriteNoteResponse> {
    app.icloud_fs().write_note(payload)
}

/// Coordinated read of one attachment (downloads it first if iCloud evicted its content).
#[command]
pub(crate) async fn read_attachment<R: Runtime>(
    app: AppHandle<R>,
    payload: ReadAttachmentRequest,
) -> Result<ReadAttachmentResponse> {
    app.icloud_fs().read_attachment(payload)
}

/// Coordinated + atomic write of one attachment.
#[command]
pub(crate) async fn write_attachment<R: Runtime>(
    app: AppHandle<R>,
    payload: WriteAttachmentRequest,
) -> Result<WriteAttachmentResponse> {
    app.icloud_fs().write_attachment(payload)
}

/// Open an external URL in the system default app (iOS counterpart of the desktop `open_external`).
#[command]
pub(crate) async fn open_url<R: Runtime>(
    app: AppHandle<R>,
    payload: OpenUrlRequest,
) -> Result<OpenUrlResponse> {
    app.icloud_fs().open_url(payload)
}
