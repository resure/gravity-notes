import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class ResolveBookmarkArgs: Decodable {
  let bookmark: String
}

class ReadNoteArgs: Decodable {
  let dir: String
  let name: String
}

class WriteNoteArgs: Decodable {
  let dir: String
  let name: String
  let contents: String
}

class ReadAttachmentArgs: Decodable {
  let dir: String
  let name: String
}

class WriteAttachmentArgs: Decodable {
  let dir: String
  let name: String
  /// Base64 of the raw attachment bytes (binary can't ride as a UTF-8 string like a note body).
  let data: String
}

class OpenUrlArgs: Decodable {
  let url: String
}

/// Native folder access for the iOS build. The user picks a folder (typically inside iCloud Drive)
/// with the system Files picker; we start *security-scoped* access to it and hand back a bookmark.
/// Because access is held process-wide, the app's ordinary POSIX file commands (`notes_*`, plain
/// `std::fs` on the Rust side) can then read and write inside that folder — so this plugin only owns
/// the pick + bookmark-resolve, not the file I/O itself.
class IcloudFsPlugin: Plugin {
  // The picker's delegate is held weakly by UIKit — keep a strong ref so it isn't deallocated while
  // the picker is on screen. Also gates re-entrancy: one pick at a time.
  private var pickerDelegate: FolderPickerDelegate?
  private var pendingPick: Invoke?

