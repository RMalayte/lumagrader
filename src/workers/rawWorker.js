// Background thread for RAW import: parsing a 20–60 MB RAW container to find its embedded
// preview used to freeze the UI. Here we only do the byte work (find the preview JPEG +
// read orientation) and hand the JPEG bytes back; decoding/drawing stays on the main thread.
import { extractThumbnail } from 'extract-raw-preview'
import { readRawOrientation, readJpegOrientation } from '../engine/orientation'

self.onmessage = async (event) => {
  const { id, buffer, name } = event.data
  let orientation = null
  try {
    const bytes = new Uint8Array(buffer)
    try {
      orientation = readRawOrientation(bytes, name || '')
    } catch {
      orientation = null
    }
    const result = await extractThumbnail(bytes, { prefer: 'largest' })
    if (result.found && result.decodable) {
      const data = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data)
      // If the preview JPEG has its own orientation tag, the browser applies it — don't double-rotate.
      const own = readJpegOrientation(data) !== null
      const out = data.slice().buffer
      self.postMessage({ id, ok: true, data: out, mimeType: result.mimeType, orientation: own ? 1 : orientation || 1 }, [out])
      return
    }
    self.postMessage({ id, ok: false, orientation: orientation || 1, reason: result.found ? 'preview not decodable' : result.reason })
  } catch (err) {
    self.postMessage({ id, ok: false, orientation: orientation || 1, reason: String(err?.message || err) })
  }
}
