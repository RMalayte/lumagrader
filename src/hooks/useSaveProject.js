import { useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { canvasToBlob } from '../engine/imageUtils'
import { getPreview } from '../engine/imageStore'
import { saveProjectToDB, getProjectFromDB } from './useProjectStore'
import { packExtras } from '../engine/photoExtras'

export function useSaveProject() {
  const { state, dispatch } = useProject()
  const { toast, prompt } = useFeedback()
  const [saving, setSaving] = useState(false)
  const active = state.images.find((im) => im.id === state.activeId)

  // Everything a saved project holds, from the current photos.
  async function collectProject(name) {
    const thumbBlob = active ? await canvasToBlob(await getPreview(active), 0.7) : null
    const images = []
    for (const im of state.images) {
      images.push({ name: im.name, blob: im.originalBlob, rating: im.rating || 0, isRawPreview: !!im.isRawPreview, settings: im.settings, albumIds: im.albumIds || [], ...(await packExtras(im)) })
    }
    return { name, updatedAt: Date.now(), thumbnail: thumbBlob, images, albums: state.albums }
  }

  // First save asks for a name; later saves update the open project in place (like Ctrl+S
  // in any editor). Pass { rename: true } to be asked again.
  async function saveProject({ rename = false } = {}) {
    if (!state.images.length || saving) return
    let name = state.currentProjectName
    if (!name || rename) {
      name = await prompt({
        title: rename ? 'Rename project' : 'Save project',
        message: 'Saved in this browser — you can reopen it from Projects.',
        defaultValue: state.currentProjectName || '',
        placeholder: 'e.g. Baguio Ride 2026',
        confirmLabel: 'Save',
      })
      if (!name) return
    }
    setSaving(true)
    try {
      const collected = await collectProject(name)
      // If a project is already open, save updates it in place instead of creating a duplicate.
      const existing = state.currentProjectId ? await getProjectFromDB(state.currentProjectId).catch(() => null) : null
      const project = { ...collected, id: existing?.id || 'proj_' + Date.now(), createdAt: existing?.createdAt || Date.now() }
      await saveProjectToDB(project)
      dispatch({ type: 'SET_CURRENT_PROJECT', id: project.id, name: project.name })
      toast(`Project "${name}" saved`)
    } catch (err) {
      console.error('Save project failed', err)
      const quota = err?.name === 'QuotaExceededError'
      toast(quota ? 'Not enough browser storage to save this project' : 'Could not save the project — your edits are still here', { type: 'error', duration: 7000 })
    } finally {
      setSaving(false)
    }
  }

  /** Saves the current photos + edits as a .lumagrader file on the device. */
  async function saveToDevice() {
    if (!state.images.length || saving) return
    let name = state.currentProjectName
    if (!name) {
      name = await prompt({
        title: 'Save to device',
        message: 'Saves one file with your original photos and all edits. Open it later from Projects → Open file.',
        defaultValue: '',
        placeholder: 'e.g. Baguio Ride 2026',
        confirmLabel: 'Save',
      })
      if (!name) return
    }
    setSaving(true)
    try {
      const { buildProjectFile, projectFileName, downloadBlob } = await import('../engine/projectFile')
      const project = await collectProject(name)
      const file = await buildProjectFile({ ...project, createdAt: project.updatedAt }, __APP_VERSION__, state.customPresets)
      const fileName = projectFileName(name)
      downloadBlob(file, fileName)
      toast(`Saved "${fileName}" to your device`)
    } catch (err) {
      console.error('Save to device failed', err)
      toast('Could not create the project file — your edits are still here', { type: 'error', duration: 7000 })
    } finally {
      setSaving(false)
    }
  }

  return { saveProject, saveToDevice, saving, hasImages: state.images.length > 0 }
}