  @objc public func pickFolder(_ invoke: Invoke) throws {
    // Only one picker in flight; reject a second concurrent request rather than losing the first.
    if pendingPick != nil {
      invoke.reject("A folder picker is already open")
      return
    }
    pendingPick = invoke

    DispatchQueue.main.async {
      // swift-rs compiles this package below the app's iOS-14 floor, so the content-types picker
      // needs a runtime guard even though the app never actually runs on iOS 13.
      guard #available(iOS 14, *) else {
        self.pendingPick = nil
        self.pickerDelegate = nil
        invoke.reject("Folder access requires iOS 14 or later")
        return
      }

      let delegate = FolderPickerDelegate(self)
      self.pickerDelegate = delegate

      // asCopy: false → open the real folder in place (security-scoped), not a sandbox copy.
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [UTType.folder], asCopy: false)
      picker.delegate = delegate
      picker.allowsMultipleSelection = false
      picker.modalPresentationStyle = .fullScreen
      self.manager.viewController?.present(picker, animated: true, completion: nil)
    }
  }

  // Called back by the delegate with the chosen folder, or nil when the picker was cancelled.
  fileprivate func onFolderPicked(_ url: URL?) {
    guard let invoke = pendingPick else { return }
    pendingPick = nil
    pickerDelegate = nil

    guard let url = url else {
      invoke.resolve(["cancelled": true])
      return
    }

    // Start security-scoped access and DON'T stop it — the workspace stays open for the app's
    // lifetime, so the Rust fs commands keep working against this path.
    let accessing = url.startAccessingSecurityScopedResource()
    do {
      let bookmark = try url.bookmarkData(
        options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      invoke.resolve([
        "path": url.path,
        "bookmark": bookmark.base64EncodedString(),
        "name": url.lastPathComponent,
        "cancelled": false,
      ])
    } catch {
      if accessing { url.stopAccessingSecurityScopedResource() }
      invoke.reject("Could not bookmark that folder: \(error.localizedDescription)")
    }
  }

  @objc public func resolveBookmark(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ResolveBookmarkArgs.self)
    guard let data = Data(base64Encoded: args.bookmark) else {
      invoke.reject("Invalid bookmark data")
      return
    }

    var stale = false
    do {
      let url = try URL(
        resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      // Re-establish access for this launch (again, held for the app's lifetime).
      _ = url.startAccessingSecurityScopedResource()

      var outBookmark = args.bookmark
      if stale,
        let refreshed = try? url.bookmarkData(
          options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      {
        outBookmark = refreshed.base64EncodedString()
      }
      invoke.resolve(["path": url.path, "bookmark": outBookmark, "stale": stale])
    } catch {
      invoke.reject("Could not reopen that folder: \(error.localizedDescription)")
    }
  }

  @objc public func readNote(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ReadNoteArgs.self)
    guard let url = Self.resolveWithin(dir: args.dir, name: args.name) else {
      invoke.reject("Invalid note path")
      return
    }
    // Off the main thread: materializing an evicted file + the coordinated read can block.
    DispatchQueue.global(qos: .userInitiated).async {
      Self.ensureDownloaded(url)
      var coordError: NSError?
      // exists:false (empty content) is the "no such file" signal — mirrors notes_read_opt → null.
      var payload: [String: Any] = ["exists": false, "content": "", "modifiedMs": 0]
      var readFailure: String?
      NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) {
        (readingURL) in
        if !FileManager.default.fileExists(atPath: readingURL.path) {
          return  // leaves exists:false
        }
        do {
          let data = try Data(contentsOf: readingURL)
          // Strict UTF-8 like the Rust notes_read_opt (which rejects invalid bytes).
          guard let content = String(data: data, encoding: .utf8) else {
            readFailure = "Note is not valid UTF-8"
            return
          }
          payload = ["exists": true, "content": content, "modifiedMs": Self.modifiedMs(readingURL)]
        } catch {
          readFailure = error.localizedDescription
        }
      }
      DispatchQueue.main.async {
        if let coordError = coordError {
          invoke.reject("Coordinated read failed: \(coordError.localizedDescription)")
        } else if let readFailure = readFailure {
          invoke.reject(readFailure)
        } else {
          invoke.resolve(payload)
        }
      }
    }
  }

  @objc public func writeNote(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteNoteArgs.self)
    guard let url = Self.resolveWithin(dir: args.dir, name: args.name) else {
      invoke.reject("Invalid note path")
      return
    }
    let data = Data(args.contents.utf8)
    DispatchQueue.global(qos: .userInitiated).async {
      // Create intermediate folders, mirroring notes_write's create_dir_all.
      try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      var coordError: NSError?
      var writeFailure: String?
      var mtime: Double = 0
      NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError)
      {
        (writingURL) in
        do {
          try data.write(to: writingURL, options: .atomic)
          mtime = Self.modifiedMs(writingURL)
        } catch {
          writeFailure = error.localizedDescription
        }
      }
      DispatchQueue.main.async {
        if let coordError = coordError {
          invoke.reject("Coordinated write failed: \(coordError.localizedDescription)")
        } else if let writeFailure = writeFailure {
          invoke.reject(writeFailure)
        } else {
          invoke.resolve(["modifiedMs": mtime])
        }
      }
    }
  }

  /// Coordinated + download-on-demand read of one attachment (an image under `Attachments/`). Mirrors
  /// `readNote` but returns the raw bytes base64-encoded — the note body rides as UTF-8, attachments
  /// are binary. `exists: false` is the "no such file" signal, like `readNote`.
  @objc public func readAttachment(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ReadAttachmentArgs.self)
    guard let url = Self.resolveWithin(dir: args.dir, name: args.name) else {
      invoke.reject("Invalid attachment path")
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      Self.ensureDownloaded(url)
      var coordError: NSError?
      var payload: [String: Any] = ["exists": false, "data": ""]
      var readFailure: String?
      NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) {
        (readingURL) in
        if !FileManager.default.fileExists(atPath: readingURL.path) {
          return  // leaves exists:false
        }
        do {
          let data = try Data(contentsOf: readingURL)
          payload = ["exists": true, "data": data.base64EncodedString()]
        } catch {
          readFailure = error.localizedDescription
        }
      }
      DispatchQueue.main.async {
        if let coordError = coordError {
          invoke.reject("Coordinated read failed: \(coordError.localizedDescription)")
        } else if let readFailure = readFailure {
          invoke.reject(readFailure)
        } else {
          invoke.resolve(payload)
        }
      }
    }
  }

  /// Coordinated + atomic write of one attachment (creating `Attachments/` like `notes_write`'s
  /// `create_dir_all`). Input bytes arrive base64-encoded.
  @objc public func writeAttachment(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteAttachmentArgs.self)
    guard let url = Self.resolveWithin(dir: args.dir, name: args.name) else {
      invoke.reject("Invalid attachment path")
      return
    }
    guard let data = Data(base64Encoded: args.data) else {
      invoke.reject("Invalid attachment data")
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      var coordError: NSError?
      var writeFailure: String?
      NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError)
      {
        (writingURL) in
        do {
          try data.write(to: writingURL, options: .atomic)
        } catch {
          writeFailure = error.localizedDescription
        }
      }
      DispatchQueue.main.async {
        if let coordError = coordError {
          invoke.reject("Coordinated write failed: \(coordError.localizedDescription)")
        } else if let writeFailure = writeFailure {
          invoke.reject(writeFailure)
        } else {
          invoke.resolve([:])
        }
      }
    }
  }

  /// Open an external link in the system default app (Safari / Mail / Phone). WKWebView won't
  /// navigate to external origins on its own, and the desktop `open_external` command shells out to
  /// macOS `open`, which doesn't exist on iOS — so ⌘/tap on a note link routes here on iOS. Restricted
  /// to the same web/mail/tel allow-list as the Rust command so a crafted note can't hand the OS a
  /// `file:`/`javascript:`/app URL.
  @objc public func openUrl(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenUrlArgs.self)
    let allowed = ["http://", "https://", "mailto:", "tel:"]
    guard allowed.contains(where: { args.url.hasPrefix($0) }), let url = URL(string: args.url) else {
      invoke.reject("refusing to open \(args.url)")
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:]) { success in
        invoke.resolve(["opened": success])
      }
    }
  }

  /// File mtime in epoch ms, FLOORED to a whole millisecond. The Rust `notes_*` commands report
  /// mtime as `Duration::as_millis() as f64` (integer ms — `modified_ms` in lib.rs), and the store's
  /// optimistic-concurrency check compares this value (seeded via the coordinated read/write) against
  /// `notes_stat` with strict `!==`. A fractional `timeIntervalSince1970 * 1000` would never equal the
  /// truncated Rust value for the same file, so every autosave would raise a phantom `ConflictError`.
  /// `.rounded(.down)` matches `as_millis()`'s truncation for these (positive) epoch timestamps.
  private static func modifiedMs(_ url: URL) -> Double {
    let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
    let date = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
    return (date * 1000).rounded(.down)
  }

  /// Join `name` (a POSIX rel-path) onto `dir`, rejecting any result that escapes `dir` — the
  /// containment guard the Rust `notes_*` commands get from `resolve_within`.
  private static func resolveWithin(dir: String, name: String) -> URL? {
    let base = URL(fileURLWithPath: dir, isDirectory: true).standardizedFileURL
    let target = base.appendingPathComponent(name).standardizedFileURL
    let basePrefix = base.path.hasSuffix("/") ? base.path : base.path + "/"
    guard target.path == base.path || target.path.hasPrefix(basePrefix) else { return nil }

    // `standardizedFileURL` removes `.` / `..`, but deliberately does NOT resolve symlinks. Match
    // the Rust backend's `confine_to_root`: resolve the deepest existing target ancestor (the target
    // itself for reads, a parent for a not-yet-created write) and require its real path to remain
    // inside the real workspace root. Without this, `Attachments/Escape -> /outside` would let a
    // coordinated read/write leave the user-picked folder despite the lexical check above.
    let realBase = base.resolvingSymlinksInPath()
    let realBasePrefix = realBase.path.hasSuffix("/") ? realBase.path : realBase.path + "/"
    var probe = target
    while !FileManager.default.fileExists(atPath: probe.path) {
      let parent = probe.deletingLastPathComponent()
      if parent.path == probe.path { return nil }
      probe = parent
    }
    let realProbe = probe.resolvingSymlinksInPath()
    guard realProbe.path == realBase.path || realProbe.path.hasPrefix(realBasePrefix) else {
      return nil
    }
    return target
  }

  /// If `url` is an iCloud item whose content is evicted, start its download and wait (bounded) for
  /// it to materialize. A plain local (non-ubiquitous) file has no downloading status → no-op.
  private static func ensureDownloaded(_ url: URL) {
    let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
    guard let status = values?.ubiquitousItemDownloadingStatus else { return }  // not ubiquitous
    if status != .notDownloaded { return }  // already available (.current / .downloaded)
    try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    let deadline = Date().addingTimeInterval(15)
    while Date() < deadline {
      Thread.sleep(forTimeInterval: 0.1)
      let v = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
      if v?.ubiquitousItemDownloadingStatus != .notDownloaded { return }
    }
  }
}

/// UIKit delegate for the folder picker — forwards the chosen URL (or a cancel) back to the plugin.
class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let plugin: IcloudFsPlugin

  init(_ plugin: IcloudFsPlugin) {
    self.plugin = plugin
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    plugin.onFolderPicked(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    plugin.onFolderPicked(nil)
  }
}

@_cdecl("init_plugin_icloud_fs")
func initPlugin() -> Plugin {
  return IcloudFsPlugin()
}
