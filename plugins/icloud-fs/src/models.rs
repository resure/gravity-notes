use serde::{Deserialize, Serialize};

/// Result of the native folder picker (`UIDocumentPickerViewController`). The user picks a folder —
/// typically inside iCloud Drive — and the Swift side starts security-scoped access and mints a
/// bookmark that re-grants that access on a later launch. `cancelled` is true when the picker was
/// dismissed without a choice (then every other field is `None`).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFolderResponse {
    /// POSIX path of the picked folder. Valid only while security-scoped access is held (which the
    /// plugin holds for the app's lifetime). `None` when cancelled.
    pub path: Option<String>,
    /// Base64 security-scoped bookmark to persist and later hand to `resolve_bookmark`. `None` when
    /// cancelled.
    pub bookmark: Option<String>,
    /// The folder's display name (its last path component). `None` when cancelled.
    pub name: Option<String>,
    /// True when the user dismissed the picker without choosing a folder.
    pub cancelled: bool,
}

/// Ask the plugin to re-resolve a previously-saved bookmark and re-establish security-scoped access
/// (done on launch for a remembered iOS folder workspace).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveBookmarkRequest {
    /// A base64 bookmark previously returned by `pick_folder`.
    pub bookmark: String,
}

/// Result of resolving a saved bookmark: the freshly-resolved path (access already started), plus a
/// possibly-refreshed bookmark to persist when the old one had gone stale.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveBookmarkResponse {
    /// The folder's current POSIX path (the provider may have moved it since the bookmark was made).
    pub path: String,
    /// The bookmark to persist going forward — refreshed when `stale`, otherwise the input value.
    pub bookmark: String,
    /// True when the OS reported the bookmark as stale and a fresh one was minted.
    pub stale: bool,
}

/// Read a single note relative to the workspace folder, `NSFileCoordinator`-coordinated and
/// materializing the file first if iCloud has evicted its content (`dir`/`name` mirror the Rust
/// `notes_*` command args — an absolute folder path and a POSIX rel-path within it).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadNoteRequest {
    pub dir: String,
    pub name: String,
}

/// Coordinated-read result. `exists: false` (empty content) is the "no such file" signal — the
/// frontend maps it to a not-found/deleted conflict, matching `notes_read_opt` returning null.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadNoteResponse {
    pub exists: bool,
    pub content: String,
    pub modified_ms: f64,
}

/// Write a single note relative to the workspace folder, `NSFileCoordinator`-coordinated and atomic
/// (creating parent folders like `notes_write`'s `create_dir_all`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteRequest {
    pub dir: String,
    pub name: String,
    pub contents: String,
}

/// Coordinated-write result: the file's new mtime in epoch ms (re-seeds the autosave baseline).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteResponse {
    pub modified_ms: f64,
}

/// Read one attachment (an image under `Attachments/`) relative to the workspace folder,
/// `NSFileCoordinator`-coordinated + download-on-demand like `read_note`. Binary, so the bytes ride
/// back base64-encoded rather than as a UTF-8 string.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAttachmentRequest {
    pub dir: String,
    pub name: String,
}

/// Coordinated-read result. `exists: false` (empty `data`) is the "no such file" signal, matching
/// `attachment_read` returning null. `data` is base64 of the raw bytes.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAttachmentResponse {
    pub exists: bool,
    pub data: String,
}

/// Write one attachment relative to the workspace folder, `NSFileCoordinator`-coordinated + atomic
/// (creating `Attachments/` like `attachment_write`). `data` is base64 of the raw bytes.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAttachmentRequest {
    pub dir: String,
    pub name: String,
    pub data: String,
}

/// Coordinated-write ack (no payload — attachments don't feed an mtime baseline like notes do).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAttachmentResponse {}

/// Open an external URL in the system default app (the iOS counterpart of the macOS-only
/// `open_external` command). Same web/mail/tel allow-list, re-checked native-side.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenUrlRequest {
    pub url: String,
}

/// Result of an external-open: whether the system accepted the URL.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenUrlResponse {
    pub opened: bool,
}
