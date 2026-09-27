import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { setInteracting } from '../engine/interaction'

// Must match the thumb size in CSS for touch screens (App.css, pointer: coarse).
const THUMB_PX = 22
const HANDLE_HIT = 26 // px either side of the handle centre that count as "on the handle"

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
  const rangeRef = useRef(null)
  const lastTapRef = useRef(0)
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

  /**
   * Touch screens: the native range input ignores pointers (CSS, pointer: coarse), so a
   * finger scrolling the panel can't bump a value. Only a press that lands on the handle
   * (±HANDLE_HIT px) and then moves sideways changes it — relative to where it started, so
   * the value never jumps. Double-tap the handle = reset. Vertical moves scroll the panel.
   */
  function onTrackPointerDown(e) {
    const input = rangeRef.current
    if (!input || window.getComputedStyle(input).pointerEvents !== 'none') return // mouse/desktop: native input
    const rect = input.getBoundingClientRect()
    const thumbX = rect.left + THUMB_PX / 2 + (current / 100) * (rect.width - THUMB_PX)
    if (Math.abs(e.clientX - thumbX) > HANDLE_HIT) return // not on the handle → let the page scroll

    const now = performance.now()
    if (now - lastTapRef.current < 320) {
      lastTapRef.current = 0
      if (Number(value) !== Number(defaultValue)) applyValue(defaultValue)
      return
    }
    lastTapRef.current = now

    const target = e.currentTarget
    const pointerId = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    const v0 = Number(value)
    const perPx = (max - min) / Math.max(1, rect.width - THUMB_PX)
    let dragging = false
    try { target.setPointerCapture(pointerId) } catch { /* ignore */ }

    function move(ev) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - x0
      if (!dragging) {
        if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(ev.clientY - y0)) return // dead zone / vertical
        dragging = true
        lastTapRef.current = 0
        onBegin?.()
        setInteracting(true)
        target.classList.add('dragging')
      }
      const raw = Math.min(max, Math.max(min, v0 + dx * perPx))
      const snapped = Number((Math.round(raw / step) * step).toFixed(decimals))
      onChange(snapped)
    }
    function end(ev) {
      if (ev.pointerId !== pointerId) return
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      target.classList.remove('dragging')
      if (dragging) {
        setInteracting(false)
        onCommit?.()
      }
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
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
      <div className="slider-track-wrap" onPointerDown={onTrackPointerDown}>
      <input
        ref={rangeRef}
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
    </div>
  )
}
