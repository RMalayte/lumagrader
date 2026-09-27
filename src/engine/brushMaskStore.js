// Runtime-only store for brush mask pixel data, keyed by mask id. Deliberately kept OUTSIDE
// React state / settings: canvases aren't JSON-serializable, and our undo history clones
// settings via JSON.stringify. This means brush strokes are NOT tracked by the main
// undo/redo system (a known V1 limitation) — masks.js's `brushVersion` counter is the
// serializable "something changed" signal that drives re-renders instead.
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
    store.set(maskId, canvas)
  }
  return canvas
}

export function clearBrushCanvas(maskId) {
  const canvas = store.get(maskId)
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
}

export function deleteBrushCanvas(maskId) {
  store.delete(maskId)
}
