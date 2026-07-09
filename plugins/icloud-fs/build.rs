const COMMANDS: &[&str] = &["pick_folder", "resolve_bookmark"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
