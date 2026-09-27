let maskCounter = 1

export function createLinearMask(x1, y1, x2, y2) {
  return {
    id: 'mask_' + maskCounter++,
    type: 'linear',
    enabled: true,
    invert: false,
    feather: 100,
    linear: { x1, y1, x2, y2 },
    adjustments: { exposure: 0, contrast: 0, saturation: 0, temp: 0, sharpen: 0, denoise: 0 },
  }
}

// V1.1: independent rx/ry gives a true ellipse. `r` is kept only so masks created before
// this change keep working — new masks always get rx/ry.
export function createRadialMask(cx, cy, r) {
  return {
    id: 'mask_' + maskCounter++,
    type: 'radial',
    enabled: true,
    invert: false,
    feather: 100,
    radial: { cx, cy, rx: r, ry: r },
    adjustments: { exposure: 0, contrast: 0, saturation: 0, temp: 0, sharpen: 0, denoise: 0 },
  }
}

// Brush masks paint an arbitrary shape rather than a formula. The actual painted pixels
// live in brushMaskStore (a runtime Map keyed by mask id), NOT in this settings object —
// canvases aren't JSON-serializable, and settings gets cloned for undo/redo history. This
// object just carries the mask's identity/type/adjustments; `brushVersion` is a plain
// number that increments on every stroke, which is what actually triggers a re-render
// through the normal settings-changed path.
export function createBrushMask() {
  return {
    id: 'mask_' + maskCounter++,
    type: 'brush',
    enabled: true,
    invert: false,
    brushVersion: 0,
    adjustments: { exposure: 0, contrast: 0, saturation: 0, temp: 0, sharpen: 0, denoise: 0 },
  }
}
