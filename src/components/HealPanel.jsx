import { useProject } from '../store/ProjectContext'
import { spotRadius, spotSize } from '../engine/heal'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'
import { useFeedback } from '../store/FeedbackContext'

const MODES = [
  { id: 'heal', label: 'Heal' },
  { id: 'clone', label: 'Clone' },
]

/** Spot removal. The on-photo part (tap to add, drag to move) is SpotOverlay. */
export default function HealPanel() {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const { confirm } = useFeedback()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const spots = active.settings.spots || []
  const sel = spots.find((sp) => sp.id === state.selectedSpotId) || null
  const defaults = state.spotSettings

  // With a spot selected the controls edit that spot; otherwise they set up the next one.
  const value = (key) => (sel ? (key === 'size' ? spotSize(sel.r) : sel[key]) : defaults[key])
  const setSpot = (patch, commit = false) => {
    const next = spots.map((sp) => (sp.id === sel.id ? { ...sp, ...patch } : sp))
    if (commit) commitPatch(active.id, { spots: next })
    else liveUpdate(active.id, { spots: next })
  }
  const change = (key, v) => {
    if (!sel) dispatch({ type: 'SET_SPOT_SETTING', patch: { [key]: v } })
    else setSpot(key === 'size' ? { r: spotRadius(v) } : { [key]: v })
  }
  const setMode = (mode) => {
    dispatch({ type: 'SET_SPOT_SETTING', patch: { mode } })
    if (sel) setSpot({ mode }, true)
  }
  const removeSelected = () => {
    commitPatch(active.id, { spots: spots.filter((sp) => sp.id !== sel.id) })
    dispatch({ type: 'SET_SELECTED_SPOT', id: null })
  }

  const slider = (key, label, min, def) => (
    <Slider
      label={label}
      value={value(key)}
      min={min}
      max={100}
      defaultValue={def}
      onBegin={() => sel && beginEdit(active.id)}
      onChange={(v) => change(key, v)}
      onCommit={() => sel && commitEdit(active.id)}
    />
  )

  return (
    <Accordion title="Healing" id="healing" panelId="healing">
      <p className="panel-hint" style={{ marginTop: 0 }}>
        Tap a blemish or dust spot on the photo to remove it. Drag a circle to move it, or drag its dashed source to choose where it copies from.
      </p>
      <div className="presets" role="radiogroup" aria-label="Spot type" style={{ marginBottom: 8 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={value('mode') === m.id}
            className={'preset-chip' + (value('mode') === m.id ? ' active' : '')}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {slider('size', 'Size', 1, 20)}
      {slider('feather', 'Feather', 0, 50)}
      {slider('opacity', 'Opacity', 1, 100)}
      <div className="btnrow">
        {sel && <button type="button" className="action secondary" onClick={removeSelected}>Delete spot</button>}
        {spots.length > 0 && (
          <button
            type="button"
            className="action secondary"
            onClick={async () => {
              const ok = await confirm({ title: `Remove all ${spots.length} spots?`, message: 'You can bring them back with Undo.', confirmLabel: 'Remove all', danger: true })
              if (!ok) return
              commitPatch(active.id, { spots: [] })
              dispatch({ type: 'SET_SELECTED_SPOT', id: null })
            }}
          >
            Clear all ({spots.length})
          </button>
        )}
      </div>
      <p className="panel-hint">{sel ? 'Editing the selected spot · tap elsewhere on the photo to add another' : 'Settings for the next spot'}</p>
    </Accordion>
  )
}
