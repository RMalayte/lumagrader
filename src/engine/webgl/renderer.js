import { createProgram, ensureRenderTarget } from './glCore'
import { VERT_SRC, FRAG_SRC, BLUR_FRAG_SRC, COMBINE_FRAG_SRC, MASK_FRAG_SRC, DETAIL_FRAG_SRC } from './shaders'
import { buildRgbCurveLUTs } from '../curvePoints'
import { getBrushCanvas } from '../brushMaskStore'
import { getProfileBias } from '../colorProfiles'
import { wbMatrixFor, isGradeActive, gradeUniforms, grainAmplitude, grainCells } from '../color'
import { buildLocalLUT, buildGlobalLUT, isToneActive, isLocalToneActive, LOCAL_LUT_SIZE, GLOBAL_LUT_SIZE } from '../tone'
import { getLocalBaseMap } from '../localBase'

const HSL_ORDER = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']
const MAIN_UNIFORM_NAMES = [
  'u_image', 'u_curvePointsLUT', 'u_cubeLut', 'u_useCubeLut', 'u_useCurvePoints',
  'u_localLUT', 'u_globalLUT', 'u_gfCoef', 'u_useTone', 'u_useLocal', 'u_exposureEV', 'u_sat', 'u_useWB', 'u_wbMatrix', 'u_curveStrength',
  'u_lutStrength', 'u_hslHue', 'u_hslSat', 'u_hslLum', 'u_hslActive', 'u_vibrance',
  'u_gradeActive', 'u_gradeTint', 'u_gradeLum', 'u_gradeBlend', 'u_gradeBalance',
  'u_grain', 'u_grainCells', 'u_vignette', 'u_resolution', 'u_dehaze',
]

// One WebGL2 context + compiled programs + textures per <canvas> element, reused across
// renders (compiling shader programs per frame would defeat the purpose of using the GPU).
const stateMap = new WeakMap()

/** Frees a canvas's WebGL context right away instead of waiting for garbage collection. */
export function releaseCanvas(canvas) {
  const state = stateMap.get(canvas)
  if (!state) return
  state.gl.getExtension('WEBGL_lose_context')?.loseContext()
  stateMap.delete(canvas)
}

function bindQuad(gl, program, quad) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  const loc = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
}

