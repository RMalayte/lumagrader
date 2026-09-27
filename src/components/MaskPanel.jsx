import { useProject } from '../store/ProjectContext'
import { createBrushMask, createLuminanceMask, createColorMask, defaultLuminanceRange, defaultColorRange, MASK_LABELS } from '../engine/masks'
import { clearBrushCanvas } from '../engine/brushMaskStore'
import { oklabToLinear } from '../engine/color'
import { srgbEncode } from '../engine/tone'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

const ADJUSTMENTS = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'temp', label: 'Temperature', min: -100, max: 100 },
  { key: 'sharpen', label: 'Sharpness', min: -100, max: 100 }, // − softens (like LR)
  { key: 'denoise', label: 'Noise Reduction', min: 0, max: 100 },
]
const RANGE_ONLY = new Set(['luminance', 'color'])

function swatch(color) {
  if (!color) return 'transparent'
  const [r, g, b] = oklabToLinear(...color).map((v) => Math.round(Math.min(1, Math.max(0, srgbEncode(Math.max(0, v)))) * 255))
  return `rgb(${r},${g},${b})`
}

export default function MaskPanel() {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null

  const masks = active.settings.masks || []
  const selectedMask = masks.find((m) => m.id === state.selectedMaskId) || null
  const begin = () => beginEdit(active.id)
  const commit = () => commitEdit(active.id)
  const patchSelected = (patch) => masks.map((m) => (m.id === state.selectedMaskId ? { ...m, ...patch } : m))
  const live = (patch) => liveUpdate(active.id, { masks: patchSelected(patch) })

  function toggleDraw(mode) {
    dispatch({ type: 'SET_MASK_DRAW_MODE', mode: state.maskDrawMode === mode ? null : mode })
  }

  function addMask(mask) {
    commitPatch(active.id, { masks: [...masks, mask] })
    dispatch({ type: 'SET_SELECTED_MASK', id: mask.id })
    dispatch({ type: 'SET_MASK_DRAW_MODE', mode: null })
    // A new color mask starts by picking its colour on the photo.
    if (mask.type === 'color') dispatch({ type: 'SET_MASK_PICK_COLOR', on: true })
  }

  function clearBrush() {
    if (!selectedMask) return
    clearBrushCanvas(selectedMask.id)
    live({ brushVersion: (selectedMask.brushVersion || 0) + 1 })
  }

  function setRangeType(type) {
    const range = type === 'luminance' ? defaultLuminanceRange() : type === 'color' ? defaultColorRange() : null
    commitPatch(active.id, { masks: patchSelected({ range }) })
    dispatch({ type: 'SET_MASK_PICK_COLOR', on: type === 'color' })
  }

  function deleteMask() {
    // Brush pixels are kept (not deleted) so Undo and snapshots can bring the mask back.
    commitPatch(active.id, { masks: masks.filter((m) => m.id !== state.selectedMaskId) })
    dispatch({ type: 'SET_SELECTED_MASK', id: null })
  }

  const chip = (label, onClick, pressed) => (
    <button type="button" aria-pressed={pressed} className={'preset-chip' + (pressed ? ' active' : '')} onClick={onClick}>{label}</button>
  )
  const range = selectedMask?.range || null

  return (
    <Accordion title="Masks" id="masks" panelId="masks">
      <div className="presets" style={{ marginBottom: 10 }}>
        {chip('+ Linear', () => toggleDraw('linear'), state.maskDrawMode === 'linear')}
        {chip('+ Radial', () => toggleDraw('radial'), state.maskDrawMode === 'radial')}
        {chip('+ Brush', () => addMask(createBrushMask()), false)}
        {chip('+ Luminance', () => addMask(createLuminanceMask()), false)}
        {chip('+ Color', () => addMask(createColorMask()), false)}
      </div>
      {state.maskDrawMode && <div className="meta-empty" style={{ marginBottom: 8 }}>Drag on the photo to draw the {state.maskDrawMode} mask.</div>}
      {masks.length > 0 && (
        <div className="presets" style={{ marginBottom: 10 }}>
          {masks.map((m, i) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === state.selectedMaskId}
              className={'preset-chip' + (m.id === state.selectedMaskId ? ' active' : '')}
              onClick={() => dispatch({ type: 'SET_SELECTED_MASK', id: m.id })}
            >
              {MASK_LABELS[m.type] || 'Mask'} {i + 1}
            </button>
          ))}
        </div>
      )}
      {selectedMask && (
        <>
          <div className="btnrow" style={{ marginTop: 0 }}>
            <label className="checkbox-row" style={{ flex: 1, margin: 0 }}>
              <input type="checkbox" checked={!!selectedMask.invert} onChange={() => commitPatch(active.id, { masks: patchSelected({ invert: !selectedMask.invert }) })} />
              Invert
            </label>
            <label className="checkbox-row" style={{ flex: 1, margin: 0 }}>
              <input type="checkbox" checked={state.maskOverlay} onChange={(e) => dispatch({ type: 'SET_MASK_OVERLAY', on: e.target.checked })} />
              Show overlay
            </label>
            <button className="action secondary" style={{ flex: 'none', padding: '6px 14px' }} onClick={deleteMask}>Delete</button>
          </div>

          {selectedMask.type === 'brush' && (
            <div style={{ marginTop: 8 }}>
              <div className="meta-empty" style={{ marginBottom: 8 }}>Drag directly on the photo to paint.</div>
              <Slider label="Brush size" value={state.brushSettings.size} min={2} max={80} defaultValue={20} onChange={(v) => dispatch({ type: 'SET_BRUSH_SETTING', patch: { size: v } })} />
              <Slider label="Hardness" value={state.brushSettings.hardness} min={0} max={100} defaultValue={60} onChange={(v) => dispatch({ type: 'SET_BRUSH_SETTING', patch: { hardness: v } })} />
              <Slider label="Flow" value={state.brushSettings.opacity} min={5} max={100} defaultValue={100} onChange={(v) => dispatch({ type: 'SET_BRUSH_SETTING', patch: { opacity: v } })} />
              <div className="btnrow" style={{ marginTop: 0 }}>
                <button
                  className={'action secondary' + (state.brushSettings.erase ? ' active-pick' : '')}
                  onClick={() => dispatch({ type: 'SET_BRUSH_SETTING', patch: { erase: !state.brushSettings.erase } })}
                >
                  {state.brushSettings.erase ? '🩹 Erasing' : '🖌️ Painting'}
                </button>
                <button className="action secondary" onClick={clearBrush}>Clear</button>
              </div>
            </div>
          )}

          {(selectedMask.type === 'linear' || selectedMask.type === 'radial') && (
            <div style={{ marginTop: 8 }}>
              <Slider label="Feather" value={selectedMask.feather ?? 100} min={0} max={100} defaultValue={100} onBegin={begin} onChange={(v) => live({ feather: v })} onCommit={commit} />
            </div>
          )}

          <div className="mask-range">
            {!RANGE_ONLY.has(selectedMask.type) && (
              <div className="presets" role="radiogroup" aria-label="Refine the mask by" style={{ marginBottom: 6 }}>
                <span className="mask-range-label">Refine by</span>
                {[['none', 'None'], ['luminance', 'Luminance'], ['color', 'Color']].map(([id, label]) => {
                  const on = (range?.type || 'none') === id
                  return (
                    <button key={id} type="button" role="radio" aria-checked={on} className={'preset-chip' + (on ? ' active' : '')} onClick={() => !on && setRangeType(id === 'none' ? null : id)}>
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            {range?.type === 'luminance' && (
              <>
                <Slider label="Darkest" value={range.min} min={0} max={100} defaultValue={60} onBegin={begin} onChange={(v) => live({ range: { ...range, min: v } })} onCommit={commit} />
                <Slider label="Brightest" value={range.max} min={0} max={100} defaultValue={100} onBegin={begin} onChange={(v) => live({ range: { ...range, max: v } })} onCommit={commit} />
                <Slider label="Smoothness" value={range.smooth ?? 30} min={0} max={100} defaultValue={30} onBegin={begin} onChange={(v) => live({ range: { ...range, smooth: v } })} onCommit={commit} />
              </>
            )}
            {range?.type === 'color' && (
              <>
                <div className="btnrow" style={{ marginTop: 0, alignItems: 'center' }}>
                  <span className="color-swatch" style={{ backgroundColor: swatch(range.color) }} aria-label={range.color ? 'Picked colour' : 'No colour picked'} />
                  <button
                    type="button"
                    className={'action secondary' + (state.maskPickColor ? ' active-pick' : '')}
                    aria-pressed={state.maskPickColor}
                    onClick={() => dispatch({ type: 'SET_MASK_PICK_COLOR', on: !state.maskPickColor })}
                  >
                    {state.maskPickColor ? 'Tap the photo…' : range.color ? 'Pick again' : 'Pick color'}
                  </button>
                </div>
                <Slider label="Range" value={range.amount ?? 40} min={0} max={100} defaultValue={40} onBegin={begin} onChange={(v) => live({ range: { ...range, amount: v } })} onCommit={commit} />
              </>
            )}
          </div>

          <div style={{ marginTop: 8 }}>
            {ADJUSTMENTS.map(({ key, label, min, max }) => (
              <Slider
                key={key}
                label={label}
                value={selectedMask.adjustments[key]}
                min={min}
                max={max}
                defaultValue={0}
                onBegin={begin}
                onChange={(v) => live({ adjustments: { ...selectedMask.adjustments, [key]: v } })}
                onCommit={commit}
              />
            ))}
          </div>
        </>
      )}
    </Accordion>
  )
}
