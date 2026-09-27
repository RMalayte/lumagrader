// Lightroom / Camera Raw .xmp preset import.
//
// A preset is XML whose settings live in the Camera Raw namespace ("crs:"), either as
// attributes (crs:Exposure2012="+0.50") or as child elements (<crs:ToneCurvePV2012>…).
// Values are translated to the closest LumaGrader slider. The two apps use different math,
// so the result follows the same *direction* as the Lightroom look but is not pixel-identical.
//
// Parsing uses the browser's DOMParser, which never fetches external entities, and every
// number is validated and clamped — preset files come from the internet.

import { defaultSettings } from './defaults'
import { defaultGeometry } from './geometry'
import { HSL_BANDS } from './hsl'
import { COLOR_PROFILE_NAMES } from './colorProfiles'
import { defaultColorGrade } from './color'

const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const MAX_XMP_BYTES = 2 * 1024 * 1024

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const LR_BAND = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta' }

/** The rdf:Description holding the preset's settings (not the one nested in crs:Look). */
function findSettingsNode(doc) {
  const descriptions = Array.from(doc.getElementsByTagNameNS(RDF, 'Description'))
  const outside = descriptions.filter((d) => {
    for (let p = d.parentElement; p; p = p.parentElement) if (p.namespaceURI === CRS) return false
    return true
  })
  return outside.find((d) => Array.from(d.attributes).some((a) => a.namespaceURI === CRS) || Array.from(d.children).some((c) => c.namespaceURI === CRS)) || null
}

function makeReader(node) {
  const direct = (name) => Array.from(node.children).find((c) => c.namespaceURI === CRS && c.localName === name) || null
  return {
    raw(name) {
      if (node.hasAttributeNS(CRS, name)) return node.getAttributeNS(CRS, name)
      const el = direct(name)
      return el && el.children.length === 0 ? el.textContent.trim() : null
    },
    num(name) {
      const v = this.raw(name)
      if (v === null || v === '') return null
      const n = Number(String(v).replace(/^\+/, ''))
      return Number.isFinite(n) ? n : null
    },
    element: direct,
  }
}

/** Text of an rdf:Alt / rdf:Seq entry list under a crs element. */
function listItems(el) {
  return el ? Array.from(el.getElementsByTagNameNS(RDF, 'li')).map((li) => li.textContent.trim()) : []
}

/**
 * Parses one .xmp preset. Returns { name, settings, applied, partial, skipped } or throws
 * with a user-readable message.
 */