function getState(canvas) {
  let state = stateMap.get(canvas)
  if (state) return state

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
  if (!gl) throw new Error('WebGL2 not supported in this browser')

  const program = createProgram(gl, VERT_SRC, FRAG_SRC)
  const blurProgram = createProgram(gl, VERT_SRC, BLUR_FRAG_SRC)
  const combineProgram = createProgram(gl, VERT_SRC, COMBINE_FRAG_SRC)
  const maskProgram = createProgram(gl, VERT_SRC, MASK_FRAG_SRC)
  const detailProgram = createProgram(gl, VERT_SRC, DETAIL_FRAG_SRC)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const imageTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, imageTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  const curveTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, curveTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

  // Engine v2 tone tables (R16F — filterable in WebGL2 without extensions):
  //   localTex  (unit 3): base EV → Highlights/Shadows gain      globalTex (unit 4): EV → out ÷ 2^EV
  //   gfTex     (unit 5): guided-filter (A, B) map for the edge-aware local base (RG16F)
  const makeFloatTex = (internal, format, data, w = 1) => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, 1, 0, format, gl.FLOAT, data)
    return t
  }
  const localTex = makeFloatTex(gl.R16F, gl.RED, new Float32Array([0]))
  const globalTex = makeFloatTex(gl.R16F, gl.RED, new Float32Array([1]))
  const gfTex = makeFloatTex(gl.RG16F, gl.RG, new Float32Array([0, 0]))

  const cubeTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_3D, cubeTex)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 1, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]))

  const brushTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, brushTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, 1, 1, 0, gl.ALPHA, gl.UNSIGNED_BYTE, new Uint8Array([0]))

  const uniforms = {}
  for (const name of MAIN_UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name)

  const blurUniforms = {
    u_image: gl.getUniformLocation(blurProgram, 'u_image'),
    u_direction: gl.getUniformLocation(blurProgram, 'u_direction'),
    u_texel: gl.getUniformLocation(blurProgram, 'u_texel'),
    u_radius: gl.getUniformLocation(blurProgram, 'u_radius'),
  }
  const combineUniforms = {
    u_original: gl.getUniformLocation(combineProgram, 'u_original'),
    u_blurred: gl.getUniformLocation(combineProgram, 'u_blurred'),
    u_amount: gl.getUniformLocation(combineProgram, 'u_amount'),
    u_mode: gl.getUniformLocation(combineProgram, 'u_mode'),
  }
  const detailUniforms = {
    u_original: gl.getUniformLocation(detailProgram, 'u_original'),
    u_blurred: gl.getUniformLocation(detailProgram, 'u_blurred'),
    u_mode: gl.getUniformLocation(detailProgram, 'u_mode'),
    u_amount: gl.getUniformLocation(detailProgram, 'u_amount'),
    u_detail: gl.getUniformLocation(detailProgram, 'u_detail'),
    u_masking: gl.getUniformLocation(detailProgram, 'u_masking'),
    u_contrast: gl.getUniformLocation(detailProgram, 'u_contrast'),
  }
  const maskUniforms = {
    u_image: gl.getUniformLocation(maskProgram, 'u_image'),
    u_maskType: gl.getUniformLocation(maskProgram, 'u_maskType'),
    u_linear: gl.getUniformLocation(maskProgram, 'u_linear'),
    u_radial: gl.getUniformLocation(maskProgram, 'u_radial'),
    u_brushMask: gl.getUniformLocation(maskProgram, 'u_brushMask'),
    u_blurredForSharpen: gl.getUniformLocation(maskProgram, 'u_blurredForSharpen'),
    u_useDetailBlur: gl.getUniformLocation(maskProgram, 'u_useDetailBlur'),
    u_sharpen: gl.getUniformLocation(maskProgram, 'u_sharpen'),
    u_denoise: gl.getUniformLocation(maskProgram, 'u_denoise'),
    u_feather: gl.getUniformLocation(maskProgram, 'u_feather'),
    u_invert: gl.getUniformLocation(maskProgram, 'u_invert'),
    u_exposure: gl.getUniformLocation(maskProgram, 'u_exposure'),
    u_contrast: gl.getUniformLocation(maskProgram, 'u_contrast'),
    u_saturation: gl.getUniformLocation(maskProgram, 'u_saturation'),
    u_temp: gl.getUniformLocation(maskProgram, 'u_temp'),
    u_resolution: gl.getUniformLocation(maskProgram, 'u_resolution'),
  }

  state = {
    gl, program, blurProgram, combineProgram, maskProgram, detailProgram, quad,
    imageTex, curveTex, localTex, globalTex, gfTex, cubeTex, brushTex, uniforms, blurUniforms, combineUniforms, maskUniforms, detailUniforms,
    cachedLutName: null,
    targetA: {}, targetB: {}, targetC: {}, targetD: {},
  }
  stateMap.set(canvas, state)
  return state
}

