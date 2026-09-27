import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import ThumbnailStrip from './components/ThumbnailStrip.jsx'
import CanvasPreview from './components/CanvasPreview.jsx'
import ControlsPanel from './components/ControlsPanel.jsx'
import EditActionsBar from './components/EditActionsBar.jsx'
import Icon from './components/Icon.jsx'
import { useProject } from './store/ProjectContext.jsx'
import { useSaveProject } from './hooks/useSaveProject.js'
import { shouldIgnoreShortcut, isMod } from './engine/keyboard.js'
import { useMediaQuery, MOBILE_QUERY } from './hooks/useMediaQuery.js'
import logo from './assets/logo-wordmark.webp'

// Loaded on first use to keep the initial download small.
const CatalogView = lazy(() => import('./components/CatalogView.jsx'))
const ShortcutsHelp = lazy(() => import('./components/ShortcutsHelp.jsx'))

const VIEW_MODES = [
  { mode: 'filmstrip', label: 'Filmstrip', icon: 'filmstrip' },
  { mode: 'loupe', label: 'Loupe', icon: 'loupe' },
  { mode: 'catalog', label: 'Projects', icon: 'grid' },
]

// Mobile: the filmstrip is hidden by default so the photo gets the room (like Lightroom
// Mobile); a toolbar button shows it, and swiping the photo changes photos. Remembered.
const STRIP_KEY = 'lumagrader.mobileStrip'
function readStripPref() {
  try { return window.localStorage.getItem(STRIP_KEY) === '1' } catch { return false }
}

export default function App() {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [stripOpen, setStripOpen] = useState(readStripPref)
  const toggleStrip = useCallback(() => {
    setStripOpen((open) => {
      try { window.localStorage.setItem(STRIP_KEY, open ? '0' : '1') } catch { /* private mode */ }
      return !open
    })
  }, [])
  const { state, dispatch, undo, redo } = useProject()
  const { saveProject, saving, hasImages } = useSaveProject()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const closeShortcuts = useCallback(() => setShowShortcuts(false), [])

  // Global shortcuts. Canvas-specific keys live in CanvasPreview; export/remove in EditActionsBar.
  useEffect(() => {
    function onKeyDown(e) {
      if (shouldIgnoreShortcut(e)) return
      const key = e.key.toLowerCase()

      if (isMod(e) && key === 'z' && state.activeId) {
        e.preventDefault()
        if (e.shiftKey) redo(state.activeId)
        else undo(state.activeId)
        return
      }
      if (isMod(e) && key === 'y' && state.activeId) {
        e.preventDefault()
        redo(state.activeId)
        return
      }
      if (isMod(e) && key === 's') {
        e.preventDefault()
        saveProject()
        return
      }
      if (isMod(e) || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.images.length) {
        e.preventDefault()
        const idx = state.images.findIndex((im) => im.id === state.activeId)
        const next = e.key === 'ArrowRight' ? Math.min(state.images.length - 1, idx + 1) : Math.max(0, idx - 1)
        if (state.images[next]) dispatch({ type: 'SET_ACTIVE', id: state.images[next].id })
        return
      }
      if (/^[0-5]$/.test(e.key) && state.activeId) {
        e.preventDefault()
        dispatch({ type: 'SET_RATING', id: state.activeId, rating: Number(e.key) })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    function onBeforeUnload(e) {
      if (!state.isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state.isDirty])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <img src={logo} alt="LumaGrader by Rax" className="app-logo" width="508" height="120" />
          {state.currentProjectName && (
            <button type="button" className="project-name" onClick={() => saveProject({ rename: true })} title="Rename project">
              {state.currentProjectName}
              {state.isDirty && <span className="unsaved-dot" aria-label="unsaved changes" />}
            </button>
          )}
        </div>
        <nav className="view-toggle" aria-label="View">
          {VIEW_MODES.map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              className={'tbtn' + (state.viewMode === mode ? ' active' : '')}
              aria-pressed={state.viewMode === mode}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode })}
              title={label}
            >
              <Icon name={icon} size={15} />
              <span className="btn-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="header-right">
          {state.viewMode !== 'catalog' && <EditActionsBar />}
          <button
            type="button"
            className={'tbtn' + (state.isDirty ? ' has-changes' : '')}
            onClick={() => saveProject()}
            disabled={saving || !hasImages}
            title="Save project (Ctrl/⌘+S)"
          >
            <Icon name="save" size={15} />
            <span className="btn-label">{saving ? 'Saving…' : state.isDirty || !state.currentProjectId ? 'Save Project' : 'Saved'}</span>
            {state.isDirty && !saving && <span className="unsaved-dot" aria-label="unsaved changes" />}
          </button>
          <button type="button" className="tbtn icon-only hide-mobile" onClick={() => setShowShortcuts(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)">
            <Icon name="keyboard" size={16} />
          </button>
        </div>
      </header>
      <main className={'app-main view-' + state.viewMode}>
        {state.viewMode === 'catalog' ? (
          <Suspense fallback={<div className="empty"><span className="spinner" /></div>}>
            <CatalogView />
          </Suspense>
        ) : (
          <>
            {state.viewMode !== 'loupe' && (!isMobile || stripOpen) && <ThumbnailStrip />}
            <CanvasPreview
              stripOpen={stripOpen}
              onToggleStrip={isMobile && state.viewMode !== 'loupe' ? toggleStrip : null}
            />
            {state.viewMode !== 'loupe' && <ControlsPanel />}
          </>
        )}
      </main>
      {showShortcuts && (
        <Suspense fallback={null}>
          <ShortcutsHelp onClose={closeShortcuts} />
        </Suspense>
      )}
    </div>
  )
}