export function parseXmpPreset(text, fileName = 'Preset.xmp') {
  if (/^\s*s\s*=\s*\{/.test(text)) throw new Error('This is an old .lrtemplate preset — export it from Lightroom as .xmp first.')
  const doc = new window.DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid XMP file.')
  const node = findSettingsNode(doc)
  if (!node) throw new Error('No Lightroom/Camera Raw settings found in this file.')
  const r = makeReader(node)

  const s = defaultSettings()
  s.geometry = defaultGeometry()
  s.masks = []
  const applied = []
  const partial = []
  const skipped = []

  const set = (key, value, label) => {
    if (value === null || value === undefined) return
    s[key] = Math.round(value)
    applied.push(label)
  }
  const direct = (lrName, key, label, lo = -100, hi = 100, fallbackName) => {
    const v = r.num(lrName) ?? (fallbackName ? r.num(fallbackName) : null)
    if (v === null) return
    if (v < lo || v > hi) partial.push(`${label} (clamped)`)
    set(key, clamp(v, lo, hi), label)
  }

  // --- Light ---------------------------------------------------------------------------
  const ev = r.num('Exposure2012') ?? r.num('Exposure')
  if (ev !== null) {
    // Both apps use stops (EV, ±5) — a direct 1:1 mapping.
    s.exposure = Math.round(clamp(ev, -5, 5) * 100) / 100
    applied.push('Exposure')
  }
  direct('Contrast2012', 'contrast', 'Contrast', -100, 100)
  direct('Highlights2012', 'highlights', 'Highlights')
  direct('Shadows2012', 'shadows', 'Shadows')
  direct('Whites2012', 'whites', 'Whites')
  direct('Blacks2012', 'blacks', 'Blacks')

  // --- Presence ------------------------------------------------------------------------
  for (const [lr, key, label] of [['Texture', 'texture', 'Texture'], ['Clarity2012', 'clarity', 'Clarity'], ['Dehaze', 'dehaze', 'Dehaze']]) {
    const v = r.num(lr) ?? (lr === 'Clarity2012' ? r.num('Clarity') : null)
    if (v === null) continue
    set(key, clamp(v, -100, 100), label)
  }
  direct('Vibrance', 'vibrance', 'Vibrance')
  direct('Saturation', 'saturation', 'Saturation')

  // --- White balance -------------------------------------------------------------------
  const incTemp = r.num('IncrementalTemperature')
  const incTint = r.num('IncrementalTint')
  if (incTemp !== null) set('temp', clamp(incTemp, -100, 100), 'Temperature')
  if (incTint !== null) set('tint', clamp(incTint, -100, 100), 'Tint')
  // RAW presets carry absolute Kelvin/Tint (WhiteBalance = Custom, Daylight, …). They apply
  // to RAW photos (Kelvin white balance); JPEGs ignore them, as in Lightroom.
  const kelvin = r.num('Temperature')
  if (incTemp === null && kelvin !== null && r.raw('WhiteBalance') !== 'As Shot') {
    s.wb = { kelvin: Math.round(clamp(kelvin, 2000, 50000)), tint: Math.round(clamp(r.num('Tint') ?? 0, -150, 150)) }
    applied.push('White balance (Kelvin — RAW photos)')
  }

  // --- HSL (same 8 bands as Lightroom) -------------------------------------------------
  let hslCount = 0
  for (const band of HSL_BANDS) {
    const b = LR_BAND[band]
    const h = r.num(`HueAdjustment${b}`), sat = r.num(`SaturationAdjustment${b}`), lum = r.num(`LuminanceAdjustment${b}`)
    if (h !== null) { s.hsl[band].h = Math.round(clamp(h, -100, 100)); hslCount++ }
    if (sat !== null) { s.hsl[band].s = Math.round(clamp(sat, -100, 100)); hslCount++ }
    if (lum !== null) { s.hsl[band].l = Math.round(clamp(lum, -100, 100)); hslCount++ }
  }
  if (hslCount) applied.push('HSL')

  // --- Detail --------------------------------------------------------------------------
  const sharp = r.num('Sharpness')
  if (sharp !== null) set('sharpen', clamp((sharp / 150) * 100, 0, 100), 'Sharpening')
  const radius = r.num('SharpenRadius')
  if (radius !== null) { s.sharpenRadius = Math.round(clamp(radius, 0.5, 3) * 10) / 10; applied.push('Sharpen radius') }
  direct('SharpenDetail', 'sharpenDetail', 'Sharpen detail', 0, 100)
  direct('SharpenEdgeMasking', 'sharpenMasking', 'Sharpen masking', 0, 100)
  direct('LuminanceSmoothing', 'noiseReduction', 'Noise reduction', 0, 100)
  direct('LuminanceNoiseReductionDetail', 'denoiseDetail', 'NR detail', 0, 100)
  direct('LuminanceNoiseReductionContrast', 'denoiseContrast', 'NR contrast', 0, 100)
  direct('ColorNoiseReduction', 'colorNoiseReduction', 'Color NR', 0, 100)
  direct('ColorNoiseReductionDetail', 'colorNoiseDetail', 'Color NR detail', 0, 100)
  direct('ColorNoiseReductionSmoothness', 'colorNoiseSmoothness', 'Color NR smoothness', 0, 100)

  // --- Effects -------------------------------------------------------------------------
  const vig = r.num('PostCropVignetteAmount')
  if (vig !== null) {
    set('vignette', clamp(vig, -100, 100), 'Vignette') // same sign convention as Lightroom
  }
  direct('PostCropVignetteMidpoint', 'vignetteMidpoint', 'Vignette midpoint', 0, 100)
  direct('PostCropVignetteRoundness', 'vignetteRoundness', 'Vignette roundness', -100, 100)
  direct('PostCropVignetteFeather', 'vignetteFeather', 'Vignette feather', 0, 100)
  direct('PostCropVignetteHighlightContrast', 'vignetteHighlights', 'Vignette highlights', 0, 100)
  direct('GrainAmount', 'grain', 'Grain', 0, 100)
  direct('GrainSize', 'grainSize', 'Grain size', 0, 100)
  direct('GrainFrequency', 'grainRoughness', 'Grain roughness', 0, 100)

  // --- Tone curve ----------------------------------------------------------------------
  // RGB composite + per-channel (Red/Green/Blue) point curves, same 0–255 scale as ours.
  const readCurve = (name) => {
    const pts = listItems(r.element(name))
      .map((p) => p.split(',').map((n) => Number(n.trim())))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y]) => ({ x: Math.round(clamp(x, 0, 255)), y: Math.round(clamp(y, 0, 255)) }))
    return pts.filter((p, i, arr) => arr.findIndex((q) => q.x === p.x) === i).sort((a, b) => a.x - b.x)
  }
  const curveTargets = [
    ['ToneCurvePV2012', 'curvePoints', 'Tone curve'],
    ['ToneCurvePV2012Red', 'curvePointsR', 'Tone curve (Red)'],
    ['ToneCurvePV2012Green', 'curvePointsG', 'Tone curve (Green)'],
    ['ToneCurvePV2012Blue', 'curvePointsB', 'Tone curve (Blue)'],
  ]
  for (const [xmpName, key, label] of curveTargets) {
    const pts = readCurve(xmpName)
    if (pts.length >= 2 && pts.length <= 32 && pts.some((p) => p.x !== p.y)) {
      s[key] = pts
      applied.push(label)
    }
  }

  // --- Color grading (3 wheels + Global, Blending, Balance) — 1:1 with Lightroom ---------
  // Older presets use Split Toning (shadow/highlight hue + saturation, balance).
  const wheel = (key, lrName, splitHue, splitSat) => {
    const h = r.num(`ColorGrade${lrName}Hue`) ?? (splitHue ? r.num(splitHue) : null)
    const sat = r.num(`ColorGrade${lrName}Sat`) ?? (splitSat ? r.num(splitSat) : null)
    const lum = r.num(`ColorGrade${lrName}Lum`)
    if (h === null && sat === null && lum === null) return false
    s.colorGrade[key] = { h: Math.round(clamp(h ?? 0, 0, 360)), s: Math.round(clamp(sat ?? 0, 0, 100)), l: Math.round(clamp(lum ?? 0, -100, 100)) }
    return !!(sat || lum)
  }
  s.colorGrade = defaultColorGrade()
  let gradeUsed = false
  gradeUsed = wheel('shadows', 'Shadow', 'SplitToningShadowHue', 'SplitToningShadowSaturation') || gradeUsed
  gradeUsed = wheel('midtones', 'Midtone') || gradeUsed
  gradeUsed = wheel('highlights', 'Highlight', 'SplitToningHighlightHue', 'SplitToningHighlightSaturation') || gradeUsed
  gradeUsed = wheel('global', 'Global') || gradeUsed
  const blend = r.num('ColorGradeBlending')
  if (blend !== null) s.colorGrade.blending = Math.round(clamp(blend, 0, 100))
  const bal = r.num('SplitToningBalance') ?? r.num('ColorGradeBalance')
  if (bal !== null) s.colorGrade.balance = Math.round(clamp(bal, -100, 100))
  if (gradeUsed) applied.push('Color grading')

  // --- Profile -------------------------------------------------------------------------
  const lookEl = r.element('Look')
  const lookName = lookEl
    ? (() => {
        const d = lookEl.getElementsByTagNameNS(RDF, 'Description')[0]
        return d?.getAttributeNS(CRS, 'Name') || listItems(d?.getElementsByTagNameNS(CRS, 'Name')[0])[0] || null
      })()
    : r.raw('CameraProfile')
  if (lookName) {
    const wanted = String(lookName).toLowerCase().replace(/^adobe /, 'luma ') // LR "Adobe Color" → our "Luma Color"
    const match = COLOR_PROFILE_NAMES.find((n) => n.toLowerCase() === wanted)
    if (match) { s.colorProfile = match; applied.push('Profile') }
    else skipped.push(`Profile "${lookName}"`)
  }
  if (r.raw('ConvertToGrayscale') === 'True') {
    s.colorProfile = 'Luma Monochrome'
    if (!applied.includes('Profile')) applied.push('Black & white')
  }

  // --- Not supported -------------------------------------------------------------------
  const unsupported = [
    ['MaskGroupBasedCorrections', 'Masks'], ['GradientBasedCorrections', 'Graduated filters'],
    ['CircularGradientBasedCorrections', 'Radial filters'], ['PaintBasedCorrections', 'Brush adjustments'],
    ['RetouchInfo', 'Spot removal'], ['LensProfileEnable', 'Lens corrections'],
  ]
  for (const [lr, label] of unsupported) {
    const el = r.element(lr)
    const v = r.raw(lr)
    if ((el && el.getElementsByTagNameNS(RDF, 'li').length) || (v && v !== '0' && v !== 'False')) skipped.push(label)
  }

  const nameFromFile = String(fileName).replace(/\.xmp$/i, '').trim()
  const alt = listItems(r.element('Name'))[0]
  const name = (alt || r.raw('Name') || nameFromFile || 'Imported preset').slice(0, 80)

  if (!applied.length) throw new Error('No supported settings found in this preset.')
  return { name, settings: s, applied, partial, skipped }
}
