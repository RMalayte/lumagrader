import { linearToOklab } from './color'
import { srgbDecode } from './tone'

// Unique across sessions: masks from a reopened project must never collide with new ones
// (brush pixels are stored per mask id).
let maskCounter = 0
const newMaskId = () => `mask_${Date.now().toString(36)}_${(maskCounter++).toString(36)}`

const noAdjustments = () => ({ exposure: 0, contrast: 0, saturation: 0, temp: 0, sharpen: 0, denoise: 0 })

export function createLinearMask(x1, y1, x2, y2) {
  return { id: newMaskId(), type: 'linear', enabled: true, invert: false, feather: 100, linear: { x1, y1, x2, y2 }, adjustments: noAdjustments() }
}

// Ellipse: rx/ry are relative to the shorter image edge. (`r` alone = older circular masks.)
export function createRadialMask(cx, cy, r) {
  return { id: newMaskId(), type: 'radial', enabled: true, invert: false, feather: 50, radial: { cx, cy, rx: r, ry: r }, adjustments: noAdjustments() }
}

// Brush masks paint an arbitrary shape. The painted pixels live in brushMaskStore (keyed by
// mask id), NOT in settings — canvases aren't JSON-serializable and settings are cloned for
// undo/redo. `brushVersion` increments on every stroke, which triggers the re-render.
export function createBrushMask() {
  return { id: newMaskId(), type: 'brush', enabled: true, invert: false, brushVersion: 0, adjustments: noAdjustments() }
}

// Range masks select by brightness or colour over the whole photo. Any other mask can also
// get a `range` to narrow it down (e.g. a radial mask that only touches the sky's blues).
export const defaultLuminanceRange = () => ({ type: 'luminance', min: 60, max: 100, smooth: 30 })
export const defaultColorRange = (color = null) => ({ type: 'color', color, amount: 40 })

export function createLuminanceMask() {
  return { id: newMaskId(), type: 'luminance', enabled: true, invert: false, range: defaultLuminanceRange(), adjustments: noAdjustments() }
}

export function createColorMask() {
  return { id: newMaskId(), type: 'color', enabled: true, invert: false, range: defaultColorRange(), adjustments: noAdjustments() }
}

/** Copy of a mask with a new id (brush pixels are copied by the caller — see duplicateBrush). */
export function duplicateMask(mask) {
  return { ...JSON.parse(JSON.stringify(mask)), id: newMaskId() }
}

export const MASK_LABELS = { linear: 'Linear', radial: 'Radial', brush: 'Brush', luminance: 'Luminance', color: 'Color' }

/** sRGB colour (0–255) → Oklab, the space the color range compares in. */
export function colorRangeSample(r, g, b) {
  return linearToOklab(srgbDecode(r / 255), srgbDecode(g / 255), srgbDecode(b / 255))
}

/** Shader parameters for a mask's range (see MASK_FRAG_SRC rangeWeight). */
export function rangeUniforms(range) {
  if (range?.type === 'luminance') {
    const lo = Math.min(range.min, range.max), hi = Math.max(range.min, range.max)
    return { type: 1, params: [lo / 100, hi / 100, (range.smooth ?? 30) / 100, 0], color: [0, 0, 0] }
  }
  if (range?.type === 'color' && range.color) {
    const tol = 0.03 + ((range.amount ?? 40) / 100) * 0.17
    return { type: 2, params: [tol, 0.6, 0, 0], color: range.color }
  }
  // A color mask whose colour hasn't been picked yet selects nothing.
  if (range?.type === 'color') return { type: 3, params: [0, 0, 0, 0], color: [0, 0, 0] }
  return { type: 0, params: [0, 0, 0, 0], color: [0, 0, 0] }
}
