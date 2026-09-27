import { useProject } from '../store/ProjectContext'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

/** Lightroom's Optics panel (manual): distortion, lens vignetting, chromatic aberration. */
export default function OpticsPanel() {
  const { state, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const s = active.settings

  const slider = (key, label, min, max, def) => (
    <Slider
      label={label}
      value={s[key] ?? def}
      min={min}
      max={max}
      defaultValue={def}
      onBegin={() => beginEdit(active.id)}
      onChange={(v) => liveUpdate(active.id, { [key]: v })}
      onCommit={() => commitEdit(active.id)}
    />
  )

  return (
    <Accordion title="Optics" id="optics" panelId="optics">
      <label className="checkbox-row">
        <input type="checkbox" checked={!!s.removeCA} onChange={(e) => commitPatch(active.id, { removeCA: e.target.checked })} />
        Remove chromatic aberration
      </label>
      {slider('lensDistortion', 'Distortion', -100, 100, 0)}
      {slider('lensVignette', 'Vignetting', -100, 100, 0)}
      {!!s.lensVignette && <div className="sub-slider">{slider('lensVignetteMidpoint', 'Midpoint', 0, 100, 50)}</div>}
      <p className="panel-hint">+ Distortion straightens bulging (barrel) lines · + Vignetting brightens dark lens corners</p>
    </Accordion>
  )
}
