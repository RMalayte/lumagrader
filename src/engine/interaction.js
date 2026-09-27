// Tiny global "a slider is being dragged" signal. While true, the main preview renders a
// lower-resolution proxy so dragging stays smooth on phones; full quality returns on release.
import { markInput } from './perfStats'

let interacting = false
const listeners = new Set()

export function setInteracting(value) {
  if (interacting === value) return
  interacting = value
  if (!value) markInput() // the full-quality render after a drag counts from the release
  listeners.forEach((fn) => fn())
}

export function isInteracting() {
  return interacting
}

export function subscribeInteraction(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
