import exifr from 'exifr'

// Camera settings summary for the Photo Info panel. exifr reads only the metadata segments
// it needs (works for JPEG and TIFF-based RAW) — the old JPEG path converted the WHOLE file
// to a data URL every time the active photo changed. Loaded lazily (dynamic import).

function formatExposure(seconds) {
  if (!seconds) return null
  return seconds >= 1 ? `${seconds}s` : `1/${Math.round(1 / seconds)}s`
}

function formatDate(d) {
  if (!d) return null
  if (d instanceof Date && !isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return typeof d === 'string' ? d.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : null
}

export async function readExifSummary(file) {
  if (!file) return null
  try {
    const data = await exifr.parse(file, {
      tiff: true, exif: true, ifd0: true, gps: false, xmp: false, icc: false, iptc: false, jfif: false,
      pick: ['Make', 'Model', 'LensModel', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'DateTimeOriginal', 'DateTime'],
    })
    if (!data) return null
    const summary = {
      make: data.Make?.trim?.() || data.Make || null,
      model: data.Model?.trim?.() || data.Model || null,
      lens: data.LensModel || null,
      exposureTime: formatExposure(data.ExposureTime),
      fNumber: data.FNumber ? `f/${Number(data.FNumber).toFixed(1)}` : null,
      iso: data.ISO ? `ISO ${data.ISO}` : null,
      focalLength: data.FocalLength ? `${Math.round(data.FocalLength)}mm` : null,
      dateTaken: formatDate(data.DateTimeOriginal || data.DateTime),
    }
    return Object.values(summary).some(Boolean) ? summary : null
  } catch {
    return null
  }
}
