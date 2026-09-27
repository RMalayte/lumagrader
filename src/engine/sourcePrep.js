// Everything that changes WHERE pixels come from runs on the source photo before the
// tone/colour engine: lens corrections → spot removal → rotate/straighten/crop.
// The first two are cached per source image (they are slow-ish and rarely change while
// other sliders move); geometry is cheap and runs every time.
import { applyGeometry, isGeometryDefault } from './geometry'
import { applyLens, isLensActive, lensKey } from './lens'
import { applySpots, spotsKey } from './heal'

const SMALL_PIXELS = 4.5e6 // previews/proxies: one cache entry per source
const smallCache = new WeakMap()
let largeEntry = null // full-size images: keep only the latest one (memory)

function toCanvas(source) {
  const c = document.createElement('canvas')
  c.width = source.naturalWidth ?? source.width
  c.height = source.naturalHeight ?? source.height
  c.getContext('2d').drawImage(source, 0, 0)
  return c
}

/** Source with lens corrections and spots applied (no geometry). Cached. */
export function correctedSource(source, s) {
  const spots = s.spots || []
  const lensOn = isLensActive(s)
  if (!lensOn && !spots.length) return source
  const key = (lensOn ? lensKey(s) : '') + '#' + spotsKey(spots)
  const w = source.naturalWidth ?? source.width, h = source.naturalHeight ?? source.height
  const small = w * h <= SMALL_PIXELS
  const hit = small ? smallCache.get(source) : largeEntry?.source === source ? largeEntry : null
  if (hit && hit.key === key) return hit.canvas

  // Reuse the lens result when only the spots changed (adding a spot must feel instant).
  const lensPart = lensOn ? lensKey(s) : ''
  let base
  if (hit && hit.lensPart === lensPart && hit.lensCanvas) base = hit.lensCanvas
  else base = lensOn ? applyLens(source, s) : null
  const canvas = spots.length ? applySpots(toCanvas(base || source), spots) : base
  const entry = { source, key, lensPart, lensCanvas: base, canvas }
  if (small) smallCache.set(source, entry)
  else largeEntry = entry
  return canvas
}

/** The exact image the tone/colour engine renders: corrections + geometry. */
export function prepareSource(source, s) {
  const corrected = correctedSource(source, s)
  return s.geometry && !isGeometryDefault(s.geometry) ? applyGeometry(corrected, s.geometry) : corrected
}
