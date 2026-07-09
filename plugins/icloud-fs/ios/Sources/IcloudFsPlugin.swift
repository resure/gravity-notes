import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class ResolveBookmarkArgs: Decodable {
  let bookmark: String
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
