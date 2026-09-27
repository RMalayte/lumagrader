export function canvasToBlob(canvas, quality = 0.8) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// Loads a blob as an <img>. The object URL is intentionally NOT revoked: the returned
// image's `src` is reused later (e.g. filmstrip thumbnails), and revoking it broke those
// thumbnails after reopening a saved project.
export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode image'))
    }
    img.src = url
  })
}
