import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { usePreview } from '../hooks/useImageSources'
import { PRESETS, defaultSettings, defaultHsl, migrateSettings } from '../engine/defaults'
import { defaultGeometry } from '../engine/geometry'
import { savePresetToDB, deletePresetFromDB } from '../hooks/useProjectStore'
import { renderToCanvas } from '../engine/pipeline'
import { useFeedback } from '../store/FeedbackContext'
import Accordion from './Accordion.jsx'

const THUMB_SIZE = 60

function PresetThumb({ proxy, settings, luts }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    if (!proxy || !canvasRef.current) return
    renderToCanvas(canvasRef.current, proxy, settings, luts)
  }, [proxy, settings, luts])
  return <canvas ref={canvasRef} className="preset-thumb-canvas" />
}

export default function PresetChips() {
  const { state, dispatch, commitSettings } = useProject()
  const { toast, prompt, confirm } = useFeedback()
  const active = state.images.find((im) => im.id === state.activeId)
  const [proxy, setProxy] = useState(null)
  const preview = usePreview(active)

  // Thumbnails depend only on the photo's pixels, not on its current edits.
  useEffect(() => {
    if (!preview) {
      setProxy(null)
      return
    }
    const c = document.createElement('canvas')
    const scale = Math.min(1, THUMB_SIZE / Math.max(preview.width, preview.height))
    c.width = Math.max(1, Math.round(preview.width * scale))
    c.height = Math.max(1, Math.round(preview.height * scale))
    c.getContext('2d').drawImage(preview, 0, 0, c.width, c.height)
    setProxy(c)
  }, [preview])

  if (!active) return null

  // Presets are color/tone recipes — applying one should never move or reset this photo's own crop/rotation.
  function announceApplied(name) {
    const n = state.selectedIds.length
    if (n > 1) toast(`"${name}" applied to ${n} photos`)
  }

  function applyBuiltin(name) {
    announceApplied(name)
    commitSettings(active.id, {
      ...defaultSettings(),
      ...PRESETS[name],
      hsl: defaultHsl(),
      curvePoints: active.settings.curvePoints,
      curvePointsR: active.settings.curvePointsR,
      curvePointsG: active.settings.curvePointsG,
      curvePointsB: active.settings.curvePointsB,
      geometry: active.settings.geometry,
      masks: active.settings.masks,
      spots: active.settings.spots || [],
      lensDistortion: active.settings.lensDistortion || 0,
      lensVignette: active.settings.lensVignette || 0,
      lensVignetteMidpoint: active.settings.lensVignetteMidpoint ?? 50,
      removeCA: !!active.settings.removeCA,
    })
  }
  function applyCustom(name) {
    const preset = JSON.parse(JSON.stringify(state.customPresets[name]))
    preset.geometry = active.settings.geometry
    preset.masks = active.settings.masks
    preset.spots = active.settings.spots || []
    announceApplied(name)
    commitSettings(active.id, preset)
  }
  async function saveCurrent() {
    const name = await prompt({ title: 'Save preset', message: 'Saves this photo\'s look (no crop, masks or spot removal).', placeholder: 'e.g. Sunset Ride', confirmLabel: 'Save' })
    if (!name) return
    if (state.customPresets[name] || PRESETS[name]) {
      const ok = await confirm({ title: `Replace "${name}"?`, message: 'A preset with this name already exists.', confirmLabel: 'Replace', danger: true })
      if (!ok) return
    }
    const settings = JSON.parse(JSON.stringify(active.settings))
    settings.geometry = defaultGeometry() // presets are portable across photos — never save a crop into one
    settings.masks = [] // ...or local masks tied to this specific photo's composition
    settings.spots = [] // ...or spot removal
    try {
      await savePresetToDB(name, settings)
      dispatch({ type: 'ADD_CUSTOM_PRESET', name, settings })
      toast(`Preset "${name}" saved`)
    } catch (err) {
      console.error('Saving preset failed', err)
      toast('Could not save the preset', { type: 'error' })
    }
  }
  async function removeCustom(name) {
    const ok = await confirm({ title: `Delete preset "${name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await deletePresetFromDB(name)
      dispatch({ type: 'DELETE_CUSTOM_PRESET', name })
      toast(`Preset "${name}" deleted`)
    } catch (err) {
      console.error('Deleting preset failed', err)
      toast('Could not delete the preset', { type: 'error' })
    }
  }

  function exportPresets() {
    const data = JSON.stringify(state.customPresets, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'lumagrader-presets.json'
    a.click()
  }

  // Accepts LumaGrader .json preset bundles and Lightroom/Camera Raw .xmp presets (many at once).
  async function importPresets(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const taken = new Set([...Object.keys(PRESETS), ...Object.keys(state.customPresets)])
    const uniqueName = (base) => {
      let name = base
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`
      taken.add(name)
      return name
    }
    const merged = {}
    const notes = new Set()
    const failures = []

    for (const file of files) {
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('File is too large to be a preset.')
        const text = await file.text()
        if (/\.xmp$/i.test(file.name) || /<x:xmpmeta|camera-raw-settings/.test(text.slice(0, 4000))) {
          const { parseXmpPreset } = await import('../engine/xmpPreset') // loaded on first XMP import
          const result = parseXmpPreset(text, file.name)
          const name = uniqueName(result.name)
          merged[name] = result.settings
          result.partial.forEach((p) => notes.add(p))
          result.skipped.forEach((p) => notes.add(`${p} — not supported`))
        } else {
          const parsed = JSON.parse(text)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not a presets file.')
          // Only accept entries that look like settings objects — the file is user-provided.
          for (const [name, settings] of Object.entries(parsed)) {
            if (typeof name !== 'string' || name.length > 80 || !settings || typeof settings !== 'object' || Array.isArray(settings)) continue
            merged[uniqueName(name)] = { ...defaultSettings(), ...migrateSettings(settings), geometry: defaultGeometry(), masks: [], spots: [] }
          }
        }
      } catch (err) {
        failures.push(`${file.name}: ${err.message || 'could not be read'}`)
      }
    }

    try {
      for (const [name, settings] of Object.entries(merged)) await savePresetToDB(name, settings)
    } catch (err) {
      console.error('Saving imported presets failed', err)
      toast('Could not save the imported presets', { type: 'error' })
      return
    }
    const count = Object.keys(merged).length
    if (count) {
      dispatch({ type: 'LOAD_CUSTOM_PRESETS', presets: merged })
      toast(`Imported ${count} preset${count === 1 ? '' : 's'}`)
    }
    if (notes.size) {
      const list = [...notes]
      toast(`Approximated or skipped: ${list.slice(0, 3).join('; ')}${list.length > 3 ? ` (+${list.length - 3} more)` : ''}`, { type: 'info', duration: 9000 })
      console.info('XMP import notes:', list)
    }
    if (failures.length) toast(failures.slice(0, 2).join(' · ') + (failures.length > 2 ? ` (+${failures.length - 2} more)` : ''), { type: 'error', duration: 9000 })
  }

  return (
    <Accordion title="Grade presets" id="presets">
      <div className="preset-grid">
        {Object.keys(PRESETS).map((name) => (
          <button key={name} type="button" className="preset-card" onClick={() => applyBuiltin(name)} title={`Apply ${name}`}>
            <PresetThumb proxy={proxy} settings={{ ...defaultSettings(), ...PRESETS[name] }} luts={state.luts} />
            <span className="preset-card-label">{name}</span>
          </button>
        ))}
        {Object.keys(state.customPresets).map((name) => (
          <div key={name} className="preset-card-wrap">
            <button type="button" className="preset-card" onClick={() => applyCustom(name)} title={`Apply ${name}`}>
              <PresetThumb proxy={proxy} settings={state.customPresets[name]} luts={state.luts} />
              <span className="preset-card-label">{name}</span>
            </button>
            <button type="button" className="preset-card-delete" onClick={() => removeCustom(name)} aria-label={`Delete preset ${name}`}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="action secondary" style={{ width: '100%', marginTop: 6 }} onClick={saveCurrent}>
        Save current as preset
      </button>
      <p className="panel-hint">Import supports Lightroom .xmp presets (approximate) and LumaGrader .json files.</p>
      <div className="btnrow" style={{ marginTop: 6 }}>
        <button className="action secondary" onClick={exportPresets} disabled={!Object.keys(state.customPresets).length}>
          Export presets
        </button>
        <label className="action secondary file-btn" style={{ marginTop: 0 }}>
          Import presets
          <input type="file" accept=".json,.xmp,application/json,application/rdf+xml" multiple hidden onChange={importPresets} />
        </label>
      </div>
    </Accordion>
  )
}
