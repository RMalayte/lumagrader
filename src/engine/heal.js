// Spot removal (Lightroom's Healing tool): each spot copies a circular patch from a source
// area onto the target.
//   clone — copies the source as is.
//   heal  — copies the source's texture but takes its colour and brightness from around the
//           target: the difference target − source along the circle's edge is spread smoothly
//           over the inside (a "membrane" / Laplace fill), so the patch blends in.
// Spots are stored in normalized coordinates of the photo BEFORE crop/rotate:
//   { id, x, y, sx, sy (0–1 of width/height), r (radius, fraction of the long side),
//     mode: 'heal' | 'clone', feather 0–100, opacity 0–100 }
// so they stay on the same spot when the crop changes, and apply at any resolution.

export const SPOT_DEFAULTS = { mode: 'heal', feather: 50, opacity: 100 }
const MEMBRANE_GRID = 40
const MEMBRANE_ITERATIONS = 120
const SOR_OMEGA = 1.85

export const spotsKey = (spots) => (spots && spots.length ? JSON.stringify(spots) : '')

let counter = 0
export const newSpotId = () => `spot_${Date.now().toString(36)}_${(counter++).toString(36)}`

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Applies every spot, in order, to a 2D canvas (in place). */
export function applySpots(canvas, spots) {
  if (!spots || !spots.length) return canvas
  const w = canvas.width, h = canvas.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data
  const long = Math.max(w, h)
  for (const sp of spots) applyOne(data, w, h, sp, long)
  ctx.putImageData(img, 0, 0)
  return canvas
}

function applyOne(data, w, h, sp, long) {
  const R = Math.max(1, sp.r * long)
  const tx = sp.x * w, ty = sp.y * h
  const sx = sp.sx * w, sy = sp.sy * h
  const ox = sx - tx, oy = sy - ty // source offset in pixels
  const feather = Math.min(1, Math.max(0, (sp.feather ?? SPOT_DEFAULTS.feather) / 100))
  const opacity = Math.min(1, Math.max(0, (sp.opacity ?? SPOT_DEFAULTS.opacity) / 100))
  const heal = (sp.mode || 'heal') === 'heal'
  const inner = R * (1 - 0.85 * feather) // alpha is 1 inside `inner`, fades to 0 at R

  const x0 = Math.max(0, Math.floor(tx - R - 2)), x1 = Math.min(w - 1, Math.ceil(tx + R + 2))
  const y0 = Math.max(0, Math.floor(ty - R - 2)), y1 = Math.min(h - 1, Math.ceil(ty + R + 2))
  if (x1 < x0 || y1 < y0) return

  const px = (x, y, ch) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x - 0.5)))
    const yi = Math.min(h - 1, Math.max(0, Math.round(y - 0.5)))
    return data[(yi * w + xi) * 4 + ch]
  }
  // Box average (3×3) — the membrane's boundary values shouldn't follow single noisy pixels.
  const avg = (x, y, ch) => {
    let s = 0
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += px(x + i, y + j, ch)
    return s / 9
  }

  // Read the source patch first (the target area may overlap the source).
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const srcPatch = new Float32Array(bw * bh * 3)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = ((y - y0) * bw + (x - x0)) * 3
      srcPatch[o] = px(x + 0.5 + ox, y + 0.5 + oy, 0)
      srcPatch[o + 1] = px(x + 0.5 + ox, y + 0.5 + oy, 1)
      srcPatch[o + 2] = px(x + 0.5 + ox, y + 0.5 + oy, 2)
    }
  }

  // Heal: membrane = smooth fill of (target − source) from the circle's edge inward.
  let membrane = null
  const G = MEMBRANE_GRID
  const cell = (2 * R) / (G - 1) // grid spans [−R, R]² around the target centre
  if (heal) {
    membrane = [new Float32Array(G * G), new Float32Array(G * G), new Float32Array(G * G)]
    const fixed = new Uint8Array(G * G)
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const dx = -R + i * cell, dy = -R + j * cell
        if (Math.hypot(dx, dy) < R) continue
        fixed[j * G + i] = 1
        // Sample just outside the circle along the same direction.
        const len = Math.hypot(dx, dy) || 1
        const ex = tx + (dx / len) * (R + 1), ey = ty + (dy / len) * (R + 1)
        for (let c = 0; c < 3; c++) membrane[c][j * G + i] = avg(ex, ey, c) - avg(ex + ox, ey + oy, c)
      }
    }
    // Initial guess for the inside: mean of the boundary.
    for (let c = 0; c < 3; c++) {
      let s = 0, n = 0
      for (let k = 0; k < G * G; k++) if (fixed[k]) { s += membrane[c][k]; n++ }
      const mean = n ? s / n : 0
      for (let k = 0; k < G * G; k++) if (!fixed[k]) membrane[c][k] = mean
    }
    // Over-relaxed Gauss–Seidel (SOR) → harmonic (smoothest) fill of the edge difference.
    for (let c = 0; c < 3; c++) {
      const m = membrane[c]
      for (let it = 0; it < MEMBRANE_ITERATIONS; it++) {
        for (let j = 1; j < G - 1; j++) {
          for (let i = 1; i < G - 1; i++) {
            const k = j * G + i
            if (!fixed[k]) m[k] += SOR_OMEGA * (0.25 * (m[k - 1] + m[k + 1] + m[k - G] + m[k + G]) - m[k])
          }
        }
      }
    }
  }
  const sampleMembrane = (dx, dy, c) => {
    const fi = Math.min(G - 1.001, Math.max(0, (dx + R) / cell)), fj = Math.min(G - 1.001, Math.max(0, (dy + R) / cell))
    const i = fi | 0, j = fj | 0, ai = fi - i, aj = fj - j
    const m = membrane[c]
    const top = m[j * G + i] + (m[j * G + i + 1] - m[j * G + i]) * ai
    const bot = m[(j + 1) * G + i] + (m[(j + 1) * G + i + 1] - m[(j + 1) * G + i]) * ai
    return top + (bot - top) * aj
  }

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - tx, dy = y + 0.5 - ty
      const dist = Math.hypot(dx, dy)
      if (dist >= R) continue
      const a = opacity * (1 - smoothstep(inner, R, dist))
      if (a <= 0) continue
      const o = (y * w + x) * 4, so = ((y - y0) * bw + (x - x0)) * 3
      for (let c = 0; c < 3; c++) {
        let v = srcPatch[so + c]
        if (membrane) v += sampleMembrane(dx, dy, c)
        data[o + c] = data[o + c] + (v - data[o + c]) * a
      }
    }
  }
}

