// Parses .cube 3D LUT files (standard format exported by DaVinci/CapCut/etc).
export function parseCube(text) {
  const lines = text.split('\n')
  let size = 0
  const data = []
  for (let line of lines) {
    line = line.trim()
    if (!line || line.startsWith('#') || /^TITLE|DOMAIN_/.test(line)) continue
    if (line.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1]); continue }
    const parts = line.split(/\s+/).map(Number)
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) data.push(parts[0], parts[1], parts[2])
  }
  if (!size || data.length < size * size * size * 3) return null
  return { size, data: new Float32Array(data) }
}
