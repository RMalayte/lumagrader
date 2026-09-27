import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { usePreview } from '../hooks/useImageSources'
import { applyGeometry, defaultGeometry } from '../engine/geometry'
import { correctedSource } from '../engine/sourcePrep'

const ASPECTS = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
]

export default function CropOverlay({ active, onDone }) {
  const { liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const baseRef = useRef(null)
  const [aspect, setAspect] = useState(null)
  const geometry = active.settings.geometry
  const preview = usePreview(active)
  const crop = geometry.crop

  useEffect(() => {
    if (!preview) return
    // Lens corrections + spot removal already applied, so the crop is judged on the real result.
    const base = applyGeometry(correctedSource(preview, active.settings), { rotate90: geometry.rotate90, angle: geometry.angle, crop: { x: 0, y: 0, w: 1, h: 1 } })
    baseRef.current = base
    const c = canvasRef.current
    c.width = base.width
    c.height = base.height
    c.getContext('2d').drawImage(base, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, geometry.rotate90, geometry.angle])

  function updateCrop(next) {
    liveUpdate(active.id, { geometry: { ...geometry, crop: next } })
  }

  function getP(e, wrapRect) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { px: (clientX - wrapRect.left) / wrapRect.width, py: (clientY - wrapRect.top) / wrapRect.height }
  }

  function startMove(e) {
    if (e.target.dataset.handle) return
    e.preventDefault()
    beginEdit(active.id)
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const start = getP(e, wrapRect)
    const startRect = { ...crop }
    function move(ev) {
      const cur = getP(ev, wrapRect)
      const dx = cur.px - start.px, dy = cur.py - start.py
      const x = Math.min(1 - startRect.w, Math.max(0, startRect.x + dx))
      const y = Math.min(1 - startRect.h, Math.max(0, startRect.y + dy))
      updateCrop({ x, y, w: startRect.w, h: startRect.h })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      commitEdit(active.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function startCornerDrag(corner, e) {
    e.stopPropagation()
    e.preventDefault()
    beginEdit(active.id)
    const startRect = { ...crop }
    const anchor = {
      nw: { x: startRect.x + startRect.w, y: startRect.y + startRect.h },
      ne: { x: startRect.x, y: startRect.y + startRect.h },
      sw: { x: startRect.x + startRect.w, y: startRect.y },
      se: { x: startRect.x, y: startRect.y },
    }[corner]
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const imgW = baseRef.current.width, imgH = baseRef.current.height

    function move(ev) {
      const { px, py } = getP(ev, wrapRect)
      const cx = Math.min(1, Math.max(0, px))
      const cy = Math.min(1, Math.max(0, py))
      let x = Math.min(anchor.x, cx)
      let y = Math.min(anchor.y, cy)
      let w = Math.abs(anchor.x - cx)
      let h = Math.abs(anchor.y - cy)
      if (aspect) {
        h = (w * imgW) / (aspect * imgH)
        y = cy < anchor.y ? anchor.y - h : anchor.y
      }
      w = Math.max(0.05, Math.min(w, 1))
      h = Math.max(0.05, Math.min(h, 1))
      x = Math.max(0, Math.min(x, 1 - w))
      y = Math.max(0, Math.min(y, 1 - h))
      updateCrop({ x, y, w, h })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      commitEdit(active.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function applyAspect(ratio) {
    setAspect(ratio)
    if (!ratio || !baseRef.current) return
    const imgW = baseRef.current.width, imgH = baseRef.current.height
    const imgRatio = imgW / imgH
    let w, h
    if (ratio > imgRatio) { w = 1; h = (imgW / ratio) / imgH } else { h = 1; w = (imgH * ratio) / imgW }
    commitPatch(active.id, { geometry: { ...geometry, crop: { x: (1 - w) / 2, y: (1 - h) / 2, w, h } } })
  }

  function rotate(delta) {
    commitPatch(active.id, { geometry: { ...geometry, rotate90: (((geometry.rotate90 + delta) % 360) + 360) % 360 } })
  }

  return (
    <div className="crop-mode">
      <div className="crop-wrap" ref={wrapRef} onPointerDown={startMove}>
        <canvas ref={canvasRef} className="crop-base-canvas" />
        <div
          className="crop-rect"
          style={{ left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' }}
        >
          {['nw', 'ne', 'sw', 'se'].map((corner) => (
            <div
              key={corner}
              className={`crop-handle crop-handle-${corner}`}
              data-handle="1"
              onPointerDown={(e) => startCornerDrag(corner, e)}
            />
          ))}
        </div>
      </div>
      <div className="crop-toolbar">
        <div className="toolbar-group">
          <button className="tbtn" onClick={() => rotate(-90)}>⟲ 90°</button>
          <button className="tbtn" onClick={() => rotate(90)}>⟳ 90°</button>
        </div>
        <div className="toolbar-group presets">
          {ASPECTS.map((a) => (
            <div key={a.label} className={'preset-chip' + (aspect === a.value ? ' active' : '')} onClick={() => applyAspect(a.value)}>
              {a.label}
            </div>
          ))}
        </div>
        <div className="toolbar-group">
          <button className="tbtn" onClick={() => commitPatch(active.id, { geometry: defaultGeometry() })}>Reset</button>
          <button className="tbtn active" onClick={onDone}>Done</button>
        </div>
      </div>
      <div
        className="slider-row"
        style={{ width: '100%', marginTop: 8 }}
        onPointerDown={() => beginEdit(active.id)}
        onPointerUp={() => commitEdit(active.id)}
      >
        <label>Straighten <b>{geometry.angle}°</b></label>
        <input
          type="range"
          min={-45}
          max={45}
          value={geometry.angle}
          onChange={(e) => liveUpdate(active.id, { geometry: { ...geometry, angle: Number(e.target.value) } })}
        />
      </div>
    </div>
  )
}
