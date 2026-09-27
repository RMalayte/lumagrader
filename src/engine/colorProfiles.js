// Camera-style rendering profiles — a base "look" applied underneath the user's own
// Exposure/Contrast/Saturation/Temperature/HSL sliders, not a replacement for them.
// Implemented as bias offsets combined with the user's values at render time (in both the
// WebGL renderer and the Canvas 2D fallback) — switching profiles never touches the user's
// own stored slider values, matching how Lightroom's Profile browser behaves.
//
// These are reasonable approximations, not the actual camera-matching color science Adobe
// ships (that requires per-camera DCP profile data) — think of them as starting points with
// a distinct character, not scientifically exact reproductions.
export const COLOR_PROFILES = {
  'Adobe Color': { contrast: 0, saturation: 0, temp: 0, hsl: {} },
  'Adobe Standard': { contrast: -5, saturation: -8, temp: 0, hsl: {} },
  'Adobe Vivid': { contrast: 12, saturation: 20, temp: 0, hsl: {} },
  'Adobe Landscape': { contrast: 8, saturation: 10, temp: 0, hsl: { green: { s: 15 }, aqua: { s: 12 }, blue: { s: 12 } } },
  'Adobe Portrait': { contrast: -3, saturation: -5, temp: 2, hsl: { red: { s: -10 }, orange: { s: -8 } } },
  'Adobe Neutral': { contrast: -15, saturation: -20, temp: 0, hsl: {} },
  'Adobe Monochrome': { contrast: 5, saturation: -100, temp: 0, hsl: {} },
}

export const COLOR_PROFILE_NAMES = Object.keys(COLOR_PROFILES)

export function getProfileBias(name) {
  return COLOR_PROFILES[name] || COLOR_PROFILES['Adobe Color']
}
