/**
 * Export on the iOS app (design-docs/ios-app.md): hand the bytes to the native
 * `save_export` command, which writes them to the app's Documents folder
 * (Files › On My iPhone › plan-up) and confirms with a native alert. Exactly one
 * of `text` / `base64` is sent.
 */
export async function saveToNativeFiles(
  fileName: string,
  content: { text: string } | { base64: string }
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_export', {
    fileName,
    text: 'text' in content ? content.text : null,
    base64: 'base64' in content ? content.base64 : null,
  })
}
