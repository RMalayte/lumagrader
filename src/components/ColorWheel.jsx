import { useEffect, useRef } from 'react'
import { withHue } from '../engine/color'

const HANDLE_HIT = 26 // px — on touch screens a drag must start on the handle (no accidental edits while scrolling)

/**
 * Lightroom-style colour wheel: angle = hue (0° red at the right, counter-clockwise),
 * distance from the centre = saturation (0–100). Mouse: press anywhere. Touch: drag the handle
 * (swipes elsewhere scroll the panel). Double-click / double-tap the handle to reset.
 */
export default function ColorWheel({ label, h = 0, s = 0, size = 180, onBegin, onChange, onCommit, onReset }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const lastTapRef = useRef(0)
  const R = size / 2

  // Wheel background — drawn once per size.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const n = Math.round(size * dpr)
    c.width = n
    c.height = n
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(n, n)
    const r = n / 2
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - r, dy = r - (y + 0.5)
      const d = Math.hypot(dx, dy) / r
      if (d > 1) continue
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
      const [cr, cg, cb] = withHue(1, 0, 0, hue)
      const sat = Math.min(1, d) * 0.85
      const v = 0.78
      const i = (y * n + x) * 4
      img.data[i] = (v * (1 - sat) + v * sat * cr) * 255
      img.data[i + 1] = (v * (1 - sat) + v * sat * cg) * 255
      img.data[i + 2] = (v * (1 - sat) + v * sat * cb) * 255
      img.data[i + 3] = d > 0.985 ? (1 - (d - 0.985) / 0.015) * 255 : 255
    }
    ctx.putImageData(img, 0, 0)
  }, [size])

  // Block page scrolling only when a touch starts on the handle.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const block = (e) => { if (e.target.closest?.('.wheel-handle')) e.preventDefault() }
    el.addEventListener('touchstart', block, { passive: false })
    return () => el.removeEventListener('touchstart', block)
  }, [])

  const rad = (h * Math.PI) / 180
  const hx = R + Math.cos(rad) * (s / 100) * (R - 2)
  const hy = R - Math.sin(rad) * (s / 100) * (R - 2)

  function valueAt(clientX, clientY) {
    const rect = wrapRef.current.getBoundingClientRect()
    const scale = size / rect.width
    const dx = (clientX - rect.left) * scale - R
    const dy = R - (clientY - rect.top) * scale
    const hue = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360)
    const sat = Math.round(Math.min(1, Math.hypot(dx, dy) / (R - 2)) * 100)
    return [hue, sat]
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return
    const touch = e.pointerType !== 'mouse'
    const rect = wrapRef.current.getBoundingClientRect()
    const scale = rect.width / size
    const dist = Math.hypot(e.clientX - (rect.left + hx * scale), e.clientY - (rect.top + hy * scale))
    if (touch && dist > HANDLE_HIT) return // let the panel scroll
    if (dist <= HANDLE_HIT) {
      const now = performance.now()
      if (now - lastTapRef.current < 320) { lastTapRef.current = 0; onReset?.(); return }
      lastTapRef.current = now
    }
    e.preventDefault()
    const target = e.currentTarget
    const id = e.pointerId
    try { target.setPointerCapture(id) } catch { /* ignore */ }
    onBegin?.()
    // Mouse: jump to the pressed point. Touch started on the handle: follow the finger.
    if (!touch) onChange(...valueAt(e.clientX, e.clientY))
    const move = (ev) => { if (ev.pointerId === id) onChange(...valueAt(ev.clientX, ev.clientY)) }
    const end = (ev) => {
      if (ev.pointerId !== id) return
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      onCommit?.()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  const [hr, hg, hb] = withHue(1, 0, 0, h)
  const handleColor = s > 0 ? `rgb(${Math.round((1 - s / 100 + (s / 100) * hr) * 255)},${Math.round((1 - s / 100 + (s / 100) * hg) * 255)},${Math.round((1 - s / 100 + (s / 100) * hb) * 255)})` : '#ddd'

  return (
    <div
      ref={wrapRef}
      className="color-wheel"
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      role="group"
      aria-label={`${label} colour wheel: hue ${h}°, saturation ${s}`}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />
      <span className="wheel-cross" aria-hidden="true" />
      <span
        className="wheel-handle"
        style={{ left: hx, top: hy, background: handleColor }}
        aria-hidden="true"
      />
    </div>
  )
}
