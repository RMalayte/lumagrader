import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { parseCube } from '../engine/lut'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

export default function LutPanel() {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const { toast } = useFeedback()
  const active = state.images.find((im) => im.id === state.activeId)

  // No type filter on the picker: iPad greys out .cube (unknown type), so the content is checked.
  function importFiles(e) {
    Array.from(e.target.files).forEach((file) => {
      if (file.size > 64 * 1024 * 1024) {
        toast(`"${file.name}" is too large to be a .cube LUT`, { type: 'error' })
        return
      }
      const reader = new FileReader()
      reader.onload = (ev) => {
        const parsed = parseCube(ev.target.result)
        const name = file.name.replace(/\.cube$/i, '')
        if (parsed) {
          dispatch({ type: 'ADD_LUT', name, ...parsed })
          toast(`LUT "${name}" imported`)
        } else {
          toast(`"${file.name}" is not a valid .cube LUT`, { type: 'error' })
        }
      }
      reader.onerror = () => toast(`Could not read "${file.name}"`, { type: 'error' })
      reader.readAsText(file)
    })
    e.target.value = ''
  }

  if (!active) return null
  const lutNames = Object.keys(state.luts)

  return (
    <Accordion title="Your LUTs" id="luts" panelId="luts">
      {lutNames.length === 0 ? (
        <p className="panel-hint">No LUTs yet. Import a .cube file to use it as a look.</p>
      ) : (
        <div className="presets">
          {active.settings.lut && (
            <button type="button" className="preset-chip" onClick={() => commitPatch(active.id, { lut: null })}>
              None
            </button>
          )}
          {lutNames.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={active.settings.lut === name}
              className={'preset-chip' + (active.settings.lut === name ? ' active' : '')}
              onClick={() => commitPatch(active.id, { lut: name })}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <label className="action secondary file-btn">
        Import .cube LUT
        <input type="file" multiple hidden onChange={importFiles} aria-label="Import .cube LUT files" />
      </label>
      {active.settings.lut && (
        <div style={{ marginTop: 10 }}>
          <Slider
            label="LUT strength"
            value={active.settings.lutStrength}
            min={0}
            max={100}
            defaultValue={100}
            onBegin={() => beginEdit(active.id)}
            onChange={(v) => liveUpdate(active.id, { lutStrength: v })}
            onCommit={() => commitEdit(active.id)}
          />
        </div>
      )}
    </Accordion>
  )
}
