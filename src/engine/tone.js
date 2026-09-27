// Tone (Lightroom-style Exposure / Contrast / Highlights / Shadows / Whites / Blacks)
//
//  1. Pixels are converted to LINEAR light; everything below works in stops (EV = log2 light).
//  2. Exposure: a gain in stops (±5), like Lightroom.
//  3. Highlights / Shadows (LOCAL): gains in stops chosen from the pixel's edge-aware
//     local brightness ("base", see localBase.js) — not from the pixel alone — so regions get
//     brighter/darker while local contrast and small bright/dark details survive.
//  4. Whites / Blacks (global): gains in stops near the white / black ends (set the end points).
//  5. Contrast: an S-curve in perceptual (sRGB-encoded) space pivoting on middle gray,
//     anchored at black and white — never clips the ends.
// Multiplying light never lifts pure black. With every slider at 0 nothing changes.
//
// The math is sampled into two small tables per settings change, used identically by the
// WebGL shader and the Canvas 2D fallback:
//   LOCAL table:  base EV → gain EV (Highlights + Shadows)
//   GLOBAL table: EV after local step → (output light ÷ 2^EV)   (Whites, Blacks, Contrast)

export const LOG_MIN = -14 // EV range covered by the tables (0 EV = white)
export const LOG_MAX = 6
export const LOCAL_LUT_SIZE = 512
export const GLOBAL_LUT_SIZE = 1024
const MID_GRAY_P = 0.46 // sRGB-encoded 18% gray

// Zones: gain = stops at ±100; weight = logistic over EV (center, width).
// Local zones are applied to the smooth local base, global ones to the pixel.
// Calibrated against a Lightroom comparison: Lightroom's Highlights
// and Shadows are "bell-shaped" — they move the upper-mids / lower-mids but leave the very
// brightest whites and deepest blacks nearly alone (those belong to Whites / Blacks):
//   - `floor` (dark zones): fades the effect out toward pure black.
//   - `ceil` (bright zones): fades it out toward white, but `ceil.overWhite` brings it back
//     above white so over-exposed areas can still be recovered.
// Fitted to a side-by-side (same photo, Contrast +30 / Highlights −60 / Shadows +40 in
// Lightroom vs LumaGrader), matching tone percentiles + fine-detail energy, under a hard
// constraint that the curve stays monotonic at every slider value even where base = pixel.
// One photo only — re-check with more comparisons.
export const LOCAL_ZONES = {
  shadows: { gain: 1.26, center: -3.49, width: 0.77, dark: true, floor: { center: -4.68, width: 0.36 } },
  highlights: { gain: 0.44, center: -1.83, width: 0.66, dark: false, ceil: { center: -0.22, width: 0.1, depth: 0.85, overWhite: 0.15 } },
}
export const GLOBAL_ZONES = {
  blacks: { gain: 1.5, center: -5.5, width: 0.8, dark: true },
  whites: { gain: 0.8, center: -0.3, width: 0.6, dark: false },
}
export const TONE_PARAMS = { contrastK: 6 } // S-curve steepness at ±100 (mutable for calibration)
const CONTRAST_K = TONE_PARAMS.contrastK

export const srgbDecode = (p) => (p <= 0.04045 ? p / 12.92 : Math.pow((p + 0.055) / 1.055, 2.4))
export const srgbEncode = (y) => (y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055)
const sigmoid = (x) => 1 / (1 + Math.exp(-x))

function zoneGain(v, s, zones) {
  let g = 0
  for (const [key, z] of Object.entries(zones)) {
    const amount = (s[key] || 0) / 100
    if (!amount) continue
    let w = sigmoid((v - z.center) / z.width)
    if (z.dark) {
      w = 1 - w
      if (z.floor) w *= sigmoid((v - z.floor.center) / z.floor.width)
    } else if (z.ceil) {
      const fall = sigmoid((v - z.ceil.center) / z.ceil.width)
      const back = sigmoid((v - z.ceil.overWhite) / 0.2)
      w *= 1 - z.ceil.depth * fall * (1 - back)
    }
    g += amount * z.gain * w
  }
  return g
}

