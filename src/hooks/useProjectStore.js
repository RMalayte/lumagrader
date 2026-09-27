// IndexedDB-backed persistence for user-saved presets and projects.
// Kept as 'lumagrade' on purpose after the LumaGrader rename: changing it would orphan
// every project and preset users already saved in this browser.
const DB_NAME = 'lumagrade'
const PRESETS_STORE = 'presets'
const PROJECTS_STORE = 'projects'
const VERSION = 2

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PRESETS_STORE)) db.createObjectStore(PRESETS_STORE, { keyPath: 'name' })
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getAllPresets() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(PRESETS_STORE, 'readonly').objectStore(PRESETS_STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function savePresetToDB(name, settings) {
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRESETS_STORE, 'readwrite')
    tx.objectStore(PRESETS_STORE).delete(name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
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
