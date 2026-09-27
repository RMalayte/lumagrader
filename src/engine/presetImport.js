// Preset import for the Grade presets panel: .xmp, .dng (Lightroom Mobile), .lrtemplate,
// LumaGrader .json bundles and .zip packs of any of these.
//
// The file picker has no type filter (iPad/Android grey out extensions they don't know,
// e.g. .xmp, .lrtemplate), so every file is recognised by its CONTENT and anything else is
// reported, not trusted.

import { defaultSettings, migrateSettings } from './defaults'
import { defaultGeometry } from './geometry'

const MB = 1024 * 1024
const MAX_TEXT_BYTES = 2 * MB // .xmp / .lrtemplate / .json
const MAX_DNG_BYTES = 120 * MB
const MAX_ZIP_BYTES = 300 * MB
const MAX_ZIP_ENTRIES = 500
const MAX_ZIP_TOTAL = 600 * MB // uncompressed, all entries

const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b)
const baseName = (path) => String(path).replace(/^.*[\\/]/, '')

/** 'zip' | 'dng' | 'text' from the first bytes (TIFF-based DNG: "II*\0" or "MM\0*"). */
function sniff(bytes) {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'dng'
  return 'text'
}

/**
 * Reads preset files. Returns { presets: [{ name, settings }], notes: [..], failures: [..] }.
 * `taken` = names already used (made unique with " (2)" etc.).
 */
export async function importPresetFiles(files, taken = new Set()) {
  const used = new Set(taken)
  const uniqueName = (base) => {
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`
    used.add(name)
    return name
  }
  const presets = []
  const notes = new Set()
  const failures = []
  const zipBudget = { entries: 0, bytes: 0 }

  async function handle(name, bytes, fromZip) {
    const kind = sniff(bytes)
    if (kind === 'zip') {
      if (fromZip) throw new Error('Zip files inside a zip are not opened.')
      return handleZip(name, bytes)
    }
    if (kind === 'dng') {
      if (bytes.length > MAX_DNG_BYTES) throw new Error('File is too large.')
      const { parseDngPreset } = await import('./xmpPreset')
      return addXmpResult(parseDngPreset(bytes, name))
    }
    if (bytes.length > MAX_TEXT_BYTES) throw new Error('File is too large to be a preset.')
    const text = new globalThis.TextDecoder('utf-8').decode(bytes)
    const head = text.slice(0, 4000)
    if (/^\s*(--[^\n]*\n\s*)*s\s*=\s*\{/.test(text)) {
      const { parseLrTemplate } = await import('./xmpPreset')
      return addXmpResult(parseLrTemplate(text, name))
    }
    if (/<x:xmpmeta|camera-raw-settings|<\?xpacket/.test(head)) {
      const { parseXmpPreset } = await import('./xmpPreset')
      return addXmpResult(parseXmpPreset(text, name))
    }
    if (/^\s*\{/.test(text)) return addJsonBundle(text)
    throw new Error('Not a preset file (.xmp, .dng, .lrtemplate, .json or .zip).')
  }

  function addXmpResult(result) {
    presets.push({ name: uniqueName(result.name), settings: result.settings })
    result.partial.forEach((p) => notes.add(p))
    result.skipped.forEach((p) => notes.add(`${p} — not supported`))
  }

  function addJsonBundle(text) {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not a presets file.')
    let count = 0
    // Only accept entries that look like settings objects — the file is user-provided.
    for (const [name, settings] of Object.entries(parsed)) {
      if (typeof name !== 'string' || name.length > 80 || !settings || typeof settings !== 'object' || Array.isArray(settings)) continue
      presets.push({ name: uniqueName(name), settings: { ...defaultSettings(), ...migrateSettings(settings), geometry: defaultGeometry(), masks: [], spots: [] } })
      count++
    }
    if (!count) throw new Error('No presets in this file.')
  }

  async function handleZip(zipName, bytes) {
    if (bytes.length > MAX_ZIP_BYTES) throw new Error('Zip file is too large.')
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    const entries = Object.values(zip.files).filter((f) => {
      if (f.dir) return false
      const b = baseName(f.name)
      return !f.name.startsWith('__MACOSX/') && !b.startsWith('.') && /\.(xmp|lrtemplate|dng|json)$/i.test(b)
    })
    if (!entries.length) throw new Error('No presets (.xmp, .dng, .lrtemplate) inside this zip.')
    let found = 0
    for (const entry of entries) {
      if (++zipBudget.entries > MAX_ZIP_ENTRIES) { notes.add(`Only the first ${MAX_ZIP_ENTRIES} presets of a zip are imported`); break }
      try {
        const data = await entry.async('uint8array')
        zipBudget.bytes += data.length
        if (zipBudget.bytes > MAX_ZIP_TOTAL) throw new Error('Zip contents are too large.')
        const before = presets.length
        await handle(baseName(entry.name), data, true)
        found += presets.length - before
      } catch (err) {
        failures.push(`${zipName} › ${baseName(entry.name)}: ${err.message || 'could not be read'}`)
        if (zipBudget.bytes > MAX_ZIP_TOTAL) break
      }
    }
    if (!found && !failures.length) throw new Error('No presets inside this zip.')
  }

  for (const file of files) {
    try {
      if (file.size > MAX_ZIP_BYTES) throw new Error('File is too large.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      await handle(file.name, bytes, false)
    } catch (err) {
      failures.push(`${file.name}: ${err.message || 'could not be read'}`)
    }
  }
  return { presets, notes: [...notes], failures }
}
