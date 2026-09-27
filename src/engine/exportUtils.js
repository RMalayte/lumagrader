import piexif from 'piexifjs'

export function formatMime(format) {
  return { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format] || 'image/jpeg'
}

export function formatExt(format) {
  return { jpeg: 'jpg', png: 'png', webp: 'webp' }[format] || 'jpg'
}

export function resizeCanvas(canvas, maxDim) {
  if (!maxDim) return canvas
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height))
  if (scale >= 1) return canvas
  const out = document.createElement('canvas')
  out.width = Math.round(canvas.width * scale)
  out.height = Math.round(canvas.height * scale)
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height)
  return out
}

function textAnchor(position, w, h, margin) {
  switch (position) {
    case 'top-left': return { x: margin, y: margin, align: 'left', baseline: 'top' }
    case 'top-right': return { x: w - margin, y: margin, align: 'right', baseline: 'top' }
    case 'bottom-left': return { x: margin, y: h - margin, align: 'left', baseline: 'bottom' }
    case 'center': return { x: w / 2, y: h / 2, align: 'center', baseline: 'middle' }
    default: return { x: w - margin, y: h - margin, align: 'right', baseline: 'bottom' }
  }
}

function imageAnchor(position, w, h, margin, iw, ih) {
  switch (position) {
    case 'top-left': return { x: margin, y: margin }
    case 'top-right': return { x: w - margin - iw, y: margin }
    case 'bottom-left': return { x: margin, y: h - margin - ih }
    case 'center': return { x: (w - iw) / 2, y: (h - ih) / 2 }
    default: return { x: w - margin - iw, y: h - margin - ih }
  }
}

// Draws a text or logo watermark onto a COPY of `sourceCanvas` (never mutates it) and
// returns the new canvas. Applied at export time only — never in the live editing preview.
export function applyWatermark(sourceCanvas, wm) {
  if (!wm || wm.type === 'none' || (wm.type === 'text' && !wm.text) || (wm.type === 'logo' && !wm.logoImg)) {
    return sourceCanvas
  }
  const out = document.createElement('canvas')
  out.width = sourceCanvas.width
  out.height = sourceCanvas.height
  const ctx = out.getContext('2d')
  ctx.drawImage(sourceCanvas, 0, 0)
  const margin = Math.round(Math.min(out.width, out.height) * 0.03)
  ctx.globalAlpha = (wm.opacity ?? 70) / 100

  if (wm.type === 'text') {
    const fontSize = Math.round(out.width * ((wm.size ?? 30) / 100) * 0.06)
    ctx.font = `700 ${fontSize}px -apple-system, sans-serif`
    const { x, y, align, baseline } = textAnchor(wm.position, out.width, out.height, margin)
    ctx.textAlign = align
    ctx.textBaseline = baseline
    ctx.lineWidth = Math.max(1, fontSize * 0.06)
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.fillStyle = '#ffffff'
    ctx.strokeText(wm.text, x, y)
    ctx.fillText(wm.text, x, y)
  } else {
    const logoW = out.width * ((wm.size ?? 30) / 100) * 0.3
    const logoH = logoW * (wm.logoImg.naturalHeight / wm.logoImg.naturalWidth)
    const { x, y } = imageAnchor(wm.position, out.width, out.height, margin, logoW, logoH)
    ctx.drawImage(wm.logoImg, x, y, logoW, logoH)
  }
  ctx.globalAlpha = 1
  return out
}

// Reads a human-readable summary of the ORIGINAL file's EXIF data (camera, exposure, date).
// Returns null if the file has no EXIF or isn't a JPEG — this is display-only, non-fatal.
export async function readExifSummary(blob) {
  if (!blob) return null
  try {
    const dataUrl = await blobToDataURL(blob)
    const exif = piexif.load(dataUrl)
    const zeroth = exif['0th'] || {}
    const ex = exif['Exif'] || {}
    const toFraction = (arr) => (Array.isArray(arr) && arr[1] ? arr[0] / arr[1] : null)

    const exposure = toFraction(ex[piexif.ExifIFD.ExposureTime])
    const fNumber = toFraction(ex[piexif.ExifIFD.FNumber])
    const focalLength = toFraction(ex[piexif.ExifIFD.FocalLength])
    const iso = ex[piexif.ExifIFD.ISOSpeedRatings]
    const dateRaw = ex[piexif.ExifIFD.DateTimeOriginal] || zeroth[piexif.ImageIFD.DateTime]

    const summary = {
      make: zeroth[piexif.ImageIFD.Make]?.trim() || null,
      model: zeroth[piexif.ImageIFD.Model]?.trim() || null,
      lens: ex[piexif.ExifIFD.LensModel]?.trim() || null,
      exposureTime: exposure ? (exposure >= 1 ? `${exposure}s` : `1/${Math.round(1 / exposure)}s`) : null,
      fNumber: fNumber ? `f/${fNumber.toFixed(1)}` : null,
      iso: iso ? `ISO ${iso}` : null,
      focalLength: focalLength ? `${Math.round(focalLength)}mm` : null,
      dateTaken: dateRaw ? dateRaw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : null,
    }
    const hasAny = Object.values(summary).some(Boolean)
    return hasAny ? summary : null
  } catch {
    return null
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/data:(.*?);/)[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// Copies EXIF metadata from the ORIGINAL uploaded file into a freshly-exported JPEG blob
// (canvas re-encoding strips it otherwise). Only works for JPEG output. Fails safe: if the
// original has no EXIF, isn't a JPEG, or piexif can't parse it, returns the blob unchanged.
export async function injectExif(newJpegBlob, originalBlob) {
  if (!originalBlob) return newJpegBlob
  try {
    const originalDataUrl = await blobToDataURL(originalBlob)
    const exifObj = piexif.load(originalDataUrl)
    // The exported pixels are already upright (orientation was applied on import), so the
    // copied tag must say "normal" — otherwise viewers rotate the photo a second time.
    if (exifObj['0th']) exifObj['0th'][piexif.ImageIFD.Orientation] = 1
    // The original's embedded thumbnail no longer matches the edited photo.
    exifObj.thumbnail = null
    exifObj['1st'] = {}
    const exifBytes = piexif.dump(exifObj)
    const newDataUrl = await blobToDataURL(newJpegBlob)
    const merged = piexif.insert(exifBytes, newDataUrl)
    return dataURLToBlob(merged)
  } catch {
    return newJpegBlob
  }
}
