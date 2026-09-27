import { HSL_BANDS } from './hsl'
import { defaultCurvePoints } from './curvePoints'
import { defaultGeometry } from './geometry'

// Exposure is in stops (EV) since engine v2 — these were converted from the old ±100 scale.
export const PRESETS = {
  None: { exposure: 0, contrast: 0, curve: 0, saturation: 0, temp: 0, tint: 0, vignette: 0, grain: 0 },
  'Travel Warm': { exposure: 0.08, contrast: 14, curve: 10, saturation: 12, temp: 22, tint: -4, vignette: 18, grain: 6 },
  'Moody Grade': { exposure: -0.12, contrast: 22, curve: 20, saturation: -18, temp: -8, tint: 8, vignette: 30, grain: 12 },
  'Clean Vlog': { exposure: 0.11, contrast: 8, curve: 5, saturation: 6, temp: 4, tint: 0, vignette: 0, grain: 0 },
  'B&W Film': { exposure: 0, contrast: 18, curve: 15, saturation: -100, temp: 0, tint: 0, vignette: 22, grain: 16 },
  'Golden Hour': { exposure: 0.14, contrast: 10, curve: 8, saturation: 16, temp: 32, tint: -10, vignette: 14, grain: 4 },
}

/**
 * Engine version of a settings object. v1 (no marker): Exposure was a ±100 brightness
 * multiplier. v2: Exposure is in stops (EV, ±5) and the tone sliders behave like Lightroom.
 */
export const ENGINE_VERSION = 2

/** Upgrades settings saved by an older engine (projects, presets, preset files). */
export function migrateSettings(s) {
  if (!s || typeof s !== 'object' || s.engine >= ENGINE_VERSION) return s
  const out = { ...s, engine: ENGINE_VERSION }
  // v1 exposure n meant brightness × (1 + n/100) → the same brightness in stops.
  const factor = Math.max(1 / 32, 1 + (Number(s.exposure) || 0) / 100)
  out.exposure = Math.round(Math.min(5, Math.max(-5, Math.log2(factor))) * 100) / 100
  return out
}

export const defaultHsl = () => Object.fromEntries(HSL_BANDS.map((b) => [b, { h: 0, s: 0, l: 0 }]))

export const defaultSettings = () => ({
  engine: ENGINE_VERSION,
  colorProfile: 'Adobe Color',
  ...PRESETS.None,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  curvePoints: defaultCurvePoints(),
  curvePointsR: defaultCurvePoints(),
  curvePointsG: defaultCurvePoints(),
  curvePointsB: defaultCurvePoints(),
  geometry: defaultGeometry(),
  masks: [],
  sharpen: 0,
  sharpenRadius: 1.0,
  sharpenDetail: 25,
  sharpenMasking: 0,
  noiseReduction: 0, // Luminance noise reduction amount
  denoiseDetail: 50,
  denoiseContrast: 0,
  colorNoiseReduction: 0,
  colorNoiseDetail: 50,
  colorNoiseSmoothness: 50,
  clarity: 0,
  texture: 0,
  dehaze: 0,
  lut: null,
  lutStrength: 100,
  hsl: defaultHsl(),
  colorGrade: { hex: '#e0623e', intensity: 0 },
})
