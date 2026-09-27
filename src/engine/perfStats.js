// Performance meter (About → Diagnostics → "Performance meter"): measures, on the user's own
// device, where the time goes between moving a slider and seeing the photo update.
// Everything is a no-op while the meter is off. Nothing leaves the device.
//
//   input→frame : edit (slider move) → preview finished on the GPU
//   wait        : edit → start of the render (React update + waiting for the next frame)
//   CPU         : time inside renderImage (JS: tables, uniforms, draw calls)
//   GPU         : draw calls → GPU done (forced with a 1-pixel read, meter-only)
//   histogram   : reading the preview back + counting (only when the histogram is shown)
//   long tasks  : main-thread blocks > 50 ms (the moments the page can't react to touch)

const KEY = 'lumagrader.perfMeter'
const WINDOW_MS = 10000

let enabled = false
try { enabled = window.localStorage.getItem(KEY) === '1' } catch { /* storage blocked */ }
const listeners = new Set()
let frames = [] // { t, latency, wait, cpu, gpu, dragging, outW, outH, mode }
let histograms = [] // { t, ms }
let longTasks = [] // { t, ms }
let pendingInput = 0
let observer = null

function startObserver() {
  if (observer || typeof window.PerformanceObserver === 'undefined') return
  try {
    observer = new window.PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ t: performance.now(), ms: e.duration })
    })
    observer.observe({ type: 'longtask', buffered: false })
  } catch { observer = null } // not supported (e.g. Safari)
}
if (enabled) startObserver()

export const perfEnabled = () => enabled

export function setPerfEnabled(on) {
  enabled = !!on
  try { window.localStorage.setItem(KEY, enabled ? '1' : '0') } catch { /* storage blocked */ }
  frames = []; histograms = []; longTasks = []; pendingInput = 0
  if (enabled) startObserver()
  else if (observer) { observer.disconnect(); observer = null }
  listeners.forEach((fn) => fn())
}

export function subscribePerf(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** An edit happened (slider move, tap…): the next preview frame is measured from here. */
export function markInput() {
  if (enabled && !pendingInput) pendingInput = performance.now()
}

export function recordFrame({ start, cpu, gpu, dragging, outW, outH, mode }) {
  if (!enabled) return
  const now = performance.now()
  const input = pendingInput
  pendingInput = 0
  frames.push({ t: now, latency: input ? now - input : null, wait: input ? Math.max(0, start - input) : null, cpu, gpu, dragging, outW, outH, mode })
  trim(now)
}

export function recordHistogram(ms) {
  if (enabled) histograms.push({ t: performance.now(), ms })
}

function trim(now) {
  const cut = now - WINDOW_MS
  if (frames.length && frames[0].t < cut) frames = frames.filter((f) => f.t >= cut)
  if (histograms.length && histograms[0].t < cut) histograms = histograms.filter((h) => h.t >= cut)
  if (longTasks.length && longTasks[0].t < cut) longTasks = longTasks.filter((l) => l.t >= cut)
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const p95 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] }

function group(list) {
  const pick = (k) => list.map((f) => f[k]).filter((v) => v != null)
  const last = list[list.length - 1]
  const span = list.length > 1 ? (list[list.length - 1].t - list[0].t) / 1000 : 0
  return {
    count: list.length,
    fps: span > 0 ? (list.length - 1) / span : null,
    latency: avg(pick('latency')), latencyP95: p95(pick('latency')),
    wait: avg(pick('wait')), cpu: avg(pick('cpu')), gpu: avg(pick('gpu')), gpuP95: p95(pick('gpu')),
    size: last ? `${last.outW}×${last.outH}` : '—', mode: last?.mode || '—',
  }
}

/** Stats over the last 10 s, split into frames while dragging and settled frames. */
export function perfSummary() {
  trim(performance.now())
  return {
    drag: group(frames.filter((f) => f.dragging)),
    full: group(frames.filter((f) => !f.dragging)),
    histogram: { count: histograms.length, avg: avg(histograms.map((h) => h.ms)) },
    longTasks: { count: longTasks.length, total: longTasks.reduce((x, l) => x + l.ms, 0), max: longTasks.reduce((x, l) => Math.max(x, l.ms), 0) },
  }
}

const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`)
const num = (v) => (v == null ? '—' : String(Math.round(v)))

/** Plain-text summary for Copy diagnostics. */
export function perfSummaryText() {
  if (!enabled) return 'Performance meter: off'
  const s = perfSummary()
  const line = (label, g) => `${label}: ${g.count} frames, ${num(g.fps)} fps, input→frame ${ms(g.latency)} (p95 ${ms(g.latencyP95)}), wait ${ms(g.wait)}, CPU ${ms(g.cpu)}, GPU ${ms(g.gpu)} (p95 ${ms(g.gpuP95)}), ${g.size} ${g.mode}`
  return [
    'Performance (last 10 s):',
    line('  dragging', s.drag),
    line('  settled ', s.full),
    `  histogram: ${s.histogram.count}× avg ${ms(s.histogram.avg)}`,
    `  long tasks: ${s.longTasks.count}, total ${ms(s.longTasks.total)}, worst ${ms(s.longTasks.max)}`,
  ].join('\n')
}
