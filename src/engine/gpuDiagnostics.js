// Graphics diagnostics for bug reports: what GPU/browser this is and the last preview failure.
// Shown in About → Diagnostics so a user can copy it into an issue. Nothing leaves the device.
const KEY = 'lumagrader.gpuLastError'

let info = null
let previewMode = 'GPU'

/** 'GPU', 'GPU (lighter preview)' or 'compatibility'. */
export function setPreviewMode(mode) {
  previewMode = mode
}

/** One-time snapshot of the GPU and browser (no personal data). */
export function gpuInfo() {
  if (info) return info
  info = { webgl2: false }
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      info = {
        webgl2: true,
        renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
        vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxFragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        floatRender: !!gl.getExtension('EXT_color_buffer_float'),
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch (err) {
    info = { webgl2: false, error: String(err?.message || err) }
  }
  return info
}

/** Remembers the latest preview failure (also across a reload). */
export function recordGpuError(err, stage) {
  const entry = { at: new Date().toISOString(), stage, message: String(err?.message || err).slice(0, 500) }
  try { window.localStorage.setItem(KEY, JSON.stringify(entry)) } catch { /* storage blocked */ }
  return entry
}

export function lastGpuError() {
  try { return JSON.parse(window.localStorage.getItem(KEY) || 'null') } catch { return null }
}

/** Plain-text report for copying into an issue or a message. */
export function diagnosticsText(extra = {}) {
  const g = gpuInfo()
  const e = lastGpuError()
  const lines = [
    `LumaGrader ${__APP_VERSION__} (${__BUILD_DATE__})`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x, memory ${navigator.deviceMemory ?? '?'} GB`,
    g.webgl2 ? `GPU: ${g.renderer} (${g.vendor}), max texture ${g.maxTexture}, frag uniforms ${g.maxFragUniforms}, float RT ${g.floatRender}` : `GPU: WebGL2 unavailable ${g.error || ''}`,
    `Preview mode: ${previewMode}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    e ? `Last graphics error (${e.at}, ${e.stage}): ${e.message}` : 'Last graphics error: none',
  ]
  return lines.join('\n')
}
