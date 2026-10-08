import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import ThumbnailStrip from './components/ThumbnailStrip.jsx'
import CanvasPreview from './components/CanvasPreview.jsx'
import ControlsPanel from './components/ControlsPanel.jsx'
import EditActionsBar from './components/EditActionsBar.jsx'
import MoreMenu from './components/MoreMenu.jsx'
import Icon from './components/Icon.jsx'
import { useProject, visibleImages } from './store/ProjectContext.jsx'
import { useSaveProject } from './hooks/useSaveProject.js'
import { shouldIgnoreShortcut, isMod } from './engine/keyboard.js'
import { useMediaQuery, MOBILE_QUERY } from './hooks/useMediaQuery.js'
import { useSessionRecovery } from './hooks/useSessionRecovery.js'
import { loadPresets } from './hooks/useProjectStore.js'
import logo from './assets/logo-wordmark.webp'

// Loaded on first use to keep the initial download small.
const CatalogView = lazy(() => import('./components/CatalogView.jsx'))
const ShortcutsHelp = lazy(() => import('./components/ShortcutsHelp.jsx'))
const AboutDialog = lazy(() => import('./components/AboutDialog.jsx'))
import { kofiUrl } from './config.js'
import WhatsNew from './components/WhatsNew.jsx'

const VIEW_MODES = [
  { mode: 'filmstrip', label: 'Edit', icon: 'filmstrip', title: 'Edit — filmstrip, photo and panels' },
  { mode: 'loupe', label: 'Loupe', icon: 'loupe', title: 'Loupe — the photo only' },
  { mode: 'catalog', label: 'Projects', icon: 'grid', title: 'Projects — saved projects' },
]

// Desktop layout preferences, remembered per browser.
const LAYOUT_KEY = 'lumagrader.layout'
const THUMB_SIZES = [{ label: 'S', px: 48 }, { label: 'M', px: 64 }, { label: 'L', px: 96 }, { label: 'XL', px: 128 }]
const PANEL_MIN = 260, PANEL_MAX = 520
function readLayout() {
  const def = { panelW: 300, strip: true, stripPos: 'left', thumb: 64 }
  try { return { ...def, ...JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || '{}') } } catch { return def }
}

// Mobile: the filmstrip is hidden by default so the photo gets the room (like Lightroom
// Mobile); a toolbar button shows it, and swiping the photo changes photos. Remembered.
const STRIP_KEY = 'lumagrader.mobileStrip'
function readStripPref() {
  try { return window.localStorage.getItem(STRIP_KEY) === '1' } catch { return false }
}

