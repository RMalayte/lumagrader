import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { defaultSettings } from '../engine/defaults'
import { shouldIgnoreShortcut, isMod } from '../engine/keyboard'
import Icon from './Icon.jsx'

// Export pulls in jszip + piexifjs — loaded only when the export dialog is first opened.
const ExportModal = lazy(() => import('./ExportModal.jsx'))

const VIEW_ITEMS = [
  { mode: 'filmstrip', label: 'Edit (filmstrip)', icon: 'filmstrip' },
  { mode: 'loupe', label: 'Loupe (photo only)', icon: 'loupe' },
  { mode: 'catalog', label: 'Projects', icon: 'grid' },
]

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Closes a dropdown on outside press or Escape. */
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen, ref])
}

// Photo-level commands (Reset, Copy, Remove, Export) in the top header, reachable in every
// view. Copy/Remove/Reset act on the multi-selection when there is one, otherwise on the
// active photo. Destructive actions are instant but undoable from the toast.
export default function EditActionsBar() {
  const { state, dispatch, commitSettings, undo } = useProject()
  const { toast } = useFeedback()
  const [modalMode, setModalMode] = useState(null) // null | 'single' | 'selected' | 'all'
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const [moreOpen, setMoreOpen] = useState(false) // mobile "⋯" menu (Reset / Copy / Remove)
  const moreRef = useRef(null)

  const active = state.images.find((im) => im.id === state.activeId)
  const selectedCount = state.selectedIds.length
  const hasSelection = selectedCount > 0

  useDismiss(exportMenuOpen, setExportMenuOpen, menuRef)
  useDismiss(moreOpen, setMoreOpen, moreRef)

  // Ctrl/⌘+E = export this photo, Delete/Backspace = remove (undoable).
  useEffect(() => {
    if (!active) return
    function onKeyDown(e) {
      if (shouldIgnoreShortcut(e)) return
      if (isMod(e) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setModalMode('single')
      } else if (!isMod(e) && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removePhotos()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!active) return null

  const targetIds = hasSelection ? state.selectedIds : [active.id]
  const undoAll = (ids) => () => ids.forEach((id) => undo(id))

  function resetPhotos() {
    commitSettings(active.id, defaultSettings()) // respects the selection
    toast(targetIds.length > 1 ? `Reset ${plural(targetIds.length, 'photo')}` : 'Photo reset', {
      action: { label: 'Undo', onClick: undoAll(targetIds) },
    })
  }

  function copySettings() {
    const ids = hasSelection ? state.selectedIds : state.images.map((im) => im.id)
    const others = ids.filter((id) => id !== active.id)
    if (!others.length) {
      toast('Nothing to copy to — add more photos or select some first', { type: 'error' })
      return
    }
    dispatch({ type: 'COPY_TO_ALL', settings: active.settings, ids: hasSelection ? state.selectedIds : null })
    toast(`Edits copied to ${plural(others.length, 'photo')}`, { action: { label: 'Undo', onClick: undoAll(others) } })
  }

  function removePhotos() {
    const ids = targetIds
    const entries = state.images.map((image, index) => ({ image, index })).filter(({ image }) => ids.includes(image.id))
    const prevActiveId = state.activeId
    dispatch({ type: 'REMOVE_IMAGES', ids })
    toast(ids.length > 1 ? `Removed ${plural(ids.length, 'photo')}` : `Removed "${active.name}"`, {
      action: { label: 'Undo', onClick: () => dispatch({ type: 'RESTORE_IMAGES', entries, activeId: prevActiveId }) },
    })
  }

  function openExport(mode) {
    setExportMenuOpen(false)
    setModalMode(mode)
  }

  return (
    <div className="header-actions" role="toolbar" aria-label="Photo actions">
      {/* Mobile: the three photo commands collapse into one "⋯" menu to keep the header on one row. */}
      <div className="menu-anchor show-mobile" ref={moreRef}>
        <button
          type="button"
          className="tbtn icon-only"
          onClick={() => setMoreOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More photo actions"
          title="More"
        >
          <Icon name="more" size={18} strokeWidth={3} />
        </button>
        {moreOpen && (
          <div className="dropdown-menu" role="menu">
            {VIEW_ITEMS.map((v) => (
              <button
                key={v.mode}
                type="button"
                role="menuitemradio"
                aria-checked={state.viewMode === v.mode}
                className={state.viewMode === v.mode ? 'is-current' : ''}
                onClick={() => { setMoreOpen(false); dispatch({ type: 'SET_VIEW_MODE', mode: v.mode }) }}
              >
                <Icon name={v.icon} size={14} /> {v.label}
              </button>
            ))}
            <div className="menu-sep" role="separator" />
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); resetPhotos() }}>
              <Icon name="reset" size={14} /> {hasSelection ? `Reset (${selectedCount})` : 'Reset edits'}
            </button>
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); copySettings() }}>
              <Icon name="copy" size={14} /> {hasSelection ? `Copy to selected (${selectedCount})` : 'Copy edits to all'}
            </button>
            <button type="button" role="menuitem" className="danger-item" onClick={() => { setMoreOpen(false); removePhotos() }}>
              <Icon name="trash" size={14} /> {hasSelection ? `Remove (${selectedCount})` : 'Remove photo'}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="tbtn hide-mobile" onClick={resetPhotos} title={hasSelection ? 'Reset all edits on the selected photos' : 'Reset all edits on this photo'}>
        <Icon name="reset" size={15} />
        <span className="btn-label">{hasSelection ? `Reset (${selectedCount})` : 'Reset'}</span>
      </button>
      <button type="button" className="tbtn hide-mobile" onClick={copySettings} title="Copy this photo's edits (crop & masks stay per photo)">
        <Icon name="copy" size={15} />
        <span className="btn-label">{hasSelection ? `Copy to selected (${selectedCount})` : 'Copy to all'}</span>
      </button>
      <button type="button" className="tbtn danger hide-mobile" onClick={removePhotos} title="Remove from this session (Del) — undoable">
        <Icon name="trash" size={15} />
        <span className="btn-label">{hasSelection ? `Remove (${selectedCount})` : 'Remove'}</span>
      </button>
      <div className="menu-anchor" ref={menuRef}>
        <button
          type="button"
          className="tbtn primary-tbtn"
          onClick={() => setExportMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
          title="Export (Ctrl/⌘+E exports this photo)"
        >
          <Icon name="download" size={15} />
          <span className="btn-label">Export</span>
          <Icon name="chevronDown" size={13} className="hide-mobile" />
        </button>
        {exportMenuOpen && (
          <div className="dropdown-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => openExport('single')}>
              This photo <kbd>Ctrl/⌘ E</kbd>
            </button>
            {hasSelection && (
              <button type="button" role="menuitem" onClick={() => openExport('selected')}>
                Selected ({selectedCount})
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => openExport('all')}>
              All photos (.zip)
            </button>
          </div>
        )}
      </div>
      {modalMode && (
        <Suspense fallback={<div className="modal-overlay" aria-busy="true"><span className="spinner" /></div>}>
          <ExportModal mode={modalMode} onClose={() => setModalMode(null)} />
        </Suspense>
      )}
    </div>
  )
}
