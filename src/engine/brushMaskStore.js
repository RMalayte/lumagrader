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

/** Copies one mask's painted pixels to another mask id (Duplicate mask). */
export function copyBrushCanvas(fromId, toId) {
  const src = store.get(fromId)
  if (!src) return
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  canvas.getContext('2d').drawImage(src, 0, 0)
  canvas._version = 1 // a new mask: saved with the project on the next autosave
  store.set(toId, canvas)
}

// ---- Mask-level feather for brush masks ---------------------------------------------------
// Softens the edges of everything already painted, adjustable any time (unlike the brush's
// own Feather, which only shapes new strokes). Feather 0–100 → blur up to 8 % of the shorter
// side. Done on a small copy (fast, and a big blur needs no detail), then scaled back up.
const feathered = new WeakMap() // brush canvas → { key, canvas }

function boxBlurAlpha(a, w, h, r) {
  const tmp = new Float32Array(w * h)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n
      acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      a[y * w + x] = acc / n
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
}

/** The brush pixels to render for `mask`: as painted, or softened by `mask.feather`. */
export function brushMaskSource(mask) {
  const canvas = store.get(mask.id)
  if (!canvas) return null
  const feather = Math.min(100, Math.max(0, mask.feather || 0))
  if (feather <= 0) return canvas
  const key = `${canvas._version || 0}|${feather}|${canvas.width}x${canvas.height}`
  const hit = feathered.get(canvas)
  if (hit && hit.key === key) return hit.canvas

  const { width: w, height: h } = canvas
  const radius = (feather / 100) * 0.08 * Math.min(w, h) // px at brush resolution
  const k = Math.max(1, radius / 4) // work at ≤ 1/k size: the blur stays ≥ 4 px there
  const sw = Math.max(2, Math.round(w / k)), sh = Math.max(2, Math.round(h / k))
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d', { willReadFrequently: true })
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(canvas, 0, 0, sw, sh)
  const img = sctx.getImageData(0, 0, sw, sh)
  const a = new Float32Array(sw * sh)
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3]
  // Three box blurs ≈ a Gaussian with σ ≈ radius / 2.
  const r = Math.max(1, Math.round(radius / k / 1.7))
  for (let pass = 0; pass < 3; pass++) boxBlurAlpha(a, sw, sh, r)
  for (let i = 0; i < a.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = a[i]
  }
  sctx.putImageData(img, 0, 0)
  const out = hit?.canvas || document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')
  octx.clearRect(0, 0, w, h)
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(small, 0, 0, w, h)
  feathered.set(canvas, { key, canvas: out })
  return out
}
