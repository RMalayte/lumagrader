import { useId } from 'react'
import { useProject, visibleImages } from '../store/ProjectContext'
import { useImportPhotos, FILE_ACCEPT } from '../hooks/useImportPhotos'
import { isPanelEdited, PANEL_KEYS } from '../engine/panels'
import Icon from './Icon.jsx'
import StarRating from './StarRating.jsx'
import AlbumBar from './AlbumBar.jsx'

export default function ThumbnailStrip({ thumbSize = null }) {
  const { state, dispatch } = useProject()
  const { importFiles, importFolder, progress } = useImportPhotos()
  const inputId = useId()
  const shown = visibleImages(state)

  function selectThumb(e, im) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      dispatch({ type: 'TOGGLE_SELECT', id: im.id })
    } else {
      dispatch({ type: 'SET_ACTIVE', id: im.id })
      if (state.selectedIds.length) dispatch({ type: 'CLEAR_SELECTION' })
    }
  }

  return (
    <nav className="col thumbs" aria-label="Photos" style={thumbSize ? { '--thumb': thumbSize + 'px' } : undefined}>
      <label className="addbtn" htmlFor={inputId} title="Add photos" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && document.getElementById(inputId)?.click()}>
        <Icon name="plus" size={18} />
        <span className="addbtn-label">Add</span>
      </label>
      <input
        type="file"
        id={inputId}
        accept={FILE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          importFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button type="button" className="addbtn" onClick={importFolder} title="Open a folder of photos">
        <Icon name="folder" size={18} />
        <span className="addbtn-label">Folder</span>
      </button>

      {state.images.length > 0 && <AlbumBar />}

      {progress && (
        <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Importing photos">
          <div className="import-progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          <span>{progress.done}/{progress.total}</span>
        </div>
      )}

      {state.activeAlbumId && shown.length === 0 && (
        <p className="album-empty">Empty album — open All photos, pick a photo and tap + next to this album.</p>
      )}

      {shown.map((im, i) => {
        const isActive = im.id === state.activeId
        const isSelected = state.selectedIds.includes(im.id)
        const edited = Object.keys(PANEL_KEYS).some((p) => isPanelEdited(im.settings, p))
        return (
          <div key={im.id} className="thumb-wrap">
            <button
              type="button"
              className={'thumb-frame' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '')}
              onClick={(e) => selectThumb(e, im)}
              title={`${im.name}\nShift/Ctrl+click to multi-select`}
              aria-label={`${im.name}, photo ${i + 1} of ${shown.length}${isSelected ? ', selected' : ''}`}
              aria-current={isActive ? 'true' : undefined}
            >
              <img className="thumb" src={im.thumbUrl} alt="" draggable={false} loading="lazy" decoding="async" />
              {im.isRawPreview && <span className="raw-badge">RAW</span>}
              {edited && <span className="thumb-edited" title="Edited" />}
            </button>
            <StarRating
              size="sm"
              rating={im.rating || 0}
              label={im.name}
              onRate={(rating) => dispatch({ type: 'SET_RATING', id: im.id, rating })}
            />
          </div>
        )
      })}
    </nav>
  )
}
