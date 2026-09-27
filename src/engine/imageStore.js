// Memory-aware image handling. Keeping every photo fully decoded (24 MP ≈ 96 MB of pixels)
// crashes a phone tab after a couple dozen photos, so each photo only keeps:
//   - sourceBlob: the file itself (JPEG/PNG) or the upright RAW preview JPEG. File-backed
//                 blobs cost almost nothing until decoded.
//   - thumbUrl:   a ~160px JPEG for the filmstrip.
//   - width/height of the source.
// Sources are decoded with createImageBitmap(blob) — NOT <img src=blob:…>. Loading through an
// <img> makes Chrome keep each file's encoded bytes in memory for as long as the URL lives.
// Decoded pixels live in small LRU caches: 1600px previews for the few most recent photos,
// and at most ONE full-size image (for 1:1 zoom and export).

export const PREVIEW_MAX = 1600
export const DRAG_MAX = 720 // lower-res proxy rendered while a slider is being dragged
const THUMB_MAX = 160
const PREVIEW_CACHE = 3
const FULL_CACHE = 1

/** Pixel size of the 1600px preview for a source of width × height. */
export function previewSizeFor(width, height, max = PREVIEW_MAX) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = url
  })
}

/**
 * Decodes a blob to an ImageBitmap (EXIF orientation applied, off the main thread in most
 * browsers). Falls back to an <img> where createImageBitmap or its options aren't supported.
 */
export async function decodeBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch {
      // older engines: fall through to <img>
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const closeSource = (src) => src?.close?.()

function scaledCanvas(source, max) {
  const sw = source.naturalWidth ?? source.width
  const sh = source.naturalHeight ?? source.height
  const { w, h } = previewSizeFor(sw, sh, max)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

function canvasToUrl(canvas, quality = 0.82) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : canvas.toDataURL('image/jpeg', quality)), 'image/jpeg', quality))
}

// ---- LRU helpers ----------------------------------------------------------------------
function lruGet(map, key) {
  if (!map.has(key)) return undefined
  const v = map.get(key)
  map.delete(key)
  map.set(key, v)
  return v
}
function lruSet(map, key, value, limit) {
  map.delete(key)
  map.set(key, value)
  while (map.size > limit) map.delete(map.keys().next().value)
}

const previews = new Map() // id → Promise<canvas>
const resolvedPreviews = new Map() // id → canvas (sync access for the current render)
const drags = new Map() // id → canvas
const fulls = new Map() // id → Promise<HTMLImageElement>

/**
 * Decodes a photo once to build its lightweight state record { sourceBlob, thumbUrl, width,
 * height } and seeds the preview cache (so the first photo shows instantly after import).
 */
export async function makeImageEntry(sourceBlob, id, decoded = null) {
  const src = decoded || (await decodeBlob(sourceBlob)) // `decoded` skips a re-decode (RAW path)
  try {
    const preview = scaledCanvas(src, PREVIEW_MAX)
    const thumbUrl = await canvasToUrl(scaledCanvas(preview, THUMB_MAX))
    lruSet(previews, id, Promise.resolve(preview), PREVIEW_CACHE)
    lruSet(resolvedPreviews, id, preview, PREVIEW_CACHE)
    return { sourceBlob, thumbUrl, width: src.naturalWidth ?? src.width, height: src.naturalHeight ?? src.height }
  } finally {
    closeSource(src)
  }
}

/** 1600px preview canvas for an image (decoded on demand, cached for recent photos). */
export function getPreview(image) {
  let p = lruGet(previews, image.id)
  if (!p) {
    p = decodeBlob(image.sourceBlob).then((src) => {
      const canvas = scaledCanvas(src, PREVIEW_MAX)
      closeSource(src)
      lruSet(resolvedPreviews, image.id, canvas, PREVIEW_CACHE)
      return canvas
    })
    p.catch(() => previews.delete(image.id))
    lruSet(previews, image.id, p, PREVIEW_CACHE)
  }
  return p
}

