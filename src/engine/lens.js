// Manual lens corrections (Lightroom's Optics → Manual): Distortion, lens Vignetting and
// Remove Chromatic Aberration. Applied to the source photo BEFORE crop/rotate and every
// other adjustment, on the CPU, so preview, 1:1 and export use the same code.
//
// Distortion: radial model  src = c + (p − c) · s · (1 + k·(s·ρ)²)  with ρ = distance from the
// centre ÷ half-diagonal. + (like Lightroom) straightens barrel distortion, − pincushion.
// The scale `s` is chosen so the corrected photo always fills the frame (no empty corners).
// Vignetting: + brightens the corners (in linear light), Midpoint sets how far in it reaches.
// Chromatic aberration: lateral CA (red/blue fringes that grow toward the corners) is a
// slightly different magnification per colour; it is measured from the photo's edges and
// undone by rescaling red and blue to line up with green.
import { srgbDecode, srgbEncode } from './tone'

const K_PER_DISTORTION = 0.3 // k at Distortion ±100
const VIGNETTE_EV = 1.2 // corner brightening at Vignetting +100 (stops)

export const LENS_DEFAULTS = { lensDistortion: 0, lensVignette: 0, lensVignetteMidpoint: 50, removeCA: false }

export function isLensActive(s) {
  return !!s && (!!s.lensDistortion || !!s.lensVignette || !!s.removeCA)
}

export const lensKey = (s) => [s.lensDistortion || 0, s.lensVignette || 0, s.lensVignetteMidpoint ?? 50, s.removeCA ? 1 : 0].join('|')

/** Scale that makes the distorted sampling grid fill the frame exactly (bisection). */
export function fillScale(k, w, h) {
  if (!k) return 1
  const rn = Math.hypot(w, h) / 2
  const inside = (s) => {
    // Check points along the four edges (the extreme samples always lie on the border).
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      for (const [px, py] of [[t * w, 0], [t * w, h], [0, t * h], [w, t * h]]) {
        const dx = px - w / 2, dy = py - h / 2
        const rho2 = (dx * dx + dy * dy) / (rn * rn)
        const m = s * (1 + k * s * s * rho2)
        if (Math.abs(dx * m) > w / 2 + 1e-6 || Math.abs(dy * m) > h / 2 + 1e-6) return false
      }
    }
    return true
  }
  let lo = 0.3, hi = 3
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (inside(mid)) lo = mid
    else hi = mid
  }
  return lo
}

function sampler(data, w, h) {
  // Bilinear sample of channel ch at pixel-space (x, y) (pixel centres at +0.5), clamped.
  return (x, y, ch) => {
    let fx = x - 0.5, fy = y - 0.5
    if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1
    if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1
    const x0 = fx | 0, y0 = fy | 0
    const x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0
    const ax = fx - x0, ay = fy - y0
    const i00 = (y0 * w + x0) * 4 + ch, i10 = (y0 * w + x1) * 4 + ch
    const i01 = (y1 * w + x0) * 4 + ch, i11 = (y1 * w + x1) * 4 + ch
    const top = data[i00] + (data[i10] - data[i00]) * ax
    const bot = data[i01] + (data[i11] - data[i01]) * ax
    return top + (bot - top) * ay
  }
}

const CA_RANGE = 0.0016 // ± relative magnification searched (≈ ±2.9 px at the corner of a 6000 px photo)
const CA_STEP = 0.0001
const CA_MAX_DIM = 2000
const caCache = new WeakMap()

/**
 * Measures lateral chromatic aberration: the magnification of red and of blue relative to
 * green (1 + t) that best lines the colour edges up. Returns { r, b } (t values).
 */
