import { useCallback, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import Accordion from './Accordion.jsx'
import { CURVE_CHANNELS, defaultCurvePoints, isIdentityCurve, makeCurve } from '../engine/curvePoints'

const SIZE = 240
const MIN_GAP = 4 // min x distance (0–255) between neighbouring points
const REMOVE_DIST = 28 // px outside the graph → drop the point (LR-style drag-off delete)

const toSvg = (x, y) => ({ sx: (x / 255) * SIZE, sy: SIZE - (y / 255) * SIZE })
const clamp255 = (v) => Math.min(255, Math.max(0, v))

/** SVG path of the smooth spline, sampled every 2 px. */
function curvePath(points) {
  const f = makeCurve(points)
  let d = ''
  for (let sx = 0; sx <= SIZE; sx += 2) {
    const y = f((sx / SIZE) * 255)
    d += (sx === 0 ? 'M' : 'L') + sx + ',' + (SIZE - (y / 255) * SIZE).toFixed(2) + ' '
  }
  return d
}

export default function CurveEditor() {
  const { state, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  const svgRef = useRef(null)
  // Touch: the graph lets the panel scroll (touch-action: pan-y), except when a finger lands
  // on a point handle — then scrolling is blocked so the point can be dragged in any direction.
  const setSvgRef = useCallback((el) => {
    if (svgRef.current?._blockScroll) svgRef.current.removeEventListener('touchstart', svgRef.current._blockScroll)
    svgRef.current = el
    if (!el) return
    el._blockScroll = (ev) => { if (ev.target.closest?.('.curve-handle')) ev.preventDefault() }
    el.addEventListener('touchstart', el._blockScroll, { passive: false })
  }, [])
  const [channelId, setChannelId] = useState('rgb')

  if (!active) return null
  const channel = CURVE_CHANNELS.find((c) => c.id === channelId)
  const pointsOf = (key) => [...(active.settings[key] || defaultCurvePoints())].sort((a, b) => a.x - b.x)
  const sorted = pointsOf(channel.key)
  const accent = channel.color || 'var(--text)'

  function pointerPos(e) {
    const rect = svgRef.current.getBoundingClientRect()
    // viewBox is SIZE×SIZE; scale screen px → viewBox units.
    const sx = ((e.clientX - rect.left) / rect.width) * SIZE
    const sy = ((e.clientY - rect.top) / rect.height) * SIZE
    const outside = Math.max(
      rect.left - e.clientX, e.clientX - rect.right, rect.top - e.clientY, e.clientY - rect.bottom, 0,
    )
    return { sx, sy, outside }
  }
  const fromSvg = (sx, sy) => ({
    x: clamp255(Math.round((sx / SIZE) * 255)),
    y: clamp255(Math.round(((SIZE - sy) / SIZE) * 255)),
  })

  /** Drags points[index] until pointer up; one undo step (beginEdit already called). */
  function dragPoint(points, index) {
    const isEndpoint = index === 0 || index === points.length - 1
    const minX = index === 0 ? 0 : points[index - 1].x + MIN_GAP
    const maxX = index === points.length - 1 ? 255 : points[index + 1].x - MIN_GAP
    let removing = false

    function move(ev) {
      const { sx, sy, outside } = pointerPos(ev)
      const { x, y } = fromSvg(sx, sy)
      removing = !isEndpoint && outside > REMOVE_DIST
      const next = removing
        ? points.filter((_, i) => i !== index)
        : points.map((p, i) => (i === index ? { x: Math.min(maxX, Math.max(minX, x)), y } : p))
      liveUpdate(active.id, { [channel.key]: next })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      commitEdit(active.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function startDrag(index, e) {
    e.stopPropagation()
    e.preventDefault()
    beginEdit(active.id)
    dragPoint(sorted, index)
  }

  // Press on empty graph area → add a point there and keep dragging it.
  // Mouse: press on empty graph adds a point and keeps dragging it.
  // Touch: only a TAP adds a point (a swipe scrolls the panel instead — no accidental points).
  function addPoint(e) {
    if (e.button !== undefined && e.button !== 0) return
    if (e.pointerType !== 'mouse') {
      const x0 = e.clientX, y0 = e.clientY, t0 = performance.now(), id = e.pointerId
      let moved = false
      const move = (ev) => { if (ev.pointerId === id && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) moved = true }
      const end = (ev) => {
        if (ev.pointerId !== id) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        if (ev.type === 'pointerup' && !moved && performance.now() - t0 < 500) {
          const { sx, sy } = pointerPos(ev)
          const { x, y } = fromSvg(sx, sy)
          if (x <= 0 || x >= 255 || sorted.some((p) => Math.abs(p.x - x) < MIN_GAP)) return
          commitPatch(active.id, { [channel.key]: [...sorted, { x, y }].sort((a, b) => a.x - b.x) })
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
      return
    }
    e.preventDefault()
    const { sx, sy } = pointerPos(e)
    const { x, y } = fromSvg(sx, sy)
    if (x <= 0 || x >= 255) return
    if (sorted.some((p) => Math.abs(p.x - x) < MIN_GAP)) return
    const next = [...sorted, { x, y }].sort((a, b) => a.x - b.x)
    beginEdit(active.id)
    liveUpdate(active.id, { [channel.key]: next })
    dragPoint(next, next.findIndex((p) => p.x === x))
  }

  function removePoint(index, e) {
    e.stopPropagation()
    if (index === 0 || index === sorted.length - 1) return
    commitPatch(active.id, { [channel.key]: sorted.filter((_, i) => i !== index) })
  }

  const edited = (key) => !isIdentityCurve(active.settings[key])
  const others = CURVE_CHANNELS.filter((c) => c.id !== channelId && edited(c.key))

  return (
    <Accordion title="Curves" id="curves" panelId="curves">
      <div className="presets curve-channels" role="radiogroup" aria-label="Curve channel">
        {CURVE_CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={c.id === channelId}
            aria-label={c.name}
            title={c.name}
            className={'preset-chip band-chip' + (c.id === channelId ? ' active' : '')}
            style={c.color ? {
              borderColor: c.color,
              background: c.id === channelId ? c.color : undefined,
              color: c.id === channelId ? '#fff' : undefined,
            } : undefined}
            onClick={() => setChannelId(c.id)}
          >
            {c.label}
            {edited(c.key) && <span className="band-dot" />}
          </button>
        ))}
        {edited(channel.key) && (
          <button
            type="button"
            className="preset-chip curve-reset"
            onClick={() => commitPatch(active.id, { [channel.key]: defaultCurvePoints() })}
          >
            Reset {channel.label}
          </button>
        )}
      </div>
      <svg
        ref={setSvgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="curve-svg"
        onPointerDown={addPoint}
        aria-label={`${channel.label} tone curve`}
      >
        {[1, 2, 3].map((q) => (
          <g key={q} className="curve-grid">
            <line x1={(q * SIZE) / 4} y1="0" x2={(q * SIZE) / 4} y2={SIZE} />
            <line x1="0" y1={(q * SIZE) / 4} x2={SIZE} y2={(q * SIZE) / 4} />
          </g>
        ))}
        <line x1="0" y1={SIZE} x2={SIZE} y2="0" className="curve-diag" />
        {others.map((c) => (
          <path key={c.id} d={curvePath(pointsOf(c.key))} className="curve-path curve-path-ghost" style={{ stroke: c.color || 'var(--text)' }} />
        ))}
        <path d={curvePath(sorted)} className="curve-path" style={{ stroke: accent }} />
        {sorted.map((p, i) => {
          const { sx, sy } = toSvg(p.x, p.y)
          return (
            <g key={i} className="curve-handle" onPointerDown={(e) => startDrag(i, e)} onDoubleClick={(e) => removePoint(i, e)}>
              <circle cx={sx} cy={sy} r="12" className="curve-hit" />
              <circle cx={sx} cy={sy} r="5" className="curve-point" style={{ stroke: accent }} />
            </g>
          )
        })}
      </svg>
      <p className="panel-hint">Tap to add a point · drag a point to move · drag it off the graph (or double-click) to remove</p>
    </Accordion>
  )
}
