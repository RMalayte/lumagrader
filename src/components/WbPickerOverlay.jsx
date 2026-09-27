import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { usePreview } from '../hooks/useImageSources'
import { renderNeutral, sampleAt } from '../engine/wbPicker'
import { solveWhiteBalance } from '../engine/color'
import { getProfileBias } from '../engine/colorProfiles'
import { effectiveSettings } from '../engine/panels'
import { subscribePreview } from '../engine/previewBus'
import { setInteracting } from '../engine/interaction'

const LOUPE_CSS = 116 // loupe diameter (CSS px)
const LOUPE_SRC = 15 // photo pixels (of the preview canvas) shown across the loupe
const LOUPE_GAP = 26 // space between the target and the loupe
const GRAB_RADIUS = 44 // pressing this close to the target drags it instead of jumping

/**
 * White Balance selector on the photo: a target the user drags (or taps to move) onto
 * something that should be neutral. White balance updates live; a loupe above the target
 * magnifies the pixels under it so it can be placed precisely, even under a finger.
 * Done/Cancel live in the Color panel.
 */
export default function WbPickerOverlay({ active, canvasRef }) {
  const { state, liveUpdate, beginEdit, commitEdit } = useProject()
  const picking = state.wbPickActive
  const wrapRef = useRef(null)
  const loupeRef = useRef(null)
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })
  const [status, setStatus] = useState('idle') // idle | ok | bright | dark
  const [dragging, setDragging] = useState(false)
  const [screen, setScreen] = useState(null) // target centre in viewport px, for the loupe
  const preview = usePreview(picking ? active : null)

  const s = active.settings
  const geomKey = JSON.stringify([s.geometry, s.spots, s.lensDistortion, s.lensVignette, s.lensVignetteMidpoint, s.removeCA])
  // The photo "as shot" is rendered once per pick session, then sampled on every move.
  const neutral = useMemo(() => {
    if (!picking || !preview) return null
    try {
      return renderNeutral(preview, active.settings)
    } catch (err) {
      console.error('White balance picker: could not read the photo', err)
      return null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only pixel-moving settings matter
  }, [picking, preview, active.id, geomKey])

  // Each new pick session starts with the target in the middle.
  useEffect(() => {
    if (picking) { setPos({ x: 0.5, y: 0.5 }); setStatus('idle') }
  }, [picking, active.id])

  // Keep the loupe's screen position in step with the target (scrolling/zooming moves it).
  useEffect(() => {
    if (!picking) return
    const update = () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (r) setScreen({ x: r.left + pos.x * r.width, y: r.top + pos.y * r.height })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [picking, pos])

  // Loupe: magnified pixels of the edited preview around the target, redrawn after each render.
  const posRef = useRef(pos)
  posRef.current = pos
  useEffect(() => {
    if (!picking) return
    const draw = (src) => {
      const loupe = loupeRef.current
      const canvas = src || canvasRef.current
      if (!loupe || !canvas || !canvas.width) return
      const dpr = window.devicePixelRatio || 1
      const size = Math.round(LOUPE_CSS * dpr)
      if (loupe.width !== size) { loupe.width = size; loupe.height = size }
      const g = loupe.getContext('2d')
      const p = posRef.current
      const cx = p.x * canvas.width, cy = p.y * canvas.height
      g.imageSmoothingEnabled = false
      g.fillStyle = '#111'
      g.fillRect(0, 0, size, size)
      try {
        g.drawImage(canvas, cx - LOUPE_SRC / 2, cy - LOUPE_SRC / 2, LOUPE_SRC, LOUPE_SRC, 0, 0, size, size)
      } catch { /* canvas not ready */ }
      // Centre box = the averaged sample area.
      const cell = size / LOUPE_SRC
      g.lineWidth = Math.max(1, dpr)
      g.strokeStyle = 'rgba(0,0,0,.85)'
      g.strokeRect(size / 2 - cell * 1.5, size / 2 - cell * 1.5, cell * 3, cell * 3)
      g.strokeStyle = 'rgba(255,255,255,.95)'
      g.strokeRect(size / 2 - cell * 1.5 - g.lineWidth, size / 2 - cell * 1.5 - g.lineWidth, cell * 3 + 2 * g.lineWidth, cell * 3 + 2 * g.lineWidth)
    }
    draw()
    return subscribePreview((canvas) => draw(canvas))
  }, [picking, pos, canvasRef])

  const lastValidRef = useRef(true)
  const rafRef = useRef(0)
  const pendingRef = useRef(null)
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  if (!picking) return null

  function apply(p) {
    if (!neutral) return
    const sample = sampleAt(neutral, p.x, p.y)
    if (sample.clipped || sample.tooDark) {
      lastValidRef.current = false
      setStatus(sample.clipped ? 'bright' : 'dark')
      return
    }
    lastValidRef.current = true
    const eff = effectiveSettings(active)
    const res = solveWhiteBalance(sample.rgb, eff, getProfileBias(eff.colorProfile).temp || 0)
    liveUpdate(active.id, eff.asShotWB ? { wb: res.wb } : { temp: res.temp, tint: res.tint })
    setStatus(res.clipped ? 'strong' : 'ok')
  }
  function schedule(p) {
    pendingRef.current = p
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      if (pendingRef.current) apply(pendingRef.current)
    })
  }

  function relFromEvent(e) {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r }
  }
  const clamp01 = (v) => Math.min(1, Math.max(0, v))

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = relFromEvent(e)
    // Near the target: drag it, keeping the finger's offset (so the finger doesn't cover it).
    // Elsewhere: the target jumps to the finger, then follows it.
    const near = Math.hypot((start.x - pos.x) * start.r.width, (start.y - pos.y) * start.r.height) < GRAB_RADIUS
    const off = near ? { x: pos.x - start.x, y: pos.y - start.y } : { x: 0, y: 0 }
    const place = (ev) => {
      const q = relFromEvent(ev)
      const p = { x: clamp01(q.x + off.x), y: clamp01(q.y + off.y) }
      setPos(p)
      schedule(p)
    }
    // Released on a spot that can't be used (blown out / black): put back the balance from
    // before this drag rather than whatever the target passed over on the way.
    const startWB = { wb: active.settings.wb ?? null, temp: active.settings.temp || 0, tint: active.settings.tint || 0 }
    beginEdit(active.id)
    setDragging(true)
    setInteracting(true)
    place(e)
    const move = (ev) => place(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      if (pendingRef.current) apply(pendingRef.current)
      pendingRef.current = null
      if (!lastValidRef.current) liveUpdate(active.id, startWB)
      setInteracting(false)
      setDragging(false)
      commitEdit(active.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const label = {
    idle: 'Drag onto grey or white',
    ok: null,
    strong: 'Strong colour — pick a grey or white area',
    bright: 'Too bright here (blown out)',
    dark: 'Too dark here',
  }[status]
  // Loupe above the target; below it when there's no room at the top of the screen.
  const loupeTop = screen && screen.y - LOUPE_GAP - LOUPE_CSS < 8 ? screen.y + LOUPE_GAP : screen ? screen.y - LOUPE_GAP - LOUPE_CSS : 0

  return (
    <div ref={wrapRef} className="wb-pick-layer" onPointerDown={onPointerDown} role="application" aria-label="White balance selector: drag the target onto something neutral grey or white">
      <div className={'wb-target' + (dragging ? ' is-dragging' : '') + (status === 'bright' || status === 'dark' ? ' is-bad' : '')} style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }} aria-hidden="true">
        <span className="wb-target-ring" />
        <span className="wb-target-cross" />
        {label && <span className="wb-target-label">{label}</span>}
      </div>
      {screen && (
        <canvas
          ref={loupeRef}
          className={'wb-loupe' + (status === 'bright' || status === 'dark' ? ' is-bad' : '')}
          style={{ left: screen.x - LOUPE_CSS / 2, top: loupeTop, width: LOUPE_CSS, height: LOUPE_CSS }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
