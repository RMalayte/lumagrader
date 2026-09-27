import { buildCurveLUT } from './curve'
import { buildRgbCurveLUTs } from './curvePoints'
import { isToneActive, isLocalToneActive, buildLocalLUT, buildGlobalLUT, sampleLUT, applyRatioLinear, luminance, srgbDecode, srgbEncode } from './tone'
import { getLocalBaseMap, sampleLocalBase } from './localBase'
import { applyGeometry, isGeometryDefault } from './geometry'
import { HSL_BANDS, BAND_HUE, rgbToHsl, hslToRgb } from './hsl'
import { getProfileBias } from './colorProfiles'
import { renderTonalWebGL } from './webgl/renderer'

// Downscaled copy of an image, used for interactive editing so slider drags stay smooth
// even on large source photos. Full-resolution `img` is still used for export.
export function makePreviewSource(img, maxSize = 1600) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight
  const scale = Math.min(1, maxSize / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return canvas
}

// Draws `source` (an HTMLImageElement or HTMLCanvasElement) onto `canvas` with the full
// adjustment/tone/curve/LUT/HSL+vibrance/grade/vignette/grain pipeline applied.
// All per-pixel passes (curve, tone zones, custom curve points, 3D LUT, HSL+vibrance,
// grain) are combined into a single getImageData/putImageData cycle for performance.
export function renderImage(canvas, source, s, luts = {}) {
  // Safety net: an ImageBitmap would upload to WebGL upside down (UNPACK_FLIP_Y is ignored
  // for bitmaps). Callers should pass canvases; this converts (slowly) if one slips through.
  if (typeof globalThis.ImageBitmap !== 'undefined' && source instanceof globalThis.ImageBitmap) {
    console.warn('renderImage got an ImageBitmap; converting to canvas')
    const c = document.createElement('canvas')
    c.width = source.width
    c.height = source.height
    c.getContext('2d').drawImage(source, 0, 0)
    source = c
  }
  const src = s.geometry && !isGeometryDefault(s.geometry) ? applyGeometry(source, s.geometry) : source
  try {
    renderTonalWebGL(canvas, src, s, luts)
    return
  } catch (err) {
    console.warn('WebGL render failed, falling back to Canvas 2D:', err)
  }
  renderTonalCanvas2D(canvas, src, s, luts)
}

// One shared off-screen WebGL canvas for every "render and read back" job (histogram,
// preset thumbnails, before/after, export). Browsers allow only ~16 live WebGL contexts and
// silently kill the OLDEST one when exceeded — which was the main preview. Creating a new
// canvas per render (as the histogram did on every slider move) exhausted that limit.
let scratchCanvas = null

/** Renders into the shared scratch canvas, then copies into `target` (a plain 2D canvas). */
export function renderToCanvas(target, source, s, luts = {}) {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas')
  renderImage(scratchCanvas, source, s, luts)
  target.width = scratchCanvas.width
  target.height = scratchCanvas.height
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.drawImage(scratchCanvas, 0, 0)
  return target
}

// sRGB byte → linear, and linear → sRGB byte, for the 2D fallback's tone step.
const DECODE_LUT = Float32Array.from({ length: 256 }, (_, i) => srgbDecode(i / 255))
const ENCODE_LUT = Uint8ClampedArray.from({ length: 4096 }, (_, i) => Math.round(srgbEncode(i / 4095) * 255))
const encode255 = (y) => ENCODE_LUT[Math.min(4095, Math.max(0, Math.round(y * 4095)))]

