use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::IcloudFs;
#[cfg(mobile)]
use mobile::IcloudFs;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the icloud-fs APIs.
pub trait IcloudFsExt<R: Runtime> {
  fn icloud_fs(&self) -> &IcloudFs<R>;
}

impl<R: Runtime, T: Manager<R>> crate::IcloudFsExt<R> for T {
  fn icloud_fs(&self) -> &IcloudFs<R> {
    self.state::<IcloudFs<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("icloud-fs")
    .invoke_handler(tauri::generate_handler![
      commands::pick_folder,
      commands::resolve_bookmark
    ])
    .setup(|app, api| {
      #[cfg(mobile)]
      let icloud_fs = mobile::init(app, api)?;
      #[cfg(desktop)]
      let icloud_fs = desktop::init(app, api)?;
      app.manage(icloud_fs);
      Ok(())
    })
    .build()
}
