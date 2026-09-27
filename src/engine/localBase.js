// Edge-aware "local brightness" for Lightroom-style Highlights / Shadows.
//
// Lightroom's Highlights/Shadows are LOCAL: they react to how bright a pixel's SURROUNDINGS
// are, not just the pixel. A bright wall gets darker, but small bright details inside it stay
// bright and its texture survives. A purely per-pixel curve squashes the ends of the range
// and flattens local contrast.
//
// We use a self-guided filter (He et al.) on log2 luminance, computed on a small ≤256px copy
// of the photo. It smooths inside regions but keeps strong edges, so there are no halos. The
// output is two coefficients per low-res pixel (A, B); at full resolution the local base is
//     base = A·log2(Y) + B      (bilinearly-upsampled A, B — "fast guided filter")
// which stays edge-aware at any resolution, so preview, 1:1 and export all match.

export const GF_MAX = 256 // low-res working size (longest side)
// radiusFrac: box radius as a fraction of the longest side; eps: edge threshold in EV²
// (edges stronger than ~√eps stops are preserved). Exported so calibration can tune them.
export const GF_PARAMS = { radiusFrac: 0.057, eps: 0.163 } // fitted together with the tone zones (tone.js)
const LOG_FLOOR = -14

function boxBlur(src, w, h, r) {
  // Separable running-sum box filter with edge clamping.
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/**
 * Guided-filter coefficients from a log2-luminance image (Float32Array, w×h).
 * Returns Float32Array of interleaved (A, B) pairs.
 */
export function guidedCoefficients(logY, w, h) {
  const r = Math.max(1, Math.round(Math.max(w, h) * GF_PARAMS.radiusFrac))
  const sq = new Float32Array(w * h)
  for (let i = 0; i < sq.length; i++) sq[i] = logY[i] * logY[i]
  const mean = boxBlur(logY, w, h, r)
  const meanSq = boxBlur(sq, w, h, r)
  const a = new Float32Array(w * h)
  const b = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) {
    const v = Math.max(0, meanSq[i] - mean[i] * mean[i])
    a[i] = v / (v + GF_PARAMS.eps)
    b[i] = mean[i] - a[i] * mean[i]
  }
  const A = boxBlur(a, w, h, r)
  const B = boxBlur(b, w, h, r)
  const out = new Float32Array(w * h * 2)
  for (let i = 0; i < A.length; i++) {
    out[i * 2] = A[i]
    out[i * 2 + 1] = B[i]
  }
  return out
}

const srgbDecode = (p) => (p <= 0.04045 ? p / 12.92 : Math.pow((p + 0.055) / 1.055, 2.4))
const DECODE = Float32Array.from({ length: 256 }, (_, i) => srgbDecode(i / 255))

/** log2 luminance of RGBA sRGB bytes. */
export function logLuminance(rgba, w, h) {
  const out = new Float32Array(w * h)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const Y = 0.2126 * DECODE[rgba[i]] + 0.7152 * DECODE[rgba[i + 1]] + 0.0722 * DECODE[rgba[i + 2]]
    out[j] = Math.max(LOG_FLOOR, Math.log2(Math.max(Y, 1e-6)))
  }
  return out
}

const cache = new WeakMap()

/**
 * Coefficient map for a source image/canvas: { width, height, data } (data = A,B pairs).
 * Cached per source object — it depends only on the photo's pixels, never on the sliders.
 */
export function getLocalBaseMap(source) {
  let map = cache.get(source)
  if (map) return map
  const sw = source.naturalWidth ?? source.width
  const sh = source.naturalHeight ?? source.height
  const scale = Math.min(1, GF_MAX / Math.max(sw, sh))
  const w = Math.max(2, Math.round(sw * scale))
  const h = Math.max(2, Math.round(sh * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  const rgba = ctx.getImageData(0, 0, w, h).data
  map = { width: w, height: h, data: guidedCoefficients(logLuminance(rgba, w, h), w, h) }
  cache.set(source, map)
  return map
}

/** Bilinear sample of (A, B) at normalised image coordinates (u → right, t → down). */
export function sampleLocalBase(map, u, t) {
  const { width: w, height: h, data } = map
  const x = Math.min(w - 1, Math.max(0, u * w - 0.5))
  const y = Math.min(h - 1, Math.max(0, t * h - 0.5))
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const i00 = (y0 * w + x0) * 2, i10 = (y0 * w + x1) * 2, i01 = (y1 * w + x0) * 2, i11 = (y1 * w + x1) * 2
  const lerp = (k) =>
    (data[i00 + k] * (1 - fx) + data[i10 + k] * fx) * (1 - fy) + (data[i01 + k] * (1 - fx) + data[i11 + k] * fx) * fy
  return [lerp(0), lerp(1)]
}
