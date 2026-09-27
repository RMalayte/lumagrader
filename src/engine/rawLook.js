// "Luma Color" base look for RAW photos.
//
// The RAW develop (rawDevelop.js) matches the camera's own JPEG in brightness and overall
// colourfulness. Lightroom's default RAW rendering is more colourful in reds/oranges, blues
// and magentas, pulls oranges/yellows toward red and renders blues a little brighter. This
// look closes that gap. It was fitted to a zero-settings comparison against Lightroom's
// default profile (same Canon RAW), in Oklab (perceptual):
//   per hue: hue shift (deg), chroma gain, lightness shift — smooth periodic splines over 12
//   knots (15°, 45°, … 345° Oklab hue) — faded out for near-neutral pixels, plus a gentle
//   global lightness curve. Fitted on one photo from one camera: a first calibration.
//
// Applied once per develop (preview and full-size export alike) through a 33³ RGB LUT.

//                 15°     45°     75°    105°   135°   165°  195°  225°   255°   285°   315°   345°
const HUE_SHIFT = [-5.1, -8.7, -19.0, -3.4, 2.8, 0, 0, 7.8, 4.2, -6.7, 3.0, 9.8]
const CHROMA_GAIN = [1.56, 1.53, 1.1, 0.98, 1.0, 1.05, 1.05, 1.36, 1.4, 1.5, 1.46, 1.48]
const L_SHIFT = [0.018, 0.013, -0.006, -0.015, -0.007, 0.004, 0.004, 0.037, 0.039, 0.031, 0.035, 0.039]
// Global Oklab lightness curve (ours → Lightroom): a touch darker in the upper mid-tones.
const L_X = [0, 0.4, 0.633, 0.78, 0.82, 1]
const L_Y = [0, 0.395, 0.616, 0.773, 0.815, 1]

const LUT_N = 33

const dec = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

function toOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Periodic Catmull-Rom over the 12 knots at 15° + 30°·i. */
function periodic(v, hue) {
  const t = ((((hue - 15) % 360) + 360) % 360) / 30
  const i = Math.floor(t), f = t - i
  const p0 = v[(i + 11) % 12], p1 = v[i % 12], p2 = v[(i + 1) % 12], p3 = v[(i + 2) % 12]
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
}

function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1])
  return ys[ys.length - 1]
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** The look on one sRGB-encoded colour (0..1) → sRGB-encoded (0..1), kept inside the gamut. */
export function lumaColorLook(r, g, b) {
  const [L, A, B] = toOklab(dec(r), dec(g), dec(b))
  const C = Math.hypot(A, B)
  const hue = (Math.atan2(B, A) * 180) / Math.PI
  const w = smoothstep(0.01, 0.045, C) // neutrals stay neutral
  const L2 = Math.min(1, Math.max(0, interp(L, L_X, L_Y) + w * periodic(L_SHIFT, hue)))
  const h2 = ((hue + w * periodic(HUE_SHIFT, hue)) * Math.PI) / 180
  let C2 = C * (1 + w * (periodic(CHROMA_GAIN, hue) - 1))
  // Gamut: shrink chroma (never lightness/hue) until the colour fits sRGB.
  let rgb = fromOklab(L2, C2 * Math.cos(h2), C2 * Math.sin(h2))
  if (rgb.some((v) => v < 0 || v > 1)) {
    let lo = 0, hi = C2
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2
      const t = fromOklab(L2, mid * Math.cos(h2), mid * Math.sin(h2))
      if (t.some((v) => v < -1e-4 || v > 1 + 1e-4)) hi = mid
      else lo = mid
    }
    C2 = lo
    rgb = fromOklab(L2, C2 * Math.cos(h2), C2 * Math.sin(h2))
  }
  return rgb.map((v) => enc(Math.min(1, Math.max(0, v))))
}

let lut = null
function getLUT() {
  if (lut) return lut
  lut = new Float32Array(LUT_N * LUT_N * LUT_N * 3)
  let o = 0
  for (let bi = 0; bi < LUT_N; bi++) for (let gi = 0; gi < LUT_N; gi++) for (let ri = 0; ri < LUT_N; ri++) {
    const [r, g, b] = lumaColorLook(ri / (LUT_N - 1), gi / (LUT_N - 1), bi / (LUT_N - 1))
    lut[o++] = r * 255; lut[o++] = g * 255; lut[o++] = b * 255
  }
  return lut
}

/** Applies the look in place to 8-bit RGBA pixels (trilinear 33³ LUT). */
export function applyLumaColorLook(rgba) {
  const L = getLUT()
  const N = LUT_N, N2 = N * N, S = (N - 1) / 255
  for (let i = 0; i < rgba.length; i += 4) {
    const fr = rgba[i] * S, fg = rgba[i + 1] * S, fb = rgba[i + 2] * S
    const r0 = Math.min(N - 2, fr | 0), g0 = Math.min(N - 2, fg | 0), b0 = Math.min(N - 2, fb | 0)
    const dr = fr - r0, dg = fg - g0, db = fb - b0
    const base = (b0 * N2 + g0 * N + r0) * 3
    for (let c = 0; c < 3; c++) {
      const p = base + c
      const c00 = L[p] + (L[p + 3] - L[p]) * dr
      const c10 = L[p + N * 3] + (L[p + N * 3 + 3] - L[p + N * 3]) * dr
      const c01 = L[p + N2 * 3] + (L[p + N2 * 3 + 3] - L[p + N2 * 3]) * dr
      const c11 = L[p + N2 * 3 + N * 3] + (L[p + N2 * 3 + N * 3 + 3] - L[p + N2 * 3 + N * 3]) * dr
      const c0 = c00 + (c10 - c00) * dg
      const c1 = c01 + (c11 - c01) * dg
      rgba[i + c] = c0 + (c1 - c0) * db
    }
  }
}
