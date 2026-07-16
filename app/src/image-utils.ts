/**
 * Resize an image file to a centered square data-URL for use as an avatar.
 * Client-side (canvas) so the DB and per-project export file stay small — a
 * multi-MB photo becomes a few KB. Decodes via `createImageBitmap` with
 * `imageOrientation: 'from-image'` so EXIF orientation is honored — phone photos
 * (which carry an orientation tag) aren't drawn sideways. Prefers webp; webp
 * encoding silently returns a PNG on browsers that can't encode it (it does not
 * throw), so we check the result prefix and re-encode to JPEG. Rejects
 * non-raster/oversized/undecodable input. GIF decodes to its first frame.
 * See design-docs/member-avatars.md.
 */
export async function resizeImageToDataURL(
  file: File,
  size = 128
): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error('Unsupported format — use PNG, JPEG, WebP or GIF.')
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image too large (max 10MB).')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Could not decode image.')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not available.')
    // Center-crop the (orientation-corrected) bitmap to a square.
    const s = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - s) / 2
    const sy = (bitmap.height - s) / 2
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size)
    let out = canvas.toDataURL('image/webp', 0.85)
    if (!out.startsWith('data:image/webp')) {
      out = canvas.toDataURL('image/jpeg', 0.85) // silent-PNG fallback
    }
    return out
  } finally {
    bitmap.close()
  }
}
