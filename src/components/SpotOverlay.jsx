import { useEffect, useRef } from 'react'
import { useProject } from '../store/ProjectContext'
import { geometryFrame } from '../engine/geometry'
import { findHealSource, newSpotId, spotRadius } from '../engine/heal'
import { correctedSource } from '../engine/sourcePrep'
import { peekPreview } from '../engine/imageStore'
import { shouldIgnoreShortcut } from '../engine/keyboard'

const TAP_MOVE_PX = 8
const TAP_MS = 600

/**
 * On-photo part of spot removal (visible while the Healing panel is open): tap to add a
 * spot, drag a circle to move it, drag the dashed circle to move its source.
 * Spots live in uncropped photo coordinates; geometryFrame maps them onto the cropped view.
 */
export default function SpotOverlay({ active }) {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const svgRef = useRef(null)
  const open = state.openAccordionId === 'healing'
  const spots = active.settings.spots || []
  const selectedId = state.selectedSpotId
  const W0 = active.width, H0 = active.height
  const long = Math.max(W0, H0)
  const frame = geometryFrame(active.settings.geometry, W0, H0)

  // Delete / Backspace removes the selected spot.
  useEffect(() => {
    if (!open || !selectedId) return
    function onKey(e) {
      if (shouldIgnoreShortcut(e)) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      commitPatch(active.id, { spots: spots.filter((sp) => sp.id !== selectedId) })
      dispatch({ type: 'SET_SELECTED_SPOT', id: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  // Pointer → uncropped photo coordinates (normalized 0–1).
  function toPhoto(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * frame.width
    const vy = ((e.clientY - rect.top) / rect.height) * frame.height
    const p = frame.toSource(vx, vy)
    return { x: p.x / W0, y: p.y / H0 }
  }

  function addSpot(p) {
    if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return
    const { size, feather, opacity, mode } = state.spotSettings
    const spot = { id: newSpotId(), x: p.x, y: p.y, r: spotRadius(size), mode, feather, opacity }
    const preview = peekPreview(active.id)
    let src = { sx: Math.min(1, p.x + spot.r * 3 * (long / W0)), sy: p.y }
    if (preview) {
      // Search on the photo as it looks now (lens corrections + existing spots applied).
      const image = correctedSource(preview, active.settings)
      src = findHealSource(image, spot, spots)
    }
    commitPatch(active.id, { spots: [...spots, { ...spot, ...src }] })
    dispatch({ type: 'SET_SELECTED_SPOT', id: spot.id })
  }

  // Tap on empty photo area → new spot. Pans/pinches (movement) and long presses don't add one.
  function onBackgroundDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
    function up(ev) {
      if (ev.pointerId !== start.id) return
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y)
      if (moved < TAP_MOVE_PX && performance.now() - start.t < TAP_MS) {
        if (selectedId) dispatch({ type: 'SET_SELECTED_SPOT', id: null })
        addSpot(toPhoto(ev))
      }
    }
    function cancel() {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  // Drag a spot's target (which: 'target') or its source (which: 'source').
  function startDrag(spot, which) {
    return (e) => {
      e.stopPropagation()
      e.preventDefault()
      dispatch({ type: 'SET_SELECTED_SPOT', id: spot.id })
      const p0 = toPhoto(e)
      const orig = { x: spot.x, y: spot.y, sx: spot.sx, sy: spot.sy }
      let begun = false
      function move(ev) {
        const p = toPhoto(ev)
        const dx = p.x - p0.x, dy = p.y - p0.y
        if (!begun) {
          if (Math.hypot(dx * W0, dy * H0) < 1) return
          beginEdit(active.id)
          begun = true
        }
        const patch = which === 'target' ? { x: orig.x + dx, y: orig.y + dy } : { sx: orig.sx + dx, sy: orig.sy + dy }
        liveUpdate(active.id, { spots: spots.map((sp) => (sp.id === spot.id ? { ...sp, ...patch } : sp)) })
      }
      function up() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (begun) commitEdit(active.id)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
  }

  const stroke = Math.max(frame.width, frame.height) * 0.0022
  return (
    <svg
      ref={svgRef}
      className="spot-overlay"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="none"
      onPointerDown={onBackgroundDown}
      aria-label="Spot removal: tap the photo to remove a blemish"
    >
      {spots.map((sp) => {
        const t = frame.toView(sp.x * W0, sp.y * H0)
        const s = frame.toView(sp.sx * W0, sp.sy * H0)
        const r = sp.r * long
        const sel = sp.id === selectedId
        const color = sel ? 'var(--accent2)' : '#fff'
        return (
          <g key={sp.id} className={'spot' + (sel ? ' selected' : '')}>
            {sel && (
              <>
                <line x1={t.x} y1={t.y} x2={s.x} y2={s.y} stroke={color} strokeWidth={stroke} opacity="0.8" />
                <circle cx={s.x} cy={s.y} r={r} fill="rgba(0,0,0,0.001)" stroke="rgba(0,0,0,.55)" strokeWidth={stroke * 2.2} />
                <circle
                  cx={s.x} cy={s.y} r={r} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={stroke}
                  strokeDasharray={`${r * 0.35} ${r * 0.25}`}
                  className="spot-handle" onPointerDown={startDrag(sp, 'source')}
                />
              </>
            )}
            <circle cx={t.x} cy={t.y} r={r} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth={stroke * 2.2} />
            <circle
              cx={t.x} cy={t.y} r={r} fill={sel ? 'rgba(245,166,35,0.12)' : 'rgba(0,0,0,0.001)'} stroke={color} strokeWidth={stroke}
              className="spot-handle" onPointerDown={startDrag(sp, 'target')}
            >
              <title>{sp.mode === 'clone' ? 'Clone spot' : 'Heal spot'}</title>
            </circle>
          </g>
        )
      })}
    </svg>
  )
}
