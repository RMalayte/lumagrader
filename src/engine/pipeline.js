import { buildCurveLUT } from './curve'
import { buildRgbCurveLUTs } from './curvePoints'
import { isToneActive, isLocalToneActive, buildLocalLUT, buildGlobalLUT, sampleLUT, applyRatioLinear, luminance, srgbDecode, srgbEncode } from './tone'
import { getLocalBaseMap, sampleLocalBase } from './localBase'
import { applyGeometry, isGeometryDefault } from './geometry'
import { HSL_BANDS } from './hsl'
import { wbMatrixFor, satVibFactor, scaleChroma, hueSat, withHue, hslBandWeights, neutralFade, lumaOf, HSL_HUE_DEG, HSL_LUM_EV } from './color'
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
  const sat = Math.max(-1, (s.saturation + (profile.saturation || 0)) / 100)
  const vib = (s.vibrance || 0) / 100
  const satOn = sat !== 0 || vib !== 0
  const profileContrast = profile.contrast || 0
  // Same tone table as the WebGL path (tone.js), so both renderers match.
  const toneOn = isToneActive(s, profileContrast)
  const localLut = toneOn && isLocalToneActive(s) ? buildLocalLUT(s) : null
  const globalLut = toneOn ? buildGlobalLUT(s, profileContrast) : null
  const baseMap = localLut ? getLocalBaseMap(src) : null
  const ev = s.exposure || 0
  const wb = wbMatrixFor(s, profile.temp || 0)
  const linearOn = toneOn || !!wb
  const dehaze = (s.dehaze || 0) / 100
  ctx.drawImage(src, 0, 0)

  const curveLut = s.curve ? buildCurveLUT(s.curve) : null
  const curvePointsLut = buildRgbCurveLUTs(s) // RGB + R/G/B point curves, or null
  const cubeLut = s.lut && luts[s.lut] ? luts[s.lut] : null
  // HSL per band (user + profile bias), in the band order of color.js / the shader.
  const hslH = [], hslS = [], hslL = []
  HSL_BANDS.forEach((band) => {
    const b = (s.hsl && s.hsl[band]) || { h: 0, s: 0, l: 0 }
    const bias = (profile.hsl && profile.hsl[band]) || {}
    hslH.push(b.h + (bias.h || 0)); hslS.push(b.s + (bias.s || 0)); hslL.push(b.l + (bias.l || 0))
  })
  const hslActive = [...hslH, ...hslS, ...hslL].some((v) => v)
  const grainAmt = s.grain > 0 ? s.grain / 2.2 : 0
  const needsPixelPass = linearOn || satOn || dehaze || curveLut || curvePointsLut || cubeLut || hslActive || grainAmt

  if (needsPixelPass) {
    const id = ctx.getImageData(0, 0, w, h)
    const d = id.data
    const n = cubeLut ? cubeLut.size - 1 : 0
    const mix = cubeLut ? s.lutStrength / 100 : 0
    const idx255 = (v) => Math.min(255, Math.max(0, Math.round(v * 255)))

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255

      if (linearOn) {
        let lr = DECODE_LUT[d[i]], lg = DECODE_LUT[d[i + 1]], lb = DECODE_LUT[d[i + 2]]
        if (wb) {
          const R = wb[0] * lr + wb[1] * lg + wb[2] * lb
          const G = wb[3] * lr + wb[4] * lg + wb[5] * lb
          const B = wb[6] * lr + wb[7] * lg + wb[8] * lb
          lr = Math.max(0, R); lg = Math.max(0, G); lb = Math.max(0, B)
        }
        let ratio = 1
        if (toneOn) {
          const Y0 = luminance(lr, lg, lb)
          const v0 = Math.log2(Math.max(Y0, 1e-6))
          let v1 = v0 + ev
          if (localLut) {
            const px = (i >> 2) % w, py = ((i >> 2) / w) | 0
            const [A, B] = sampleLocalBase(baseMap, (px + 0.5) / w, (py + 0.5) / h)
            v1 += sampleLUT(localLut, A * v0 + B + ev)
          }
          ratio = (Math.pow(2, v1) * sampleLUT(globalLut, v1)) / Math.max(Y0, 1e-6)
        }
        const [nr, ng, nb] = applyRatioLinear(lr, lg, lb, ratio) // includes the gamut fit
        r = encode255(nr) / 255; g = encode255(ng) / 255; b = encode255(nb) / 255
      }
      if (satOn) [r, g, b] = scaleChroma(r, g, b, satVibFactor(r, g, b, sat, vib))

      if (dehaze > 0) {
        r = (r - 0.5) * (1 + dehaze * 0.6) + 0.5; g = (g - 0.5) * (1 + dehaze * 0.6) + 0.5; b = (b - 0.5) * (1 + dehaze * 0.6) + 0.5
        r = Math.min(1, Math.max(0, r)); g = Math.min(1, Math.max(0, g)); b = Math.min(1, Math.max(0, b))
        const L = lumaOf(r, g, b), k = 1 + dehaze * 0.3
        r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k
      } else if (dehaze < 0) {
        const a = -dehaze, L = lumaOf(r, g, b)
        r += (L - r) * a * 0.3; g += (L - g) * a * 0.3; b += (L - b) * a * 0.3
        r += (0.8 - r) * a * 0.45; g += (0.8 - g) * a * 0.45; b += (0.8 - b) * a * 0.45
      }

      // LUT lookups need integer indices.
      if (curveLut) { r = curveLut[idx255(r)] / 255; g = curveLut[idx255(g)] / 255; b = curveLut[idx255(b)] / 255 }
      if (curvePointsLut) { r = curvePointsLut.r[idx255(r)] / 255; g = curvePointsLut.g[idx255(g)] / 255; b = curvePointsLut.b[idx255(b)] / 255 }

      if (cubeLut) {
        const ri = Math.round(Math.min(1, Math.max(0, r)) * n), gi = Math.round(Math.min(1, Math.max(0, g)) * n), bi = Math.round(Math.min(1, Math.max(0, b)) * n)
        const ci = (ri + cubeLut.size * gi + cubeLut.size * cubeLut.size * bi) * 3
        r += (cubeLut.data[ci] - r) * mix
        g += (cubeLut.data[ci + 1] - g) * mix
        b += (cubeLut.data[ci + 2] - b) * mix
      }

      if (hslActive) {
        const [hue, hs] = hueSat(r, g, b)
        const fade = neutralFade(hs)
        if (fade > 0) {
          const [i0, i1, w0, w1] = hslBandWeights(hue)
          const dh = (hslH[i0] * w0 + hslH[i1] * w1) * fade
          const ds = (hslS[i0] * w0 + hslS[i1] * w1) * fade
          const dl = (hslL[i0] * w0 + hslL[i1] * w1) * fade
          if (dh) [r, g, b] = withHue(r, g, b, hue + (dh / 100) * HSL_HUE_DEG)
          if (ds) [r, g, b] = scaleChroma(r, g, b, 1 + ds / 100)
          if (dl) {
            const gain = Math.pow(2, (dl / 100) * HSL_LUM_EV)
            const [nr, ng, nb] = applyRatioLinear(srgbDecode(Math.max(0, r)), srgbDecode(Math.max(0, g)), srgbDecode(Math.max(0, b)), gain)
            r = srgbEncode(nr); g = srgbEncode(ng); b = srgbEncode(nb)
          }
        }
      }

      r *= 255; g *= 255; b *= 255
      if (grainAmt) {
        const noise = (Math.random() - 0.5) * grainAmt
        r += noise; g += noise; b += noise
      }

      d[i] = r; d[i + 1] = g; d[i + 2] = b
    }
    ctx.putImageData(id, 0, 0)
  }

  if (s.colorGrade && s.colorGrade.intensity > 0) {
    ctx.globalCompositeOperation = 'color'
    ctx.globalAlpha = s.colorGrade.intensity / 100
    ctx.fillStyle = s.colorGrade.hex
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  // Vignette, Lightroom convention: negative darkens the corners, positive lightens them.
  if (s.vignette) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7)
    const tone = s.vignette < 0 ? '0,0,0' : '255,255,255'
    grad.addColorStop(0, `rgba(${tone},0)`)
    grad.addColorStop(1, `rgba(${tone},${Math.abs(s.vignette) / 140})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }
}
