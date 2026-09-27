import { useProject } from '../store/ProjectContext'
import { defaultSettings } from '../engine/defaults'
import { kelvinToPos, posToKelvin, KELVIN_MIN, KELVIN_MAX, RAW_TINT_MAX } from '../engine/color'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

const TEMP_BAR = 'linear-gradient(to right,#3d7bd9,#c9c9c9,#e0b33a)'
const TINT_BAR = 'linear-gradient(to right,#3fae4a,#c9c9c9,#c64fc0)'
const Bar = ({ bg }) => <div className="hue-gradient-bar" style={{ background: bg }} aria-hidden="true" />

/**
 * Color panel. RAW photos (with the camera's as-shot white point) get Lightroom's RAW white
 * balance: Temp in Kelvin + Tint (−150…+150), starting at "As Shot". JPEGs keep the relative
 * −100…+100 Temp/Tint, like Lightroom does for non-RAW files.
 */
export default function ColorPanel() {
  const { state, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const s = active.settings
  const defaults = defaultSettings()
  const asShot = active.wbAsShot
  const common = {
    onBegin: () => beginEdit(active.id),
    onCommit: () => commitEdit(active.id),
  }
  const slider = (key, label, min, max, bar) => (
    <Slider key={key} label={label} value={s[key] ?? 0} min={min} max={max} step={1} defaultValue={defaults[key]}
      onChange={(v) => liveUpdate(active.id, { [key]: v })} {...common}>
      {bar && <Bar bg={bar} />}
    </Slider>
  )

  let wbBlock
  if (asShot) {
    const kelvin = s.wb?.kelvin ?? asShot.kelvin
    const tint = s.wb?.tint ?? asShot.tint
    // Back at the as-shot values → store null ("As Shot"), so presets/copies stay clean.
    const setWB = (k, t) => {
      const same = Math.abs(k - asShot.kelvin) < 1 && Math.abs(t - asShot.tint) < 0.05
      liveUpdate(active.id, { wb: same ? null : { kelvin: k, tint: t } })
    }
    const isAsShot = !s.wb
    wbBlock = (
      <>
        <div className="wb-row">
          <span className="wb-label">White Balance</span>
          <select
            className="wb-select"
            value={isAsShot ? 'asShot' : 'custom'}
            onChange={(e) => e.target.value === 'asShot' && commitPatch(active.id, { wb: null })}
            aria-label="White balance mode"
          >
            <option value="asShot">As Shot ({asShot.kelvin} K)</option>
            <option value="custom" disabled={isAsShot}>Custom</option>
          </select>
        </div>
        <Slider
          label="Temp"
          value={kelvinToPos(kelvin)}
          min={0}
          max={1000}
          step={1}
          defaultValue={kelvinToPos(asShot.kelvin)}
          format={() => String(Math.round(kelvin))}
          parse={(text) => kelvinToPos(Math.min(KELVIN_MAX, Math.max(KELVIN_MIN, Number(String(text).replace(/[^\d.]/g, '')) || asShot.kelvin)))}
          onChange={(pos) => setWB(pos === kelvinToPos(asShot.kelvin) ? asShot.kelvin : posToKelvin(pos), tint)}
          {...common}
        >
          <Bar bg={TEMP_BAR} />
        </Slider>
        <Slider
          label="Tint"
          value={Math.round(tint)}
          min={-RAW_TINT_MAX}
          max={RAW_TINT_MAX}
          step={1}
          defaultValue={Math.round(asShot.tint)}
          onChange={(v) => setWB(kelvin, v === Math.round(asShot.tint) ? asShot.tint : v)}
          {...common}
        >
          <Bar bg={TINT_BAR} />
        </Slider>
        {(s.temp || s.tint) ? (
          <p className="panel-hint">This photo also has a relative Temp/Tint from a preset ({s.temp || 0}/{s.tint || 0}).{' '}
            <button type="button" className="link-btn" onClick={() => commitPatch(active.id, { temp: 0, tint: 0 })}>Clear</button>
          </p>
        ) : null}
      </>
    )
  } else {
    wbBlock = (
      <>
        {slider('temp', 'Temperature', -100, 100, TEMP_BAR)}
        {slider('tint', 'Tint', -100, 100, TINT_BAR)}
      </>
    )
  }

  return (
    <Accordion title="Color" id="color" panelId="color">
      {wbBlock}
      {slider('vibrance', 'Vibrance', -100, 100)}
      {slider('saturation', 'Saturation', -100, 100)}
    </Accordion>
  )
}
