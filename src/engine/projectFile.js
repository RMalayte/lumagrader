// Project files (.lumagrader) — a whole project saved to the device, to back it up, move it to
// another device/browser, or free up browser storage. A .lumagrader file is a ZIP:
//   project.json          name, dates, albums, and per photo: settings, rating, snapshots,
//                         albums, file names
//   thumbnail.jpg         project thumbnail (optional)
//   photos/001-name.ext   the ORIGINAL photo files, untouched
//   brushes/<maskId>.png  painted brush-mask pixels
// project.json also carries the user's saved presets, so they travel with the file.
// Opening one goes through the same path as opening a project saved in the browser.
import JSZip from 'jszip'

export const PROJECT_FILE_EXT = '.lumagrader'
const FORMAT = 'lumagrader-project'
const FORMAT_VERSION = 1
const MAX_JSON_BYTES = 20 * 1024 * 1024
const MAX_PHOTOS = 2000

const safeName = (name, fallback) =>
  Array.from(String(name || fallback), (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('').replace(/^\.+/, '').slice(0, 120) || fallback

/** File name for a project: "Baguio Ride 2026.lumagrader". */
export const projectFileName = (name) => safeName(name, 'LumaGrader project') + PROJECT_FILE_EXT

/**
 * Builds the .lumagrader file. `project` has the shape saved in the browser:
 * { name, createdAt, updatedAt, thumbnail?, images: [{ name, blob, rating, isRawPreview,
 *   settings, snapshots, brushes: { maskId: Blob } }] }
 */
export async function buildProjectFile(project, appVersion = '', presets = {}) {
  const zip = new JSZip()
  const images = project.images.map((im, i) => {
    const file = `photos/${String(i + 1).padStart(3, '0')}-${safeName(im.name, 'photo')}`
    // Photos are already compressed — store them as is (fast, no size gain from deflate).
    zip.file(file, im.blob, { compression: 'STORE' })
    const brushes = {}
    for (const [maskId, blob] of Object.entries(im.brushes || {})) {
      const path = `brushes/${safeName(maskId, 'mask')}.png`
      zip.file(path, blob, { compression: 'STORE' })
      brushes[maskId] = path
    }
    return {
      name: im.name,
      file,
      type: im.blob?.type || '',
      rating: im.rating || 0,
      isRawPreview: !!im.isRawPreview,
      settings: im.settings,
      snapshots: im.snapshots || [],
      albumIds: im.albumIds || [],
      brushes,
    }
  })
  if (project.thumbnail) zip.file('thumbnail.jpg', project.thumbnail, { compression: 'STORE' })
  const meta = { format: FORMAT, version: FORMAT_VERSION, app: appVersion, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt, albums: project.albums || [], images, presets }
  zip.file('project.json', JSON.stringify(meta))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Reads a .lumagrader file back into the browser-project shape. Throws an Error with a
 * user-readable message when the file isn't a valid LumaGrader project.
 */
export async function readProjectFile(file) {
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('This isn\'t a LumaGrader project file.')
  }
  const metaEntry = zip.file('project.json')
  if (!metaEntry) throw new Error('This isn\'t a LumaGrader project file.')
  const text = await metaEntry.async('string')
  if (text.length > MAX_JSON_BYTES) throw new Error('This project file is damaged.')
  let meta
  try {
    meta = JSON.parse(text)
  } catch {
    throw new Error('This project file is damaged.')
  }
  if (!isPlainObject(meta) || meta.format !== FORMAT || !Array.isArray(meta.images)) throw new Error('This isn\'t a LumaGrader project file.')
  if (Number(meta.version) > FORMAT_VERSION) throw new Error('This project was saved by a newer LumaGrader — please update the app.')
  if (!meta.images.length || meta.images.length > MAX_PHOTOS) throw new Error('This project file has no photos.')

  const images = []
  let missing = 0
  for (const im of meta.images) {
    const entry = isPlainObject(im) && typeof im.file === 'string' ? zip.file(im.file) : null
    if (!entry) { missing++; continue }
    const name = safeName(im.name, 'photo')
    const data = await entry.async('blob')
    const blob = new globalThis.File([data], name, { type: typeof im.type === 'string' ? im.type : '' })
    const brushes = {}
    if (isPlainObject(im.brushes)) {
      for (const [maskId, path] of Object.entries(im.brushes)) {
        const b = typeof path === 'string' ? zip.file(path) : null
        if (b) brushes[maskId] = new Blob([await b.async('blob')], { type: 'image/png' })
      }
    }
    images.push({
      name,
      blob,
      rating: Math.max(0, Math.min(5, Math.round(Number(im.rating) || 0))),
      isRawPreview: !!im.isRawPreview,
      settings: isPlainObject(im.settings) ? im.settings : {},
      snapshots: Array.isArray(im.snapshots) ? im.snapshots.filter((s) => isPlainObject(s) && isPlainObject(s.settings)) : [],
      albumIds: Array.isArray(im.albumIds) ? im.albumIds.filter((a) => typeof a === 'string') : [],
      brushes,
    })
  }
  if (!images.length) throw new Error('This project file is damaged (no photos could be read).')

  const albums = Array.isArray(meta.albums)
    ? meta.albums.filter((a) => isPlainObject(a) && typeof a.id === 'string' && typeof a.name === 'string').map((a) => ({ id: a.id.slice(0, 80), name: a.name.slice(0, 80) }))
    : []

  const presets = {}
  if (isPlainObject(meta.presets)) {
    for (const [name, settings] of Object.entries(meta.presets)) {
      if (name && name.length <= 80 && isPlainObject(settings)) presets[name] = settings
    }
  }

  const thumbEntry = zip.file('thumbnail.jpg')
  const now = Date.now()
  return {
    name: safeName(meta.name, 'Imported project'),
    createdAt: Number(meta.createdAt) || now,
    updatedAt: Number(meta.updatedAt) || now,
    thumbnail: thumbEntry ? new Blob([await thumbEntry.async('blob')], { type: 'image/jpeg' }) : null,
    images,
    albums,
    missing,
    presets,
  }
}

/** Hands a file to the user: the browser's download (Files / Downloads on phones). */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
