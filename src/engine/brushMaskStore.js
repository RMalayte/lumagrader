// Runtime store for brush mask pixel data, keyed by mask id. Kept OUTSIDE React state /
// settings: canvases aren't JSON-serializable, and undo history clones settings via JSON.
// Consequence: brush strokes themselves are not undoable; masks.js's `brushVersion` counter
// is the serializable "something changed" signal that drives re-renders. Projects and crash
// recovery save the pixels separately (photoExtras.js). `_version` on a canvas counts edits so
// unchanged brushes aren't re-encoded on every autosave.
const store = new Map()

export function getBrushCanvas(maskId) {
  return store.get(maskId) || null
}

export function ensureBrushCanvas(maskId, width, height) {
  let canvas = store.get(maskId)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas._version = 0
    store.set(maskId, canvas)
  }
  return canvas
}

/** Marks a brush canvas as changed (after painting). */
export function touchBrushCanvas(maskId) {
  const canvas = store.get(maskId)
  if (canvas) canvas._version = (canvas._version || 0) + 1
}

/** Replaces a mask's pixels with a saved image (project load / crash recovery). */
export function setBrushImage(maskId, image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d').drawImage(image, 0, 0)
  canvas._version = 0
  store.set(maskId, canvas)
}

export function clearBrushCanvas(maskId) {
  const canvas = store.get(maskId)
  if (canvas) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    canvas._version = (canvas._version || 0) + 1
  }
}

export function deleteBrushCanvas(maskId) {
  store.delete(maskId)
}
