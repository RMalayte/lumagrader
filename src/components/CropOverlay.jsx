import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { usePreview } from '../hooks/useImageSources'
import { applyGeometry, defaultGeometry, rotatedFrame, cropFits, furthestFit, shrinkToFit, cropForAngle } from '../engine/geometry'
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
  const [dragging, setDragging] = useState(false) // shows the rule-of-thirds grid
  const straightenStartRef = useRef(null)
  // Size of the photo the crop is judged on (before rotation), and the current rotated frame.
  const srcW = preview?.width || active.width, srcH = preview?.height || active.height
  const frame = rotatedFrame(srcW, srcH, geometry.rotate90, geometry.angle)
  // "Auto" crop = the largest uncropped photo that fits the current straighten angle. While the
  // crop is still auto, straightening keeps it auto (and back at 0° it is the whole photo again).
  const isAuto = (c, angle) => {
    const auto = cropForAngle({ x: 0, y: 0, w: 1, h: 1 }, srcW, srcH, geometry.rotate90, 0, angle)
    return ['x', 'y', 'w', 'h'].every((k) => Math.abs(c[k] - auto[k]) < 1e-4)
  }

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

  // A crop saved before crops were kept on the photo can show empty corners: fit it once the
  // photo is loaded (as soon as Crop opens).
  useEffect(() => {
    if (!preview || !geometry.angle || cropFits(crop, frame)) return
    commitPatch(active.id, { geometry: { ...geometry, crop: shrinkToFit(crop, frame) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

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
    setDragging(true)
    function move(ev) {
      const cur = getP(ev, wrapRect)
      const dx = cur.px - start.px, dy = cur.py - start.py
      const x = Math.min(1 - startRect.w, Math.max(0, startRect.x + dx))
      const y = Math.min(1 - startRect.h, Math.max(0, startRect.y + dy))
      // Slide as far as the photo allows (never into the empty corners of a straightened photo).
      const from = cropFits(startRect, frame) ? startRect : shrinkToFit(startRect, frame)
      updateCrop(furthestFit(from, { x, y, w: startRect.w, h: startRect.h }, frame))
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
      commitEdit(active.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Corners resize freely (or at the locked aspect) from the opposite corner; edges move one
  // side (with a locked aspect the other side grows around the middle). The result is always
  // limited to the photo.
  function startHandleDrag(handle, e) {
    e.stopPropagation()
    e.preventDefault()
    beginEdit(active.id)
    setDragging(true)
    const r0 = cropFits(crop, frame) ? { ...crop } : shrinkToFit({ ...crop }, frame)
    const left = r0.x, top = r0.y, right = r0.x + r0.w, bottom = r0.y + r0.h
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const pxRatio = frame.bw / frame.bh // normalised → pixel aspect
    const MIN = 0.04

    function target(px, py) {
      const cx = Math.min(1, Math.max(0, px)), cy = Math.min(1, Math.max(0, py))
      let l = left, t = top, r = right, b = bottom
      if (handle.includes('w')) l = Math.min(cx, r - MIN)
      if (handle.includes('e')) r = Math.max(cx, l + MIN)
      if (handle.includes('n')) t = Math.min(cy, b - MIN)
      if (handle.includes('s')) b = Math.max(cy, t + MIN)
      if (aspect) {
        const ratio = aspect / pxRatio // normalised w / h
        if (handle.length === 2) {
          // corner: width leads; height follows, away from the fixed corner
          const w = r - l, h = w / ratio
          if (handle.includes('n')) t = b - h
          else b = t + h
        } else if (handle === 'e' || handle === 'w') {
          const h = (r - l) / ratio, mid = (top + bottom) / 2
          t = mid - h / 2; b = mid + h / 2
        } else {
          const w = (b - t) * ratio, mid = (left + right) / 2
          l = mid - w / 2; r = mid + w / 2
        }
      }
      return { x: l, y: t, w: r - l, h: b - t }
    }
    // Fixed point the crop shrinks toward when it would leave the photo.
    const anchor = {
      x: handle.includes('w') ? right : handle.includes('e') ? left : (left + right) / 2,
      y: handle.includes('n') ? bottom : handle.includes('s') ? top : (top + bottom) / 2,
    }

    function move(ev) {
      const { px, py } = getP(ev, wrapRect)
      const want = target(px, py)
      if (cropFits(want, frame)) return updateCrop(want)
      updateCrop(furthestFit({ x: anchor.x, y: anchor.y, w: 0, h: 0 }, want, frame))
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
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
    // Largest crop of that shape that fits the (straightened) photo, centred.
    const next = shrinkToFit({ x: (1 - w) / 2, y: (1 - h) / 2, w, h }, frame, 0.5, 0.5)
    commitPatch(active.id, { geometry: { ...geometry, crop: next } })
  }

  // Straighten keeps the crop on the photo: the frame shrinks just enough that no empty corner
  // shows (an uncropped photo stays "auto": the largest version of itself that fits).
  function setAngle(angle, commit = false) {
    const start = straightenStartRef.current || { crop, angle: geometry.angle, auto: isAuto(crop, geometry.angle) }
    const next = start.auto
      ? cropForAngle({ x: 0, y: 0, w: 1, h: 1 }, srcW, srcH, geometry.rotate90, 0, angle)
      : cropForAngle(start.crop, srcW, srcH, geometry.rotate90, start.angle, angle)
    const patch = { geometry: { ...geometry, angle, crop: next } }
    if (commit) commitPatch(active.id, patch)
    else liveUpdate(active.id, patch)
  }

  function rotate(delta) {
    const rotate90 = (((geometry.rotate90 + delta) % 360) + 360) % 360
    // A crop drawn for the old orientation doesn't carry over: start from the whole photo.
    const crop = cropForAngle({ x: 0, y: 0, w: 1, h: 1 }, srcW, srcH, rotate90, 0, geometry.angle)
    commitPatch(active.id, { geometry: { ...geometry, rotate90, crop } })
  }

  return (
    <div className="crop-mode">
      <div className="crop-wrap" ref={wrapRef} onPointerDown={startMove}>
        <canvas ref={canvasRef} className="crop-base-canvas" />
        <div
          className="crop-rect"
          style={{ left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' }}
        >
          <div className={'crop-grid' + (dragging ? ' visible' : '')} aria-hidden="true" />
          {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => (
            <div
              key={h}
              className={`crop-handle crop-handle-${h}` + (h.length === 1 ? ' edge' : '')}
              data-handle="1"
              onPointerDown={(e) => startHandleDrag(h, e)}
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
          <button className="tbtn" onClick={() => { setAspect(null); commitPatch(active.id, { geometry: defaultGeometry() }) }}>Reset</button>
          <button className="tbtn active" onClick={onDone}>Done</button>
        </div>
      </div>
      <div
        className="slider-row"
        style={{ width: '100%', marginTop: 8 }}
        onPointerDown={() => { beginEdit(active.id); straightenStartRef.current = { crop, angle: geometry.angle, auto: isAuto(crop, geometry.angle) }; setDragging(true) }}
        onPointerUp={() => { commitEdit(active.id); straightenStartRef.current = null; setDragging(false) }}
      >
        <label>Straighten <b>{Number(geometry.angle).toFixed(1)}°</b></label>
        <input
          type="range"
          min={-45}
          max={45}
          step={0.1}
          value={geometry.angle}
          onDoubleClick={() => setAngle(0, true)}
          onChange={(e) => setAngle(Number(e.target.value))}
        />
      </div>
    </div>
  )
}
