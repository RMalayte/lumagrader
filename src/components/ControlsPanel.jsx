import { useEffect, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { defaultSettings } from '../engine/defaults'
import { isPanelEdited } from '../engine/panels'
import { useMediaQuery, MOBILE_QUERY } from '../hooks/useMediaQuery'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'
import PresetChips from './PresetChips.jsx'
import ColorProfilePicker from './ColorProfilePicker.jsx'
import LutPanel from './LutPanel.jsx'
import CurveEditor from './CurveEditor.jsx'
import HSLPanel from './HSLPanel.jsx'
import ColorGradePicker from './ColorGradePicker.jsx'
import MaskPanel from './MaskPanel.jsx'
import DetailPanel from './DetailPanel.jsx'
import ColorPanel from './ColorPanel.jsx'

const LIGHT_SLIDERS = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.05 }, // stops (EV), like Lightroom
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
]
// Lightroom's Effects panel: the detail sliders appear once Amount is set.
const EFFECT_SLIDERS = [
  { key: 'vignette', label: 'Vignette', min: -100, max: 100 }, // LR: − darkens, + lightens
  { key: 'vignetteMidpoint', label: 'Midpoint', min: 0, max: 100, sub: 'vignette' },
  { key: 'vignetteRoundness', label: 'Roundness', min: -100, max: 100, sub: 'vignette' },
  { key: 'vignetteFeather', label: 'Feather', min: 0, max: 100, sub: 'vignette' },
  { key: 'vignetteHighlights', label: 'Highlights', min: 0, max: 100, sub: 'vignette', onlyNegative: true },
  { key: 'grain', label: 'Grain', min: 0, max: 100 },
  { key: 'grainSize', label: 'Size', min: 0, max: 100, sub: 'grain' },
  { key: 'grainRoughness', label: 'Roughness', min: 0, max: 100, sub: 'grain' },
]

function SliderGroup({ id, title, sliders }) {
  const { state, liveUpdate, beginEdit, commitEdit } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  const defaults = defaultSettings()
  return (
    <Accordion title={title} id={id} panelId={id}>
      {sliders.filter(({ sub, onlyNegative }) => !sub || (onlyNegative ? active.settings[sub] < 0 : active.settings[sub])).map(({ key, label, min, max, step, bar, sub }) => (
        <div key={key} className={sub ? 'sub-slider' : undefined}>
        <Slider
          key={key}
          label={label}
          value={active.settings[key] ?? defaults[key]}
          min={min}
          max={max}
          step={step || 1}
          defaultValue={defaults[key]}
          onBegin={() => beginEdit(active.id)}
          onChange={(v) => liveUpdate(active.id, { [key]: v })}
          onCommit={() => commitEdit(active.id)}
        >
          {bar && <div className="hue-gradient-bar" style={{ background: bar }} aria-hidden="true" />}
        </Slider>
        </div>
      ))}
    </Accordion>
  )
}

// Panels grouped into tabs. On desktop all groups are stacked in the sidebar; on mobile the
// sidebar becomes a bottom sheet with one tab per group so the photo keeps most of the screen.
const GROUPS = [
  {
    id: 'look',
    label: 'Look',
    panels: ['profile', 'presets', 'luts'],
    render: () => (
      <>
        <ColorProfilePicker />
        <PresetChips />
        <LutPanel />
      </>
    ),
  },
  {
    id: 'light',
    label: 'Light',
    panels: ['light', 'curves'],
    render: () => (
      <>
        <SliderGroup id="light" title="Light" sliders={LIGHT_SLIDERS} />
        <CurveEditor />
      </>
    ),
  },
  {
    id: 'color',
    label: 'Color',
    panels: ['color', 'hsl', 'colorGrade'],
    render: () => (
      <>
        <ColorPanel />
        <HSLPanel />
        <ColorGradePicker />
      </>
    ),
  },
  {
    id: 'detail',
    label: 'Detail',
    panels: ['detail', 'effects'],
    render: () => (
      <>
        <DetailPanel />
        <SliderGroup id="effects" title="Effects" sliders={EFFECT_SLIDERS} />
      </>
    ),
  },
  { id: 'masks', label: 'Masks', panels: ['masks'], render: () => <MaskPanel /> },
]

export default function ControlsPanel() {
  const { state, dispatch } = useProject()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  // Mobile: the tool sheet has a FIXED height, so the photo keeps the same size no matter
  // which tab or panel is open.
  const [mobileTab, setMobileTab] = useState('light')
  const [sheetCollapsed, setSheetCollapsed] = useState(false) // tap the active tab → photo gets the space
  const active = state.images.find((im) => im.id === state.activeId)
  const tabGroup = GROUPS.find((g) => g.id === mobileTab)

  // Make sure the current tab shows an open panel (e.g. on first load or after switching tabs).
  useEffect(() => {
    if (isMobile && tabGroup && !tabGroup.panels.includes(state.openAccordionId)) {
      dispatch({ type: 'SET_OPEN_ACCORDION', id: tabGroup.panels[0] })
    }
    // Only when the tab or layout changes — not every time the user collapses a panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, mobileTab])

  if (!active) return null

  const selectionHint = state.selectedIds.length > 0 && (
    <div className="selection-hint">
      {state.selectedIds.length} photos selected — presets and Copy (top bar) apply to all of them
    </div>
  )

  if (!isMobile) {
    return (
      <aside className="col controls" aria-label="Editing panels">
        {selectionHint}
        {GROUPS.map((g) => (
          <div key={g.id}>{g.render()}</div>
        ))}
      </aside>
    )
  }

  const group = tabGroup

  function selectTab(g) {
    if (g.id === mobileTab) {
      setSheetCollapsed((c) => !c)
      return
    }
    setMobileTab(g.id)
    setSheetCollapsed(false)
  }

  return (
    <aside className="col controls controls-sheet" aria-label="Editing panels">
      {group && !sheetCollapsed && (
        // The curve graph needs room: the sheet grows while Curves is open (photo shrinks, like LR Mobile).
        <div className={'sheet-content' + (state.openAccordionId === 'curves' ? ' is-tall' : '')} id="sheet-content">
          {selectionHint}
          {group.render()}
        </div>
      )}
      <div className="sheet-tabs" role="tablist" aria-label="Editing tools">
        {GROUPS.map((g) => {
          const edited = g.panels.some((p) => isPanelEdited(active.settings, p))
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={mobileTab === g.id}
              aria-expanded={mobileTab === g.id ? !sheetCollapsed : undefined}
              aria-controls={mobileTab === g.id ? 'sheet-content' : undefined}
              title={mobileTab === g.id ? (sheetCollapsed ? 'Show tools' : 'Hide tools (bigger photo)') : g.label}
              className={'sheet-tab' + (mobileTab === g.id ? ' active' : '')}
              onClick={() => selectTab(g)}
            >
              {g.label}
              {edited && <span className="edited-dot" aria-label="edited" />}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
