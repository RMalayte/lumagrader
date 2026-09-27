// The main preview announces each finished render, so views that need the edited pixels
// (the histogram) can read them from it instead of rendering the photo a second time.
const listeners = new Set()
let last = null

/** `canvas`: the preview canvas just drawn; `meta`: { imageId, dragging }. */
export function publishPreview(canvas, meta) {
  last = { canvas, meta }
  for (const fn of listeners) fn(canvas, meta)
}

/** Also replays the latest render, so a view opened later isn't empty until the next edit. */
export function subscribePreview(fn) {
  listeners.add(fn)
  if (last?.canvas.isConnected) fn(last.canvas, { ...last.meta, dragging: false })
  return () => listeners.delete(fn)
}
