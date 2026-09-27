// IndexedDB-backed persistence for user-saved presets and projects.
// Kept as 'lumagrade' on purpose after the LumaGrader rename: changing it would orphan
// every project and preset users already saved in this browser.
const DB_NAME = 'lumagrade'
const PRESETS_STORE = 'presets'
const PROJECTS_STORE = 'projects'
const SESSION_STORE = 'session' // one record: the unsaved working session (crash/close recovery)
const SESSION_FILES = 'sessionFiles' // that session's original photo files, written once per photo
const VERSION = 3

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PRESETS_STORE)) db.createObjectStore(PRESETS_STORE, { keyPath: 'name' })
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(SESSION_FILES)) db.createObjectStore(SESSION_FILES, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Asks the browser to keep this site's storage (presets, projects) instead of clearing it
 * when the device runs low on space. Chrome grants it silently for sites people use or
 * install; elsewhere it's a harmless no-op.
 */
export function requestPersistentStorage() {
  try {
    navigator.storage?.persist?.().catch(() => {})
  } catch {
    // not supported
  }
}

// Presets are also mirrored in localStorage: if the IndexedDB copy is ever lost or can't be
// opened, they come back from the mirror (and the other way round).
const PRESET_BACKUP_KEY = 'lumagrader.presetsBackup'

function readPresetBackup() {
  try {
    const v = JSON.parse(window.localStorage.getItem(PRESET_BACKUP_KEY) || 'null')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

function writePresetBackup(map) {
  try {
    window.localStorage.setItem(PRESET_BACKUP_KEY, JSON.stringify(map))
  } catch {
    // storage full or blocked — IndexedDB still has them
  }
}

/** All saved presets as { name: settings }, from IndexedDB merged with the backup mirror. */
export async function loadPresets() {
  const backup = readPresetBackup()
  let rows = null
  try {
    rows = await getAllPresets()
  } catch (err) {
    console.warn('Reading presets from IndexedDB failed — using the backup copy', err)
  }
  if (!rows) return backup
  const map = Object.fromEntries(rows.map((r) => [r.name, r.settings]))
  const onlyInBackup = Object.keys(backup).filter((name) => !(name in map))
  for (const name of onlyInBackup) {
    map[name] = backup[name]
    await putPreset(name, backup[name]).catch(() => {})
  }
  writePresetBackup(map)
  return map
}

async function getAllPresets() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(PRESETS_STORE, 'readonly').objectStore(PRESETS_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function savePresetToDB(name, settings) {
  await putPreset(name, settings)
  writePresetBackup({ ...readPresetBackup(), [name]: settings })
  requestPersistentStorage()
}

async function putPreset(name, settings) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRESETS_STORE, 'readwrite')
    tx.objectStore(PRESETS_STORE).put({ name, settings })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deletePresetFromDB(name) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PRESETS_STORE, 'readwrite')
    tx.objectStore(PRESETS_STORE).delete(name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  const backup = readPresetBackup()
  delete backup[name]
  writePresetBackup(backup)
}

export async function getAllProjects() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(PROJECTS_STORE, 'readonly').objectStore(PROJECTS_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getProjectFromDB(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(PROJECTS_STORE, 'readonly').objectStore(PROJECTS_STORE).get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveProjectToDB(project) {
  requestPersistentStorage()
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, 'readwrite')
    tx.objectStore(PROJECTS_STORE).put(project)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteProjectFromDB(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, 'readwrite')
    tx.objectStore(PROJECTS_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---- Unsaved-session recovery --------------------------------------------------------
// Browsers (especially iOS Safari and installed PWAs) often close a tab without showing the
// "unsaved changes" warning, so the working session is mirrored here while it's unsaved.

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Writes photo files not stored yet, the session record, and drops files of removed photos. */
export async function writeSession(record, files) {
  const db = await openDB()
  const existing = await new Promise((resolve, reject) => {
    const req = db.transaction(SESSION_FILES, 'readonly').objectStore(SESSION_FILES).getAllKeys()
    req.onsuccess = () => resolve(new Set(req.result))
    req.onerror = () => reject(req.error)
  })
  // Files one per transaction: a 30 MB RAW is fine, 20 of them in one transaction may not be.
  for (const f of files) {
    if (existing.has(f.id)) continue
    const tx = db.transaction(SESSION_FILES, 'readwrite')
    tx.objectStore(SESSION_FILES).put(f)
    await txDone(tx)
  }
  const keep = new Set(record.images.map((im) => im.id))
  const tx = db.transaction([SESSION_STORE, SESSION_FILES], 'readwrite')
  tx.objectStore(SESSION_STORE).put({ key: 'current', ...record })
  for (const id of existing) if (!keep.has(id)) tx.objectStore(SESSION_FILES).delete(id)
  await txDone(tx)
}

export async function readSession() {
  const db = await openDB()
  const record = await new Promise((resolve, reject) => {
    const req = db.transaction(SESSION_STORE, 'readonly').objectStore(SESSION_STORE).get('current')
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
  if (!record?.images?.length) return null
  return record
}

export async function readSessionFile(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(SESSION_FILES, 'readonly').objectStore(SESSION_FILES).get(id)
    req.onsuccess = () => resolve(req.result?.blob || null)
    req.onerror = () => reject(req.error)
  })
}

export async function clearSession() {
  const db = await openDB()
  const tx = db.transaction([SESSION_STORE, SESSION_FILES], 'readwrite')
  tx.objectStore(SESSION_STORE).clear()
  tx.objectStore(SESSION_FILES).clear()
  await txDone(tx)
}