/**
 * Picks a source for a new spot automatically: the nearby area whose surroundings look most
 * like the target's surroundings (and that isn't itself on the blemish or another spot).
 * `image` is a 2D canvas of the photo (any size). Returns { sx, sy } normalized.
 */
export function findHealSource(image, spot, others = []) {
  const W = image.width, H = image.height
  const scale = Math.min(1, 400 / Math.max(W, H))
  const w = Math.max(8, Math.round(W * scale)), h = Math.max(8, Math.round(H * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const grey = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  const at = (x, y) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x))), yi = Math.min(h - 1, Math.max(0, Math.round(y)))
    return grey[yi * w + xi]
  }
  const long = Math.max(w, h)
  const R = Math.max(1.5, spot.r * long)
  const tx = spot.x * w, ty = spot.y * h
  const RING = 32
  const ring = (cx, cy, rad) => {
    const out = []
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2
      out.push(at(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad))
    }
    return out
  }
  const tRing1 = ring(tx, ty, R * 1.15), tRing2 = ring(tx, ty, R * 1.45)
  const std = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length)
  }
  const tTexture = std([...tRing1, ...tRing2])
  const blocked = others.map((o) => ({ x: o.x * w, y: o.y * h, r: o.r * long }))

  let best = null
  for (const dist of [2.3, 3, 4, 5.5]) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + dist // offset per ring so rings don't line up
      const cx = tx + Math.cos(a) * R * dist, cy = ty + Math.sin(a) * R * dist
      if (cx - R * 1.5 < 0 || cy - R * 1.5 < 0 || cx + R * 1.5 > w || cy + R * 1.5 > h) continue
      if (blocked.some((b) => Math.hypot(cx - b.x, cy - b.y) < R + b.r)) continue
      const r1 = ring(cx, cy, R * 1.15), r2 = ring(cx, cy, R * 1.45)
      let ssd = 0
      for (let i = 0; i < RING; i++) ssd += (r1[i] - tRing1[i]) ** 2 + (r2[i] - tRing2[i]) ** 2
      // The inside should be as smooth/textured as the target's surroundings (no new blemish).
      const inside = [...ring(cx, cy, R * 0.3), ...ring(cx, cy, R * 0.65), at(cx, cy)]
      const texturePenalty = Math.abs(std(inside) - tTexture) * 40
      const score = ssd / (2 * RING) + texturePenalty * texturePenalty * 0.05 + dist * 2
      if (!best || score < best.score) best = { score, cx, cy }
    }
  }
  if (!best) {
    // Tiny photo or spot at the border: fall back to a spot to the right/left.
    const cx = tx + (tx < w / 2 ? 1 : -1) * R * 2.5
    return { sx: Math.min(1, Math.max(0, cx / w)), sy: spot.y }
  }
  return { sx: best.cx / w, sy: best.cy / h }
}

// UI "Size" 1–100 ↔ spot radius (fraction of the photo's long side).
export const spotRadius = (size) => 0.003 + (Math.min(100, Math.max(1, size)) / 100) * 0.07
export const spotSize = (r) => Math.round(Math.min(100, Math.max(1, ((r - 0.003) / 0.07) * 100)))
