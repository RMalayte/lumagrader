// Point tone curves (Lightroom "Point Curve"): a composite RGB curve plus separate
// Red / Green / Blue channel curves. Points live in 0–255 (same scale as LR's XMP
// ToneCurvePV2012*), and are joined by a smooth cubic spline — not straight lines.

/** Settings key for each curve channel. `curvePoints` stays the RGB key (backward compatible). */
export const CURVE_CHANNELS = [
  { id: 'rgb', key: 'curvePoints', label: 'RGB', name: 'RGB (all channels)', color: null }, // drawn in text colour, like LR,
  { id: 'r', key: 'curvePointsR', label: 'R', name: 'Red', color: '#ff5a5a' },
  { id: 'g', key: 'curvePointsG', label: 'G', name: 'Green', color: '#4cd26b' },
  { id: 'b', key: 'curvePointsB', label: 'B', name: 'Blue', color: '#4f8dff' },
]
export const CURVE_KEYS = CURVE_CHANNELS.map((c) => c.key)

// Identity curve: output == input (no effect until points are moved).
export function defaultCurvePoints() {
  return [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]
}

export function isIdentityCurve(points) {
  if (!points || points.length < 2) return true
  const pts = normalize(points)
  // Collinear points on the diagonal spanning the full range → spline is exactly y = x.
  return pts[0].x === 0 && pts[pts.length - 1].x === 255 && pts.every((p) => p.x === p.y)
}

/** Sorted copy with duplicate x removed (first wins). */
function normalize(points) {
  const sorted = [...(points || defaultCurvePoints())].sort((a, b) => a.x - b.x)
  return sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1].x)
}

/**
 * Tangents for a C2 cubic spline through the points, modeled on the spline solver Adobe
 * uses for Camera Raw / Lightroom point curves: start from weighted secant slopes, then
 * solve the tridiagonal system for continuous curvature. Result: an LR-like smooth
 * curve through every point (it can overshoot slightly between tight points — like LR).
 */
function splineSlopes(X, Y) {
  const n = X.length
  const S = new Float64Array(n)
  let A = X[1] - X[0]
  let B = (Y[1] - Y[0]) / A
  S[0] = B
  for (let j = 2; j < n; j++) {
    const C = X[j] - X[j - 1]
    const D = (Y[j] - Y[j - 1]) / C
    S[j - 1] = (B * C + D * A) / (A + C)
    A = C
    B = D
  }
  S[n - 1] = 2 * B - S[n - 2]
  S[0] = 2 * S[0] - S[1]
  if (n > 2) {
    const E = new Float64Array(n)
    const F = new Float64Array(n)
    const G = new Float64Array(n)
    F[0] = 0.5
    E[n - 1] = 0.5
    G[0] = 0.75 * (S[0] + S[1])
    G[n - 1] = 0.75 * (S[n - 2] + S[n - 1])
    for (let j = 1; j < n - 1; j++) {
      const span = (X[j + 1] - X[j - 1]) * 2
      E[j] = (X[j + 1] - X[j]) / span
      F[j] = (X[j] - X[j - 1]) / span
      G[j] = 1.5 * S[j]
    }
    for (let j = 1; j < n; j++) {
      const piv = 1 - F[j - 1] * E[j]
      if (j !== n - 1) F[j] /= piv
      G[j] = (G[j] - G[j - 1] * E[j]) / piv
    }
    for (let j = n - 2; j >= 0; j--) G[j] -= F[j] * G[j + 1]
    for (let j = 0; j < n; j++) S[j] = G[j]
  }
  return S
}

/**
 * Compiles points into an evaluator f(x) → y (both 0–255, continuous, clamped to 0–255).
 * Outside the first/last point the curve is flat (holds the end value), like LR.
 */
export function makeCurve(points) {
  const pts = normalize(points)
  if (pts.length < 2) return (x) => x
  const X = pts.map((p) => p.x)
  const Y = pts.map((p) => p.y)
  const S = splineSlopes(X, Y)
  const last = X.length - 1
  return (x) => {
    if (x <= X[0]) return Y[0]
    if (x >= X[last]) return Y[last]
    let j = 0
    while (j < last - 1 && x > X[j + 1]) j++
    const h = X[j + 1] - X[j]
    const t = (x - X[j]) / h
    const t2 = t * t
    const t3 = t2 * t
    // Cubic Hermite basis.
    const y =
      (2 * t3 - 3 * t2 + 1) * Y[j] +
      (t3 - 2 * t2 + t) * h * S[j] +
      (-2 * t3 + 3 * t2) * Y[j + 1] +
      (t3 - t2) * h * S[j + 1]
    return Math.min(255, Math.max(0, y))
  }
}

/** Single-curve 256-entry LUT (kept for callers that only need one channel). */
export function buildCurvePointsLUT(points) {
  const f = makeCurve(points)
  const lut = new Uint8ClampedArray(256)
  for (let x = 0; x < 256; x++) lut[x] = Math.round(f(x))
  return lut
}

/** True when any of the four point curves changes the image. */
export function hasActiveCurves(s) {
  return CURVE_KEYS.some((k) => s && !isIdentityCurve(s[k]))
}

/**
 * Combined RGB + channel curves → per-channel 256-entry LUTs. Like LR, the RGB curve is
 * applied first and the channel curve on its result: out_r = R(RGB(r)). Composition is
 * done on the continuous splines, so there is only one rounding step.
 * Returns null when every curve is identity.
 */
export function buildRgbCurveLUTs(s) {
  if (!hasActiveCurves(s)) return null
  const master = makeCurve(s.curvePoints)
  const channels = [s.curvePointsR, s.curvePointsG, s.curvePointsB].map((p) => (isIdentityCurve(p) ? null : makeCurve(p)))
  const r = new Uint8ClampedArray(256)
  const g = new Uint8ClampedArray(256)
  const b = new Uint8ClampedArray(256)
  const rgba = new Uint8Array(256 * 4)
  const outs = [r, g, b]
  for (let x = 0; x < 256; x++) {
    const m = master(x)
    for (let c = 0; c < 3; c++) {
      const v = Math.round(channels[c] ? channels[c](m) : m)
      outs[c][x] = v
      rgba[x * 4 + c] = v
    }
    rgba[x * 4 + 3] = 255
  }
  return { r, g, b, rgba }
}
