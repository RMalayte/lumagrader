import exifr from 'exifr'
import { orientToBlob } from './orientation'
import { decodeBlob } from './imageStore'

// RAW support: we use the camera's own embedded preview JPEG — NOT a true RAW decode (no
// demosaicing or recovery from the sensor data). Quality/resolution vary by camera.
// Loaded lazily (dynamic import) the first time a RAW file is imported or reopened.

export { isRawFile } from './rawFormats'

let worker = null
let seq = 0
const pending = new Map()

function getWorker() {
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('../workers/rawWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const done = pending.get(e.data.id)
      if (done) {
        pending.delete(e.data.id)
        done(e.data)
      }
    }
    worker.onerror = (e) => {
      console.warn('RAW worker failed; falling back to the main thread.', e)
      worker = false
      pending.forEach((done) => done({ ok: false, orientation: 1, workerFailed: true }))
      pending.clear()
    }
  } catch (err) {
    console.warn('RAW worker unavailable; using the main thread.', err)
    worker = false
  }
  return worker
}

async function extractOnMainThread(bytes, name) {
  const [{ extractThumbnail }, { readRawOrientation, readJpegOrientation }] = await Promise.all([
    import('extract-raw-preview'),
    import('./orientation'),
  ])
  const orientation = readRawOrientation(bytes, name) || 1
  const result = await extractThumbnail(bytes, { prefer: 'largest' })
  if (!result.found || !result.decodable) return { ok: false, orientation }
  const data = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data)
  return { ok: true, data, mimeType: result.mimeType, orientation: readJpegOrientation(data) !== null ? 1 : orientation }
}

async function extractPreview(file) {
  const buffer = await file.arrayBuffer()
  const w = getWorker()
  if (w) {
    const id = ++seq
    const result = await new Promise((resolve) => {
      pending.set(id, resolve)
      w.postMessage({ id, buffer, name: file.name || '' }, [buffer])
    })
    if (!result.workerFailed) return result
    return extractOnMainThread(new Uint8Array(await file.arrayBuffer()), file.name || '')
  }
  return extractOnMainThread(new Uint8Array(buffer), file.name || '')
}

/**
 * Returns the RAW file's embedded preview as an upright JPEG Blob (orientation applied), or
 * null if the file has no usable preview.
 */
export async function loadRawPreview(file) {
  let blob = null
  let orientation = 1
  try {
    const result = await extractPreview(file)
    orientation = result.orientation || 1
    if (result.ok) blob = new Blob([result.data], { type: result.mimeType })
    else console.warn(`No usable embedded preview in ${file.name}:`, result.reason)
  } catch (err) {
    console.warn('RAW preview extraction failed:', err)
  }
  if (!blob) {
    try {
      const thumb = await exifr.thumbnail(file) // last resort: small EXIF thumbnail
      if (thumb) blob = new Blob([thumb], { type: 'image/jpeg' })
    } catch {
      blob = null
    }
  }
  if (!blob || orientation === 1) return blob
  const bitmap = await decodeBlob(blob)
  try {
    return (await orientToBlob(bitmap, orientation)) || blob
  } finally {
    bitmap.close?.()
  }
}
