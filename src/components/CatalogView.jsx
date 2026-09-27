import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { ingestPhoto, newImageId } from '../hooks/useImportPhotos'
import { releaseImages } from '../engine/imageStore'
import { unpackExtras } from '../engine/photoExtras'
import { getAllProjects, deleteProjectFromDB, savePresetToDB } from '../hooks/useProjectStore'
import { defaultSettings, migrateSettings } from '../engine/defaults'
import { defaultGeometry } from '../engine/geometry'
import Icon from './Icon.jsx'

export default function CatalogView() {
  const { state, dispatch } = useProject()
  const { toast, confirm } = useFeedback()
  const [projects, setProjects] = useState([])
  const [thumbUrls, setThumbUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(null)
  const [busyFile, setBusyFile] = useState(null) // project id being saved to the device, or 'open'
  const fileInputRef = useRef(null)

  async function refresh() {
    const rows = await getAllProjects().catch((err) => {
      console.error('Loading projects failed', err)
      toast('Could not load saved projects', { type: 'error' })
      return []
    })
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    setProjects(rows)
    setThumbUrls((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url))
      const next = {}
      rows.forEach((p) => { if (p.thumbnail) next[p.id] = URL.createObjectURL(p.thumbnail) })
      return next
    })
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmDiscard = () =>
    !state.isDirty ||
    confirm({ title: 'Discard unsaved changes?', message: 'Your current edits haven\'t been saved.', confirmLabel: 'Discard', danger: true })

  // `fromFile`: opened from a .lumagrader file — not (yet) saved in this browser.
  async function openProject(project, { fromFile = false } = {}) {
    if (opening || !(await confirmDiscard())) return
    setOpening(project.id || 'file')
    try {
      // One photo at a time (not Promise.all): decoding a whole project in parallel could
      // hold dozens of full-size images in memory at once and crash a phone tab.
      const images = []
      dispatch({ type: 'SET_IMPORT_PROGRESS', progress: { done: 0, total: project.images.length } })
      for (const imData of project.images) {
        const id = newImageId()
        const entry = await ingestPhoto(imData.blob, !!imData.isRawPreview, id)
        images.push({
          id,
          name: imData.name,
          ...entry,
          originalBlob: imData.blob,
          rating: imData.rating || 0,
          isRawPreview: !!imData.isRawPreview,
          settings: imData.settings,
          albumIds: Array.isArray(imData.albumIds) ? imData.albumIds : [],
          ...(await unpackExtras(imData)),
          history: { past: [], future: [] },
        })
        dispatch({ type: 'SET_IMPORT_PROGRESS', progress: { done: images.length, total: project.images.length } })
      }
      releaseImages(state.images, { revokeUrls: true })
      dispatch({ type: 'LOAD_PROJECT', images, albums: project.albums, projectId: fromFile ? null : project.id, projectName: project.name })
      if (fromFile) toast(`Opened "${project.name}"${project.missing ? ` — ${project.missing} photo(s) couldn't be read` : ''}. Press Save Project to keep it in this browser.`, { duration: 6000 })
    } catch (err) {
      dispatch({ type: 'SET_IMPORT_PROGRESS', progress: null })
      console.error('Opening project failed', err)
      toast(`Could not open "${project.name}"`, { type: 'error' })
    } finally {
      dispatch({ type: 'SET_IMPORT_PROGRESS', progress: null })
      setOpening(null)
    }
  }

  async function saveProjectFile(project) {
    if (busyFile) return
    setBusyFile(project.id)
    try {
      const { buildProjectFile, projectFileName, downloadBlob } = await import('../engine/projectFile')
      const file = await buildProjectFile(project, __APP_VERSION__, state.customPresets)
      downloadBlob(file, projectFileName(project.name))
      toast(`Saved "${projectFileName(project.name)}" to your device`)
    } catch (err) {
      console.error('Save to device failed', err)
      toast('Could not create the project file', { type: 'error' })
    } finally {
      setBusyFile(null)
    }
  }

  async function openProjectFile(file) {
    if (!file || busyFile) return
    setBusyFile('open')
    let project
    try {
      const { readProjectFile } = await import('../engine/projectFile')
      project = await readProjectFile(file)
    } catch (err) {
      console.warn('Reading project file failed', err)
      toast(err?.message || 'Could not open this file', { type: 'error', duration: 6000 })
      return
    } finally {
      setBusyFile(null)
    }
    await addMissingPresets(project.presets)
    await openProject(project, { fromFile: true })
  }

  // Presets saved in the file that this browser doesn't have yet (same name = keep ours).
  async function addMissingPresets(presets = {}) {
    const added = {}
    for (const [name, raw] of Object.entries(presets)) {
      if (state.customPresets[name]) continue
      // Same clean-up as an imported preset file: no crop, masks or spots in a preset.
      const settings = { ...defaultSettings(), ...migrateSettings(raw), geometry: defaultGeometry(), masks: [], spots: [] }
      try {
        await savePresetToDB(name, settings)
        added[name] = settings
      } catch (err) {
        console.warn('Could not add preset from project file', name, err)
      }
    }
    if (Object.keys(added).length) dispatch({ type: 'LOAD_CUSTOM_PRESETS', presets: added })
  }

  async function removeProject(project) {
    const ok = await confirm({ title: `Delete "${project.name}"?`, message: 'This removes the saved project from this browser. It cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await deleteProjectFromDB(project.id)
      toast(`Deleted "${project.name}"`)
    } catch (err) {
      console.error('Delete project failed', err)
      toast('Could not delete the project', { type: 'error' })
    }
    refresh()
  }

  return (
    <div className="catalog">
      <div className="catalog-header">
        <h2>Your Projects</h2>
        <div className="catalog-actions">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; openProjectFile(f) }}
        />
        <button
          type="button"
          className="action secondary"
          style={{ flex: 'none', padding: '8px 14px' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={!!opening || busyFile === 'open'}
          title="Open a .lumagrader project file from this device"
        >
          <Icon name="openFile" size={15} /> {busyFile === 'open' || opening === 'file' ? 'Opening…' : 'Open file'}
        </button>
        <button
          className="action primary"
          style={{ flex: 'none', padding: '8px 16px' }}
          onClick={async () => {
            if (!(await confirmDiscard())) return
            releaseImages(state.images, { revokeUrls: true })
            dispatch({ type: 'NEW_PROJECT' })
          }}
        >
          + New
        </button>
        </div>
      </div>
      {loading ? (
        <div className="empty">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="empty-state compact">
          <h2>No saved projects yet</h2>
          <p>Edit some photos, then press Save Project (Ctrl/⌘+S). Have a .lumagrader file? Use Open file.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {projects.map((p) => (
            <div key={p.id} className="catalog-card">
              <button type="button" className="catalog-open" onClick={() => openProject(p)} disabled={!!opening} aria-label={`Open project ${p.name}`}>
                {thumbUrls[p.id] ? <img src={thumbUrls[p.id]} alt="" /> : <div className="catalog-thumb-empty" />}
                <div className="catalog-card-info">
                  <span className="catalog-card-name">{opening === p.id ? (state.importProgress ? `Opening ${state.importProgress.done}/${state.importProgress.total}…` : 'Opening…') : p.name}</span>
                  <span className="catalog-card-count">
                    {p.images.length} photo{p.images.length === 1 ? '' : 's'} · {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
              <button
                type="button"
                className="catalog-device"
                onClick={() => saveProjectFile(p)}
                disabled={!!busyFile}
                aria-label={`Save project ${p.name} to device`}
                title="Save to device (.lumagrader file)"
              >
                {busyFile === p.id ? '…' : <Icon name="toDevice" size={13} />}
              </button>
              <button type="button" className="catalog-delete" onClick={() => removeProject(p)} aria-label={`Delete project ${p.name}`} title="Delete project">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
