import { useEffect, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { ingestPhoto, newImageId } from '../hooks/useImportPhotos'
import { releaseImages } from '../engine/imageStore'
import { getAllProjects, deleteProjectFromDB } from '../hooks/useProjectStore'

export default function CatalogView() {
  const { state, dispatch } = useProject()
  const { toast, confirm } = useFeedback()
  const [projects, setProjects] = useState([])
  const [thumbUrls, setThumbUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(null)

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

  async function openProject(project) {
    if (opening || !(await confirmDiscard())) return
    setOpening(project.id)
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
          history: { past: [], future: [] },
        })
        dispatch({ type: 'SET_IMPORT_PROGRESS', progress: { done: images.length, total: project.images.length } })
      }
      releaseImages(state.images, { revokeUrls: true })
      dispatch({ type: 'LOAD_PROJECT', images, projectId: project.id, projectName: project.name })
    } catch (err) {
      dispatch({ type: 'SET_IMPORT_PROGRESS', progress: null })
      console.error('Opening project failed', err)
      toast(`Could not open "${project.name}"`, { type: 'error' })
    } finally {
      dispatch({ type: 'SET_IMPORT_PROGRESS', progress: null })
      setOpening(null)
    }
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
      {loading ? (
        <div className="empty">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="empty-state compact">
          <h2>No saved projects yet</h2>
          <p>Edit some photos, then press Save Project (Ctrl/⌘+S).</p>
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
              <button type="button" className="catalog-delete" onClick={() => removeProject(p)} aria-label={`Delete project ${p.name}`} title="Delete project">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
