import { useEffect, useState } from 'react'
import { effectiveSettings } from '../engine/panels'
import JSZip from 'jszip'
import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { renderToCanvas } from '../engine/pipeline'
import { getFullImage } from '../engine/imageStore'
import { gpuMaxDimension } from '../engine/webgl/renderer'
import { resizeCanvas, applyWatermark, formatMime, formatExt, injectExif } from '../engine/exportUtils'
import { takeSupportNudge, requestSupportPrompt } from '../config'
import { canPickFile, canPickFolder, safeFileName, stripExt, isAbort, pickSaveFile, pickFolder, writeToHandle, writeToFolder, downloadBlob } from '../engine/saveTarget'

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
  const [progress, setProgress] = useState(null) // { done, total, stage }
  const [error, setError] = useState(null)
  // File names and where they go (folder/name pickers where the browser allows it).
  const baseOf = (name) => (name || 'photo').replace(/\.[^.]+$/, '')
  const [fileName, setFileName] = useState(() => (mode === 'single' && active ? baseOf(active.name) : 'lumagrader-export'))
  const [multiTarget, setMultiTarget] = useState('zip') // 'zip' | 'folder'
  const [naming, setNaming] = useState('original') // 'original' | 'sequence'
  const [seqBase, setSeqBase] = useState(() => safeFileName(state.currentProjectName || 'LumaGrader'))
  const single = targets.length === 1
  const ext = formatExt(format)
  const usePicker = single || multiTarget === 'zip' ? canPickFile() : canPickFolder()

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

  // Name of each exported photo (without extension), unique within this export.
  function exportNames() {
    const digits = Math.max(2, String(targets.length).length)
    const used = new Set()
    return targets.map((im, i) => {
      const base = naming === 'sequence' && !single ? `${safeFileName(seqBase, 'Photo')}_${String(i + 1).padStart(digits, '0')}` : safeFileName(baseOf(im.name))
      let name = `${base}.${ext}`
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`
      used.add(name.toLowerCase())
      return name
    })
  }

  async function runExport() {
    if (!targets.length || busy) return
    const singleName = `${safeFileName(stripExt(fileName.trim(), ext), baseOf(targets[0].name))}.${ext}`
    const zipName = `${safeFileName(stripExt(fileName.trim(), 'zip'), 'lumagrader-export')}.zip`
    // Ask where to save FIRST, straight from the click (browsers require that); rendering after.
    let handle = null, dir = null
    try {
      if (single) handle = await pickSaveFile(singleName, formatMime(format), ext)
      else if (multiTarget === 'zip') handle = await pickSaveFile(zipName, 'application/zip', 'zip')
      else if (canPickFolder()) dir = await pickFolder()
    } catch (err) {
      if (isAbort(err)) return // cancelled the save dialog: stay in the export window
      console.warn('Save picker unavailable — downloading instead', err)
    }
    setBusy(true)
    setError(null)
    setProgress({ done: 0, total: targets.length, stage: 'render' })
    try {
      const names = exportNames()
      let doneMsg
      if (single) {
        const blob = await renderFinal(targets[0])
        if (!blob) throw new Error('Encoding failed')
        setProgress({ done: 1, total: 1, stage: 'save' })
        if (handle) await writeToHandle(handle, blob)
        else downloadBlob(blob, singleName)
        doneMsg = handle ? `Saved "${handle.name}"` : `Exported "${singleName}" — check your Downloads`
      } else if (dir) {
        for (let i = 0; i < targets.length; i++) {
          const blob = await renderFinal(targets[i])
          if (!blob) throw new Error(`Encoding failed for ${targets[i].name}`)
          await writeToFolder(dir, names[i], blob)
          setProgress((p) => ({ ...p, done: p.done + 1 }))
        }
        doneMsg = `Saved ${targets.length} photos to "${dir.name}"`
      } else {
        const zip = new JSZip()
        for (let i = 0; i < targets.length; i++) {
          const blob = await renderFinal(targets[i])
          if (!blob) throw new Error(`Encoding failed for ${targets[i].name}`)
          zip.file(names[i], blob)
          setProgress((p) => ({ ...p, done: p.done + 1 }))
        }
        setProgress((p) => ({ ...p, stage: 'zip' }))
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        if (handle) await writeToHandle(handle, zipBlob)
        else downloadBlob(zipBlob, zipName)
        doneMsg = handle ? `Saved ${targets.length} photos in "${handle.name}"` : `Exported ${targets.length} photos as "${zipName}" — check your Downloads`
      }
      toast(doneMsg)
      onClose()
      // Once a week: a centred "Support LumaGrader" card, after the file is saved (and after any
      // "Save as…" dialog is closed) — never before, so it never stands in the way.
      if (takeSupportNudge()) requestSupportPrompt({ count: targets.length })
    } catch (err) {
      console.error('Export failed', err)
      // Stay open with the reason, so a different size or format can be tried right away.
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      const reason = denied
        ? 'The browser did not allow saving there — pick another folder.'
        : err?.message && /Encoding failed/.test(err.message) ? err.message + '. Try a smaller size or another format.' : 'The photo could not be processed. Try a smaller size or another format.'
      setError(`Export failed. ${reason}`)
    } finally {
      setBusy(false)
      setProgress(null)
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
          <h4 className="modal-subhead">File</h4>
          {!single && (
            <div className="presets" role="radiogroup" aria-label="Save as" style={{ marginBottom: 10 }}>
              {[['zip', 'One .zip file'], ['folder', 'Separate files']].map(([v, label]) => (
                <button
                  type="button"
                  key={v}
                  role="radio"
                  aria-checked={multiTarget === v}
                  className={'preset-chip' + (multiTarget === v ? ' active' : '')}
                  onClick={() => setMultiTarget(v)}
                  disabled={v === 'folder' && !canPickFolder()}
                  title={v === 'folder' && !canPickFolder() ? 'This browser can only download a .zip — use Chrome or Edge on a computer to save into a folder' : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {(single || multiTarget === 'zip') && (
            <label className="file-name-row">
              <span className="file-name-label">{single ? 'File name' : 'Zip name'}</span>
              <span className="file-name-field">
                <input
                  type="text"
                  className="text-input"
                  value={fileName}
                  maxLength={120}
                  spellCheck={false}
                  onChange={(e) => setFileName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runExport()}
                />
                <span className="file-ext">.{single ? ext : 'zip'}</span>
              </span>
            </label>
          )}
          {!single && (
            <>
              <div className="presets" role="radiogroup" aria-label="Photo names" style={{ margin: '10px 0' }}>
                {[['original', 'Original names'], ['sequence', 'Name + number']].map(([v, label]) => (
                  <button type="button" key={v} role="radio" aria-checked={naming === v} className={'preset-chip' + (naming === v ? ' active' : '')} onClick={() => setNaming(v)}>
                    {label}
                  </button>
                ))}
              </div>
              {naming === 'sequence' && (
                <label className="file-name-row">
                  <span className="file-name-label">Name</span>
                  <span className="file-name-field">
                    <input type="text" className="text-input" value={seqBase} maxLength={80} spellCheck={false} onChange={(e) => setSeqBase(e.target.value)} />
                  </span>
                </label>
              )}
              <p className="panel-hint">e.g. {exportNames().slice(0, 2).join(', ')}{targets.length > 2 ? ', …' : ''}</p>
            </>
          )}
          <p className="panel-hint save-where">
            {usePicker
              ? single || multiTarget === 'zip'
                ? 'You\'ll choose the folder (and can still rename) when you press Export.'
                : 'You\'ll choose the folder when you press Export. Existing files are never overwritten.'
              : 'Saved to your Downloads folder — this browser doesn\'t let apps choose a folder (Chrome or Edge on a computer can).'}
          </p>

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
          {progress && (
            <div className="export-progress" role="status" aria-live="polite">
              <div className="export-progress-bar"><span style={{ width: `${(progress.stage === 'zip' ? 1 : progress.done / progress.total) * 100}%` }} /></div>
              <div className="export-progress-text">
                {progress.stage === 'zip' ? 'Packing the .zip…' : progress.total > 1 ? `Exporting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Exporting…'}
              </div>
            </div>
          )}
          {error && <div className="export-error" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="action secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="action primary" onClick={runExport} disabled={busy || !targets.length}>
            {busy ? <><span className="spinner" aria-hidden="true" /> Exporting…</> : error ? 'Try again' : `Export${targets.length > 1 ? ` (${targets.length})` : ''}${usePicker ? '…' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
