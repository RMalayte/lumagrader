import { useProject } from '../store/ProjectContext'
import { HSL_BANDS, BAND_COLOR, BAND_HUE } from '../engine/hsl'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

const ROWS = [
  { key: 'h', label: 'Hue' },
  { key: 's', label: 'Saturation' },
  { key: 'l', label: 'Luminance' },
]

const cap = (s) => s[0].toUpperCase() + s.slice(1)

export default function HSLPanel() {
  const { state, dispatch, liveUpdate, beginEdit, commitEdit } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null

  const band = state.currentBand
  const bandVal = active.settings.hsl[band]

  function setBandValue(key, value) {
    const hsl = { ...active.settings.hsl, [band]: { ...active.settings.hsl[band], [key]: value } }
    liveUpdate(active.id, { hsl })
  }

  // Bands with any non-zero value get a dot so it's clear which colors were touched.
  const bandEdited = (b) => ['h', 's', 'l'].some((k) => active.settings.hsl[b][k] !== 0)

  return (
    <Accordion title="HSL" id="hsl" panelId="hsl">
      <button
        type="button"
        className={'action secondary' + (state.eyedropperActive ? ' active-pick' : '')}
        style={{ width: '100%', marginBottom: 10 }}
        aria-pressed={state.eyedropperActive}
        onClick={() => dispatch({ type: 'SET_EYEDROPPER', active: !state.eyedropperActive })}
      >
        {state.eyedropperActive ? '◎ Click a color on the photo…' : '🎯 Pick color from photo'}
      </button>
      <div className="presets hsl-bands" role="radiogroup" aria-label="Color band">
        {HSL_BANDS.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={b === band}
            aria-label={cap(b)}
            title={cap(b)}
            className={'preset-chip band-chip' + (b === band ? ' active' : '')}
            style={{
              background: b === band ? BAND_COLOR[b] : undefined,
              borderColor: BAND_COLOR[b],
              color: b === band ? '#fff' : undefined,
            }}
            onClick={() => dispatch({ type: 'SET_CURRENT_BAND', band: b })}
          >
            {b[0].toUpperCase()}
            {bandEdited(b) && <span className="band-dot" />}
          </button>
        ))}
      </div>
      <div className="hsl-band-name">{cap(band)}</div>
      {ROWS.map(({ key, label }) => (
        <Slider
          key={key}
          label={label}
          value={bandVal[key]}
          min={-100}
          max={100}
          defaultValue={0}
          onBegin={() => beginEdit(active.id)}
          onChange={(v) => setBandValue(key, v)}
          onCommit={() => commitEdit(active.id)}
        >
          {key === 'h' && (
            <div
              className="hue-gradient-bar"
              style={{
                background: `linear-gradient(to right, hsl(${(BAND_HUE[band] - 60 + 360) % 360},65%,50%), hsl(${BAND_HUE[band]},70%,55%), hsl(${(BAND_HUE[band] + 60) % 360},65%,50%))`,
              }}
            />
          )}
        </Slider>
      ))}
    </Accordion>
  )
}