/** The preview if it's already decoded, else null (no loading). */
export function peekPreview(id) {
  return resolvedPreviews.get(id) || null
}

/** Low-res proxy of the preview, used while dragging sliders for smoother feedback. */
export function getDragProxy(id) {
  const preview = peekPreview(id)
  if (!preview) return null
  let proxy = drags.get(id)
  if (!proxy || proxy.source !== preview) {
    proxy = scaledCanvas(preview, DRAG_MAX)
    proxy.source = preview
    lruSet(drags, id, proxy, 2)
  }
  return proxy
}

/**
 * Full-size decoded image (only one kept at a time — they're huge). Evicted bitmaps are left
 * to garbage collection rather than close()d, since a render may still be using one.
 */
export function getFullImage(image, maxDim = Infinity) {
  const key = Number.isFinite(maxDim) ? `${image.id}@${maxDim}` : image.id
  let p = lruGet(fulls, key)
  if (!p) {
    p = loadFull(image, maxDim)
    p.catch(() => fulls.delete(key))
    lruSet(fulls, key, p, FULL_CACHE)
  }
  return p
}

/**
 * Full-size pixels, optionally capped to `maxDim` on the long side (phones: GPU texture and
 * memory limits). A capped RAW uses the half-size develop instead of a full LibRaw decode.
 */
async function loadFull(image, maxDim) {
  const capped = Number.isFinite(maxDim) && Math.max(image.width, image.height) > maxDim
  if (image.rawDevelop && !capped) return decodeFullRaw(image)
  const src = toUprightCanvas(await decodeBlob(image.sourceBlob))
  const sw = src.width, sh = src.height
  if (!Number.isFinite(maxDim) || Math.max(sw, sh) <= maxDim) {
    if (capped) src.reducedSize = true // e.g. a RAW shown from its half-size develop
    return src
  }
  const out = scaledCanvas(src, maxDim)
  src.width = src.height = 0 // free the large copy right away
  out.reducedSize = true
  return out
}

/**
 * WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap sources (WebGL spec §5.14.8), so a
 * full-size bitmap was uploaded upside down → zoomed-in view and JPEG export came out
 * flipped. Canvases honour the flag, so full-size images are kept as a canvas. Same memory:
 * the bitmap is closed right after the copy.
 */
export function toUprightCanvas(src) {
  if (typeof globalThis.ImageBitmap === 'undefined' || !(src instanceof globalThis.ImageBitmap)) return src
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  canvas.getContext('2d').drawImage(src, 0, 0)
  src.close()
  return canvas
}

/** Drops cached pixels for images (e.g. when a whole project is closed). */
export function releaseImages(images, { revokeUrls = false } = {}) {
  for (const im of images) {
    previews.delete(im.id)
    resolvedPreviews.delete(im.id)
    drags.delete(im.id)
    for (const k of [...fulls.keys()]) if (k === im.id || k.startsWith(`${im.id}@`)) fulls.delete(k)
    if (revokeUrls && im.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(im.thumbUrl)
  }
}

/**
 * Full-size RAW: decode the sensor data again at full resolution and develop it with the
 * photo's stored params (identical look to the preview). If that fails (e.g. not enough
 * memory on a phone), fall back to the half-size developed image and flag it.
 */
async function decodeFullRaw(image) {
  try {
    const { decodeAndDevelopRaw } = await import('./rawPipeline')
    const { imageData } = await decodeAndDevelopRaw(image.originalBlob, { half: false, params: image.rawDevelop })
    // A canvas, not createImageBitmap(imageData): Chrome uploads ImageData-made bitmaps to
    // WebGL without honouring UNPACK_FLIP_Y, which exported RAWs upside down.
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    canvas.getContext('2d').putImageData(imageData, 0, 0)
    return canvas
  } catch (err) {
    console.warn('Full-size RAW decode failed; using the half-size develop.', err)
    const fallback = toUprightCanvas(await decodeBlob(image.sourceBlob))
    fallback.reducedSize = true
    return fallback
  }
}
