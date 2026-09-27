import { useEffect, useRef, useState } from 'react'
import { renderToCanvas } from '../engine/pipeline'
import { defaultSettings } from '../engine/defaults'
import { effectiveSettings } from '../engine/panels'
import { usePreview } from '../hooks/useImageSources'

// Split-view drag comparison: "before" (unedited) overlaid on "after" (edited),
// clipped at the drag handle position.
export default function CompareSlider({ active, luts }) {
  const afterRef = useRef(null)
  const beforeRef = useRef(null)
  const wrapRef = useRef(null)
  const [pos, setPos] = useState(50)
  const preview = usePreview(active)

  useEffect(() => {
    if (!active || !preview) return
    renderToCanvas(afterRef.current, preview, effectiveSettings(active), luts)
    renderToCanvas(beforeRef.current, preview, { ...defaultSettings(), geometry: active.settings.geometry }, {})
  }, [active, preview, luts])

  function updateFromClientX(clientX) {
    const rect = wrapRef.current.getBoundingClientRect()
    let pct = ((clientX - rect.left) / rect.width) * 100
    pct = Math.min(100, Math.max(0, pct))
    setPos(pct)
  }

  function startDrag(e) {
    e.preventDefault()
    e.stopPropagation()
    const move = (ev) => updateFromClientX(ev.touches ? ev.touches[0].clientX : ev.clientX)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const ratio = active.width / active.height

  return (
    <div className="compare-wrap" ref={wrapRef} style={{ aspectRatio: ratio }}>
      <canvas ref={afterRef} className="compare-canvas compare-after" />
      <canvas ref={beforeRef} className="compare-canvas compare-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <div className="compare-handle" style={{ left: pos + '%' }} onPointerDown={startDrag} />
      <span className="compare-label compare-label-left">Before</span>
      <span className="compare-label compare-label-right">After</span>
    </div>
  )
}
