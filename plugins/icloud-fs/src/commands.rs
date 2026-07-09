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