// Canvas 2D reference implementation — kept as an automatic fallback for browsers/devices
// without WebGL2 support, or if the shader ever fails to compile.
function renderTonalCanvas2D(canvas, src, s, luts = {}) {
  const w = src.naturalWidth ?? src.width
  const h = src.naturalHeight ?? src.height
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  const profile = getProfileBias(s.colorProfile)
  const saturate = Math.max(0, 1 + (s.saturation + (profile.saturation || 0)) / 100)
  const profileContrast = profile.contrast || 0
  // Same tone table as the WebGL path (tone.js), so both renderers match.
  const toneOn = isToneActive(s, profileContrast)
  const localLut = toneOn && isLocalToneActive(s) ? buildLocalLUT(s) : null
  const globalLut = toneOn ? buildGlobalLUT(s, profileContrast) : null
  const baseMap = localLut ? getLocalBaseMap(src) : null
  const ev = s.exposure || 0
  const satOn = saturate !== 1
  ctx.drawImage(src, 0, 0)

  const curveLut = s.curve ? buildCurveLUT(s.curve) : null
  const curvePointsLut = buildRgbCurveLUTs(s) // RGB + R/G/B point curves, or null
  const cubeLut = s.lut && luts[s.lut] ? luts[s.lut] : null
  const hslActive = (s.hsl && Object.values(s.hsl).some((v) => v.h || v.s || v.l)) || Object.keys(profile.hsl || {}).length > 0
  const vibranceActive = !!s.vibrance
  const needsColorPass = hslActive || vibranceActive
  const grainAmt = s.grain > 0 ? s.grain / 2.2 : 0
  const needsPixelPass = toneOn || satOn || curveLut || curvePointsLut || cubeLut || needsColorPass || grainAmt

  if (needsPixelPass) {
    const id = ctx.getImageData(0, 0, w, h)
    const d = id.data
    const n = cubeLut ? cubeLut.size - 1 : 0
    const mix = cubeLut ? s.lutStrength / 100 : 0

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2]

      if (toneOn) {
        const lr = DECODE_LUT[r], lg = DECODE_LUT[g], lb = DECODE_LUT[b]
        const Y0 = luminance(lr, lg, lb)
        const v0 = Math.log2(Math.max(Y0, 1e-6))
        let v1 = v0 + ev
        if (localLut) {
          const px = (i >> 2) % w, py = ((i >> 2) / w) | 0
          const [A, B] = sampleLocalBase(baseMap, (px + 0.5) / w, (py + 0.5) / h)
          v1 += sampleLUT(localLut, A * v0 + B + ev)
        }
        const Yf = Math.pow(2, v1) * sampleLUT(globalLut, v1)
        const [nr, ng, nb] = applyRatioLinear(lr, lg, lb, Yf / Math.max(Y0, 1e-6))
        r = encode255(nr); g = encode255(ng); b = encode255(nb)
      }
      if (satOn) {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = Math.min(255, Math.max(0, luma + (r - luma) * saturate))
        g = Math.min(255, Math.max(0, luma + (g - luma) * saturate))
        b = Math.min(255, Math.max(0, luma + (b - luma) * saturate))
      }

      // LUT lookups need integer indices (Saturation above leaves fractional values).
      if (curveLut) { r = curveLut[Math.round(r)]; g = curveLut[Math.round(g)]; b = curveLut[Math.round(b)] }
      if (curvePointsLut) { r = curvePointsLut.r[Math.round(r)]; g = curvePointsLut.g[Math.round(g)]; b = curvePointsLut.b[Math.round(b)] }

      if (cubeLut) {
        const ri = Math.round((r / 255) * n), gi = Math.round((g / 255) * n), bi = Math.round((b / 255) * n)
        const idx = (ri + cubeLut.size * gi + cubeLut.size * cubeLut.size * bi) * 3
        r = r + (cubeLut.data[idx] * 255 - r) * mix
        g = g + (cubeLut.data[idx + 1] * 255 - g) * mix
        b = b + (cubeLut.data[idx + 2] * 255 - b) * mix
      }

      if (needsColorPass) {
        let [h2, sat, l] = rgbToHsl(r, g, b)
        if (hslActive) {
          let dh = 0, ds = 0, dl = 0
          for (const band of HSL_BANDS) {
            const center = BAND_HUE[band]
            let dist = Math.abs(h2 - center); if (dist > 180) dist = 360 - dist
            const bw = Math.max(0, 1 - dist / 40)
            if (bw <= 0) continue
            const bd = s.hsl[band]
            const bias = (profile.hsl && profile.hsl[band]) || {}
            dh += (bd.h + (bias.h || 0)) * bw * 0.4
            ds += ((bd.s + (bias.s || 0)) * bw) / 120
            dl += ((bd.l + (bias.l || 0)) * bw) / 200
          }
          h2 = (h2 + dh + 360) % 360
          sat = Math.min(1, Math.max(0, sat + ds))
          l = Math.min(1, Math.max(0, l + dl))
        }
        if (vibranceActive) {
          sat = Math.min(1, Math.max(0, sat + (s.vibrance / 100) * (1 - sat) * 0.8))
        }
        const [nr, ng, nb] = hslToRgb(h2, sat, l)
        r = nr; g = ng; b = nb
      }

      if (grainAmt) {
        const noise = (Math.random() - 0.5) * grainAmt
        r += noise; g += noise; b += noise
      }

      d[i] = r; d[i + 1] = g; d[i + 2] = b
    }
    ctx.putImageData(id, 0, 0)
  }

  const effTemp = (s.temp || 0) + (profile.temp || 0)
  if (effTemp !== 0 || s.tint !== 0) {
    ctx.globalCompositeOperation = 'overlay'
    const r = effTemp > 0 ? effTemp * 1.4 : 0, b = effTemp < 0 ? -effTemp * 1.4 : 0
    const g = s.tint > 0 ? s.tint * 1.2 : 0, m = s.tint < 0 ? -s.tint * 1.2 : 0
    ctx.fillStyle = `rgba(${128 + r - b},${128 + g - m},${128 + b - r + (m ? -m * 0.3 : 0)},0.35)`
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
  }

  if (s.colorGrade && s.colorGrade.intensity > 0) {
    ctx.globalCompositeOperation = 'color'
    ctx.globalAlpha = s.colorGrade.intensity / 100
    ctx.fillStyle = s.colorGrade.hex
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  if (s.vignette > 0) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${s.vignette / 140})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }
}
