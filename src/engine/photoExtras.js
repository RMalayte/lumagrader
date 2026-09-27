// Per-photo data that lives outside `settings` but must be saved with projects and crash
// recovery: snapshots (named versions of the settings) and brush-mask pixels.
import { getBrushCanvas, setBrushImage } from './brushMaskStore'

const blobCache = new WeakMap() // brush canvas → { version, blob }

function canvasToPng(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function brushMaskIds(im) {
  const ids = new Set()
  const collect = (settings) => (settings?.masks || []).forEach((m) => m.type === 'brush' && ids.add(m.id))
  collect(im.settings)
  ;(im.snapshots || []).forEach((snap) => collect(snap.settings))
  return [...ids]
}

/** Serializable extras of an image record: { snapshots, brushes: { maskId: Blob } }. */
export async function packExtras(im) {
  const brushes = {}
  for (const id of brushMaskIds(im)) {
    const canvas = getBrushCanvas(id)
    if (!canvas) continue
    const version = canvas._version || 0
    let entry = blobCache.get(canvas)
    if (!entry || entry.version !== version) {
      entry = { version, blob: await canvasToPng(canvas) }
      blobCache.set(canvas, entry)
    }
    if (entry.blob) brushes[id] = entry.blob
  }
  return { snapshots: im.snapshots || [], brushes }
}

/** Restores brush pixels from saved extras; returns the fields to put on the image record. */
export async function unpackExtras(data) {
  const brushes = data?.brushes || {}
  for (const [id, blob] of Object.entries(brushes)) {
    try {
      const bitmap = await createImageBitmap(blob)
      setBrushImage(id, bitmap)
      bitmap.close?.()
    } catch (err) {
      console.warn('Could not restore a brush mask', err)
    }
  }
  return { snapshots: Array.isArray(data?.snapshots) ? data.snapshots : [] }
}
