// 8-band HSL mixer: per-pixel RGB<->HSL conversion with weighted band falloff.
export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']
export const BAND_HUE = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 275, magenta: 320 }
export const BAND_COLOR = {
  red: '#e04b3e', orange: '#e08a3e', yellow: '#d8c93e', green: '#5bb35b',
  aqua: '#3ec2c2', blue: '#3e7fe0', purple: '#8a5be0', magenta: '#d84fb0',
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h *= 60
  }
  return [h, s, l]
}

export function hslToRgb(h, s, l) {
  h /= 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255]
}
