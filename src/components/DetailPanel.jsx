import { useProject } from '../store/ProjectContext'
import { defaultSettings } from '../engine/defaults'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

const SIMPLE_SLIDERS = [
  { key: 'texture', label: 'Texture', min: 0, max: 100 },
  { key: 'clarity', label: 'Clarity', min: 0, max: 100 },
  { key: 'dehaze', label: 'Dehaze (approx.)', min: 0, max: 100 },
]
const SHARPEN_SLIDERS = [
  { key: 'sharpen', label: 'Amount', min: 0, max: 100 },
  { key: 'sharpenRadius', label: 'Radius', min: 0.5, max: 3, step: 0.1 },
  { key: 'sharpenDetail', label: 'Detail', min: 0, max: 100 },
  { key: 'sharpenMasking', label: 'Masking', min: 0, max: 100 },
]
const LUMA_NR_SLIDERS = [
  { key: 'noiseReduction', label: 'Amount', min: 0, max: 100 },
  { key: 'denoiseDetail', label: 'Detail', min: 0, max: 100 },
  { key: 'denoiseContrast', label: 'Contrast', min: 0, max: 100 },
]
const COLOR_NR_SLIDERS = [
  { key: 'colorNoiseReduction', label: 'Amount', min: 0, max: 100 },
  { key: 'colorNoiseDetail', label: 'Detail', min: 0, max: 100 },
  { key: 'colorNoiseSmoothness', label: 'Smoothness', min: 0, max: 100 },
]

export default function DetailPanel() {
  const { state, liveUpdate, beginEdit, commitEdit } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null

  const s = active.settings
  const defaults = defaultSettings()

  const renderSliders = (sliders) =>
    sliders.map(({ key, label, min, max, step }) => (
      <Slider
        key={key}
        label={label}
        value={s[key]}
        min={min}
        max={max}
        step={step || 1}
        defaultValue={defaults[key]}
        onBegin={() => beginEdit(active.id)}
        onChange={(v) => liveUpdate(active.id, { [key]: v })}
        onCommit={() => commitEdit(active.id)}
      />
    ))

  const group = (title, sliders) => (
    <div className="detail-subgroup">
      <h4 className="detail-subhead">{title}</h4>
      {renderSliders(sliders)}
    </div>
  )

  return (
    <Accordion title="Detail" id="detail" panelId="detail">
      {renderSliders(SIMPLE_SLIDERS)}
      {group('Sharpening', SHARPEN_SLIDERS)}
      {group('Noise Reduction (Luminance)', LUMA_NR_SLIDERS)}
      {group('Color Noise Reduction', COLOR_NR_SLIDERS)}
    </Accordion>
  )
}
