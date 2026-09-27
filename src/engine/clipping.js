// Clipping detection for the histogram warnings and the on-photo overlay (like Lightroom's J key).
// Highlights: any channel at 255 (detail lost in at least one channel) → shown red.
// Shadows: all channels at ~0 (crushed to pure black) → shown blue.
const HI = 255
const LO = 1
const MAX_OVERLAY_SIZE = 1600 // analyse a downscaled copy — plenty for a warning overlay, and cheap

/** Fraction of pixels clipped, from per-channel histograms (Uint32Array[256] each). */
export function clippingFromHistogram(r, g, b, totalPixels) {
  if (!totalPixels) return { shadows: 0, highlights: 0 }
  const highlights = Math.max(r[255], g[255], b[255]) / totalPixels
  const shadows = Math.min(r[0] + r[1], g[0] + g[1], b[0] + b[1]) / totalPixels
  return { shadows, highlights }
}

/** Visible threshold: ignore a handful of stray pixels. */
export const CLIP_THRESHOLD = 0.0005

/**
 * Paints clipped pixels of `source` (a rendered 2D or WebGL canvas) onto `target`.
 * `target` is sized to a downscaled copy and stretched over the photo with CSS.
 */
export function drawClippingOverlay(source, target, { shadows, highlights }) {
  if (!shadows && !highlights) {
    // Keep the hidden overlay tiny instead of a full-size transparent canvas (~7 MB).
    target.width = 1
    target.height = 1
    return
  }
  const scale = Math.min(1, MAX_OVERLAY_SIZE / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  target.width = w
  target.height = h
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, w, h)

  // Copy through a plain 2D canvas — the source may be a WebGL canvas.
  const read = document.createElement('canvas')
  read.width = w
  read.height = h
  const rctx = read.getContext('2d', { willReadFrequently: true })
  rctx.drawImage(source, 0, 0, w, h)
  const src = rctx.getImageData(0, 0, w, h).data
  const out = ctx.createImageData(w, h)
  const o = out.data

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2]
    if (highlights && (r >= HI || g >= HI || b >= HI)) {
      o[i] = 255; o[i + 1] = 40; o[i + 2] = 40; o[i + 3] = 255
    } else if (shadows && r <= LO && g <= LO && b <= LO) {
      o[i] = 40; o[i + 1] = 110; o[i + 2] = 255; o[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
}
