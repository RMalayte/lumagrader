import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { createLinearMask, createRadialMask, colorRangeSample } from '../engine/masks'
import { ensureBrushCanvas, touchBrushCanvas, getBrushCanvas } from '../engine/brushMaskStore'
import { previewSizeFor, peekPreview } from '../engine/imageStore'
import { renderToCanvas } from '../engine/pipeline'
import { effectiveSettings } from '../engine/panels'

export default function MaskCanvasOverlay({ active }) {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const svgRef = useRef(null)
  const visualWrapRef = useRef(null)
  const [draft, setDraft] = useState(null) // { type, x1, y1, x2, y2 } while actively drawing a linear/radial mask
  const [brushCursor, setBrushCursor] = useState(null) // { x, y } (normalized) — where the brush outline is drawn
  const [stroking, setStroking] = useState(false) // a brush stroke is in progress

  const masks = active.settings.masks || []
  const selectedMaskId = state.selectedMaskId
  const selectedMask = masks.find((m) => m.id === selectedMaskId) || null
  const drawMode = state.maskDrawMode
  const isPaintingBrush = selectedMask?.type === 'brush'
  // Brush masks are painted at preview resolution (normalized coords everywhere else).
  const { w: imgW, h: imgH } = previewSizeFor(active.width, active.height)
  const minDim = Math.min(imgW, imgH)
  const handleR = Math.max(imgW, imgH) * 0.014

  // Red overlay like Lightroom's "auto overlay": shown only WHILE a stroke is being painted, so
  // you see where the brush goes, then hidden on release so the adjustment itself is visible.
  // "Show overlay" keeps it on permanently (the photo renders it then — this one stays off to
  // avoid doubling). A solid red fill is clipped to exactly the painted shape.
  const showTint = isPaintingBrush && stroking && !state.maskOverlay
  useEffect(() => {
    if (!showTint || !visualWrapRef.current) return
    const maskCanvas = ensureBrushCanvas(selectedMask.id, imgW, imgH)
    const tinted = document.createElement('canvas')
    tinted.width = imgW
    tinted.height = imgH
    const tctx = tinted.getContext('2d')
    tctx.clearRect(0, 0, imgW, imgH)
    tctx.drawImage(maskCanvas, 0, 0)
    tctx.globalCompositeOperation = 'source-in'
    tctx.fillStyle = 'rgb(255, 40, 40)'
    tctx.fillRect(0, 0, imgW, imgH)
    tinted.className = 'brush-tint'
    visualWrapRef.current.replaceChildren(tinted)
  }, [showTint, selectedMask?.id, selectedMask?.brushVersion, imgW, imgH])

  if (state.openAccordionId !== 'masks') return null

  function getRelPos(e, refEl) {
    const rect = (refEl || svgRef.current).getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return { x, y }
  }

  // Color range: sample the photo as this mask sees it (everything before it applied).
  function pickRangeColor(e) {
    e.preventDefault()
    e.stopPropagation()
    const preview = peekPreview(active.id)
    const idx = masks.findIndex((m) => m.id === selectedMaskId)
    if (!preview || idx < 0) return
    const p = getRelPos(e)
    const out = document.createElement('canvas')
    renderToCanvas(out, preview, { ...effectiveSettings(active), masks: masks.slice(0, idx) }, state.luts)
    const x = Math.round(p.x * (out.width - 1)), y = Math.round(p.y * (out.height - 1))
    const x0 = Math.max(0, x - 2), y0 = Math.max(0, y - 2)
    const d = out.getContext('2d').getImageData(x0, y0, Math.min(5, out.width - x0), Math.min(5, out.height - y0)).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
    const n = d.length / 4
    const color = colorRangeSample(r / n, g / n, b / n)
    const mask = masks[idx]
    commitPatch(active.id, { masks: masks.map((m) => (m.id === mask.id ? { ...m, range: { ...(m.range || {}), type: 'color', color } } : m)) })
    dispatch({ type: 'SET_MASK_PICK_COLOR', on: false })
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
    setBrushCursor(last)
    setStroking(true)
    paintStroke(ctx, last, last)
    bumpBrushVersion()
    function move(ev) {
      const cur = getRelPos(ev, paintRef)
      setBrushCursor(cur)
      paintStroke(ctx, last, cur)
      last = cur
      bumpBrushVersion()
    }
    function up(ev) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setStroking(false)
      if (ev.pointerType !== 'mouse') setBrushCursor(null) // touch: no hover, hide the outline
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function bumpBrushVersion() {
    touchBrushCanvas(selectedMaskId)
    // The canvas's own edit counter, not `masks` from this render: a stroke's pointer handlers
    // keep the masks they started with, so "+1" on those stopped changing after the first dab
    // and the overlay never showed the rest of the stroke.
    const version = (selectedMask.brushVersion || 0) + (getBrushCanvas(selectedMaskId)?._version || 1)
    liveUpdate(active.id, {
      masks: masks.map((m) => (m.id === selectedMaskId ? { ...m, brushVersion: version } : m)),
    })
  }

  // Brush outline like Lightroom: outer circle = brush size, inner circle = where the soft
  // edge starts (Hardness); a minus sign while erasing.
  const brushR = (state.brushSettings.size / 100) * minDim * 0.5
  const brushInnerR = brushR * (state.brushSettings.hardness / 100)

  return (
    <div className="mask-overlay-stack">
      {showTint && <div className="brush-visual-wrap" ref={visualWrapRef} />}
      <svg
        ref={svgRef}
        className="mask-canvas-overlay"
        viewBox={`0 0 ${imgW} ${imgH}`}
        preserveAspectRatio="none"
        style={{ pointerEvents: drawMode || isPaintingBrush || state.maskPickColor ? 'auto' : 'none', cursor: isPaintingBrush && !state.maskPickColor ? 'none' : drawMode || state.maskPickColor ? 'crosshair' : 'default' }}
        onPointerDown={state.maskPickColor ? pickRangeColor : isPaintingBrush ? startPaint : startDraw}
        onPointerMove={isPaintingBrush ? (e) => e.pointerType === 'mouse' && setBrushCursor(getRelPos(e)) : undefined}
        onPointerLeave={isPaintingBrush ? (e) => e.pointerType === 'mouse' && setBrushCursor(null) : undefined}
      >
        {masks.map((m) => {
          const isSel = m.id === selectedMaskId
          const stroke = isSel ? 'var(--accent)' : 'rgba(255,255,255,.55)'
          if (m.type !== 'linear' && m.type !== 'radial') return null
          if (m.type === 'linear') {
            // Feather guides like Lightroom: lines across the photo, perpendicular to the drag,
            // where the transition starts, its middle, and where it ends (selected mask only).
            const L = m.linear
            const dx = (L.x2 - L.x1) * imgW, dy = (L.y2 - L.y1) * imgH
            const len = Math.hypot(dx, dy) || 1
            const nx = -dy / len, ny = dx / len // unit normal, in pixels
            const reach = Math.hypot(imgW, imgH)
            const hw = Math.max(0, (m.feather ?? 100) / 100) * 0.5
            const guide = (t, key, dashed) => {
              const cx = (L.x1 + (L.x2 - L.x1) * t) * imgW, cy = (L.y1 + (L.y2 - L.y1) * t) * imgH
              return (
                <line key={key} x1={cx - nx * reach} y1={cy - ny * reach} x2={cx + nx * reach} y2={cy + ny * reach}
                  className={'mask-guide' + (dashed ? ' dashed' : '')} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              )
            }
            return (
              <g key={m.id}>
                {isSel && hw > 0.001 && guide(0.5 - hw, 'a', true)}
                {isSel && guide(0.5, 'c', false)}
                {isSel && hw > 0.001 && guide(0.5 + hw, 'b', true)}
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
              {isSel && (m.feather ?? 100) > 0 && (m.feather ?? 100) < 100 && (
                <ellipse cx={cxPx} cy={cyPx} rx={rx * (1 - (m.feather ?? 100) / 100)} ry={ry * (1 - (m.feather ?? 100) / 100)}
                  className="mask-guide dashed" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              )}
              {isSel && (
                <>
                  <circle cx={cxPx} cy={cyPx} r={handleR} fill="var(--accent)" style={{ pointerEvents: 'auto', cursor: 'move' }} onPointerDown={startCenterDrag} />
                  <circle cx={cxPx + rx} cy={cyPx} r={handleR} fill="#fff" stroke={stroke} strokeWidth={handleR * 0.3} style={{ pointerEvents: 'auto', cursor: 'ew-resize' }} onPointerDown={startRadiusDrag('x')} />
                  <circle cx={cxPx} cy={cyPx + ry} r={handleR} fill="#fff" stroke={stroke} strokeWidth={handleR * 0.3} style={{ pointerEvents: 'auto', cursor: 'ns-resize' }} onPointerDown={startRadiusDrag('y')} />
                </>
              )}
            </g>
          )
        })}
        {isPaintingBrush && brushCursor && !state.maskPickColor && (
          <g className="brush-cursor" pointerEvents="none">
            <circle cx={brushCursor.x * imgW} cy={brushCursor.y * imgH} r={brushR} className="brush-cursor-shadow" vectorEffect="non-scaling-stroke" />
            <circle cx={brushCursor.x * imgW} cy={brushCursor.y * imgH} r={brushR} className="brush-cursor-ring" vectorEffect="non-scaling-stroke" />
            {brushInnerR > brushR * 0.04 && brushInnerR < brushR * 0.98 && (
              <circle cx={brushCursor.x * imgW} cy={brushCursor.y * imgH} r={brushInnerR} className="brush-cursor-ring inner" vectorEffect="non-scaling-stroke" />
            )}
            <line
              x1={brushCursor.x * imgW - brushR * 0.18} y1={brushCursor.y * imgH} x2={brushCursor.x * imgW + brushR * 0.18} y2={brushCursor.y * imgH}
              className="brush-cursor-ring" vectorEffect="non-scaling-stroke"
            />
            {!state.brushSettings.erase && (
              <line
                x1={brushCursor.x * imgW} y1={brushCursor.y * imgH - brushR * 0.18} x2={brushCursor.x * imgW} y2={brushCursor.y * imgH + brushR * 0.18}
                className="brush-cursor-ring" vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )}
        {draft && draft.type === 'linear' && (
          <line x1={draft.x1 * imgW} y1={draft.y1 * imgH} x2={draft.x2 * imgW} y2={draft.y2 * imgH} stroke="var(--accent)" strokeWidth={imgW * 0.004} strokeDasharray={`${imgW * 0.012} ${imgW * 0.008}`} />
        )}
        {draft && draft.type === 'radial' && (
          <circle
            cx={draft.x1 * imgW} cy={draft.y1 * imgH}
            r={Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) * minDim}
            fill="rgba(101,191,255,0.12)" stroke="var(--accent)" strokeWidth={imgW * 0.004} strokeDasharray={`${imgW * 0.012} ${imgW * 0.008}`}
          />
        )}
      </svg>
    </div>
  )
}