function setMainUniforms(state, s, luts, source, w, h) {
  const { gl, imageTex, curveTex, cubeTex, uniforms } = state

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, imageTex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.uniform1i(uniforms.u_image, 0)

  // RGB + R/G/B point curves, pre-composed into one RGBA LUT (channel c reads component c).
  const curveLuts = buildRgbCurveLUTs(s)
  const curveActive = !!curveLuts
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, curveTex)
  if (curveActive) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveLuts.rgba)
  }
  gl.uniform1i(uniforms.u_curvePointsLUT, 1)
  gl.uniform1i(uniforms.u_useCurvePoints, curveActive ? 1 : 0)

  const cubeLutEntry = s.lut && luts[s.lut]
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_3D, cubeTex)
  if (cubeLutEntry && state.cachedLutName !== s.lut) {
    const { size, data } = cubeLutEntry
    const bytes = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) bytes[i] = Math.round(data[i] * 255)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, size, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes)
    state.cachedLutName = s.lut
  }
  gl.uniform1i(uniforms.u_cubeLut, 2)
  gl.uniform1i(uniforms.u_useCubeLut, cubeLutEntry ? 1 : 0)

  const profile = getProfileBias(s.colorProfile)
  const effSaturation = s.saturation + (profile.saturation || 0)
  const profileContrast = profile.contrast || 0

  // Tone tables are rebuilt only when a tone slider (or the profile's contrast) changes;
  // the local-base map only when the source pixels change (cached per source object).
  const toneOn = isToneActive(s, profileContrast)
  const localOn = toneOn && isLocalToneActive(s)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  if (toneOn) {
    const key = [s.exposure, s.contrast, profileContrast, s.highlights, s.shadows, s.whites, s.blacks].join('|')
    if (state.toneKey !== key) {
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, state.localTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, LOCAL_LUT_SIZE, 1, 0, gl.RED, gl.FLOAT, buildLocalLUT(s))
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, state.globalTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, GLOBAL_LUT_SIZE, 1, 0, gl.RED, gl.FLOAT, buildGlobalLUT(s, profileContrast))
      state.toneKey = key
    }
  }
  if (localOn) {
    const map = getLocalBaseMap(source)
    if (state.gfMap !== map) {
      gl.activeTexture(gl.TEXTURE5)
      gl.bindTexture(gl.TEXTURE_2D, state.gfTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, map.width, map.height, 0, gl.RG, gl.FLOAT, map.data)
      state.gfMap = map
    }
  }
  gl.activeTexture(gl.TEXTURE3)
  gl.bindTexture(gl.TEXTURE_2D, state.localTex)
  gl.activeTexture(gl.TEXTURE4)
  gl.bindTexture(gl.TEXTURE_2D, state.globalTex)
  gl.activeTexture(gl.TEXTURE5)
  gl.bindTexture(gl.TEXTURE_2D, state.gfTex)
  gl.uniform1i(uniforms.u_localLUT, 3)
  gl.uniform1i(uniforms.u_globalLUT, 4)
  gl.uniform1i(uniforms.u_gfCoef, 5)
  gl.uniform1i(uniforms.u_useTone, toneOn ? 1 : 0)
  gl.uniform1i(uniforms.u_useLocal, localOn ? 1 : 0)
  gl.uniform1f(uniforms.u_exposureEV, s.exposure || 0)
  gl.uniform1f(uniforms.u_sat, Math.max(-1, effSaturation / 100))
  // White balance (engine v3): Bradford adaptation matrix in linear light — see color.js.
  const wb = wbMatrixFor(s, profile.temp || 0) // RAW Kelvin/Tint + relative Temp/Tint
  gl.uniform1i(uniforms.u_useWB, wb ? 1 : 0)
  if (wb) {
    // GLSL mat3 is column-major: transpose our row-major matrix.
    gl.uniformMatrix3fv(uniforms.u_wbMatrix, false, new Float32Array([wb[0], wb[3], wb[6], wb[1], wb[4], wb[7], wb[2], wb[5], wb[8]]))
  }
  gl.uniform1f(uniforms.u_curveStrength, s.curve || 0)
  gl.uniform1f(uniforms.u_lutStrength, (s.lutStrength || 0) / 100)

  const hueArr = new Float32Array(8), satArr = new Float32Array(8), lumArr = new Float32Array(8)
  let hslActive = false
  HSL_ORDER.forEach((band, i) => {
    const b = (s.hsl && s.hsl[band]) || { h: 0, s: 0, l: 0 }
    const bias = (profile.hsl && profile.hsl[band]) || {}
    hueArr[i] = b.h + (bias.h || 0)
    satArr[i] = b.s + (bias.s || 0)
    lumArr[i] = b.l + (bias.l || 0)
    if (hueArr[i] || satArr[i] || lumArr[i]) hslActive = true
  })
  gl.uniform1fv(uniforms.u_hslHue, hueArr)
  gl.uniform1fv(uniforms.u_hslSat, satArr)
  gl.uniform1fv(uniforms.u_hslLum, lumArr)
  gl.uniform1i(uniforms.u_hslActive, hslActive ? 1 : 0)
  gl.uniform1f(uniforms.u_vibrance, (s.vibrance || 0) / 100)


  // Color Grading (engine v4): 3 wheels + global in Oklab — see color.js.
  const gradeOn = isGradeActive(s.colorGrade)
  gl.uniform1i(uniforms.u_gradeActive, gradeOn ? 1 : 0)
  if (gradeOn) {
    const G = gradeUniforms(s.colorGrade)
    gl.uniform2fv(uniforms.u_gradeTint, new Float32Array(G.tints))
    gl.uniform1fv(uniforms.u_gradeLum, new Float32Array(G.lums))
    gl.uniform1f(uniforms.u_gradeBlend, G.blending)
    gl.uniform1f(uniforms.u_gradeBalance, G.balance)
  }

  gl.uniform1f(uniforms.u_grain, s.grain > 0 ? grainAmplitude(s.grain) : 0)
  gl.uniform2f(uniforms.u_grainCells, ...grainCells(w, h))
  gl.uniform1f(uniforms.u_vignette, s.vignette || 0)
  gl.uniform2f(uniforms.u_resolution, w, h)
  gl.uniform1f(uniforms.u_dehaze, (s.dehaze || 0) / 100)
}

