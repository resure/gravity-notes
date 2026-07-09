use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_icloud_fs);

// Registers the Swift `IcloudFsPlugin` with the Tauri runtime (iOS only — Android isn't a target).
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<IcloudFs<R>> {
  #[cfg(target_os = "ios")]
  let handle = api.register_ios_plugin(init_plugin_icloud_fs)?;
  Ok(IcloudFs(handle))
}

/// Access to the icloud-fs APIs — a thin Rust facade over the Swift plugin's two native operations.
pub struct IcloudFs<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> IcloudFs<R> {
  /// Present the folder picker and, on a choice, start security-scoped access + return a bookmark.
  pub fn pick_folder(&self) -> crate::Result<PickFolderResponse> {
    self
      .0
      .run_mobile_plugin("pickFolder", ())
      .map_err(Into::into)
  }

  /// Re-resolve a saved bookmark and re-establish security-scoped access to that folder.
  pub fn resolve_bookmark(
    &self,
    payload: ResolveBookmarkRequest,
  ) -> crate::Result<ResolveBookmarkResponse> {
    self
      .0
      .run_mobile_plugin("resolveBookmark", payload)
      .map_err(Into::into)
  }

  /// Coordinated + download-on-demand read of one note (the open-note path, where iCloud eviction
  /// and mid-sync partial reads actually bite; the bulk walk stays on the Rust `notes_*` commands).
  pub fn read_note(&self, payload: ReadNoteRequest) -> crate::Result<ReadNoteResponse> {
    self
      .0
      .run_mobile_plugin("readNote", payload)
      .map_err(Into::into)
  }

  /// Coordinated + atomic write of one note (autosave / create / metadata sidecar).
  pub fn write_note(&self, payload: WriteNoteRequest) -> crate::Result<WriteNoteResponse> {
    self
      .0
      .run_mobile_plugin("writeNote", payload)
      .map_err(Into::into)
  }
}
