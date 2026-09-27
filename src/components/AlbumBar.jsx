import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import Icon from './Icon.jsx'

const newAlbumId = () => `album_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
const plural = (n) => `${n} photo${n === 1 ? '' : 's'}`
const MENU_W = 250

/**
 * Albums inside the current project: a button at the top of the filmstrip that shows which
 * album is open and opens the album menu (switch, add/remove photos, new/rename/delete).
 * Photos can be in several albums; deleting an album never removes its photos.
 */
export default function AlbumBar() {
  const { state, dispatch } = useProject()
  const { prompt, confirm, toast } = useFeedback()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const current = state.albums.find((a) => a.id === state.activeAlbumId) || null
  const targetIds = state.selectedIds.length ? state.selectedIds : state.activeId ? [state.activeId] : []
  const count = (albumId) => state.images.filter((im) => im.albumIds?.includes(albumId)).length

  // Fixed position (the filmstrip scrolls and would clip an absolute menu); opens upward when
  // the strip is at the bottom of the screen (phones).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const h = menuRef.current?.offsetHeight || 300
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8))
    const below = r.bottom + 6 + h <= window.innerHeight - 8
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
  }, [open, state.albums.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const show = (albumId) => {
    dispatch({ type: 'SET_ACTIVE_ALBUM', id: albumId })
    setOpen(false)
  }

  function addTo(album) {
    if (!targetIds.length) return
    dispatch({ type: 'SET_ALBUM_MEMBERSHIP', albumId: album.id, ids: targetIds, add: true })
    toast(`Added ${plural(targetIds.length)} to "${album.name}"`)
  }

  async function createAlbum() {
    setOpen(false)
    const name = await prompt({
      title: 'New album',
      message: targetIds.length ? `The ${targetIds.length === 1 ? 'current photo' : `${targetIds.length} selected photos`} will be added to it.` : 'Add photos to it from All photos.',
      placeholder: 'e.g. Day 1, Portraits, Best shots',
      confirmLabel: 'Create',
    })
    if (!name?.trim()) return
    const album = { id: newAlbumId(), name: name.trim().slice(0, 80) }
    dispatch({ type: 'ADD_ALBUM', album, ids: targetIds })
    toast(`Album "${album.name}" created${targetIds.length ? ` with ${plural(targetIds.length)}` : ''}`)
  }

  function removeFromCurrent() {
    if (!current || !targetIds.length) return
    setOpen(false)
    dispatch({ type: 'SET_ALBUM_MEMBERSHIP', albumId: current.id, ids: targetIds, add: false })
    toast(`Removed ${plural(targetIds.length)} from "${current.name}" (still in the project)`)
  }

  async function renameCurrent() {
    setOpen(false)
    const name = await prompt({ title: 'Rename album', defaultValue: current.name, confirmLabel: 'Rename' })
    if (name?.trim()) dispatch({ type: 'RENAME_ALBUM', id: current.id, name: name.trim().slice(0, 80) })
  }

  async function deleteCurrent() {
    setOpen(false)
    const ok = await confirm({ title: `Delete album "${current.name}"?`, message: 'Its photos stay in the project.', confirmLabel: 'Delete', danger: true })
    if (ok) dispatch({ type: 'DELETE_ALBUM', id: current.id })
  }

  const label = current ? current.name : 'All photos'
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'album-btn' + (current ? ' in-album' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Albums — showing ${label}`}
        title={`Albums — showing ${label}`}
      >
        <Icon name="album" size={18} />
        <span className="album-btn-label">{label}</span>
      </button>
      {open && (
        <div ref={menuRef} className="dropdown-menu album-menu" role="menu" aria-label="Albums" style={{ ...pos, width: MENU_W, visibility: pos ? 'visible' : 'hidden' }}>
          <button type="button" role="menuitemradio" aria-checked={!current} className={!current ? 'is-current' : ''} onClick={() => show(null)}>
            <Icon name="grid" size={14} /> <span className="album-name">All photos</span> <span className="album-count">{state.images.length}</span>
          </button>
          {state.albums.map((a) => (
            <div key={a.id} className="album-row">
              <button type="button" role="menuitemradio" aria-checked={current?.id === a.id} className={current?.id === a.id ? 'is-current' : ''} onClick={() => show(a.id)}>
                <Icon name="album" size={14} /> <span className="album-name">{a.name}</span> <span className="album-count">{count(a.id)}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="album-add"
                onClick={() => addTo(a)}
                disabled={!targetIds.length}
                aria-label={`Add ${plural(targetIds.length)} to ${a.name}`}
                title={targetIds.length ? `Add ${targetIds.length === 1 ? 'this photo' : `${targetIds.length} selected photos`} to "${a.name}"` : 'Select a photo first'}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          ))}
          <div className="menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={createAlbum}>
            <Icon name="plus" size={14} /> New album…
          </button>
          {current && (
            <>
              <button type="button" role="menuitem" onClick={removeFromCurrent} disabled={!targetIds.length}>
                <Icon name="close" size={14} /> Remove {targetIds.length > 1 ? `${targetIds.length} photos` : 'photo'} from album
              </button>
              <button type="button" role="menuitem" onClick={renameCurrent}>
                <Icon name="save" size={14} /> Rename album…
              </button>
              <button type="button" role="menuitem" className="danger-item" onClick={deleteCurrent}>
                <Icon name="trash" size={14} /> Delete album
              </button>
            </>
          )}
          <p className="album-hint">
            {window.matchMedia('(pointer: coarse)').matches
              ? 'Open a photo, then tap + next to an album to add it.'
              : 'Shift/Ctrl+click photos to select several, then click + next to an album.'}
          </p>
        </div>
      )}
    </>
  )
}
