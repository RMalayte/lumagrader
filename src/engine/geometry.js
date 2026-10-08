export function defaultGeometry() {
  return { rotate90: 0, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }
}

export function isGeometryDefault(geo) {
  if (!geo) return true
  const c = geo.crop
  const cropIsFull = !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1)
  return geo.rotate90 === 0 && geo.angle === 0 && cropIsFull
}

// Returns a new canvas with rotate90 -> fine straighten angle -> crop applied, in that order.
export function applyGeometry(source, geo) {
  const w0 = source.naturalWidth ?? source.width
  const h0 = source.naturalHeight ?? source.height

  const steps = ((geo.rotate90 % 360) + 360) % 360
  const swapped = steps === 90 || steps === 270
  let cur = document.createElement('canvas')
  cur.width = swapped ? h0 : w0
  cur.height = swapped ? w0 : h0
  let ctx = cur.getContext('2d')
  ctx.translate(cur.width / 2, cur.height / 2)
  ctx.rotate((steps * Math.PI) / 180)
  ctx.drawImage(source, -w0 / 2, -h0 / 2)

  if (geo.angle) {
    const rad = (geo.angle * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
    const bw = Math.ceil(cur.width * cos + cur.height * sin)
    const bh = Math.ceil(cur.width * sin + cur.height * cos)
    const angled = document.createElement('canvas')
    angled.width = bw
    angled.height = bh
    const actx = angled.getContext('2d')
    actx.translate(bw / 2, bh / 2)
    actx.rotate(rad)
    actx.drawImage(cur, -cur.width / 2, -cur.height / 2)
    cur = angled
  }

  const c = geo.crop
  if (c && !(c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1)) {
    const sx = c.x * cur.width, sy = c.y * cur.height
    const sw = c.w * cur.width, sh = c.h * cur.height
    const cropped = document.createElement('canvas')
    cropped.width = Math.max(1, Math.round(sw))
    cropped.height = Math.max(1, Math.round(sh))
    cropped.getContext('2d').drawImage(cur, sx, sy, sw, sh, 0, 0, cropped.width, cropped.height)
    return cropped
  }
  return cur
}

/**
 * Maps between the photo before geometry (source pixels, 0…w0 × 0…h0) and the displayed,
 * rotated + straightened + cropped frame (view pixels, 0…width × 0…height) — the same
 * transforms applyGeometry performs. Used by tools that store positions on the uncropped
 * photo (spot removal) but are drawn over the cropped preview.
 */
export function geometryFrame(geo, w0, h0) {
  const g = geo || defaultGeometry()
  const steps = ((((g.rotate90 || 0) % 360) + 360) % 360)
  const q = (steps * Math.PI) / 180
  const swapped = steps === 90 || steps === 270
  const w1 = swapped ? h0 : w0, h1 = swapped ? w0 : h0
  const a = ((g.angle || 0) * Math.PI) / 180
  const bw = a ? Math.ceil(w1 * Math.abs(Math.cos(a)) + h1 * Math.abs(Math.sin(a))) : w1
  const bh = a ? Math.ceil(w1 * Math.abs(Math.sin(a)) + h1 * Math.abs(Math.cos(a))) : h1
  const c = g.crop || { x: 0, y: 0, w: 1, h: 1 }
  const t = q + a // both rotations are about the centre, so they compose
  const cos = Math.cos(t), sin = Math.sin(t)
  const width = c.w * bw, height = c.h * bh
  return {
    width,
    height,
    toView(x, y) {
      const dx = x - w0 / 2, dy = y - h0 / 2
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos
      return { x: rx + bw / 2 - c.x * bw, y: ry + bh / 2 - c.y * bh }
    },
    toSource(x, y) {
      const rx = x + c.x * bw - bw / 2, ry = y + c.y * bh - bh / 2
      return { x: rx * cos + ry * sin + w0 / 2, y: -rx * sin + ry * cos + h0 / 2 }
    },
  }
}

// ---- Crop limits (Lightroom's "Constrain to image") ----------------------------------------
// The crop is stored normalised to the straightened photo's bounding box. When the photo is
// straightened, that box has empty (transparent → black) corners, so a crop must stay inside
// the rotated photo itself. These helpers test and enforce that.

/** Sizes of the rotated photo: w1×h1 = after 90° turns, bw×bh = bounding box after `angle`. */
export function rotatedFrame(w0, h0, rotate90 = 0, angle = 0) {
  const steps = (((rotate90 || 0) % 360) + 360) % 360
  const swapped = steps === 90 || steps === 270
  const w1 = swapped ? h0 : w0, h1 = swapped ? w0 : h0
  const a = ((angle || 0) * Math.PI) / 180
  const bw = a ? Math.ceil(w1 * Math.abs(Math.cos(a)) + h1 * Math.abs(Math.sin(a))) : w1
  const bh = a ? Math.ceil(w1 * Math.abs(Math.sin(a)) + h1 * Math.abs(Math.cos(a))) : h1
  return { w1, h1, bw, bh, a }
}

function pointInPhoto(f, nx, ny) {
  const X = nx * f.bw - f.bw / 2, Y = ny * f.bh - f.bh / 2
  const c = Math.cos(f.a), s = Math.sin(f.a)
  const rx = X * c + Y * s, ry = -X * s + Y * c
  const eps = 0.75 // px of slack for rounding
  return Math.abs(rx) <= f.w1 / 2 + eps && Math.abs(ry) <= f.h1 / 2 + eps
}

/** True if every corner of `crop` lies on the photo (no empty corners in the result). */
export function cropFits(crop, f) {
  if (crop.x < -1e-6 || crop.y < -1e-6 || crop.x + crop.w > 1 + 1e-6 || crop.y + crop.h > 1 + 1e-6) return false
  if (!f.a) return true
  return [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]].every(([x, y]) => pointInPhoto(f, x, y))
}

