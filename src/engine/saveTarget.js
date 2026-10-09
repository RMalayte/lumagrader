// Where exported files go.
// Chrome / Edge on computers (also the installed app) let a web app ask for a file name and a
// folder (File System Access API: showSaveFilePicker / showDirectoryPicker). Other browsers and
// phones only support a plain download to the Downloads folder — the name we pick is used there.

export const canPickFile = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
export const canPickFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

const PICKER_ID = 'lumagrader-export' // the browser remembers the last folder per id

/** A file name that every OS accepts (no path characters, no trailing dots/spaces). */
export function safeFileName(name, fallback = 'photo') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .split('').filter((ch) => ch.charCodeAt(0) >= 32).join('') // no control characters
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  return cleaned || fallback
}

/** `base` without a trailing ".ext" the user may have typed. */
export const stripExt = (base, ext) => base.replace(new RegExp(`\\.${ext}$`, 'i'), '')

export const isAbort = (err) => err?.name === 'AbortError'

/**
 * Opens "Save as…" for one file. Must be called straight from a click (before any slow work).
 * Returns a handle, or null when the browser can't (→ plain download). Throws AbortError on cancel.
 */
export async function pickSaveFile(suggestedName, mime, ext) {
  if (!canPickFile()) return null
  return window.showSaveFilePicker({
    id: PICKER_ID,
    startIn: 'pictures',
    suggestedName,
    types: [{ description: ext.toUpperCase() + ' file', accept: { [mime]: ['.' + ext] } }],
  })
}

/** Opens a folder picker (several separate files). Throws AbortError on cancel. */
export async function pickFolder() {
  return window.showDirectoryPicker({ id: PICKER_ID, mode: 'readwrite', startIn: 'pictures' })
}

export async function writeToHandle(handle, blob) {
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/** Writes `blob` as `name` in a picked folder, never overwriting: "name (2).jpg" if taken. */
export async function writeToFolder(dir, name, blob) {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let final = name
  for (let n = 2; n < 1000; n++) {
    try {
      await dir.getFileHandle(final) // exists → try the next number
      final = `${base} (${n})${ext}`
    } catch {
      break
    }
  }
  await writeToHandle(await dir.getFileHandle(final, { create: true }), blob)
  return final
}

/** Plain browser download (Downloads folder). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
