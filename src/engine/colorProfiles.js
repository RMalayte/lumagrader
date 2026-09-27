// Camera-style rendering profiles — a base "look" applied underneath the user's own
// Exposure/Contrast/Saturation/Temperature/HSL sliders, not a replacement for them.
// Implemented as bias offsets combined with the user's values at render time (in both the
// WebGL renderer and the Canvas 2D fallback) — switching profiles never touches the user's
// own stored slider values, matching how Lightroom's Profile browser behaves.
//
// Our own looks (not Adobe's profiles, which need per-camera DCP data): "Luma Color" is the
// neutral default — for RAWs it includes the Lightroom-like base colour (rawLook.js) — and the
// others are starting points with a distinct character on top of it.
export const COLOR_PROFILES = {
  'Luma Color': { contrast: 0, saturation: 0, temp: 0, hsl: {} },
  'Luma Standard': { contrast: -5, saturation: -8, temp: 0, hsl: {} },
  'Luma Vivid': { contrast: 12, saturation: 20, temp: 0, hsl: {} },
  'Luma Landscape': { contrast: 8, saturation: 10, temp: 0, hsl: { green: { s: 15 }, aqua: { s: 12 }, blue: { s: 12 } } },
  'Luma Portrait': { contrast: -3, saturation: -5, temp: 2, hsl: { red: { s: -10 }, orange: { s: -8 } } },
  'Luma Neutral': { contrast: -15, saturation: -20, temp: 0, hsl: {} },
  'Luma Monochrome': { contrast: 5, saturation: -100, temp: 0, hsl: {} },
}

export const COLOR_PROFILE_NAMES = Object.keys(COLOR_PROFILES)

// Profiles were named "Adobe …" before v0.7.2 (renamed: Adobe is a trademark and these are
// our own approximations). Old projects/presets are mapped by migrateSettings / here.
export const LEGACY_PROFILE_NAMES = Object.fromEntries(COLOR_PROFILE_NAMES.map((n) => [n.replace('Luma ', 'Adobe '), n]))
export const canonicalProfile = (name) => (COLOR_PROFILES[name] ? name : LEGACY_PROFILE_NAMES[name] || 'Luma Color')

export function getProfileBias(name) {
  return COLOR_PROFILES[canonicalProfile(name)]
}
