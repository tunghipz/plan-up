// plan-up iOS: the Mac's auto-backup folder, read from the phone
// (design-docs/ios-backup-folder.md).
//
// The user picks the folder once (usually in iCloud Drive). We keep a bookmark of
// it in UserDefaults so the pick survives relaunches, and only ever LIST and READ
// inside it — there is no write command. Names arriving here were already checked
// in Rust (lib.rs, `is_backup_filename` + subdir allow-list); the checks below are
// a second fence, not the only one.

import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

struct ListArgs: Decodable {
  let subdir: String?
}

struct ReadArgs: Decodable {
  let fileName: String
  let subdir: String?
}

private let bookmarkKey = "plan-up.backupFolderBookmark"

enum FolderError: LocalizedError {
  case notChosen
  case badName(String)

  var errorDescription: String? {
    switch self {
    case .notChosen: return "No backup folder chosen."
    case .badName(let name): return "Invalid name: \(name)"
    }
  }
}

class BackupFolderPlugin: Plugin, UIDocumentPickerDelegate {
  /// The `pick` call waiting on the document picker (one picker at a time).
  private var pendingPick: Invoke?
  private let io = DispatchQueue(label: "plan-up.backup-folder", qos: .userInitiated)

  // MARK: commands

  @objc public func pick(_ invoke: Invoke) {
    DispatchQueue.main.async {
      // A second tap while the picker is up answers the first call with "cancelled".
      self.pendingPick?.resolve(["name": nil])
      self.pendingPick = invoke
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
      picker.delegate = self
      picker.allowsMultipleSelection = false
      self.manager.viewController?.present(picker, animated: true)
    }
  }

  @objc public func status(_ invoke: Invoke) {
    io.async {
      do {
        guard let url = try self.resolveFolder() else {
          invoke.resolve(["name": nil])
          return
        }
        invoke.resolve(["name": url.lastPathComponent])
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  @objc public func list(_ invoke: Invoke) {
    io.async {
      do {
        let args = try invoke.parseArgs(ListArgs.self)
        let names = try self.withFolder(subdir: args.subdir) { dir -> [String] in
          var listed: [String] = []
          var coordError: NSError?
          var readError: Error?
          NSFileCoordinator().coordinate(readingItemAt: dir, options: [], error: &coordError) { url in
            do {
              listed = try FileManager.default.contentsOfDirectory(atPath: url.path)
            } catch {
              readError = error
            }
          }
          if let e = coordError ?? readError { throw e }
          return listed.map(Self.realName)
        }
        invoke.resolve(["files": names])
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  @objc public func read(_ invoke: Invoke) {
    io.async {
      do {
        let args = try invoke.parseArgs(ReadArgs.self)
        let name = args.fileName
        if name.isEmpty || name.contains("/") || name.contains("..") || name.hasPrefix(".") {
          throw FolderError.badName(name)
        }
        let data = try self.withFolder(subdir: args.subdir) { dir -> Data in
          let file = dir.appendingPathComponent(name)
          // Not downloaded yet (iCloud): ask for it; the coordinated read below
          // then waits until the bytes are local.
          try? FileManager.default.startDownloadingUbiquitousItem(at: file)
          var out = Data()
          var coordError: NSError?
          var readError: Error?
          NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &coordError) { url in
            do {
              out = try Data(contentsOf: url)
            } catch {
              readError = error
            }
          }
          if let e = coordError ?? readError { throw e }
          return out
        }
        invoke.resolve(["data": data.base64EncodedString()])
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  // MARK: document picker

  public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pendingPick else { return }
    pendingPick = nil
    guard let url = urls.first else {
      invoke.resolve(["name": nil])
      return
    }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
      invoke.resolve(["name": url.lastPathComponent])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pendingPick?.resolve(["name": nil])
    pendingPick = nil
  }

  // MARK: helpers

  /// The saved folder, or nil when none was picked. A stale bookmark (folder
  /// moved or renamed) is refreshed in place while it still resolves.
  private func resolveFolder() throws -> URL? {
    guard let bookmark = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
    var stale = false
    let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    if stale {
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        UserDefaults.standard.set(fresh, forKey: bookmarkKey)
      }
    }
    return url
  }

  /// Run `body` on the folder (or its `versions/` subfolder) inside the
  /// security scope the bookmark grants.
  private func withFolder<T>(subdir: String?, _ body: (URL) throws -> T) throws -> T {
    guard let root = try resolveFolder() else { throw FolderError.notChosen }
    let sub = subdir ?? ""
    guard sub == "" || sub == "versions" else { throw FolderError.badName(sub) }
    let scoped = root.startAccessingSecurityScopedResource()
    defer { if scoped { root.stopAccessingSecurityScopedResource() } }
    return try body(sub.isEmpty ? root : root.appendingPathComponent(sub, isDirectory: true))
  }

  /// iCloud keeps a not-yet-downloaded file as `.<name>.icloud`; report its real name.
  static func realName(_ name: String) -> String {
    if name.hasPrefix("."), name.hasSuffix(".icloud") {
      return String(name.dropFirst().dropLast(".icloud".count))
    }
    return name
  }
}

@_cdecl("init_plugin_backup_folder")
public func initPlugin() -> Plugin {
  return BackupFolderPlugin()
}
