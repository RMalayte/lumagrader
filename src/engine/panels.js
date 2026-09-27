import { defaultSettings } from './defaults'

// Which settings keys belong to which sidebar panel. Used for the "edited" dot, per-panel
// reset, and per-panel bypass (temporarily hiding a panel's effect without losing values).
export const PANEL_KEYS = {
  profile: ['colorProfile'],
  luts: ['lut', 'lutStrength'],
  light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  curves: ['curvePoints', 'curvePointsR', 'curvePointsG', 'curvePointsB', 'curve'],
  color: ['temp', 'tint', 'saturation', 'vibrance'],
  hsl: ['hsl'],
  colorGrade: ['colorGrade'],
  effects: ['vignette', 'grain'],
  detail: [
    'texture', 'clarity', 'dehaze',
    'sharpen', 'sharpenRadius', 'sharpenDetail', 'sharpenMasking',
    'noiseReduction', 'denoiseDetail', 'denoiseContrast',
    'colorNoiseReduction', 'colorNoiseDetail', 'colorNoiseSmoothness',
  ],
  masks: ['masks'],
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
  const bypass = image?.bypass
  if (!bypass) return image.settings
  const bypassed = Object.keys(bypass).filter((id) => bypass[id])
  if (!bypassed.length) return image.settings
  return bypassed.reduce((acc, id) => ({ ...acc, ...panelResetPatch(id) }), image.settings)
}