/** Drag handle between the photo and the editing panel (desktop). Double-click = default width. */
function PanelResizer({ width, onResize }) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef(null)
  function onPointerDown(e) {
    e.preventDefault()
    startRef.current = { x: e.clientX, w: width }
    setDragging(true)
    const move = (ev) => {
      const w = startRef.current.w - (ev.clientX - startRef.current.x)
      onResize(Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w))))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function onKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    onResize(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width + (e.key === 'ArrowLeft' ? 20 : -20))))
  }
  return (
    <div
      className={'panel-resizer' + (dragging ? ' is-dragging' : '')}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editing panel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize the panel · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(300)}
      onKeyDown={onKeyDown}
    />
  )
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
  useSessionRecovery()
  const [layout, setLayoutState] = useState(readLayout)
  const setLayout = useCallback((patch) => {
    setLayoutState((cur) => {
      const next = { ...cur, ...patch }
      try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }, [])

  // Saved presets load once at startup, whichever panel or tab is open.
  useEffect(() => {
    loadPresets()
      .then((presets) => dispatch({ type: 'LOAD_CUSTOM_PRESETS', presets }))
      .catch((err) => console.warn('Loading presets failed', err))
  }, [dispatch])
  const activePhoto = state.images.find((im) => im.id === state.activeId)
  const editingPhoto = !!activePhoto && state.viewMode !== 'catalog'
  const { saveProject, saveToDevice, saving, justSaved, hasImages } = useSaveProject()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const closeAbout = useCallback(() => setShowAbout(false), [])
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
      const shown = visibleImages(state)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && shown.length) {
        e.preventDefault()
        const idx = shown.findIndex((im) => im.id === state.activeId)
        const next = e.key === 'ArrowRight' ? Math.min(shown.length - 1, idx + 1) : Math.max(0, idx - 1)
        if (shown[next]) dispatch({ type: 'SET_ACTIVE', id: shown[next].id })
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

  const showPhotoActions = state.viewMode !== 'catalog' && !!activePhoto
  const showStrip = state.viewMode !== 'loupe' && (isMobile ? stripOpen : layout.strip)
  const stripBottom = !isMobile && layout.stripPos === 'bottom'

  // Secondary commands, in the header's "⋯" menu.
  const appItems = [
    // Mobile: the view switch is hidden while editing, so it lives here too.
    ...(isMobile && editingPhoto
      ? [{ heading: 'View' }, ...VIEW_MODES.map((v) => ({ label: v.label, icon: v.icon, current: state.viewMode === v.mode, onClick: () => dispatch({ type: 'SET_VIEW_MODE', mode: v.mode }) })), { sep: true }]
      : []),
    ...(!isMobile && state.viewMode !== 'catalog'
      ? [
          { heading: 'Filmstrip' },
          { label: 'Show filmstrip', icon: 'filmstrip', checked: layout.strip, onClick: () => setLayout({ strip: !layout.strip }), hidden: state.viewMode === 'loupe' },
          { ariaLabel: 'Filmstrip position', row: [{ label: 'Left', current: layout.stripPos === 'left', onClick: () => setLayout({ stripPos: 'left', strip: true }) }, { label: 'Bottom', current: layout.stripPos === 'bottom', onClick: () => setLayout({ stripPos: 'bottom', strip: true }) }] },
          { ariaLabel: 'Thumbnail size', row: THUMB_SIZES.map((t) => ({ label: t.label, title: `Thumbnails ${t.px}px`, current: layout.thumb === t.px, onClick: () => setLayout({ thumb: t.px, strip: true }) })) },
          { sep: true },
        ]
      : []),
    { heading: 'Project' },
    { label: 'Save to device (.lumagrader)', icon: 'toDevice', onClick: saveToDevice, disabled: saving || !hasImages },
    { sep: true },
    { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', onClick: () => setShowShortcuts(true), hidden: isMobile },
    kofiUrl() ? { href: kofiUrl(), label: 'Support on Ko-fi', icon: 'coffee' } : null,
    { label: "About · What's new", icon: 'info', onClick: () => setShowAbout(true) },
  ]

  return (
    <div className="app">
      <header className={'app-header' + (editingPhoto ? ' is-editing' : '')}>
        <div className="header-left">
          <img src={logo} alt="LumaGrader" className="app-logo" width="666" height="120" />
          {state.currentProjectName && (
            <button type="button" className="project-name" onClick={() => saveProject({ rename: true })} title="Rename project">
              {state.currentProjectName}
              {state.isDirty && <span className="unsaved-dot" aria-label="unsaved changes" />}
            </button>
          )}
        </div>
        <nav className="view-toggle" aria-label="View">
          {VIEW_MODES.map(({ mode, label, icon, title }) => (
            <button
              key={mode}
              type="button"
              className={'tbtn seg' + (state.viewMode === mode ? ' active' : '')}
              aria-pressed={state.viewMode === mode}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode })}
              title={title}
            >
              <Icon name={icon} size={15} />
              <span className="btn-label">{label}</span>
            </button>
          ))}
        </nav>
        {editingPhoto && (
          // Mobile only: filmstrip + undo/redo live in the header so the photo gets the
          // whole area below it (the preview toolbar row is hidden on phones).
          <div className="header-quick show-mobile" role="toolbar" aria-label="Photo history">
            {state.viewMode !== 'loupe' && (
              <button type="button" className={'tbtn icon-only' + (stripOpen ? ' active' : '')} onClick={toggleStrip} aria-pressed={stripOpen} aria-label={stripOpen ? 'Hide filmstrip' : 'Show filmstrip'} title={stripOpen ? 'Hide filmstrip' : 'Show filmstrip (or swipe the photo)'}>
                <Icon name="filmstrip" size={16} />
              </button>
            )}
            <button type="button" className="tbtn icon-only" onClick={() => undo(activePhoto.id)} disabled={!activePhoto.history.past.length} aria-label="Undo" title="Undo">
              <Icon name="undo" size={16} />
            </button>
            <button type="button" className="tbtn icon-only" onClick={() => redo(activePhoto.id)} disabled={!activePhoto.history.future.length} aria-label="Redo" title="Redo">
              <Icon name="redo" size={16} />
            </button>
          </div>
        )}
        <div className="header-right">
          <button
            type="button"
            className={'tbtn save-btn' + (state.isDirty ? ' is-unsaved' : '') + (justSaved ? ' just-saved' : '')}
            onClick={() => saveProject()}
            disabled={saving || !hasImages}
            aria-live="polite"
            title={saving ? 'Saving…' : state.isDirty || !state.currentProjectId ? 'Save project in this browser (Ctrl/⌘+S)' : 'All changes saved (Ctrl/⌘+S)'}
          >
            {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name={justSaved ? 'check' : 'save'} size={15} />}
            <span className="btn-label">{saving ? 'Saving…' : justSaved ? 'Saved' : state.isDirty || !state.currentProjectId ? 'Save' : 'Saved'}</span>
            {state.isDirty && !saving && <span className="unsaved-dot" aria-label="unsaved changes" />}
          </button>
          {showPhotoActions ? <EditActionsBar appItems={appItems} /> : <MoreMenu items={appItems} label="More" />}
        </div>
      </header>
      <main
        className={'app-main view-' + state.viewMode + (stripBottom ? ' strip-bottom' : '')}
        style={{ '--controls-w': layout.panelW + 'px' }}
      >
        {state.viewMode === 'catalog' ? (
          <Suspense fallback={<div className="empty"><span className="spinner" /></div>}>
            <CatalogView />
          </Suspense>
        ) : (
          <>
            {showStrip && !stripBottom && <ThumbnailStrip thumbSize={isMobile ? null : layout.thumb} />}
            <div className="work-row">
              <CanvasPreview />
              {state.viewMode !== 'loupe' && activePhoto && !isMobile && <PanelResizer width={layout.panelW} onResize={(w) => setLayout({ panelW: w })} />}
              {state.viewMode !== 'loupe' && <ControlsPanel />}
            </div>
            {showStrip && stripBottom && <ThumbnailStrip thumbSize={layout.thumb} />}
          </>
        )}
      </main>
      {showShortcuts && (
        <Suspense fallback={null}>
          <ShortcutsHelp onClose={closeShortcuts} />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={null}>
          <AboutDialog onClose={closeAbout} />
        </Suspense>
      )}
      <WhatsNew />
    </div>
  )
}
