import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useProject, visibleImages } from '../store/ProjectContext'
import { renderImage } from '../engine/pipeline'
import { releaseCanvas, gpuMaxDimension } from '../engine/webgl/renderer'
import { useFeedback } from '../store/FeedbackContext'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { effectiveSettings } from '../engine/panels'
import { defaultSettings } from '../engine/defaults'
import { drawClippingOverlay } from '../engine/clipping'
import { shouldIgnoreShortcut, isMod } from '../engine/keyboard'
import { rgbToHsl, HSL_BANDS, BAND_HUE } from '../engine/hsl'
import { useImportPhotos, FILE_ACCEPT } from '../hooks/useImportPhotos'
import { usePreview, useFullImage, useInteracting } from '../hooks/useImageSources'
import { getDragProxy, previewSizeFor } from '../engine/imageStore'
import CompareSlider from './CompareSlider.jsx'
import CropOverlay from './CropOverlay.jsx'
import MaskCanvasOverlay from './MaskCanvasOverlay.jsx'
import SpotOverlay from './SpotOverlay.jsx'
import PhotoInfoOverlay from './PhotoInfoOverlay.jsx'
import Icon from './Icon.jsx'

const MIN_ZOOM = 0.25
const FIT_MAX_ZOOM = 4 // zoom is relative to "fit"; 1:1 may need more when the photo is large

function ToolbarButton({ icon, label, onClick, active, disabled, title }) {
  return (
    <button
      type="button"
      className={'tbtn' + (active ? ' active' : '')}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={title || label}
      aria-pressed={active === undefined ? undefined : active}
    >
      <Icon name={icon} size={15} />
      <span className="btn-label">{label}</span>
    </button>
  )
}

function EmptyState({ onFiles, onFolder, progress }) {
  const inputId = useId()
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name="image" size={40} strokeWidth={1.5} /></div>
      <h2>Drop photos here</h2>
      <p>JPEG, PNG, WebP and RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF…)</p>
      <div className="empty-actions">
        <label className="action primary file-btn" htmlFor={inputId}>
          <Icon name="plus" size={16} /> Add photos
        </label>
        <input
          id={inputId}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button type="button" className="action secondary" onClick={onFolder}>
          <Icon name="folder" size={16} /> Open folder
        </button>
      </div>
      {progress && (
        <div className="import-progress wide" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Importing photos">
          <div className="import-progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          <span>Importing {progress.done}/{progress.total}…</span>
        </div>
      )}
    </div>
  )
}

