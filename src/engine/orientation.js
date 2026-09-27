// EXIF/TIFF Orientation (tag 0x0112) handling.
//
// Browsers already apply the orientation of normal JPEGs. RAW files are different: the
// camera writes "portrait" into the RAW's own TIFF header (or CR3's CMT1 box), while the
// embedded preview JPEG we extract usually has no orientation tag at all — so a portrait
// shot showed up landscape. These helpers read the tag and rotate the preview ourselves.

const ORIENTATION_TAG = 0x0112
const MAX_SCAN = 4 * 1024 * 1024 // metadata lives near the start of every supported format

/** Reads Orientation (1–8) from a TIFF structure starting at `start`, or null. */
export function readTiffOrientation(bytes, start = 0) {
  if (start + 8 > bytes.length) return null
  const bo = String.fromCharCode(bytes[start], bytes[start + 1])
  if (bo !== 'II' && bo !== 'MM') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = bo === 'II'
  // Bytes 2–3 are the magic (42 for TIFF, but ORF/RW2 use their own) — only IFD0 matters.
  const ifd0 = start + view.getUint32(start + 4, le)
  if (ifd0 + 2 > bytes.length) return null
  const count = view.getUint16(ifd0, le)
  if (count > 1000) return null // not a real IFD
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12
    if (entry + 12 > bytes.length) return null
    if (view.getUint16(entry, le) === ORIENTATION_TAG) {
      const value = view.getUint16(entry + 8, le)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

function indexOfAscii(bytes, text, from = 0, to = bytes.length) {
  const codes = Array.from(text, (ch) => ch.charCodeAt(0))
  const end = Math.min(to, bytes.length) - codes.length
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer
    return i
  }
  return -1
}

/** Orientation from a JPEG's APP1 Exif segment, or null if it has none. */
export function readJpegOrientation(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 < bytes.length && offset < MAX_SCAN) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (marker === 0xe1 && indexOfAscii(bytes, 'Exif\0\0', offset + 4, offset + 10) === offset + 4) {
      return readTiffOrientation(bytes, offset + 10)
    }
    if (marker === 0xda) return null // start of image data — no Exif before it
    offset += 2 + size
  }
  return null
}

/** Orientation stored in a RAW file's own metadata, or null. */
export function readRawOrientation(bytes, fileName = '') {
  if (/\.cr3$/i.test(fileName) || indexOfAscii(bytes, 'ftypcrx', 0, 64) !== -1) {
    // CR3 (ISO-BMFF): IFD0 lives in the CMT1 box; its payload is a TIFF header.
    const at = indexOfAscii(bytes, 'CMT1', 0, MAX_SCAN)
    return at === -1 ? null : readTiffOrientation(bytes, at + 4)
  }
  if (indexOfAscii(bytes, 'FUJIFILMCCD-RAW', 0, 16) === 0) return null // RAF preview JPEG carries its own Exif
  return readTiffOrientation(bytes, 0)
}

/**
 * Returns a new JPEG blob with `orientation` applied to `bitmap` (1 = returns null: nothing to do).
 */
export async function orientToBlob(bitmap, orientation) {
  if (!orientation || orientation === 1) return null
  const w = bitmap.naturalWidth ?? bitmap.width
  const h = bitmap.naturalHeight ?? bitmap.height
  const swap = orientation >= 5
  const canvas = document.createElement('canvas')
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h
  const ctx = canvas.getContext('2d')
  // Standard EXIF orientation transforms (maps stored pixels to upright display).
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break
    case 7: ctx.transform(0, -1, -1, 0, h, w); break
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break
    default: break
  }
  ctx.drawImage(bitmap, 0, 0)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.97))
}
