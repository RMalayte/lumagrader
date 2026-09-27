// White balance eyedropper: samples the photo with no white balance or colour edits applied
// (only lens/spot/crop, which move pixels around), so the pick is independent of the
// current Temp/Tint and of any look that tints greys (split tones, curves, HSL…).

import { defaultSettings } from './defaults'
import { renderToCanvas } from './pipeline'

const dec = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

/** Settings that render the photo "as shot": geometry and optics kept, everything else neutral. */
export function neutralSourceSettings(s) {
  return {
    ...defaultSettings(),
    geometry: s.geometry,
    spots: s.spots || [],
    lensDistortion: s.lensDistortion || 0,
    lensVignette: s.lensVignette || 0,
    lensVignetteMidpoint: s.lensVignetteMidpoint ?? 50,
    removeCA: !!s.removeCA,
  }
}

/**
 * Average colour (linear sRGB, 0–1) around a point given as 0–1 of the displayed (cropped)
 * photo. The sample is a small square (~0.8 % of the long side) to average out noise.
 * Returns { rgb, clipped, tooDark }.
 */
export function sampleNeutral(preview, settings, relX, relY) {
  const out = document.createElement('canvas')
  renderToCanvas(out, preview, neutralSourceSettings(settings), {})
  const w = out.width, h = out.height
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.004))
  const cx = Math.round(Math.min(1, Math.max(0, relX)) * (w - 1))
  const cy = Math.round(Math.min(1, Math.max(0, relY)) * (h - 1))
  const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r)
  const x1 = Math.min(w, cx + r + 1), y1 = Math.min(h, cy + r + 1)
  const d = out.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0).data
  out.width = out.height = 0 // free the scratch canvas now
  let R = 0, G = 0, B = 0, hot = 0
  const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) {
    R += dec(d[i] / 255); G += dec(d[i + 1] / 255); B += dec(d[i + 2] / 255)
    if (Math.max(d[i], d[i + 1], d[i + 2]) >= 252) hot++
  }
  const rgb = [R / n, G / n, B / n]
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  return { rgb, clipped: hot > n * 0.3, tooDark: luma < 0.004 }
}