export default function CanvasPreview() {
  const { state, dispatch, undo, redo } = useProject()
  const { importFiles, importFolder, progress } = useImportPhotos()
  const canvasRef = useRef(null)
  // The preview canvas unmounts for Before/After and Crop; release its WebGL context then,
  // so repeated toggling never piles up contexts (browsers cap them at ~16).
  // If the GPU gives up (too large / out of graphics memory — mostly phones at 1:1 zoom), the
  // canvas is stuck with a dead WebGL context and stays blank. Recover by mounting a fresh
  // canvas and capping the resolution used for zoom from then on.
  // Phones also drop WebGL contexts when the browser goes to the background; that is not a
  // failure — the canvas is just replaced quietly when the page is visible again.
  // Escalation for real failures: 1st → lighter preview (zoom capped at 2048 px), 2nd →
  // compatibility mode (software rendering, never blank; masks need the GPU).
  const [gpuTrouble, setGpuTrouble] = useState(false)
  const [forceCanvas, setForceCanvas] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const failuresRef = useRef(0)
  const { toast } = useFeedback()
  const recoverFromGpuFailure = useCallback((reason) => {
    console.warn('Preview render failed — recovering with a fresh canvas:', reason)
    if (document.hidden) {
      // Lost while in the background (Android frees GPU memory): swap the canvas on return.
      const onVisible = () => {
        if (document.hidden) return
        document.removeEventListener('visibilitychange', onVisible)
        setCanvasKey((k) => k + 1)
      }
      document.addEventListener('visibilitychange', onVisible)
      return
    }
    failuresRef.current += 1
    if (failuresRef.current === 1) {
      setGpuTrouble(true)
      toast('Your device ran low on graphics memory — showing a lighter preview. Export still works.', { type: 'error', duration: 7000 })
    } else if (failuresRef.current === 2) {
      setForceCanvas(true)
      toast('Graphics unavailable — switched to compatibility mode. Editing works (a bit slower); masks are off until you reload.', { type: 'error', duration: 9000 })
    } else if (failuresRef.current > 4) {
      return // give up remounting; compatibility mode should never get here
    }
    setCanvasKey((k) => k + 1)
  }, [toast])
  const setCanvasEl = useCallback((el) => {
    if (!el && canvasRef.current) releaseCanvas(canvasRef.current)
    canvasRef.current = el
    if (el) {
      el.addEventListener('webglcontextlost', (e) => {
        e.preventDefault()
        if (!el._released) recoverFromGpuFailure('webglcontextlost')
      }, { once: true })
    }
  }, [recoverFromGpuFailure])
  const clipCanvasRef = useRef(null)
  const areaRef = useRef(null)
  const stageRef = useRef(null)
  const active = state.images.find((im) => im.id === state.activeId)

  const [zoom, setZoom] = useState(1)
  const [compareOn, setCompareOn] = useState(false)
  const [holdBefore, setHoldBefore] = useState(false) // touch & hold the photo → original (LR Mobile)
  const [cropMode, setCropMode] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0, srcW: 1 })
  const [scrollbars, setScrollbars] = useState({ x: 0, y: 0 })
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })
  const anchorRef = useRef(null) // keeps the point under the fingers/cursor fixed while zooming

  const preview = usePreview(active)
  const interacting = useInteracting()

  // ---- Zoom math (derived during render, so a resolution switch never flashes) ----------
  // Normally the 1600px preview is rendered. While a slider is dragged, a ≤720px proxy is
  // used (smooth on phones). Past preview resolution, the full-size image is loaded so 1:1
  // really shows original pixels.
  const dpr = window.devicePixelRatio || 1
  const fitScale = canvasSize.w && stageBox.w ? Math.max(0.0001, Math.min(stageBox.w / canvasSize.w, stageBox.h / canvasSize.h)) : 1
  const fitW = canvasSize.w * fitScale // on-screen CSS width at "Fit"
  const previewW = active ? previewSizeFor(active.width, active.height).w : 1
  const outPerSrc = canvasSize.w / (canvasSize.srcW || 1) // output px per source px (crop-aware)
  const previewOutW = previewW * outPerSrc
  const fullOutW = (active?.width || 1) * outPerSrc
  // Phones/tablets stay on the preview at Fit even on very dense screens: a full-size render
  // there costs hundreds of MB of graphics memory (blank canvas) for no visible gain.
  const coarse = useMediaQuery('(pointer: coarse)')
  const wantFullRes = !!active && active.width > previewW * 1.01 && fitW > 0 && fitW * zoom * dpr > previewOutW * 1.05 && (!coarse || zoom > 1.01)
  // Full-size zoom is capped to what the GPU can take (and 3072 px on phones/tablets; 2048 px
  // after a GPU failure) — beyond that the canvas would stay blank.
  const fullCap = gpuTrouble ? 2048 : Math.min(gpuMaxDimension(), coarse ? 3072 : Infinity)
  const fullImage = useFullImage(active, wantFullRes, fullCap)
  const oneToOneZoom = fitW > 0 ? fullOutW / (fitW * dpr) : 1
  const maxZoom = Math.max(FIT_MAX_ZOOM, oneToOneZoom)
  const pct = fitW > 0 && fullOutW > 0 ? Math.round(((fitW * zoom * dpr) / fullOutW) * 100) : 100
  const isOneToOne = Math.abs(zoom - oneToOneZoom) < 0.01
  const dispW = canvasSize.w * fitScale * zoom
  const dispH = canvasSize.h * fitScale * zoom
  // Centering via real padding (not flex centering) so scroll can reach every edge when zoomed.
  const padding = { x: Math.max(0, (stageBox.w - dispW) / 2), y: Math.max(0, (stageBox.h - dispH) / 2), sbX: scrollbars.x, sbY: scrollbars.y }

  useEffect(() => {
    setZoom(1)
    setCompareOn(false)
    setCropMode(false)
    dispatch({ type: 'SET_SELECTED_MASK', id: null })
    dispatch({ type: 'SET_MASK_DRAW_MODE', mode: null })
    dispatch({ type: 'SET_SELECTED_SPOT', id: null })
  }, [state.activeId, dispatch])

  useEffect(() => {
    if (!active || !preview || compareOn || cropMode || !canvasRef.current) return
    const canvas = canvasRef.current
    const dragProxy = interacting ? getDragProxy(active.id) : null
    const source = dragProxy || (wantFullRes && fullImage) || preview
    const srcW = source.naturalWidth ?? source.width
    const raf = requestAnimationFrame(() => {
      const overlayId = state.maskOverlay && state.openAccordionId === 'masks' ? state.selectedMaskId : null
      const s = holdBefore ? { ...defaultSettings(), geometry: active.settings.geometry } : { ...effectiveSettings(active), _maskOverlayId: overlayId }
      try {
        renderImage(canvas, source, s, state.luts, { forceCanvas })
      } catch (err) {
        recoverFromGpuFailure(err)
        return
      }
      setCanvasSize((prev) => (prev.w === canvas.width && prev.h === canvas.height && prev.srcW === srcW ? prev : { w: canvas.width, h: canvas.height, srcW }))
      // Clipping overlay reads pixels back — skip it mid-drag, redo on release.
      if (clipCanvasRef.current && !dragProxy) drawClippingOverlay(canvas, clipCanvasRef.current, state.clipping)
    })
    return () => cancelAnimationFrame(raf)
  }, [active, preview, fullImage, wantFullRes, interacting, state.luts, compareOn, cropMode, state.clipping, holdBefore, canvasKey, forceCanvas, recoverFromGpuFailure, state.maskOverlay, state.selectedMaskId, state.openAccordionId])

  // Track the stage's real size. A ResizeObserver (not window resize) is needed because the
  // stage also shrinks when the mobile tool sheet opens or the header wraps.
  const hasStage = !!active && !cropMode
  useEffect(() => {
    const stage = stageRef.current
    if (!hasStage || !stage) return
    const ro = new window.ResizeObserver(() => setStageBox({ w: stage.clientWidth, h: stage.clientHeight }))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [hasStage])

  // Scrollbar thickness (0 unless zoomed in) so the info overlay never covers them; and keep
  // the zoom anchor (pinch midpoint / cursor / centre for 1:1) fixed on screen.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const sb = { x: stage.offsetWidth - stage.clientWidth, y: stage.offsetHeight - stage.clientHeight }
    if (sb.x !== scrollbars.x || sb.y !== scrollbars.y) setScrollbars(sb)
    const a = anchorRef.current
    if (a) {
      anchorRef.current = null
      stage.scrollLeft = a.fx * dispW + padding.x - a.mx
      stage.scrollTop = a.fy * dispH + padding.y - a.my
    }
  }, [dispW, dispH, padding.x, padding.y, scrollbars.x, scrollbars.y])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else areaRef.current?.requestFullscreen?.()
  }

  // Latest layout values for gesture handlers (window listeners outlive a single render).
  const layoutRef = useRef({})
  layoutRef.current = { zoom, maxZoom, dispW, dispH, padding }

  /** Zooms to `next`, keeping the photo point under (clientX, clientY) — or the centre — still. */
  function setZoomAt(next, clientX, clientY) {
    const { zoom: z0, maxZoom: zMax, dispW: w, dispH: h, padding: pad } = layoutRef.current
    const z = Math.min(zMax, Math.max(MIN_ZOOM, next))
    if (Math.abs(z - z0) < 0.0005) return
    const stage = stageRef.current
    if (stage && w > 0 && h > 0) {
      const r = stage.getBoundingClientRect()
      const mx = clientX == null ? stage.clientWidth / 2 : clientX - r.left
      const my = clientY == null ? stage.clientHeight / 2 : clientY - r.top
      const clamp01 = (v) => Math.min(1, Math.max(0, v))
      anchorRef.current = { fx: clamp01((stage.scrollLeft + mx - pad.x) / w), fy: clamp01((stage.scrollTop + my - pad.y) / h), mx, my }
    }
    setZoom(Math.round(z * 1000) / 1000)
  }

  function zoomBy(delta, clientX, clientY) {
    const z = layoutRef.current.zoom
    setZoomAt(z + delta * Math.max(1, z / 2), clientX, clientY)
  }

  function goOneToOne(clientX, clientY) {
    setZoomAt(oneToOneZoom, clientX, clientY)
  }

  function toggleFitOneToOne(clientX, clientY) {
    if (isOneToOne || zoom > 1.05) setZoomAt(1, clientX, clientY)
    else goOneToOne(clientX, clientY)
  }

  // Canvas-level keyboard shortcuts (global ones live in App / EditActionsBar).
  useEffect(() => {
    if (!active) return
    function onKeyDown(e) {
      if (shouldIgnoreShortcut(e) || isMod(e) || e.altKey) return
      if (cropMode) return // crop has its own interaction; don't fight it
      const key = e.key.toLowerCase()
      if (e.key === '\\') setCompareOn((v) => !v)
      else if (key === 'z') toggleFitOneToOne()
      else if (e.key === '+' || e.key === '=') zoomBy(0.25)
      else if (e.key === '-' || e.key === '_') zoomBy(-0.25)
      else if (key === 'r') setCropMode(true)
      else if (key === 'f') toggleFullscreen()
      else if (key === 'j') {
        const on = !(state.clipping.shadows && state.clipping.highlights)
        dispatch({ type: 'SET_CLIPPING', patch: { shadows: on, highlights: on } })
      } else if (key === 'i') dispatch({ type: 'SET_INFO_VISIBLE', visible: !state.infoVisible })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Wheel / trackpad zoom toward the cursor. Native non-passive listener so preventDefault
  // actually stops the page from scrolling (React's onWheel is passive).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function onWheel(e) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)) // ctrlKey = trackpad pinch
      setZoomAt(layoutRef.current.zoom * factor, e.clientX, e.clientY)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  })

  // Touch & mouse gestures on the photo: one pointer pans, two pointers pinch-zoom around
  // their midpoint, double-tap toggles Fit ↔ 1:1 at the tapped point.
  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)
  const lastTapRef = useRef({ t: 0, x: 0, y: 0 })
  const holdTimerRef = useRef(null)
  const swipeRef = useRef({ multi: false })
  useEffect(() => () => clearTimeout(holdTimerRef.current), [])

  function onStagePointerDown(e) {
    if (state.eyedropperActive) return // let the click-to-pick handler run instead
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const stage = stageRef.current
    if (!stage) return
    const pointers = pointersRef.current
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), x0: e.clientX, y0: e.clientY })
    const touchLike = e.pointerType !== 'mouse'
    // Touch & hold (no movement) shows the original; released → edited again.
    clearTimeout(holdTimerRef.current)
    // (Not while a tool uses taps on the photo: drawing masks, spot removal.)
    const photoTool = !!state.maskDrawMode || state.openAccordionId === 'healing'
    if (touchLike && pointers.size === 1 && !photoTool) {
      holdTimerRef.current = setTimeout(() => setHoldBefore(true), 450)
    } else if (pointers.size > 1) {
      setHoldBefore(false)
    }
    if (pointers.size === 1) swipeRef.current = { multi: false }
    else swipeRef.current.multi = true

    const beginPan = (pt) => {
      gestureRef.current = { type: 'pan', x: pt.x, y: pt.y, sl: stage.scrollLeft, st: stage.scrollTop }
      stage.classList.add('panning')
    }
    if (pointers.size === 1) beginPan({ x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()]
      gestureRef.current = { type: 'pinch', d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, z0: layoutRef.current.zoom }
    }
    if (pointers.size > 1) return // listeners already attached by the first pointer

    function move(ev) {
      if (!pointers.has(ev.pointerId)) return
      const p = pointers.get(ev.pointerId)
      p.x = ev.clientX
      p.y = ev.clientY
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) clearTimeout(holdTimerRef.current)
      const g = gestureRef.current
      if (!g) return
      if (g.type === 'pan' && pointers.size === 1) {
        stage.scrollLeft = g.sl - (ev.clientX - g.x)
        stage.scrollTop = g.st - (ev.clientY - g.y)
      } else if (g.type === 'pinch' && pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()]
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y)
        setZoomAt(g.z0 * (d / g.d0), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
      }
    }
    function up(ev) {
      const p = pointers.get(ev.pointerId)
      pointers.delete(ev.pointerId)
      clearTimeout(holdTimerRef.current)
      setHoldBefore(false)
      // Swipe left/right at Fit (one finger, mostly horizontal, quick) → next/previous photo.
      if (p && ev.pointerType !== 'mouse' && pointers.size === 0 && !swipeRef.current.multi && layoutRef.current.zoom <= 1.001) {
        const dx = ev.clientX - p.x0
        const dy = ev.clientY - p.y0
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - p.t < 700) {
          const shown = visibleImages(state)
          const idx = shown.findIndex((im) => im.id === state.activeId)
          const next = shown[idx + (dx < 0 ? 1 : -1)]
          if (next) dispatch({ type: 'SET_ACTIVE', id: next.id })
        }
      }
      // Double-tap (touch) → toggle Fit / 1:1 at that point.
      if (!photoTool && p && ev.pointerType !== 'mouse' && gestureRef.current?.type === 'pan' && performance.now() - p.t < 250 && Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) < 10) {
        const last = lastTapRef.current
        if (performance.now() - last.t < 320 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 30) {
          toggleFitOneToOne(ev.clientX, ev.clientY)
          lastTapRef.current = { t: 0, x: 0, y: 0 }
        } else lastTapRef.current = { t: performance.now(), x: ev.clientX, y: ev.clientY }
      }
      if (pointers.size === 1) {
        const [rest] = [...pointers.values()]
        gestureRef.current = { type: 'pan', x: rest.x, y: rest.y, sl: stage.scrollLeft, st: stage.scrollTop }
      }
      if (pointers.size === 0) {
        gestureRef.current = null
        stage.classList.remove('panning')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // Samples the clicked pixel from the already-graded canvas and jumps the HSL panel to
  // whichever of the 8 bands that color's hue is closest to.
  function pickColor(e) {
    if (!state.eyedropperActive || !canvasRef.current) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height)
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return

    // Copy to a plain 2D canvas first — the source canvas may be WebGL-context.
    const readCanvas = document.createElement('canvas')
    readCanvas.width = canvas.width
    readCanvas.height = canvas.height
    const rctx = readCanvas.getContext('2d')
    rctx.drawImage(canvas, 0, 0)
    const [r, g, b] = rctx.getImageData(x, y, 1, 1).data
    const [h] = rgbToHsl(r, g, b)

    let nearest = HSL_BANDS[0]
    let minDist = Infinity
    for (const band of HSL_BANDS) {
      let dist = Math.abs(h - BAND_HUE[band])
      if (dist > 180) dist = 360 - dist
      if (dist < minDist) {
        minDist = dist
        nearest = band
      }
    }
    dispatch({ type: 'SET_CURRENT_BAND', band: nearest })
    dispatch({ type: 'SET_EYEDROPPER', active: false })
  }

  // ---- Drag & drop import (works on the empty state and on top of a photo) ---------------
  const dropHandlers = {
    onDragOver(e) {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!dragOver) setDragOver(true)
    },
    onDragLeave(e) {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
    },
    onDrop(e) {
      if (!e.dataTransfer.files?.length) return
      e.preventDefault()
      setDragOver(false)
      importFiles(e.dataTransfer.files)
    },
  }
  const dropOverlay = dragOver && (
    <div className="drop-overlay" aria-hidden="true">
      <Icon name="plus" size={28} />
      <span>Drop to add photos</span>
    </div>
  )

  if (!active) {
    return (
      <div className={'col canvasArea' + (dragOver ? ' is-dragover' : '')} {...dropHandlers}>
        <EmptyState onFiles={importFiles} onFolder={importFolder} progress={progress} />
        {dropOverlay}
      </div>
    )
  }

  if (cropMode) {
    return (
      <div className="col canvasArea">
        <CropOverlay active={active} onDone={() => setCropMode(false)} />
      </div>
    )
  }

  const canUndo = active.history.past.length > 0
  const canRedo = active.history.future.length > 0
  const displaySize = canvasSize.w ? { width: canvasSize.w * fitScale * zoom, height: canvasSize.h * fitScale * zoom } : undefined
  const showClipping = state.clipping.shadows || state.clipping.highlights

  return (
    <div className={'col canvasArea' + (isFullscreen ? ' is-fullscreen' : '') + (dragOver ? ' is-dragover' : '')} ref={areaRef} {...dropHandlers}>
      <div className="preview-toolbar" role="toolbar" aria-label="Photo view">
        <div className="toolbar-group">
          <ToolbarButton icon="undo" label="Undo" onClick={() => undo(active.id)} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)" />
          <ToolbarButton icon="redo" label="Redo" onClick={() => redo(active.id)} disabled={!canRedo} title="Redo (Ctrl/⌘+Shift+Z)" />
        </div>
        <div className="toolbar-group">
          <button type="button" className="tbtn icon-only zoom-step" onClick={() => zoomBy(-0.25)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out (−)" title="Zoom out (−)">
            <Icon name="zoomOut" size={15} />
          </button>
          <span className="zoom-label" aria-live="polite" title="Percent of the photo's real pixels">
            {zoom === 1 ? `Fit · ${pct}%` : `${pct}%`}
          </span>
          <button type="button" className="tbtn icon-only zoom-step" onClick={() => zoomBy(0.25)} disabled={zoom >= maxZoom} aria-label="Zoom in (+)" title="Zoom in (+)">
            <Icon name="zoomIn" size={15} />
          </button>
          <button type="button" className={'tbtn' + (zoom === 1 ? ' active' : '')} onClick={() => setZoom(1)} aria-pressed={zoom === 1} title="Fit to screen (Z toggles)">
            Fit
          </button>
          <button type="button" className={'tbtn' + (isOneToOne ? ' active' : '')} onClick={() => goOneToOne()} aria-pressed={isOneToOne} title="Actual pixels (Z toggles)">
            1:1
          </button>
        </div>
        <div className="toolbar-group">
          <ToolbarButton icon="compare" label="Before/After" onClick={() => setCompareOn((v) => !v)} active={compareOn} title="Before / After (\)" />
          <ToolbarButton icon="crop" label="Crop" onClick={() => setCropMode(true)} title="Crop (R)" />
          <ToolbarButton icon={isFullscreen ? 'shrink' : 'expand'} label={isFullscreen ? 'Exit' : 'Fullscreen'} onClick={toggleFullscreen} title="Fullscreen (F)" />
        </div>
      </div>
      <div className="stage-wrap">
        <div className={'stage' + (state.eyedropperActive ? ' picking' : '')} ref={stageRef} onPointerDown={onStagePointerDown} onContextMenu={(e) => pointersRef.current.size > 0 && e.preventDefault()}>
          <div
            className="stage-inner"
            style={compareOn ? { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' } : { padding: `${padding.y}px ${padding.x}px` }}
          >
            {compareOn ? (
              <CompareSlider active={active} luts={state.luts} />
            ) : (
              <div className="canvas-mask-wrap" style={displaySize}>
                <canvas key={canvasKey} ref={setCanvasEl} style={displaySize} onClick={pickColor} role="img" aria-label={`Edited preview of ${active.name}`} />
                <canvas ref={clipCanvasRef} className="clip-overlay" hidden={!showClipping} aria-hidden="true" />
                <MaskCanvasOverlay active={active} />
                <SpotOverlay active={active} />
              </div>
            )}
          </div>
        </div>
        {holdBefore && <div className="hold-before-label" aria-live="polite">Before</div>}
        {/* Mobile: the toolbar row is hidden — its view tools float over the photo instead. */}
        <div className="photo-fabs show-mobile" role="toolbar" aria-label="Photo view">
          <button type="button" className={'fab' + (compareOn ? ' active' : '')} onClick={() => setCompareOn((v) => !v)} aria-pressed={compareOn} aria-label="Before / After" title="Before / After (or touch & hold the photo)">
            <Icon name="compare" size={17} />
          </button>
          <button type="button" className="fab" onClick={() => setCropMode(true)} aria-label="Crop" title="Crop">
            <Icon name="crop" size={17} />
          </button>
          <button type="button" className="fab" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen">
            <Icon name={isFullscreen ? 'shrink' : 'expand'} size={17} />
          </button>
        </div>
        {zoom !== 1 && !compareOn && (
          <button type="button" className="zoom-badge show-mobile" onClick={() => setZoom(1)} aria-label={`Zoom ${pct}%. Tap to fit`}>
            {pct}% · Fit
          </button>
        )}
        {!preview && !compareOn && (
          <div className="stage-loading" role="status">
            <span className="spinner" aria-hidden="true" /> Loading photo…
          </div>
        )}
        {/* Fixed to the bottom-right corner of the photo container (not the photo itself), so
            it stays put regardless of image size, orientation or zoom. Offset by the scrollbar
            thickness so it never covers the scrollbars when zoomed in. */}
        {!compareOn && <PhotoInfoOverlay inset={{ right: padding.sbX + 12, bottom: padding.sbY + 12 }} />}
        {showClipping && !compareOn && (
          <div className="clip-legend" aria-live="polite">
            <span>Clipping:</span>
            {state.clipping.highlights && <span className="clip-legend-hi">■ highlights</span>}
            {state.clipping.shadows && <span className="clip-legend-lo">■ shadows</span>}
            <button type="button" onClick={() => dispatch({ type: 'SET_CLIPPING', patch: { shadows: false, highlights: false } })} aria-label="Hide clipping warnings">
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </div>
      {state.eyedropperActive && <div className="eyedropper-hint">Click anywhere on the photo to pick a color</div>}
      {progress && <div className="import-pill">Importing {progress.done}/{progress.total}…</div>}
      {dropOverlay}
    </div>
  )
}
