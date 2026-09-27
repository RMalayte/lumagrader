import { useProject } from '../store/ProjectContext'
import Histogram from './Histogram.jsx'
import MetadataPanel from './MetadataPanel.jsx'
import Icon from './Icon.jsx'

// A compact floating panel (histogram + rating + key EXIF facts) fixed to the bottom-right
// corner of the photo container. `inset` is supplied by CanvasPreview (scrollbar-aware).
// Visibility lives in the store so the I shortcut can toggle it.
export default function PhotoInfoOverlay({ inset = { right: 12, bottom: 12 } }) {
  const { state, dispatch } = useProject()
  if (!state.images.find((im) => im.id === state.activeId)) return null

  const setVisible = (visible) => dispatch({ type: 'SET_INFO_VISIBLE', visible })

  if (!state.infoVisible) {
    return (
      <button
        type="button"
        className="photo-info-toggle"
        style={inset}
        onClick={() => setVisible(true)}
        aria-label="Show histogram and photo info (I)"
        title="Show histogram & photo info (I)"
      >
        <Icon name="info" size={16} />
      </button>
    )
  }

  return (
    <section className="photo-info-overlay" style={inset} aria-label="Histogram and photo info">
      <button type="button" className="photo-info-close" onClick={() => setVisible(false)} aria-label="Hide photo info (I)" title="Hide (I)">
        <Icon name="close" size={13} />
      </button>
      <Histogram />
      <MetadataPanel />
    </section>
  )
}