// Renders the full tonal/color/effects pipeline on the GPU, plus (if active) sharpening and
// noise reduction via a small chain of separable-Gaussian-blur + combine passes. Throws if
// WebGL2 is unavailable or a shader fails to compile — callers should catch and fall back.
export function renderTonalWebGL(canvas, source, s, luts) {
  const w = source.naturalWidth ?? source.width
  const h = source.naturalHeight ?? source.height
  canvas.width = w
  canvas.height = h

  const state = getState(canvas)
  const { gl } = state

  gl.viewport(0, 0, w, h)

  gl.useProgram(state.program)
  bindQuad(gl, state.program, state.quad)
  setMainUniforms(state, s, luts, source, w, h)

  const sharpenActive = (s.sharpen || 0) > 0
  const denoiseActive = (s.noiseReduction || 0) > 0
  const colorNoiseActive = (s.colorNoiseReduction || 0) > 0
  // Texture / Clarity / Dehaze are bipolar since engine v3 (negative = soften / add haze).
  const clarityActive = (s.clarity || 0) !== 0
  const textureActive = (s.texture || 0) !== 0
  const dehazeActive = (s.dehaze || 0) !== 0
  const masks = (s.masks || []).filter((m) => m.enabled !== false)

  if (!sharpenActive && !denoiseActive && !colorNoiseActive && !clarityActive && !textureActive && !dehazeActive && masks.length === 0) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return
  }

  const A = ensureRenderTarget(gl, state.targetA, w, h)
  const B = ensureRenderTarget(gl, state.targetB, w, h)
  const C = ensureRenderTarget(gl, state.targetC, w, h)
  const D = ensureRenderTarget(gl, state.targetD, w, h)

  gl.bindFramebuffer(gl.FRAMEBUFFER, A.framebuffer)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  // A now holds the fully tonal/color-graded image.

  function blurPass(srcTex, dstTarget, direction, radius) {
    gl.useProgram(state.blurProgram)
    bindQuad(gl, state.blurProgram, state.quad)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstTarget.framebuffer)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(state.blurUniforms.u_image, 0)
    gl.uniform2f(state.blurUniforms.u_direction, direction[0], direction[1])
    gl.uniform2f(state.blurUniforms.u_texel, 1 / w, 1 / h)
    gl.uniform1f(state.blurUniforms.u_radius, radius)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function combinePass(originalTex, blurredTex, dstTarget, amount, mode) {
    gl.useProgram(state.combineProgram)
    bindQuad(gl, state.combineProgram, state.quad)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstTarget ? dstTarget.framebuffer : null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, originalTex)
    gl.uniform1i(state.combineUniforms.u_original, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, blurredTex)
    gl.uniform1i(state.combineUniforms.u_blurred, 1)
    gl.uniform1f(state.combineUniforms.u_amount, amount)
    gl.uniform1i(state.combineUniforms.u_mode, mode)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function detailPass(srcTarget, dstTarget, cfg) {
    const exclude = dstTarget ? [srcTarget, dstTarget] : [srcTarget]
    const [scratch1, scratch2] = [A, B, C, D].filter((t) => !exclude.includes(t))
    blurPass(srcTarget.texture, scratch1, [1, 0], cfg.radius)
    blurPass(scratch1.texture, scratch2, [0, 1], cfg.radius)

    gl.useProgram(state.detailProgram)
    bindQuad(gl, state.detailProgram, state.quad)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstTarget ? dstTarget.framebuffer : null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTarget.texture)
    gl.uniform1i(state.detailUniforms.u_original, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, scratch2.texture)
    gl.uniform1i(state.detailUniforms.u_blurred, 1)
    gl.uniform1i(state.detailUniforms.u_mode, cfg.mode)
    gl.uniform1f(state.detailUniforms.u_amount, cfg.amount)
    gl.uniform1f(state.detailUniforms.u_detail, cfg.detail || 0)
    gl.uniform1f(state.detailUniforms.u_masking, cfg.masking || 0)
    gl.uniform1f(state.detailUniforms.u_contrast, cfg.contrast || 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function maskPass(srcTarget, dstTarget, mask) {
    const srcTex = srcTarget.texture
    const adj = mask.adjustments || {}
    const sharpenAmt = (adj.sharpen || 0) / 100 // −1..1: negative softens
    const denoiseAmt = (adj.denoise || 0) / 100

    // Sharpen and denoise share ONE blur pass (radius biased toward whichever wants more
    // spread) rather than each getting their own — running both independently would need
    // 6 scratch buffers at once instead of 4. A shared blur is an approximation when both
    // are active together, but keeps the render-target budget sane.
    let blurredTex = null
    if (sharpenAmt !== 0 || denoiseAmt > 0) {
      const exclude = dstTarget ? [srcTarget, dstTarget] : [srcTarget]
      const [scratch1, scratch2] = [A, B, C, D].filter((t) => !exclude.includes(t))
      const radius = 1.0 + Math.max(Math.abs(sharpenAmt) * (sharpenAmt < 0 ? 4.0 : 2.0), denoiseAmt * 4.0)
      blurPass(srcTex, scratch1, [1, 0], radius)
      blurPass(scratch1.texture, scratch2, [0, 1], radius)
      blurredTex = scratch2.texture
    }

    gl.useProgram(state.maskProgram)
    bindQuad(gl, state.maskProgram, state.quad)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstTarget ? dstTarget.framebuffer : null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(state.maskUniforms.u_image, 0)

    const typeIndex = { linear: 0, radial: 1, brush: 2 }[mask.type] ?? 0
    gl.uniform1i(state.maskUniforms.u_maskType, typeIndex)
    if (mask.type === 'linear') {
      gl.uniform4f(state.maskUniforms.u_linear, mask.linear.x1, mask.linear.y1, mask.linear.x2, mask.linear.y2)
    } else if (mask.type === 'radial') {
      const rx = mask.radial.rx ?? mask.radial.r
      const ry = mask.radial.ry ?? mask.radial.r
      gl.uniform4f(state.maskUniforms.u_radial, mask.radial.cx, mask.radial.cy, rx, ry)
    } else if (mask.type === 'brush') {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, state.brushTex)
      const canvas = getBrushCanvas(mask.id)
      if (canvas) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, gl.ALPHA, gl.UNSIGNED_BYTE, canvas)
      }
      gl.uniform1i(state.maskUniforms.u_brushMask, 1)
    }

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, blurredTex || state.curveTex)
    gl.uniform1i(state.maskUniforms.u_blurredForSharpen, 2)
    gl.uniform1i(state.maskUniforms.u_useDetailBlur, blurredTex ? 1 : 0)
    gl.uniform1f(state.maskUniforms.u_sharpen, sharpenAmt * (sharpenAmt < 0 ? 0.9 : 1.5))
    gl.uniform1f(state.maskUniforms.u_denoise, denoiseAmt * 0.8)

    gl.uniform1i(state.maskUniforms.u_invert, mask.invert ? 1 : 0)
    gl.uniform1f(state.maskUniforms.u_feather, (mask.feather ?? 100) / 100)
    gl.uniform1f(state.maskUniforms.u_exposure, (adj.exposure || 0) / 100)
    gl.uniform1f(state.maskUniforms.u_contrast, (adj.contrast || 0) / 100)
    gl.uniform1f(state.maskUniforms.u_saturation, (adj.saturation || 0) / 100)
    gl.uniform1f(state.maskUniforms.u_temp, (adj.temp || 0) / 100)
    gl.uniform2f(state.maskUniforms.u_resolution, w, h)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  // Chained in this order: broad local-contrast (Texture, Clarity) first, then edge
  // sharpening, then noise smoothing, then local masks last (masks apply on top of
  // everything else, matching how Lightroom layers local adjustments over the develop
  // settings). Each "blur" entry reuses the same blur+combine shape; mode 0 = unsharp-style
  // push-away-from-blur, mode 1 = blend-toward-blur.
  const passes = []
  // Negative amounts blend toward the blur (softening) — same pass, opposite direction.
  if (dehazeActive) passes.push({ kind: 'blur', radius: 20.0 + (Math.abs(s.dehaze) / 100) * 30.0, amount: (s.dehaze / 100) * (s.dehaze > 0 ? 0.6 : 0.35), mode: 0 })
  if (textureActive) passes.push({ kind: 'blur', radius: 2.0 + (Math.abs(s.texture) / 100) * 4.0, amount: (s.texture / 100) * (s.texture > 0 ? 0.9 : 0.75), mode: 0 })
  if (clarityActive) passes.push({ kind: 'blur', radius: 10.0 + (Math.abs(s.clarity) / 100) * 20.0, amount: (s.clarity / 100) * (s.clarity > 0 ? 0.8 : 0.6), mode: 0 })
  if (sharpenActive) {
    const radiusBase = s.sharpenRadius ?? 1.0
    const detailShrink = 1 - ((s.sharpenDetail ?? 25) / 100) * 0.5 // higher Detail -> smaller effective radius, finer texture
    passes.push({
      kind: 'detail',
      radius: Math.max(0.3, radiusBase * detailShrink),
      mode: 0,
      amount: (s.sharpen / 100) * 1.5,
      masking: (s.sharpenMasking ?? 0) / 100,
    })
  }
  if (denoiseActive) {
    passes.push({
      kind: 'detail',
      radius: 1.0 + (s.noiseReduction / 100) * 4.0,
      mode: 1,
      amount: (s.noiseReduction / 100) * 0.8,
      detail: (s.denoiseDetail ?? 50) / 100,
      contrast: (s.denoiseContrast ?? 0) / 100,
    })
  }
  if (colorNoiseActive) {
    passes.push({
      kind: 'detail',
      radius: 1.0 + ((s.colorNoiseSmoothness ?? 50) / 100) * 6.0,
      mode: 2,
      amount: (s.colorNoiseReduction / 100) * 0.9,
      detail: (s.colorNoiseDetail ?? 50) / 100,
    })
  }
  masks.forEach((m) => passes.push({ kind: 'mask', mask: m }))

  let sourceTarget = A
  passes.forEach((pass, i) => {
    const isLast = i === passes.length - 1
    if (pass.kind === 'blur') {
      const [scratch1, scratch2] = [A, B, C, D].filter((t) => t !== sourceTarget)
      // Softening (negative amounts) shows the sparse 9-tap kernel as ghost copies at large
      // radii, so it runs several smaller blurs instead (Gaussians compose: σ = √n · σᵢ).
      const iterations = pass.amount < 0 ? 3 : 1
      const r = pass.radius / Math.sqrt(iterations)
      blurPass(sourceTarget.texture, scratch1, [1, 0], r)
      blurPass(scratch1.texture, scratch2, [0, 1], r)
      for (let k = 1; k < iterations; k++) {
        blurPass(scratch2.texture, scratch1, [1, 0], r)
        blurPass(scratch1.texture, scratch2, [0, 1], r)
      }
      if (isLast) {
        combinePass(sourceTarget.texture, scratch2.texture, null, pass.amount, pass.mode)
      } else {
        combinePass(sourceTarget.texture, scratch2.texture, scratch1, pass.amount, pass.mode)
        sourceTarget = scratch1
      }
    } else if (pass.kind === 'detail') {
      const dest = isLast ? null : [A, B, C, D].find((t) => t !== sourceTarget)
      detailPass(sourceTarget, dest, pass)
      if (!isLast) sourceTarget = dest
    } else {
      const dest = isLast ? null : [A, B, C, D].find((t) => t !== sourceTarget)
      maskPass(sourceTarget, dest, pass.mask)
      if (!isLast) sourceTarget = dest
    }
  })
}
