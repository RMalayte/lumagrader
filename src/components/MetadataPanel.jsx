import { useEffect, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import StarRating from './StarRating.jsx'

function formatBytes(bytes) {
  if (!bytes) return null
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export default function MetadataPanel() {
  const { state, dispatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  const [exif, setExif] = useState(null)

  useEffect(() => {
    if (!active) {
      setExif(null)
      return
    }
    let cancelled = false
    // exifr loads on demand and reads only the metadata segments (not the whole file).
    const reader = import('../engine/exifSummary').then((m) => m.readExifSummary(active.originalBlob))
    reader.then((data) => {
      if (!cancelled) setExif(data)
    })
    return () => {
      cancelled = true
    }
  }, [active])

  if (!active) return null

  const bits = [
    `${active.width}×${active.height}`,
    active.originalBlob ? formatBytes(active.originalBlob.size) : null,
    exif?.make || exif?.model ? [exif.make, exif.model].filter(Boolean).join(' ') : null,
    exif?.fNumber || null,
    exif?.exposureTime || null,
    exif?.iso || null,
    exif?.focalLength || null,
    exif?.dateTaken || null,
  ].filter(Boolean)

  return (
    <div className="meta-inline">
      <div className="meta-name" title={active.name}>{active.name}</div>
      <div className="star-row-inline">
        <StarRating rating={active.rating || 0} label={active.name} onRate={(rating) => dispatch({ type: 'SET_RATING', id: active.id, rating })} />
        {active.isRawPreview && (
          <span className="raw-badge-inline" title={active.rawSource === 'libraw' ? 'Developed from the RAW sensor data' : `Using the camera's embedded JPEG preview${active.rawError ? ` — RAW decode failed: ${active.rawError}` : ''}`}>
            {active.rawSource === 'libraw' ? 'RAW' : 'RAW preview'}
          </span>
        )}
      </div>
      <div className="meta-inline-text">{bits.length ? bits.join(' · ') : 'No EXIF data found on this file.'}</div>
    </div>
  )
}
