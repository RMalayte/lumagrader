import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { usePreview } from '../hooks/useImageSources'
import { PRESETS, defaultSettings, defaultHsl, migrateSettings } from '../engine/defaults'
import { defaultGeometry } from '../engine/geometry'
import { savePresetToDB, deletePresetFromDB } from '../hooks/useProjectStore'
import { renderToCanvas } from '../engine/pipeline'
import { useFeedback } from '../store/FeedbackContext'
import { blendPresetSettings, sameSettings, PRESET_AMOUNT_MAX } from '../engine/presetAmount'
import Accordion from './Accordion.jsx'
import Slider from './Slider.jsx'

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
  const { state, dispatch, liveUpdate, beginEdit, commitEdit } = useProject()
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

  const session = state.presetSession
  const byId = (id) => state.images.find((im) => im.id === id)
  // A photo is still "in" the last preset (its Amount can change) while its settings are
  // exactly what that preset produced at one of the amounts used — so Undo/Redo of an
  // Amount change keep the slider, but any other edit ends it. Returns that amount or null.
  const amountOf = (im) => {
    if (!session || !im || !session.before[im.id]) return null
    const tried = [session.amount, ...[...(session.amounts || [])].reverse()]
    for (const a of new Set(tried)) {
      if (sameSettings(im.settings, blendPresetSettings(session.before[im.id], session.full[im.id], a / 100, im.wbAsShot || null))) return a
    }
    return null
  }
  const inSession = (im) => amountOf(im) !== null

  // Presets are color/tone recipes — applying one never moves or resets a photo's own
  // crop/rotation, masks or spot removal. With several photos selected, each keeps its own.
  function builtinFor(im, name) {
    const own = im.settings
    return {
      ...defaultSettings(),
      ...PRESETS[name],
      hsl: defaultHsl(),
      curvePoints: own.curvePoints,
      curvePointsR: own.curvePointsR,
      curvePointsG: own.curvePointsG,
      curvePointsB: own.curvePointsB,
      geometry: own.geometry,
      masks: own.masks,
      spots: own.spots || [],
      lensDistortion: own.lensDistortion || 0,
      lensVignette: own.lensVignette || 0,
      lensVignetteMidpoint: own.lensVignetteMidpoint ?? 50,
      removeCA: !!own.removeCA,
    }
  }
  function customFor(im, name) {
    const preset = JSON.parse(JSON.stringify(state.customPresets[name]))
    preset.geometry = im.settings.geometry
    preset.masks = im.settings.masks
    preset.spots = im.settings.spots || []
    return preset
  }

  function applyPreset(name, build) {
    const ids = (state.selectedIds.length > 0 ? state.selectedIds : [active.id]).filter((id) => byId(id))
    // Switching presets keeps Amount relative to the photo before the FIRST preset, so 0 %
    // always means "no preset", like trying presets one after another in Lightroom.
    const keepBase = session && ids.every((id) => inSession(byId(id)))
    const before = {}, full = {}
    for (const id of ids) {
      const im = byId(id)
      before[id] = keepBase ? session.before[id] : im.settings
      full[id] = build(im, name)
    }
    dispatch({ type: 'SET_SETTINGS_PER_IMAGE', byId: full })
    dispatch({ type: 'SET_PRESET_SESSION', session: { name, ids, before, full, amount: 100, amounts: [100] } })
    if (ids.length > 1) toast(`"${name}" applied to ${ids.length} photos`)
  }
  const applyBuiltin = (name) => applyPreset(name, builtinFor)
  const applyCustom = (name) => applyPreset(name, customFor)

  // Amount slider: re-blends every photo the preset went to (and that hasn't been edited since).
  const shownAmount = amountOf(active)
  const showAmount = shownAmount !== null
  const amountTargets = () => (session?.ids || []).map(byId).filter((im) => inSession(im))
  function setAmount(amount) {
    for (const im of amountTargets()) {
      liveUpdate(im.id, blendPresetSettings(session.before[im.id], session.full[im.id], amount / 100, im.wbAsShot || null))
    }
    dispatch({ type: 'SET_PRESET_AMOUNT', amount })
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
      {showAmount && (
        <div className="preset-amount">
          <Slider
            label={`${session.name} · Amount`}
            value={shownAmount}
            min={0}
            max={PRESET_AMOUNT_MAX}
            step={1}
            defaultValue={100}
            format={(v) => `${Math.round(v)}%`}
            parse={(text) => Math.min(PRESET_AMOUNT_MAX, Math.max(0, Math.round(Number(String(text).replace(/[^\d.]/g, '')) || 0)))}
            onBegin={() => amountTargets().forEach((im) => beginEdit(im.id))}
            onChange={setAmount}
            onCommit={() => { session.ids.forEach((id) => commitEdit(id)); dispatch({ type: 'REMEMBER_PRESET_AMOUNT' }) }}
          />
        </div>
      )}
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
