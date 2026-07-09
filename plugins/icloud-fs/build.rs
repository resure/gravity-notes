const COMMANDS: &[&str] = &["pick_folder", "resolve_bookmark", "read_note", "write_note"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
