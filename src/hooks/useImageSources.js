import { useEffect, useState, useSyncExternalStore } from 'react'
import { getPreview, peekPreview, getFullImage } from '../engine/imageStore'
import { subscribeInteraction, isInteracting } from '../engine/interaction'

/** The 1600px preview canvas for `image`, or null while it is being decoded. */
export function usePreview(image) {
  const id = image?.id
  const [state, setState] = useState(() => ({ id, canvas: id != null ? peekPreview(id) : null }))
  useEffect(() => {
    if (!image) return
    let cancelled = false
    const cached = peekPreview(image.id)
    if (cached) setState({ id: image.id, canvas: cached })
    else {
      setState({ id: image.id, canvas: null })
      getPreview(image).then(
        (canvas) => !cancelled && setState({ id: image.id, canvas }),
        () => !cancelled && setState({ id: image.id, canvas: null }),
      )
    }
    return () => {
      cancelled = true
    }
    // sourceBlob identifies the pixels; settings changes must not reload them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id, image?.sourceBlob])
  return state.id === id ? state.canvas : null
}

/** The full-size image, loaded only while `wanted` is true (1:1 zoom). */
export function useFullImage(image, wanted) {
  const [loaded, setLoaded] = useState({ id: null, img: null })
  useEffect(() => {
    if (!image || !wanted) return
    let cancelled = false
    getFullImage(image).then((img) => !cancelled && setLoaded({ id: image.id, img }), () => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id, image?.sourceBlob, wanted])
  return wanted && loaded.id === image?.id ? loaded.img : null
}

/** True while the user is dragging a slider (see engine/interaction.js). */
export function useInteracting() {
  return useSyncExternalStore(subscribeInteraction, isInteracting, () => false)
}
