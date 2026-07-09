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
