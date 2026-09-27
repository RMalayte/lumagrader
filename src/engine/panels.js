import { defaultSettings } from './defaults'

// Which settings keys belong to which sidebar panel. Used for the "edited" dot, per-panel
// reset, and per-panel bypass (temporarily hiding a panel's effect without losing values).
export const PANEL_KEYS = {
  profile: ['colorProfile'],
  luts: ['lut', 'lutStrength'],
  light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  curves: ['curvePoints', 'curvePointsR', 'curvePointsG', 'curvePointsB', 'curve'],
  color: ['wb', 'temp', 'tint', 'saturation', 'vibrance'],
  hsl: ['hsl'],
  colorGrade: ['colorGrade'],
  effects: ['vignette', 'vignetteMidpoint', 'vignetteRoundness', 'vignetteFeather', 'vignetteHighlights', 'grain', 'grainSize', 'grainRoughness'],
  detail: [
    'texture', 'clarity', 'dehaze',
    'sharpen', 'sharpenRadius', 'sharpenDetail', 'sharpenMasking',
    'noiseReduction', 'denoiseDetail', 'denoiseContrast',
    'colorNoiseReduction', 'colorNoiseDetail', 'colorNoiseSmoothness',
  ],
  masks: ['masks'],
  optics: ['lensDistortion', 'lensVignette', 'lensVignetteMidpoint', 'removeCA'],
  healing: ['spots'],
}

const DEFAULTS = defaultSettings()

function sameValue(a, b) {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

export function isPanelEdited(settings, panelId) {
  const keys = PANEL_KEYS[panelId]
  if (!keys || !settings) return false
  return keys.some((key) => settings[key] !== undefined && !sameValue(settings[key], DEFAULTS[key]))
}

/** Patch that restores one panel's keys to their defaults. */
export function panelResetPatch(panelId) {
  const fresh = defaultSettings()
  return Object.fromEntries((PANEL_KEYS[panelId] || []).map((key) => [key, fresh[key]]))
}

/**
 * Settings actually rendered for an image: bypassed panels are swapped for defaults so
 * their effect disappears while the user's values stay intact in `settings`.
 */
export function effectiveSettings(image) {
  // The photo's own as-shot white balance (RAW) travels with the settings for rendering only;
  // it is never stored in settings, so copying edits to another photo can't carry it along.
  const base = image?.wbAsShot ? { ...image.settings, asShotWB: image.wbAsShot } : image.settings
  const bypass = image?.bypass
  if (!bypass) return base
  const bypassed = Object.keys(bypass).filter((id) => bypass[id])
  if (!bypassed.length) return base
  return bypassed.reduce((acc, id) => ({ ...acc, ...panelResetPatch(id) }), base)
}
