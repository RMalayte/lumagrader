import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { ingestPhoto } from './useImportPhotos'
import { writeSession, readSession, readSessionFile, clearSession } from './useProjectStore'

const AUTOSAVE_DELAY = 1500 // ms after the last change

/**
 * Protects unsaved work:
 *  1. While the session has unsaved changes, it is mirrored to IndexedDB (debounced, and
 *     flushed immediately when the page is hidden / closed — the only moment phones give us).
 *  2. On the next start, if such a session exists, the user is asked to restore or discard it.
 *  3. Saving the project (or starting a new one) clears the mirror.
 * The "Leave site?" warning (beforeunload) stays in App.jsx for browsers that show it.
 */
export function useSessionRecovery() {
  const { state, dispatch } = useProject()
  const { toast, confirm } = useFeedback()
  const [ready, setReady] = useState(false) // no autosave/clear until the restore offer is resolved
  const timerRef = useRef(null)
  const stateRef = useRef(state)
  const warnedRef = useRef(false)
  const hasMirrorRef = useRef(false)
  stateRef.current = state

  // 1) On start: offer to restore.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let record = null
      try { record = await readSession() } catch (err) { console.warn('Session recovery unavailable', err) }
      if (cancelled) return
      if (!record || stateRef.current.images.length) {
        setReady(true)
        return
      }
      hasMirrorRef.current = true
      const when = new Date(record.savedAt).toLocaleString()
      const n = record.images.length
      const ok = await confirm({
        title: 'Restore unsaved edits?',
        message: `${n} photo${n === 1 ? '' : 's'}${record.projectName ? ` from "${record.projectName}"` : ''} ${n === 1 ? "wasn't" : "weren't"} saved before the app closed (${when}).`,
        confirmLabel: 'Restore',
        cancelLabel: 'Discard',
      })
      if (cancelled) return
      if (ok) await restore(record)
      else await clearSession().catch(() => {})
      hasMirrorRef.current = ok
      setReady(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function restore(record) {
    const images = []
    dispatch({ type: 'SET_IMPORT_PROGRESS', progress: { done: 0, total: record.images.length } })
    try {
      for (const im of record.images) {
        const blob = await readSessionFile(im.id)
        if (!blob) continue
        const entry = await ingestPhoto(blob, !!im.isRawPreview, im.id)
        images.push({
          id: im.id,
          name: im.name,
          ...entry,
          originalBlob: blob,
          rating: im.rating || 0,
          isRawPreview: !!im.isRawPreview,
          settings: im.settings,
          history: { past: [], future: [] },
        })
        dispatch({ type: 'SET_IMPORT_PROGRESS', progress: { done: images.length, total: record.images.length } })
      }
      if (!images.length) throw new Error('No photo files in the recovery data')
      dispatch({ type: 'LOAD_PROJECT', images, projectId: record.projectId || null, projectName: record.projectName || null })
      if (record.activeId && images.some((im) => im.id === record.activeId)) dispatch({ type: 'SET_ACTIVE', id: record.activeId })
      dispatch({ type: 'MARK_DIRTY' })
      toast(`Restored ${images.length} photo${images.length === 1 ? '' : 's'} — save the project to keep them`)
    } catch (err) {
      console.error('Restore failed', err)
      toast('Could not restore the unsaved session', { type: 'error' })
    } finally {
      dispatch({ type: 'SET_IMPORT_PROGRESS', progress: null })
    }
  }

  async function flush() {
    clearTimeout(timerRef.current)
    const s = stateRef.current
    try {
      if (!s.isDirty || !s.images.length) {
        if (hasMirrorRef.current) {
          hasMirrorRef.current = false
          await clearSession()
        }
        return
      }
      const record = {
        savedAt: Date.now(),
        projectId: s.currentProjectId,
        projectName: s.currentProjectName,
        activeId: s.activeId,
        images: s.images.map((im) => ({ id: im.id, name: im.name, rating: im.rating || 0, isRawPreview: !!im.isRawPreview, settings: im.settings })),
      }
      const files = s.images.map((im) => ({ id: im.id, name: im.name, blob: im.originalBlob }))
      hasMirrorRef.current = true
      await writeSession(record, files)
    } catch (err) {
      console.warn('Autosave for recovery failed', err)
      if (!warnedRef.current) {
        warnedRef.current = true
        const quota = err?.name === 'QuotaExceededError'
        toast(quota ? 'Not enough storage for crash recovery — remember to Save Project' : 'Crash recovery unavailable — remember to Save Project', { type: 'error', duration: 7000 })
      }
    }
  }

  // 2) Mirror changes (debounced).
  useEffect(() => {
    if (!ready) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, state.isDirty ? AUTOSAVE_DELAY : 0)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.images, state.isDirty, state.activeId, state.currentProjectId, state.currentProjectName])

  // 3) Flush right away when the page is hidden or closed (app switch, tab close, swipe away).
  useEffect(() => {
    if (!ready) return
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}
