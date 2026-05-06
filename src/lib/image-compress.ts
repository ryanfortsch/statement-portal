/**
 * Browser-side image compression. Resizes oversized photos and
 * re-encodes them as JPEG before upload so iPhone shots (5+ MB) don't
 * burn through Blob storage and bandwidth.
 *
 * Skips compression in three cases (returns the original file):
 *  - HEIC / HEIF: browsers can't decode these into a canvas without a
 *    polyfill. iOS auto-converts to JPEG when the user takes a photo
 *    via <input capture>, so HEIC mostly arrives via library picks; we
 *    let those upload at full size rather than ship a heavy decoder.
 *  - Already small (< 500 KB): no point re-encoding tiny screenshots.
 *  - Decode/canvas failure: graceful fallback to the untouched file so
 *    the user can always upload something.
 *
 * Default max dimension is 1600px on the long edge — plenty of detail
 * for inspection / work-slip evidence without keeping native sensor
 * resolution. JPEG quality of 0.82 is the sweet spot where artifacts
 * are imperceptible on photos but file size drops 3-5x.
 */
export async function compressImage(
  file: File,
  maxLongEdge = 1600,
  quality = 0.82
): Promise<File> {
  if (file.type === 'image/heic' || file.type === 'image/heif') return file;
  if (file.size < 500_000) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  if (!bitmap) return file;

  const { width: w, height: h } = bitmap;
  const longEdge = Math.max(w, h);
  if (longEdge <= maxLongEdge) {
    bitmap.close?.();
    return file;
  }

  const scale = maxLongEdge / longEdge;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, newW, newH);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  if (!blob) return file;

  // Don't ship something larger than the original. Some already-optimized
  // JPEGs balloon when re-encoded at this quality on small dimensions.
  if (blob.size >= file.size) return file;

  const baseName = file.name.replace(/\.[^/.]+$/, '') || 'photo';
  return new File([blob], `${baseName}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}