/** Interpolates between two crops and returns the furthest one (toward `to`) that fits. */
export function furthestFit(from, to, f) {
  if (cropFits(to, f)) return to
  const lerp = (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, w: from.w + (to.w - from.w) * t, h: from.h + (to.h - from.h) * t })
  let lo = 0, hi = 1
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (cropFits(lerp(mid), f)) lo = mid
    else hi = mid
  }
  return lerp(lo)
}

/** Shrinks `crop` toward the point (ax, ay) — normalised — until it fits on the photo. */
export function shrinkToFit(crop, f, ax = crop.x + crop.w / 2, ay = crop.y + crop.h / 2) {
  if (cropFits(crop, f)) return crop
  if (!pointInPhoto(f, ax, ay)) { ax = 0.5; ay = 0.5 }
  return furthestFit({ x: ax, y: ay, w: 0, h: 0 }, crop, f)
}

/** Re-expresses a crop made for frame `from` in frame `to` (same centre and pixel size). */
export function remapCrop(crop, from, to) {
  const cx = (crop.x + crop.w / 2) * from.bw - from.bw / 2
  const cy = (crop.y + crop.h / 2) * from.bh - from.bh / 2
  const w = (crop.w * from.bw) / to.bw, h = (crop.h * from.bh) / to.bh
  return { x: (cx + to.bw / 2) / to.bw - w / 2, y: (cy + to.bh / 2) / to.bh - h / 2, w, h }
}

/** The whole (unrotated-size) photo as a crop in frame `f`, centred — the "no crop" size. */
export function fullPhotoCrop(f) {
  const w = f.w1 / f.bw, h = f.h1 / f.bh
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

export const isFullCrop = (c) => !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1)

/**
 * Crop after straightening to `angle`, starting from `crop` (made at `fromAngle`): same centre
 * and size, then shrunk until it fits — like Lightroom, the frame never shows empty corners.
 * An uncropped photo keeps its own shape and becomes the largest version that fits.
 */
export function cropForAngle(crop, w0, h0, rotate90, fromAngle, angle) {
  const from = rotatedFrame(w0, h0, rotate90, fromAngle)
  const to = rotatedFrame(w0, h0, rotate90, angle)
  if (!to.a) return isFullCrop(crop) || (!from.a && isFullCrop(crop)) ? { x: 0, y: 0, w: 1, h: 1 } : clamp01(remapCrop(crop, from, to))
  const base = isFullCrop(crop) ? fullPhotoCrop(to) : remapCrop(crop, from, to)
  return shrinkToFit(base, to)
}

function clamp01(c) {
  const w = Math.min(1, c.w), h = Math.min(1, c.h)
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h }
}
