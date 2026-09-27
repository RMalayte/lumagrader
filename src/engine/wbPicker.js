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
 * Renders the photo "as shot" once (see neutralSourceSettings) and keeps its pixels, so the
 * draggable picker can sample many points cheaply. Returns { data, width, height }.
 */
export function renderNeutral(preview, settings) {
  const out = document.createElement('canvas')
  renderToCanvas(out, preview, neutralSourceSettings(settings), {})
  const { width, height } = out
  const data = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data
  out.width = out.height = 0 // free the scratch canvas now
  return { data, width, height }
}

/**
 * Average colour (linear sRGB, 0–1) of a small square (~0.8 % of the long side, to average
 * out noise) around a point given as 0–1 of the displayed (cropped) photo.
 * Returns { rgb, clipped, tooDark }.
 */
export function sampleAt({ data, width: w, height: h }, relX, relY) {
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.004))
  const cx = Math.round(Math.min(1, Math.max(0, relX)) * (w - 1))
  const cy = Math.round(Math.min(1, Math.max(0, relY)) * (h - 1))
  let R = 0, G = 0, B = 0, hot = 0, n = 0
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const i = (y * w + x) * 4
      R += DEC[data[i]]; G += DEC[data[i + 1]]; B += DEC[data[i + 2]]
      if (Math.max(data[i], data[i + 1], data[i + 2]) >= 252) hot++
      n++
    }
  }
  const rgb = [R / n, G / n, B / n]
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  return { rgb, clipped: hot > n * 0.3, tooDark: luma < 0.004 }
}

const DEC = Float32Array.from({ length: 256 }, (_, i) => dec(i / 255))
