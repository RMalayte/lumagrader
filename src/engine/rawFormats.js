// Kept tiny and separate so the main bundle can recognise RAW files without loading the
// RAW parsing libraries (those load on demand from rawUtils.js).
export const RAW_EXTENSIONS = /\.(cr2|cr3|nef|arw|dng|orf|rw2|raf|pef|srw)$/i

export function isRawFile(filename) {
  return RAW_EXTENSIONS.test(filename)
}
