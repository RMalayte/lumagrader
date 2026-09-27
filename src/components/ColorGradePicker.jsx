import { useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { defaultColorGrade } from '../engine/color'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'
import ColorWheel from './ColorWheel.jsx'

const VIEWS = [
  { id: '3way', label: '3-Way' },
  { id: 'shadows', label: 'Shadows' },
  { id: 'midtones', label: 'Midtones' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'global', label: 'Global' },
]
const HUE_BAR = 'linear-gradient(to right,#f00,#ff0 16.7%,#0f0 33.3%,#0ff 50%,#00f 66.7%,#f0f 83.3%,#f00)'
const LUM_BAR = 'linear-gradient(to right,#111,#eee)'
const edited = (w) => !!w && (w.s || w.l)

/**
 * Lightroom-style Color Grading: Shadows / Midtones / Highlights / Global wheels (hue +
 * saturation on the wheel, Luminance slider), plus Blending and Balance.
 */
export default function ColorGradePicker() {
  const { state, liveUpdate, beginEdit, commitEdit, commitPatch } = useProject()
  const [view, setView] = useState('3way')
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const cg = { ...defaultColorGrade(), ...(active.settings.colorGrade?.midtones ? active.settings.colorGrade : {}) }

  const begin = () => beginEdit(active.id)
  const commit = () => commitEdit(active.id)
  const setWheel = (key, patch) => liveUpdate(active.id, { colorGrade: { ...cg, [key]: { ...cg[key], ...patch } } })
  const setField = (key, v) => liveUpdate(active.id, { colorGrade: { ...cg, [key]: v } })
  const resetWheel = (key) => commitPatch(active.id, { colorGrade: { ...cg, [key]: { h: 0, s: 0, l: 0 } } })

  const wheel = (key, label, size, detailed) => (
    <div className={'grade-wheel' + (detailed ? ' detailed' : '')} key={key}>
      {!detailed && <div className="grade-wheel-title">{label}</div>}
      <ColorWheel
        label={label}
        h={cg[key].h}
        s={cg[key].s}
        size={size}
        onBegin={begin}
        onChange={(h, s) => setWheel(key, { h, s })}
        onCommit={commit}
        onReset={() => resetWheel(key)}
      />
      {detailed && (
        <>
          <Slider label="Hue" value={cg[key].h} min={0} max={360} defaultValue={0} onBegin={begin} onChange={(v) => setWheel(key, { h: v })} onCommit={commit}>
            <div className="hue-gradient-bar" style={{ background: HUE_BAR }} aria-hidden="true" />
          </Slider>
          <Slider label="Saturation" value={cg[key].s} min={0} max={100} defaultValue={0} onBegin={begin} onChange={(v) => setWheel(key, { s: v })} onCommit={commit} />
        </>
      )}
      <Slider label={detailed ? 'Luminance' : 'Lum'} value={cg[key].l} min={-100} max={100} defaultValue={0} onBegin={begin} onChange={(v) => setWheel(key, { l: v })} onCommit={commit}>
        {detailed && <div className="hue-gradient-bar" style={{ background: LUM_BAR }} aria-hidden="true" />}
      </Slider>
    </div>
  )

  return (
    <Accordion title="Color grading" id="colorGrade" panelId="colorGrade">
      <div className="presets grade-views" role="radiogroup" aria-label="Color grading view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            className={'preset-chip band-chip' + (view === v.id ? ' active' : '')}
            onClick={() => setView(v.id)}
          >
            {v.label}
            {v.id !== '3way' && edited(cg[v.id]) && <span className="band-dot" />}
          </button>
        ))}
      </div>

      {view === '3way' ? (
        <div className="grade-3way">
          <div className="grade-row center">{wheel('midtones', 'Midtones', 120, false)}</div>
          <div className="grade-row">
            {wheel('shadows', 'Shadows', 120, false)}
            {wheel('highlights', 'Highlights', 120, false)}
          </div>
        </div>
      ) : (
        <div className="grade-single">{wheel(view, VIEWS.find((v) => v.id === view).label, 190, true)}</div>
      )}

      <Slider label="Blending" value={cg.blending} min={0} max={100} defaultValue={50} onBegin={begin} onChange={(v) => setField('blending', v)} onCommit={commit} />
      <Slider label="Balance" value={cg.balance} min={-100} max={100} defaultValue={0} onBegin={begin} onChange={(v) => setField('balance', v)} onCommit={commit} />
      <p className="panel-hint">Drag a wheel&apos;s dot to tint that tonal range · double-tap the dot to reset</p>
    </Accordion>
  )
}
