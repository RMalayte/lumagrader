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
