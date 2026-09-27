import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { createLinearMask, createRadialMask } from '../engine/masks'
import { ensureBrushCanvas } from '../engine/brushMaskStore'
import { previewSizeFor } from '../engine/imageStore'

export default function MaskCanvasOverlay({ active }) {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const svgRef = useRef(null)
  const visualWrapRef = useRef(null)
  const [draft, setDraft] = useState(null) // { type, x1, y1, x2, y2 } while actively drawing a linear/radial mask

  const masks = active.settings.masks || []
  const selectedMaskId = state.selectedMaskId
  const selectedMask = masks.find((m) => m.id === selectedMaskId) || null
  const drawMode = state.maskDrawMode
  const isPaintingBrush = selectedMask?.type === 'brush'
  // Brush masks are painted at preview resolution (normalized coords everywhere else).
  const { w: imgW, h: imgH } = previewSizeFor(active.width, active.height)
  const minDim = Math.min(imgW, imgH)
  const handleR = Math.max(imgW, imgH) * 0.014

  // Mounts a clear amber-tinted visualization of the REAL brush canvas (from the runtime
  // store) so painting has obvious feedback. Rendering the raw white-alpha canvas with a
  // blend mode was washing out the whole photo — this instead clips a solid amber fill to
  // exactly the painted shape, independent of the photo's own brightness underneath.
  useEffect(() => {
    if (!isPaintingBrush || !visualWrapRef.current) return
    const maskCanvas = ensureBrushCanvas(selectedMask.id, imgW, imgH)
    const tinted = document.createElement('canvas')
    tinted.width = imgW
    tinted.height = imgH
    const tctx = tinted.getContext('2d')
    tctx.clearRect(0, 0, imgW, imgH)
    tctx.drawImage(maskCanvas, 0, 0)
    tctx.globalCompositeOperation = 'source-in'
    tctx.fillStyle = '#f5a623'
    tctx.fillRect(0, 0, imgW, imgH)
    tinted.style.width = '100%'
    tinted.style.height = '100%'
    tinted.style.display = 'block'
    tinted.style.opacity = '0.32'
    visualWrapRef.current.replaceChildren(tinted)
  }, [isPaintingBrush, selectedMask?.id, selectedMask?.brushVersion, imgW, imgH])

  if (state.openAccordionId !== 'masks') return null

  function getRelPos(e, refEl) {
    const rect = (refEl || svgRef.current).getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return { x, y }
  }

  function updateMasks(nextMasks) {
    liveUpdate(active.id, { masks: nextMasks })
  }

  function startDraw(e) {
    if (!drawMode) return
    e.preventDefault()
    const start = getRelPos(e)
    setDraft({ type: drawMode, x1: start.x, y1: start.y, x2: start.x, y2: start.y })
    function move(ev) {
      const cur = getRelPos(ev)
      setDraft({ type: drawMode, x1: start.x, y1: start.y, x2: cur.x, y2: cur.y })
    }
    function up(ev) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const end = getRelPos(ev)
      let newMask
      if (drawMode === 'linear') {
        newMask = createLinearMask(start.x, start.y, end.x, end.y)
      } else {
        const r = Math.max(0.05, Math.hypot(end.x - start.x, end.y - start.y))
        newMask = createRadialMask(start.x, start.y, r)
      }
      commitPatch(active.id, { masks: [...masks, newMask] })
      dispatch({ type: 'SET_SELECTED_MASK', id: newMask.id })
      dispatch({ type: 'SET_MASK_DRAW_MODE', mode: null })
      setDraft(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function startPointDrag(pointKey) {
    return (e) => {
      e.stopPropagation()
      beginEdit(active.id)
      function move(ev) {
        const p = getRelPos(ev)
        updateMasks(
          masks.map((m) =>
            m.id === selectedMaskId
              ? { ...m, linear: { ...m.linear, [pointKey === 'p1' ? 'x1' : 'x2']: p.x, [pointKey === 'p1' ? 'y1' : 'y2']: p.y } }
              : m,
          ),
        )
      }
      function up() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        commitEdit(active.id)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  function startCenterDrag(e) {
    e.stopPropagation()
    beginEdit(active.id)
    function move(ev) {
      const p = getRelPos(ev)
      updateMasks(masks.map((m) => (m.id === selectedMaskId ? { ...m, radial: { ...m.radial, cx: p.x, cy: p.y } } : m)))
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      commitEdit(active.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // axis: 'x' resizes rx (horizontal handle), 'y' resizes ry (vertical handle)
  function startRadiusDrag(axis) {
    return (e) => {
      e.stopPropagation()
      beginEdit(active.id)
      const mask = masks.find((m) => m.id === selectedMaskId)
      function move(ev) {
        const p = getRelPos(ev)
        if (axis === 'x') {
          const rx = Math.max(0.02, Math.abs((p.x - mask.radial.cx) * imgW) / minDim)
          updateMasks(masks.map((m) => (m.id === selectedMaskId ? { ...m, radial: { ...m.radial, rx } } : m)))
        } else {
          const ry = Math.max(0.02, Math.abs((p.y - mask.radial.cy) * imgH) / minDim)
          updateMasks(masks.map((m) => (m.id === selectedMaskId ? { ...m, radial: { ...m.radial, ry } } : m)))
        }
      }
      function up() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        commitEdit(active.id)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  function paintStroke(ctx, from, to) {
    const { size, hardness, opacity, erase } = state.brushSettings
    const radius = (size / 100) * minDim * 0.5
    const fromPx = { x: from.x * imgW, y: from.y * imgH }
    const toPx = { x: to.x * imgW, y: to.y * imgH }
    const dist = Math.hypot(toPx.x - fromPx.x, toPx.y - fromPx.y)
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.3)))
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    ctx.globalAlpha = opacity / 100
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = fromPx.x + (toPx.x - fromPx.x) * t
      const y = fromPx.y + (toPx.y - fromPx.y) * t
      const grad = ctx.createRadialGradient(x, y, radius * (hardness / 100), x, y, radius)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  function startPaint(e) {
    if (!isPaintingBrush) return
    e.preventDefault()
    const canvas = ensureBrushCanvas(selectedMask.id, imgW, imgH)
    const ctx = canvas.getContext('2d')
    const paintRef = svgRef.current
    let last = getRelPos(e, paintRef)
    paintStroke(ctx, last, last)
    bumpBrushVersion()
    function move(ev) {
      const cur = getRelPos(ev, paintRef)
      paintStroke(ctx, last, cur)
      last = cur
      bumpBrushVersion()
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function bumpBrushVersion() {
    liveUpdate(active.id, {
      masks: masks.map((m) => (m.id === selectedMaskId ? { ...m, brushVersion: (m.brushVersion || 0) + 1 } : m)),
    })
  }

  return (
    <div className="mask-overlay-stack">
      {isPaintingBrush && <div className="brush-visual-wrap" ref={visualWrapRef} />}
      <svg
        ref={svgRef}
        className="mask-canvas-overlay"
        viewBox={`0 0 ${imgW} ${imgH}`}
        preserveAspectRatio="none"
        style={{ pointerEvents: drawMode || isPaintingBrush ? 'auto' : 'none', cursor: drawMode ? 'crosshair' : isPaintingBrush ? 'crosshair' : 'default' }}
        onPointerDown={isPaintingBrush ? startPaint : startDraw}
      >
        {masks.map((m) => {
          const isSel = m.id === selectedMaskId
          const stroke = isSel ? 'var(--accent2)' : 'rgba(255,255,255,.55)'
          if (m.type === 'brush') return null
          if (m.type === 'linear') {
            return (
              <g key={m.id}>
                <line
                  x1={m.linear.x1 * imgW} y1={m.linear.y1 * imgH} x2={m.linear.x2 * imgW} y2={m.linear.y2 * imgH}
                  stroke={stroke} strokeWidth={imgW * 0.003}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); dispatch({ type: 'SET_SELECTED_MASK', id: m.id }) }}
                />
                {isSel && (
                  <>
                    <circle cx={m.linear.x1 * imgW} cy={m.linear.y1 * imgH} r={handleR} fill="#fff" stroke={stroke} strokeWidth={handleR * 0.3} style={{ pointerEvents: 'auto', cursor: 'grab' }} onPointerDown={startPointDrag('p1')} />
                    <circle cx={m.linear.x2 * imgW} cy={m.linear.y2 * imgH} r={handleR} fill="#fff" stroke={stroke} strokeWidth={handleR * 0.3} style={{ pointerEvents: 'auto', cursor: 'grab' }} onPointerDown={startPointDrag('p2')} />
                  </>
                )}
              </g>
            )
          }
          const rx = (m.radial.rx ?? m.radial.r) * minDim
          const ry = (m.radial.ry ?? m.radial.r) * minDim
          const cxPx = m.radial.cx * imgW
          const cyPx = m.radial.cy * imgH
          return (
            <g key={m.id}>
              <ellipse
                cx={cxPx} cy={cyPx} rx={rx} ry={ry}
                fill="none" stroke={stroke} strokeWidth={imgW * 0.003}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onPointerDown={(e) => { e.stopPropagation(); dispatch({ type: 'SET_SELECTED_MASK', id: m.id }) }}
              />
              {isSel && (
                <>
                  <circle cx={cxPx} cy={cyPx} r={handleR} fill="var(--accent2)" style={{ pointerEvents: 'auto', cursor: 'move' }} onPointerDown={startCenterDrag} />
                  <circle cx={cxPx + rx} cy={cyPx} r={handleR} fill="#fff" stroke={stroke} strokeWidth={handleR * 0.3} style={{ pointerEvents: 'auto', cursor: 'ew-resize' }} onPointerDown={startRadiusDrag('x')} />
                  <circle cx={cxPx} cy={cyPx + ry} r={handleR} fill="#fff" stroke={stroke} strokeWidth={handleR * 0.3} style={{ pointerEvents: 'auto', cursor: 'ns-resize' }} onPointerDown={startRadiusDrag('y')} />
                </>
              )}
            </g>
          )
        })}
        {draft && draft.type === 'linear' && (
          <line x1={draft.x1 * imgW} y1={draft.y1 * imgH} x2={draft.x2 * imgW} y2={draft.y2 * imgH} stroke="var(--accent2)" strokeWidth={imgW * 0.004} strokeDasharray={`${imgW * 0.012} ${imgW * 0.008}`} />
        )}
        {draft && draft.type === 'radial' && (
          <circle
            cx={draft.x1 * imgW} cy={draft.y1 * imgH}
            r={Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) * minDim}
            fill="rgba(245,166,35,0.12)" stroke="var(--accent2)" strokeWidth={imgW * 0.004} strokeDasharray={`${imgW * 0.012} ${imgW * 0.008}`}
          />
        )}
      </svg>
    </div>
  )
}
