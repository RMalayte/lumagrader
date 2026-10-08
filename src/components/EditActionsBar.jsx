import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import MoreMenu, { useDismiss } from './MoreMenu.jsx'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { defaultSettings } from '../engine/defaults'
import { shouldIgnoreShortcut, isMod } from '../engine/keyboard'
import Icon from './Icon.jsx'

// Export pulls in jszip + piexifjs — loaded only when the export dialog is first opened.
const ExportModal = lazy(() => import('./ExportModal.jsx'))


const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Photo commands in the top header: Export (primary) and a "⋯" menu holding Reset, Copy,
// Remove plus the app-wide items passed in `appItems`. Copy/Remove/Reset act on the
// multi-selection when there is one, otherwise on the active photo. Remove asks first and is
// also undoable from the toast.
export default function EditActionsBar({ appItems = [] }) {
  const { state, dispatch, commitSettings, undo } = useProject()
  const { toast, confirm } = useFeedback()
  const [modalMode, setModalMode] = useState(null) // null | 'single' | 'selected' | 'all'
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const active = state.images.find((im) => im.id === state.activeId)
  const selectedCount = state.selectedIds.length
  const hasSelection = selectedCount > 0

  useDismiss(exportMenuOpen, setExportMenuOpen, menuRef)

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

  async function removePhotos() {
    const ids = targetIds
    const ok = await confirm({
      title: ids.length > 1 ? `Remove ${plural(ids.length, 'photo')}?` : `Remove "${active.name}"?`,
      message: 'Removes it from this session together with its edits. A saved project keeps it until you save again.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
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

  const photoItems = [
    { heading: hasSelection ? `${selectedCount} selected photos` : 'This photo' },
    { label: hasSelection ? `Reset edits (${selectedCount})` : 'Reset edits', icon: 'reset', onClick: resetPhotos, title: 'Back to the original — undoable' },
    { label: hasSelection ? `Copy edits to selected (${selectedCount})` : 'Copy edits to all photos', icon: 'copy', onClick: copySettings, title: "Crop and masks stay per photo" },
    { label: hasSelection ? `Remove (${selectedCount})…` : 'Remove photo…', icon: 'trash', onClick: removePhotos, danger: true, kbd: 'Del' },
    { sep: true },
  ]

  return (
    <div className="header-actions" role="toolbar" aria-label="Photo actions">
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
      <MoreMenu items={[...photoItems, ...appItems]} label="More actions" />
      {modalMode && (
        <Suspense fallback={<div className="modal-overlay" aria-busy="true"><span className="spinner" /></div>}>
          <ExportModal mode={modalMode} onClose={() => setModalMode(null)} />
        </Suspense>
      )}
    </div>
  )
}
