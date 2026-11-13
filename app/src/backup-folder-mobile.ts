import { exportAll, importAll, type ExportPayload } from './io'
import { parseVersionFilename, VERSIONS_DIR } from './backup'
import { saveToNativeFiles } from './native-save'
import type { VersionEntry } from './backup-tauri'

/**
 * iPhone: open a backup from the Mac's auto-backup folder in iCloud Drive
 * (design-docs/ios-backup-folder.md). Read-only — the native side holds the
 * folder and nothing here can write to it. Every entry point is only reached
 * from the `⋯ → Folder backup…` sheet, which exists only on IS_NATIVE_MOBILE.
 */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core')
  return core.invoke<T>(cmd, args)
}

/** Name of the folder picked earlier, or null if none yet. */
export function getFolderName(): Promise<string | null> {
  return invoke<string | null>('backup_folder_status')
}

/** Open the iOS folder picker. The picked folder's name, or null on Cancel. */
export function pickFolder(): Promise<string | null> {
  return invoke<string | null>('backup_folder_pick')
}

/** `versions/` snapshots in the folder, newest first. */
export async function listFolderVersions(): Promise<VersionEntry[]> {
  const names = await invoke<string[]>('backup_folder_list', { subdir: VERSIONS_DIR })
  return names
    .map((file) => ({ file, at: parseVersionFilename(file) }))
    .filter((e): e is VersionEntry => e.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Read + parse one snapshot (Rust inflates `.json.gz`). */
export async function readFolderVersion(file: string): Promise<ExportPayload> {
  const text = await invoke<string>('backup_folder_read', { fileName: file, subdir: VERSIONS_DIR })
  return JSON.parse(text) as ExportPayload
}

/** `plan-up-iphone-truoc-khi-mo-YYYY-MM-DD-HHMMSS.json`, local time. */
export function safetyCopyFilename(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `plan-up-iphone-truoc-khi-mo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`
}

/**
 * Replace the phone's data with a snapshot. Same fail-safe order as the desktop
 * restore: read the target first (nothing touched if it's bad), then save the
 * phone's current data to Files › plan-up (abort if that fails), then
 * importAll (validates before clearing, rolls back on error). Caller reloads.
 */
export async function openFolderVersion(file: string): Promise<void> {
  const payload = await readFolderVersion(file)
  const current = await exportAll()
  try {
    await saveToNativeFiles(
      safetyCopyFilename(new Date()),
      { text: JSON.stringify(current) },
      { quiet: true }
    )
  } catch (e) {
    throw new Error(`Không lưu được bản an toàn của iPhone: ${String(e)}`, { cause: e })
  }
  await importAll(payload)
}
