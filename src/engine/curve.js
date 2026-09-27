// S-curve lookup table applied per-pixel to boost/reduce midtone contrast.
export function buildCurveLUT(strength) {
  const lut = new Uint8ClampedArray(256)
  const gamma = 1 - strength / 220
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    const y = x < 0.5 ? 0.5 * Math.pow(2 * x, gamma) : 1 - 0.5 * Math.pow(2 * (1 - x), gamma)
    lut[i] = Math.round(Math.min(1, Math.max(0, y)) * 255)
  }
  return lut
}
