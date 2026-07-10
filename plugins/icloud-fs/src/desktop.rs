use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<IcloudFs<R>> {
  Ok(IcloudFs(app.clone()))
}

/// Desktop no-op facade. This plugin is only registered on iOS (the desktop app uses a plain folder
/// path via the `notes_*` commands, no security-scoped bookmark), so these paths are never hit — but
/// the crate still compiles for the host so it can be unit-tested and linted.
pub struct IcloudFs<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> IcloudFs<R> {
  pub fn pick_folder(&self) -> crate::Result<PickFolderResponse> {
    Err(crate::Error::Unsupported)
  }

  pub fn resolve_bookmark(
    &self,
    _payload: ResolveBookmarkRequest,
  ) -> crate::Result<ResolveBookmarkResponse> {
    Err(crate::Error::Unsupported)
  }

  pub fn read_note(&self, _payload: ReadNoteRequest) -> crate::Result<ReadNoteResponse> {
    Err(crate::Error::Unsupported)
  }

  pub fn write_note(&self, _payload: WriteNoteRequest) -> crate::Result<WriteNoteResponse> {
    Err(crate::Error::Unsupported)
  }

  pub fn read_attachment(
    &self,
    _payload: ReadAttachmentRequest,
  ) -> crate::Result<ReadAttachmentResponse> {
    Err(crate::Error::Unsupported)
  }

  pub fn write_attachment(
    &self,
    _payload: WriteAttachmentRequest,
  ) -> crate::Result<WriteAttachmentResponse> {
    Err(crate::Error::Unsupported)
  }

  pub fn open_url(&self, _payload: OpenUrlRequest) -> crate::Result<OpenUrlResponse> {
    Err(crate::Error::Unsupported)
  }
}