// Normalised logistic S-curve through (0,0) and (1,1), pivoting at middle gray.
const S0 = sigmoid(-CONTRAST_K * MID_GRAY_P)
const S1 = sigmoid(CONTRAST_K * (1 - MID_GRAY_P))
const sCurve = (p) => (sigmoid(CONTRAST_K * (p - MID_GRAY_P)) - S0) / (S1 - S0)
const sCurveInv = (y) => {
  const t = Math.min(1 - 1e-9, Math.max(1e-9, y * (S1 - S0) + S0))
  return MID_GRAY_P + Math.log(t / (1 - t)) / CONTRAST_K
}
const S_SLOPE_AT_1 = (CONTRAST_K * S1 * (1 - S1)) / (S1 - S0)

function applyContrast(p, c) {
  if (!c) return p
  const a = Math.abs(c)
  if (p >= 1) {
    const slope = c > 0 ? S_SLOPE_AT_1 : 1 / S_SLOPE_AT_1
    return 1 + (p - 1) * (1 + a * (slope - 1))
  }
  const target = c > 0 ? sCurve(Math.max(0, p)) : sCurveInv(Math.max(0, p))
  return p + a * (target - p)
}

/** Local (Highlights + Shadows) gain in stops for a local base brightness (EV, incl. exposure). */
export function localGainEV(baseEV, s) {
  return zoneGain(baseEV, s, LOCAL_ZONES)
}

/** Output light for a pixel at `v` EV (after exposure + local gain): Whites, Blacks, Contrast. */
export function globalToneY(v, s, profileContrast = 0) {
  const y1 = Math.pow(2, v + zoneGain(v, s, GLOBAL_ZONES))
  const contrast = Math.max(-1, Math.min(1, ((s.contrast || 0) + profileContrast) / 100))
  const p = applyContrast(srgbEncode(y1), contrast)
  return p <= 0 ? 0 : srgbDecode(p)
}

/** Reference tone mapping of one pixel: y = linear luminance, baseLog2 = local base (log2, pre-exposure). */
export function toneMapPixel(y, baseLog2, s, profileContrast = 0) {
  if (y <= 0) return 0
  const ev = s.exposure || 0
  const v = Math.log2(y) + ev + localGainEV(baseLog2 + ev, s)
  return globalToneY(v, s, profileContrast)
}

export function isToneActive(s, profileContrast = 0) {
  return !!(s.exposure || s.contrast || profileContrast || s.highlights || s.shadows || s.whites || s.blacks)
}
export const isLocalToneActive = (s) => !!(s.highlights || s.shadows)

const lutEV = (i, n) => LOG_MIN + (i / (n - 1)) * (LOG_MAX - LOG_MIN)

export function buildLocalLUT(s) {
  const lut = new Float32Array(LOCAL_LUT_SIZE)
  for (let i = 0; i < LOCAL_LUT_SIZE; i++) lut[i] = localGainEV(lutEV(i, LOCAL_LUT_SIZE), s)
  return lut
}

/** GLOBAL table: value = output light ÷ 2^v (≈1 near identity, keeps half-float precision). */
export function buildGlobalLUT(s, profileContrast = 0) {
  const lut = new Float32Array(GLOBAL_LUT_SIZE)
  for (let i = 0; i < GLOBAL_LUT_SIZE; i++) {
    const v = lutEV(i, GLOBAL_LUT_SIZE)
    lut[i] = globalToneY(v, s, profileContrast) / Math.pow(2, v)
  }
  return lut
}

/** Linear interpolation into a LUT over [LOG_MIN, LOG_MAX] (clamped at the ends). */
export function sampleLUT(lut, v) {
  const n = lut.length
  const x = Math.min(n - 1, Math.max(0, ((v - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (n - 1)))
  const i = Math.min(n - 2, Math.floor(x))
  return lut[i] + (lut[i + 1] - lut[i]) * (x - i)
}

/** Linear luminance (Rec.709 / sRGB primaries). */
export const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Scales linear RGB by `ratio`, fitting into gamut by desaturating toward luminance (keeps hue). */
export function applyRatioLinear(r, g, b, ratio) {
  let R = r * ratio, G = g * ratio, B = b * ratio
  const m = Math.max(R, G, B)
  if (m > 1) {
    const Y = luminance(R, G, B)
    if (Y >= 1) return [1, 1, 1]
    const t = (1 - Y) / (m - Y)
    R = Y + (R - Y) * t
    G = Y + (G - Y) * t
    B = Y + (B - Y) * t
  }
  return [Math.max(0, R), Math.max(0, G), Math.max(0, B)]
}
