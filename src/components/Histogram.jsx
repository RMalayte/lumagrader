import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { subscribePreview } from '../engine/previewBus'
import { recordHistogram } from '../engine/perfStats'
import { clippingFromHistogram, CLIP_THRESHOLD } from '../engine/clipping'

// Read resolution. Big enough that small blown highlights (sky, speculars) aren't averaged
// away by the downscale, small enough to stay cheap on every edit.
const SIZE = 480
const LIVE_INTERVAL = 80 // ms between histogram updates while a slider is dragged

function drawHistogram(canvas, r, g, b) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const max = Math.max(1, ...r, ...g, ...b)

  function channel(arr, color) {
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < 256; i++) {
      ctx.lineTo((i / 255) * w, h - (arr[i] / max) * h)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  ctx.globalCompositeOperation = 'lighter'
  channel(r, 'rgba(255,70,70,0.7)')
  channel(g, 'rgba(70,230,90,0.7)')
  channel(b, 'rgba(70,140,255,0.7)')
  ctx.globalCompositeOperation = 'source-over'
}

function ClipToggle({ side, clipped, on, onToggle }) {
  const label = side === 'shadows' ? 'Shadow clipping' : 'Highlight clipping'
  return (
    <button
      type="button"
      className={`clip-toggle clip-${side}` + (clipped ? ' has-clip' : '') + (on ? ' on' : '')}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={`${label}${clipped ? ' (detected)' : ''}. Show on photo (J)`}
      title={`${label}${clipped ? ' detected' : ''} — click to show on photo (J)`}
    >
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        {side === 'shadows' ? <path d="M0 0L10 0L0 10Z" /> : <path d="M0 0L10 0L10 10Z" />}
      </svg>
    </button>
  )
}

export default function Histogram() {
  const { state, dispatch } = useProject()
  const canvasRef = useRef(null)
  const [clip, setClip] = useState({ shadows: 0, highlights: 0 })
  const active = state.images.find((im) => im.id === state.activeId)
  const readRef = useRef(null)
  const lastRunRef = useRef(0)
  const timerRef = useRef(0)

  // Reads the preview the user is looking at (already rendered) — no second render. While a
  // slider is dragged, updates are throttled to ~12/s; the settled render updates right away.
  useEffect(() => {
    function compute(source) {
      lastRunRef.current = performance.now()
      const scale = Math.min(1, SIZE / Math.max(source.width, source.height))
      const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale))
      let c = readRef.current
      if (!c) c = readRef.current = document.createElement('canvas')
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(source, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)
      const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256)
      for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++
        g[data[i + 1]]++
        b[data[i + 2]]++
      }
      if (canvasRef.current) drawHistogram(canvasRef.current, r, g, b)
      recordHistogram(performance.now() - lastRunRef.current)
      setClip((prev) => {
        const next = clippingFromHistogram(r, g, b, data.length / 4)
        return prev.shadows === next.shadows && prev.highlights === next.highlights ? prev : next
      })
    }
    const unsubscribe = subscribePreview((source, meta) => {
      clearTimeout(timerRef.current)
      const wait = meta.dragging ? Math.max(0, LIVE_INTERVAL - (performance.now() - lastRunRef.current)) : 0
      timerRef.current = setTimeout(() => compute(source), wait)
    })
    return () => {
      unsubscribe()
      clearTimeout(timerRef.current)
    }
  }, [])

  if (!active) return null

  const toggle = (side) => dispatch({ type: 'SET_CLIPPING', patch: { [side]: !state.clipping[side] } })

  return (
    <div className="histo-wrap">
      <canvas ref={canvasRef} width={200} height={54} className="histogram-canvas-inline" role="img" aria-label="RGB histogram" />
      <ClipToggle side="shadows" clipped={clip.shadows > CLIP_THRESHOLD} on={state.clipping.shadows} onToggle={() => toggle('shadows')} />
      <ClipToggle side="highlights" clipped={clip.highlights > CLIP_THRESHOLD} on={state.clipping.highlights} onToggle={() => toggle('highlights')} />
    </div>
  )
}
