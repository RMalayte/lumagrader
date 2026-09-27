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
