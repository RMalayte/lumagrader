import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { setInteracting } from '../engine/interaction'

function decimalsOf(step) {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

/**
 * Lightroom-style slider:
 *  - bipolar ranges (e.g. −100…+100) fill from the center, so + / − is visible at a glance
 *  - click the value to type an exact number (Enter = apply, Esc = cancel)
 *  - ↺ button (and double-click on the track) resets to the default
 *
 * History: `onBegin` is called before a change and `onCommit` after it, so one drag,
 * one arrow-key press or one typed value = one undo step.
 */
export default function Slider({ label, value, min, max, step = 1, defaultValue = 0, onChange, onBegin, onCommit, children }) {
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const draftRef = useRef(null)
  const decimals = decimalsOf(step)
  const shown = Number(value).toFixed(decimals)
  const isDefault = Number(value) === Number(defaultValue)

  useEffect(() => {
    if (editing) draftRef.current?.select()
  }, [editing])

  // Fill: from the zero point for bipolar sliders, from the left edge otherwise.
  const pct = (v) => ((v - min) / (max - min)) * 100
  const origin = min < 0 && max > 0 ? pct(0) : 0
  const current = pct(Number(value))
  const fillStart = Math.min(origin, current)
  const fillEnd = Math.max(origin, current)

  function applyValue(v) {
    onBegin?.()
    onChange(v)
    onCommit?.()
  }

  function startDragSession() {
    onBegin?.()
    // While dragging, the preview renders at lower resolution for smoothness (see interaction.js).
    setInteracting(true)
    // Commit when the pointer is released anywhere, even outside the slider.
    const end = () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setInteracting(false)
      onCommit?.()
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  function finishTyping(apply) {
    setEditing(false)
    if (!apply) return
    const n = Number(draft)
    if (draft.trim() === '' || Number.isNaN(n)) return
    const clamped = Math.min(max, Math.max(min, n))
    const snapped = Number((Math.round(clamped / step) * step).toFixed(decimals))
    if (snapped !== Number(value)) applyValue(snapped)
  }

  return (
    <div className="slider-row">
      <div className="slider-head">
        <label htmlFor={inputId}>{label}</label>
        <div className="slider-value-wrap">
          {!isDefault && (
            <button
              type="button"
              className="slider-reset"
              onClick={() => applyValue(defaultValue)}
              aria-label={`Reset ${label}`}
              title={`Reset ${label}`}
            >
              <Icon name="reset" size={11} />
            </button>
          )}
          {editing ? (
            <input
              ref={draftRef}
              className="slider-value-input"
              type="number"
              inputMode="decimal"
              min={min}
              max={max}
              step={step}
              value={draft}
              aria-label={`${label} value`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finishTyping(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishTyping(true)
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  finishTyping(false)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={'slider-value' + (isDefault ? '' : ' changed')}
              onClick={() => {
                setDraft(shown)
                setEditing(true)
              }}
              title="Click to type a value"
              aria-label={`${label}: ${shown}. Click to type a value`}
            >
              {Number(value) > 0 && min < 0 ? '+' : ''}
              {shown}
            </button>
          )}
        </div>
      </div>
      {children}
      <input
        id={inputId}
        className="lg-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill-start': fillStart + '%', '--fill-end': fillEnd + '%' }}
        onPointerDown={startDragSession}
        onKeyDown={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) onBegin?.()
        }}
        onKeyUp={() => onCommit?.()}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => applyValue(defaultValue)}
      />
    </div>
  )
}
