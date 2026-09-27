// Runs the RAW develop step (tone mapping, colour, colour-noise reduction) off the main thread.
import { buildDevelopParams, developRaw } from '../engine/rawDevelop'

self.onmessage = (event) => {
  const { id, data16, width, height, params, target } = event.data
  try {
    const p = params || buildDevelopParams(data16, width, height, target)
    const { rgba, params: fitted } = developRaw(data16, width, height, p)
    self.postMessage({ id, ok: true, rgba, width, height, params: fitted }, [rgba.buffer])
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
