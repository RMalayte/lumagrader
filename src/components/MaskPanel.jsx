import { useProject } from '../store/ProjectContext'
import { createBrushMask } from '../engine/masks'
import { clearBrushCanvas, deleteBrushCanvas } from '../engine/brushMaskStore'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

const ADJUSTMENTS = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'temp', label: 'Temperature', min: -100, max: 100 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100 },
  { key: 'denoise', label: 'Noise Reduction', min: 0, max: 100 },
]

export default function MaskPanel() {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null

  const masks = active.settings.masks || []
  const selectedMask = masks.find((m) => m.id === state.selectedMaskId) || null

  function toggleDraw(mode) {
    dispatch({ type: 'SET_MASK_DRAW_MODE', mode: state.maskDrawMode === mode ? null : mode })
  }

  function addBrush() {
    const newMask = createBrushMask()
    commitPatch(active.id, { masks: [...masks, newMask] })
    dispatch({ type: 'SET_SELECTED_MASK', id: newMask.id })
    dispatch({ type: 'SET_MASK_DRAW_MODE', mode: null })
  }

  function clearBrush() {
    if (!selectedMask) return
    clearBrushCanvas(selectedMask.id)
    liveUpdate(active.id, { masks: masks.map((m) => (m.id === selectedMask.id ? { ...m, brushVersion: (m.brushVersion || 0) + 1 } : m)) })
  }

  function updateAdjustment(key, value) {
    liveUpdate(active.id, { masks: masks.map((m) => (m.id === state.selectedMaskId ? { ...m, adjustments: { ...m.adjustments, [key]: value } } : m)) })
  }

  function updateFeather(value) {
    liveUpdate(active.id, { masks: masks.map((m) => (m.id === state.selectedMaskId ? { ...m, feather: value } : m)) })
  }

  function toggleInvert() {
    commitPatch(active.id, { masks: masks.map((m) => (m.id === state.selectedMaskId ? { ...m, invert: !m.invert } : m)) })
  }

  function deleteMask() {
    if (selectedMask?.type === 'brush') deleteBrushCanvas(selectedMask.id)
    commitPatch(active.id, { masks: masks.filter((m) => m.id !== state.selectedMaskId) })
    dispatch({ type: 'SET_SELECTED_MASK', id: null })
  }

  return (
    <Accordion title="Masks" id="masks" panelId="masks">
      <div className="presets" style={{ marginBottom: 10 }}>
        <button type="button" aria-pressed={state.maskDrawMode === 'linear'} className={'preset-chip' + (state.maskDrawMode === 'linear' ? ' active' : '')} onClick={() => toggleDraw('linear')}>+ Linear</button>
        <button type="button" aria-pressed={state.maskDrawMode === 'radial'} className={'preset-chip' + (state.maskDrawMode === 'radial' ? ' active' : '')} onClick={() => toggleDraw('radial')}>+ Radial</button>
        <button type="button" className="preset-chip" onClick={addBrush}>+ Brush</button>
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
              {m.type === 'linear' ? 'Linear' : m.type === 'radial' ? 'Radial' : 'Brush'} {i + 1}
            </button>
          ))}
        </div>
      )}
      {selectedMask && (
        <>
          <div className="btnrow" style={{ marginTop: 0 }}>
            <label className="checkbox-row" style={{ flex: 1, margin: 0 }}>
              <input type="checkbox" checked={!!selectedMask.invert} onChange={toggleInvert} />
              Invert mask
            </label>
            <button className="action secondary" style={{ flex: 'none', padding: '6px 14px' }} onClick={deleteMask}>Delete</button>
          </div>

          {selectedMask.type === 'brush' && (
            <div style={{ marginTop: 8 }}>
              <div className="meta-empty" style={{ marginBottom: 8 }}>Drag directly on the photo to paint.</div>
              <Slider
                label="Brush size"
                value={state.brushSettings.size}
                min={2}
                max={80}
                defaultValue={20}
                onChange={(v) => dispatch({ type: 'SET_BRUSH_SETTING', patch: { size: v } })}
              />
              <Slider
                label="Hardness"
                value={state.brushSettings.hardness}
                min={0}
                max={100}
                defaultValue={60}
                onChange={(v) => dispatch({ type: 'SET_BRUSH_SETTING', patch: { hardness: v } })}
              />
              <Slider
                label="Flow"
                value={state.brushSettings.opacity}
                min={5}
                max={100}
                defaultValue={100}
                onChange={(v) => dispatch({ type: 'SET_BRUSH_SETTING', patch: { opacity: v } })}
              />
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

          <div style={{ marginTop: 8 }}>
            {selectedMask.type !== 'brush' && (
              <Slider
                label="Feather"
                value={selectedMask.feather ?? 100}
                min={0}
                max={100}
                defaultValue={100}
                onBegin={() => beginEdit(active.id)}
                onChange={updateFeather}
                onCommit={() => commitEdit(active.id)}
              />
            )}
            {ADJUSTMENTS.map(({ key, label, min, max }) => (
              <Slider
                key={key}
                label={label}
                value={selectedMask.adjustments[key]}
                min={min}
                max={max}
                defaultValue={0}
                onBegin={() => beginEdit(active.id)}
                onChange={(v) => updateAdjustment(key, v)}
                onCommit={() => commitEdit(active.id)}
              />
            ))}
          </div>
        </>
      )}
    </Accordion>
  )
}
