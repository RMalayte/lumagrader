import { useEffect, useState } from 'react'
import { perfEnabled, perfSummary, subscribePerf, setPerfEnabled } from '../engine/perfStats'

const ms = (v) => (v == null ? '—' : `${Math.round(v)}`)

/** Small on-photo readout of the performance meter (About → Diagnostics turns it on). */
export default function PerfHud() {
  const [on, setOn] = useState(perfEnabled())
  const [s, setS] = useState(null)
  useEffect(() => subscribePerf(() => setOn(perfEnabled())), [])
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => setS(perfSummary()), 500)
    return () => window.clearInterval(id)
  }, [on])
  if (!on || !s) return null
  const row = (label, g) => (
    <div className="perf-row">
      <b>{label}</b> {g.count ? <>{ms(g.fps)} fps · {ms(g.latency)} ms <span className="perf-dim">(p95 {ms(g.latencyP95)})</span> · CPU {ms(g.cpu)} · GPU {ms(g.gpu)} · wait {ms(g.wait)}</> : <span className="perf-dim">no frames yet</span>}
    </div>
  )
  return (
    <div className="perf-hud" role="status" aria-label="Performance meter">
      <div className="perf-row perf-head">
        <span>PERF · last 10 s · {s.full.size !== '—' ? s.full.size : s.drag.size} {s.full.mode !== '—' ? s.full.mode : s.drag.mode}</span>
        <button type="button" className="perf-close" onClick={() => setPerfEnabled(false)} aria-label="Turn off performance meter">×</button>
      </div>
      {row('drag', s.drag)}
      {row('full', s.full)}
      <div className="perf-row">
        <b>hist</b> {s.histogram.count ? `${s.histogram.count}× ${ms(s.histogram.avg)} ms` : 'off'} · <b>long tasks</b> {s.longTasks.count} ({ms(s.longTasks.total)} ms, worst {ms(s.longTasks.max)})
      </div>
    </div>
  )
}