export function estimateCA(source) {
  const cached = caCache.get(source)
  if (cached) return cached
  const w0 = source.naturalWidth ?? source.width, h0 = source.naturalHeight ?? source.height
  const sc = Math.min(1, CA_MAX_DIM / Math.max(w0, h0))
  const w = Math.max(8, Math.round(w0 * sc)), h = Math.max(8, Math.round(h0 * sc))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const sample = sampler(data, w, h)
  const cx = w / 2, cy = h / 2, rn = Math.hypot(w, h) / 2

  // Edge points away from the centre (CA is ~0 in the middle): strongest green gradients.
  const pts = []
  for (let y = 2; y < h - 2; y += 1) {
    for (let x = 2; x < w - 2; x += 1) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      const rho = Math.hypot(dx, dy) / rn
      if (rho < 0.35) continue
      const i = (y * w + x) * 4 + 1
      const gx = data[i + 4] - data[i - 4], gy = data[i + w * 4] - data[i - w * 4]
      // Only the radial part of the gradient reveals a radial misalignment.
      const radial = Math.abs((gx * dx + gy * dy) / (Math.hypot(dx, dy) || 1))
      if (radial > 40) pts.push(x + 0.5, y + 0.5, radial)
    }
  }
  const result = { r: 0, b: 0 }
  if (pts.length / 3 < 200) {
    caCache.set(source, result)
    return result
  }
  // Cap the work: keep an evenly spread subset.
  const stride = Math.max(1, Math.floor(pts.length / 3 / 40000))
  const cost = (ch, t) => {
    // Residual of the best linear fit channel ≈ a·green + b at the edge points.
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
    for (let j = 0; j < pts.length; j += 3 * stride) {
      const x = pts[j], y = pts[j + 1], wgt = pts[j + 2]
      const g = sample(x, y, 1)
      const v = sample(cx + (x - cx) * (1 + t), cy + (y - cy) * (1 + t), ch)
      n += wgt; sx += wgt * g; sy += wgt * v; sxx += wgt * g * g; sxy += wgt * g * v; syy += wgt * v * v
    }
    const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n, cxy = sxy - (sx * sy) / n
    return vy - (cxy * cxy) / Math.max(vx, 1e-9)
  }
  for (const [ch, key] of [[0, 'r'], [2, 'b']]) {
    const steps = Math.round(CA_RANGE / CA_STEP)
    const costs = []
    for (let i = -steps; i <= steps; i++) costs.push(cost(ch, i * CA_STEP))
    let best = 0
    for (let i = 1; i < costs.length; i++) if (costs[i] < costs[best]) best = i
    let t = (best - steps) * CA_STEP
    // Parabolic refinement between neighbours.
    if (best > 0 && best < costs.length - 1) {
      const a = costs[best - 1], b = costs[best], d = costs[best + 1]
      const den = a - 2 * b + d
      if (den > 0) t += (0.5 * (a - d) / den) * CA_STEP
    }
    // No clear minimum (flat cost) → leave it alone.
    const flat = costs[best] > 0.995 * costs[steps]
    result[key] = flat ? 0 : t
  }
  caCache.set(source, result)
  return result
}

const DECODE = Float32Array.from({ length: 257 }, (_, i) => srgbDecode(Math.min(255, i) / 255))
const ENCODE = Float32Array.from({ length: 4097 }, (_, i) => srgbEncode(i / 4096) * 255)
const lin = (v) => {
  const i = v | 0
  return DECODE[i] + (DECODE[i + 1] - DECODE[i]) * (v - i)
}
const enc = (y) => ENCODE[y >= 1 ? 4096 : y <= 0 ? 0 : Math.round(y * 4096)]

/** Returns a new canvas with the lens corrections of `s` applied to `source`. */
export function applyLens(source, s) {
  const w = source.naturalWidth ?? source.width, h = source.naturalHeight ?? source.height
  const inCanvas = document.createElement('canvas')
  inCanvas.width = w
  inCanvas.height = h
  const ictx = inCanvas.getContext('2d', { willReadFrequently: true })
  ictx.drawImage(source, 0, 0)
  const src = ictx.getImageData(0, 0, w, h).data
  const out = new ImageData(w, h)
  const d = out.data
  const sample = sampler(src, w, h)

  const k = -((s.lensDistortion || 0) / 100) * K_PER_DISTORTION
  const scale = fillScale(k, w, h)
  const ca = s.removeCA ? estimateCA(source) : { r: 0, b: 0 }
  // Red/blue are magnified by (1 + t) relative to green: sampling them at (1 + t) lines them up.
  const mr = 1 + ca.r, mb = 1 + ca.b
  const vig = (s.lensVignette || 0) / 100
  const m0 = 0.05 + 0.75 * ((s.lensVignetteMidpoint ?? 50) / 100)
  const cx = w / 2, cy = h / 2, rn2 = (w * w + h * h) / 4

  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - cy
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx
      const rho2 = (dx * dx + dy * dy) / rn2
      const m = k ? scale * (1 + k * scale * scale * rho2) : 1
      const gx = cx + dx * m, gy = cy + dy * m
      let r = sample(cx + dx * m * mr, cy + dy * m * mr, 0)
      let g = sample(gx, gy, 1)
      let b = sample(cx + dx * m * mb, cy + dy * m * mb, 2)
      if (vig) {
        const rho = Math.sqrt(rho2) * m
        let f = (rho - m0) / (1 - m0)
        f = f <= 0 ? 0 : f >= 1 ? 1 : f
        const gain = Math.pow(2, vig * VIGNETTE_EV * f * f)
        r = enc(lin(r) * gain)
        g = enc(lin(g) * gain)
        b = enc(lin(b) * gain)
      }
      const o = (y * w + x) * 4
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255
    }
  }
  const outCanvas = document.createElement('canvas')
  outCanvas.width = w
  outCanvas.height = h
  outCanvas.getContext('2d').putImageData(out, 0, 0)
  return outCanvas
}
