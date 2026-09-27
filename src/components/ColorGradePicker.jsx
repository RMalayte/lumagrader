import { useProject } from '../store/ProjectContext'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

export default function ColorGradePicker() {
  const { state, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const cg = active.settings.colorGrade

  return (
    <Accordion title="Color grade" id="colorGrade" panelId="colorGrade">
      <div className="color-grade-row">
        <label className="color-swatch" title="Grade color">
          <input
            type="color"
            value={cg.hex}
            aria-label="Grade color"
            onChange={(e) => commitPatch(active.id, { colorGrade: { ...cg, hex: e.target.value } })}
          />
        </label>
        <div style={{ flex: 1 }}>
          <Slider
            label="Intensity"
            value={cg.intensity}
            min={0}
            max={100}
            defaultValue={0}
            onBegin={() => beginEdit(active.id)}
            onChange={(v) => liveUpdate(active.id, { colorGrade: { ...cg, intensity: v } })}
            onCommit={() => commitEdit(active.id)}
          />
        </div>
      </div>
    </Accordion>
  )
}
