const COMMANDS: &[&str] = &[
  "pick_folder",
  "resolve_bookmark",
  "read_note",
  "write_note",
  "read_attachment",
  "write_attachment",
  "open_url",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
