import { useEffect, useState } from 'react'
import { effectiveSettings } from '../engine/panels'
import JSZip from 'jszip'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { renderToCanvas } from '../engine/pipeline'
import { getFullImage } from '../engine/imageStore'
import { gpuMaxDimension } from '../engine/webgl/renderer'
import { resizeCanvas, applyWatermark, formatMime, formatExt, injectExif } from '../engine/exportUtils'

const RESOLUTIONS = [
  { label: 'Original', value: null },
  { label: '2048px', value: 2048 },
  { label: '1920px', value: 1920 },
  { label: '1080px', value: 1080 },
]
const WATERMARK_POSITIONS = [
  { label: 'Bottom Right', value: 'bottom-right' },
  { label: 'Bottom Left', value: 'bottom-left' },
  { label: 'Top Right', value: 'top-right' },
  { label: 'Top Left', value: 'top-left' },
  { label: 'Center', value: 'center' },
]

// mode: 'single' | 'selected' | 'all'
export default function ExportModal({ mode, onClose }) {
  const { state } = useProject()
  const { toast } = useFeedback()
  const active = state.images.find((im) => im.id === state.activeId)
  const targets =
    mode === 'single' ? (active ? [active] : []) : mode === 'selected' ? state.images.filter((im) => state.selectedIds.includes(im.id)) : state.images

  const [format, setFormat] = useState('jpeg')
  const [quality, setQuality] = useState(92)
  const [maxDim, setMaxDim] = useState(null)
  const [preserveMetadata, setPreserveMetadata] = useState(true)
  const [watermark, setWatermark] = useState({ type: 'none', text: '', position: 'bottom-right', opacity: 70, size: 30, logoImg: null })
  const [busy, setBusy] = useState(false)

  function updateWatermark(patch) {
    setWatermark((w) => ({ ...w, ...patch }))
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const img = new Image()
    img.onload = () => updateWatermark({ logoImg: img })
    img.src = URL.createObjectURL(file)
  }

  async function renderFinal(im) {
    // Full-size pixels are decoded only now, one photo at a time (the cache keeps just one).
    // Phones: capped to what the GPU takes (6000 px long side at most); if the GPU still gives
    // up, retry at 70% until it fits — never a blank or silently different file.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    let cap = Math.min(gpuMaxDimension(), coarse ? 6000 : Infinity)
    let canvas = null, full = null
    for (let attempt = 0; attempt < 4 && !canvas; attempt++) {
      full = await getFullImage(im, cap)
      try {
        canvas = renderToCanvas(document.createElement('canvas'), full, effectiveSettings(im), state.luts, { allowCanvasFallback: attempt === 3 })
      } catch (err) {
        console.warn(`Export render failed at ${full.width}×${full.height}, retrying smaller`, err)
        cap = Math.round(Math.max(full.width, full.height) * 0.7)
      }
    }
    if (full.reducedSize) toast(`${im.name}: exported at ${canvas.width}×${canvas.height} — the full size is too large for this device`, { type: 'error', duration: 7000 })
    const resized = resizeCanvas(canvas, maxDim)
    const watermarked = applyWatermark(resized, watermark)
    let blob = await new Promise((res) => watermarked.toBlob(res, formatMime(format), quality / 100))
    if (format === 'jpeg' && preserveMetadata) {
      blob = await injectExif(blob, im.originalBlob)
    }
    return blob
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  async function runExport() {
    if (!targets.length || busy) return
    setBusy(true)
    try {
      if (targets.length === 1) {
        const blob = await renderFinal(targets[0])
        if (!blob) throw new Error('Encoding failed')
        download(blob, targets[0].name.replace(/\.[^.]+$/, '') + '.' + formatExt(format))
      } else {
        const zip = new JSZip()
        const used = new Set()
        for (const im of targets) {
          const blob = await renderFinal(im)
          if (!blob) throw new Error(`Encoding failed for ${im.name}`)
          // Avoid silently overwriting photos that share a filename inside the zip.
          const base = im.name.replace(/\.[^.]+$/, '')
          let fname = base + '.' + formatExt(format)
          for (let n = 2; used.has(fname); n++) fname = `${base} (${n}).${formatExt(format)}`
          used.add(fname)
          zip.file(fname, blob)
        }
        download(await zip.generateAsync({ type: 'blob' }), 'lumagrader-export.zip')
      }
      toast(targets.length === 1 ? 'Export ready — check your downloads' : `Exported ${targets.length} photos (.zip)`)
      onClose()
    } catch (err) {
      console.error('Export failed', err)
      toast('Export failed. Try a smaller size or another format.', { type: 'error', duration: 7000 })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const title = mode === 'single' ? `Export "${active?.name}"` : mode === 'selected' ? `Export ${targets.length} selected photos` : `Export all ${targets.length} photos`

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="export-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close export">×</button>
        </div>
        <div className="modal-body">
          <h4 className="modal-subhead">Format & Quality</h4>
          <div className="presets" style={{ marginBottom: 10 }}>
            {['jpeg', 'png', 'webp'].map((f) => (
              <button type="button" key={f} className={'preset-chip' + (format === f ? ' active' : '')} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {format !== 'png' && (
            <div className="slider-row">
              <label>Quality <b>{quality}%</b></label>
              <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            </div>
          )}
          <div className="presets" style={{ marginBottom: 10 }}>
            {RESOLUTIONS.map((r) => (
              <button type="button" key={r.label} className={'preset-chip' + (maxDim === r.value ? ' active' : '')} onClick={() => setMaxDim(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          {format === 'jpeg' && (
            <label className="checkbox-row">
              <input type="checkbox" checked={preserveMetadata} onChange={(e) => setPreserveMetadata(e.target.checked)} />
              Preserve original metadata (EXIF)
            </label>
          )}

          <h4 className="modal-subhead">Watermark</h4>
          <div className="presets" style={{ marginBottom: 10 }}>
            {['none', 'text', 'logo'].map((t) => (
              <button type="button" key={t} className={'preset-chip' + (watermark.type === t ? ' active' : '')} onClick={() => updateWatermark({ type: t })}>
                {t === 'none' ? 'None' : t === 'text' ? 'Text' : 'Logo'}
              </button>
            ))}
          </div>
          {watermark.type === 'text' && (
            <input
              type="text"
              placeholder="@yourhandle"
              value={watermark.text}
              onChange={(e) => updateWatermark({ text: e.target.value })}
              className="text-input"
              style={{ marginBottom: 10 }}
            />
          )}
          {watermark.type === 'logo' && (
            <label className="action secondary" style={{ width: '100%', display: 'block', textAlign: 'center', cursor: 'pointer', marginBottom: 10 }}>
              {watermark.logoImg ? 'Change logo image' : 'Upload logo image'}
              <input type="file" accept="image/*" hidden onChange={handleLogoUpload} />
            </label>
          )}
          {watermark.type !== 'none' && (
            <>
              <div className="presets" style={{ marginBottom: 10 }}>
                {WATERMARK_POSITIONS.map((p) => (
                  <button type="button" key={p.value} className={'preset-chip' + (watermark.position === p.value ? ' active' : '')} onClick={() => updateWatermark({ position: p.value })}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="slider-row">
                <label>Opacity <b>{watermark.opacity}</b></label>
                <input type="range" min={10} max={100} value={watermark.opacity} onChange={(e) => updateWatermark({ opacity: Number(e.target.value) })} />
              </div>
              <div className="slider-row">
                <label>Size <b>{watermark.size}</b></label>
                <input type="range" min={5} max={100} value={watermark.size} onChange={(e) => updateWatermark({ size: Number(e.target.value) })} />
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="action secondary" onClick={onClose}>Cancel</button>
          <button className="action primary" onClick={runExport} disabled={busy || !targets.length}>
            {busy ? 'Exporting…' : `Export ${targets.length > 1 ? `(${targets.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
