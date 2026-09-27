export const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

// Single fragment shader implementing the full tonal/color/effects pipeline
// (everything except geometry, which is handled upstream on the CPU/Canvas 2D).
// Mirrors the math in engine/pipeline.js's Canvas 2D fallback as closely as possible.
export const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform sampler2D u_curvePointsLUT;
uniform sampler3D u_cubeLut;
uniform bool u_useCubeLut;
uniform bool u_useCurvePoints;

uniform sampler2D u_localLUT;  // base EV → Highlights/Shadows gain (EV)      — tone.js
uniform sampler2D u_globalLUT; // EV → output light ÷ 2^EV (Whites/Blacks/Contrast)
uniform sampler2D u_gfCoef;    // guided-filter (A, B): local base = A·log2(Y) + B — localBase.js
uniform bool u_useTone;
uniform bool u_useLocal;
uniform float u_exposureEV;
uniform float u_saturate;

uniform float u_curveStrength;

uniform float u_lutStrength;

uniform float u_hslHue[8];
uniform float u_hslSat[8];
uniform float u_hslLum[8];
uniform bool u_hslActive;
uniform float u_vibrance;

uniform vec3 u_tempTintColor;
uniform float u_temp;
uniform float u_tint;

uniform vec3 u_gradeColor;
uniform float u_gradeIntensity;

uniform float u_grain;
uniform float u_grainSeed;

uniform float u_vignette;
uniform vec2 u_resolution;
uniform float u_dehaze;

vec3 rgb2hsl(vec3 c) {
  float maxc = max(max(c.r, c.g), c.b);
  float minc = min(min(c.r, c.g), c.b);
  float l = (maxc + minc) * 0.5;
  float h = 0.0;
  float s = 0.0;
  if (maxc != minc) {
    float d = maxc - minc;
    s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
    if (maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x / 360.0;
  float s = hsl.y;
  float l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

float blendOverlay(float base, float blend) {
  return base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend));
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Must match tone.js LOG_MIN / LOG_MAX and the LUT sizes.
float lutCoord(float v, float n) {
  float t = clamp((v + 14.0) / 20.0, 0.0, 1.0);
  return t * (n - 1.0) / n + 0.5 / n;
}

float hashNoise(vec2 co, float seed) {
  return fract(sin(dot(co, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

void main() {
  vec3 c = texture(u_image, v_uv).rgb;

  // Engine v2 tone — see tone.js (math) and localBase.js (edge-aware local base).
  // Linear light; Highlights/Shadows from the local base, then Whites/Blacks/Contrast;
  // luminance-ratio scaling keeps hue; gamut fit instead of per-channel clipping.
  if (u_useTone) {
    vec3 lin = srgbToLinear(c);
    float Y0 = dot(lin, vec3(0.2126, 0.7152, 0.0722));
    float v0 = log2(max(Y0, 1e-6));
    float v1 = v0 + u_exposureEV;
    if (u_useLocal) {
      vec2 ab = texture(u_gfCoef, vec2(v_uv.x, 1.0 - v_uv.y)).rg; // map rows are top-down
      float base = ab.x * v0 + ab.y + u_exposureEV;
      v1 += texture(u_localLUT, vec2(lutCoord(base, 512.0), 0.5)).r;
    }
    float Yf = exp2(v1) * texture(u_globalLUT, vec2(lutCoord(v1, 1024.0), 0.5)).r;
    lin *= Yf / max(Y0, 1e-6);
    float m = max(max(lin.r, lin.g), lin.b);
    if (m > 1.0) {
      float Y2 = dot(lin, vec3(0.2126, 0.7152, 0.0722));
      lin = Y2 >= 1.0 ? vec3(1.0) : Y2 + (lin - Y2) * ((1.0 - Y2) / (m - Y2));
    }
    c = linearToSrgb(lin);
  }
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, u_saturate);
  c = clamp(c, 0.0, 1.0);

  // Dehaze approximation: not a true dark-channel-prior haze removal — just extra
  // contrast + saturation to punch through a hazy/flat look, paired with a large-radius
  // local-contrast pass later in the effect chain.
  if (u_dehaze > 0.0) {
    c = clamp((c - 0.5) * (1.0 + u_dehaze * 0.6) + 0.5, 0.0, 1.0);
    float dehazeLuma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(dehazeLuma), c, 1.0 + u_dehaze * 0.3), 0.0, 1.0);
  }

  if (u_curveStrength != 0.0) {
    float gamma = 1.0 - u_curveStrength / 220.0;
    vec3 x = c;
    vec3 lo = 0.5 * pow(2.0 * x, vec3(gamma));
    vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - x), vec3(gamma));
    c = clamp(mix(lo, hi, step(0.5, x)), 0.0, 1.0);
  }

  if (u_useCurvePoints) {
    // 256-texel LUT: map 0..1 onto texel centers so linear filtering interpolates exactly.
    vec3 cu = (clamp(c, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
    c.r = texture(u_curvePointsLUT, vec2(cu.r, 0.5)).r;
    c.g = texture(u_curvePointsLUT, vec2(cu.g, 0.5)).g;
    c.b = texture(u_curvePointsLUT, vec2(cu.b, 0.5)).b;
  }

  if (u_useCubeLut) {
    vec3 graded = texture(u_cubeLut, c).rgb;
    c = mix(c, graded, u_lutStrength);
  }

  if (u_hslActive || u_vibrance != 0.0) {
    vec3 hsl = rgb2hsl(c);
    if (u_hslActive) {
      float dh = 0.0, ds = 0.0, dl = 0.0;
      float centers[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 320.0);
      for (int i = 0; i < 8; i++) {
        float dist = abs(hsl.x - centers[i]);
        dist = min(dist, 360.0 - dist);
        float w = max(0.0, 1.0 - dist / 40.0);
        if (w > 0.0) {
          dh += u_hslHue[i] * w * 0.4;
          ds += (u_hslSat[i] * w) / 120.0;
          dl += (u_hslLum[i] * w) / 200.0;
        }
      }
      hsl.x = mod(hsl.x + dh + 360.0, 360.0);
      hsl.y = clamp(hsl.y + ds, 0.0, 1.0);
      hsl.z = clamp(hsl.z + dl, 0.0, 1.0);
    }
    if (u_vibrance != 0.0) {
      hsl.y = clamp(hsl.y + u_vibrance * (1.0 - hsl.y) * 0.8, 0.0, 1.0);
    }
    c = hsl2rgb(hsl);
  }

  if (u_temp != 0.0 || u_tint != 0.0) {
    vec3 blend = u_tempTintColor;
    vec3 blended = vec3(blendOverlay(c.r, blend.r), blendOverlay(c.g, blend.g), blendOverlay(c.b, blend.b));
    c = mix(c, blended, 0.35);
  }

  if (u_gradeIntensity > 0.0) {
    vec3 baseHsl = rgb2hsl(c);
    vec3 gradeHsl = rgb2hsl(u_gradeColor);
    vec3 graded = hsl2rgb(vec3(gradeHsl.x, gradeHsl.y, baseHsl.z));
    c = mix(c, graded, u_gradeIntensity);
  }

  if (u_grain > 0.0) {
    float n = (hashNoise(gl_FragCoord.xy, u_grainSeed) - 0.5) * u_grain;
    c += n;
  }

  if (u_vignette > 0.0) {
    vec2 pixelPos = v_uv * u_resolution;
    vec2 center = u_resolution * 0.5;
    float dist = distance(pixelPos, center);
    float innerR = min(u_resolution.x, u_resolution.y) * 0.3;
    float outerR = max(u_resolution.x, u_resolution.y) * 0.7;
    float t = clamp((dist - innerR) / (outerR - innerR), 0.0, 1.0);
    c -= t * (u_vignette / 140.0);
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

// Applies one local adjustment mask (linear or circular-radial gradient) to `u_image`.
// Chained per-mask, same ping-pong pattern as the blur/combine detail-effect passes.
export const MASK_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_image;
uniform int u_maskType; // 0 = linear, 1 = radial, 2 = brush
uniform vec4 u_linear;  // x1,y1,x2,y2 (UV space)
uniform vec4 u_radial;  // cx,cy,rx,ry (normalized to the shorter image edge)
uniform sampler2D u_brushMask;
uniform sampler2D u_blurredForSharpen;
uniform bool u_useDetailBlur;
uniform float u_sharpen;
uniform float u_denoise;
uniform float u_feather; // 0..1 — 0 = hard edge, 1 = the original full-length soft gradient
uniform bool u_invert;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temp;
uniform vec2 u_resolution;

float linearWeight(vec2 uv) {
  vec2 p1 = u_linear.xy;
  vec2 p2 = u_linear.zw;
  vec2 dir = p2 - p1;
  float len = length(dir);
  if (len < 0.0001) return 0.0;
  float t = dot(uv - p1, dir) / (len * len);
  float halfWidth = max(0.001, u_feather * 0.5);
  return clamp((t - (0.5 - halfWidth)) / (halfWidth * 2.0), 0.0, 1.0);
}

float radialWeight(vec2 uv) {
  vec2 pixelPos = (uv - u_radial.xy) * u_resolution;
  float minDim = min(u_resolution.x, u_resolution.y);
  float rx = max(u_radial.z * minDim, 0.001);
  float ry = max(u_radial.w * minDim, 0.001);
  float dist = length(vec2(pixelPos.x / rx, pixelPos.y / ry)); // 1.0 = exactly on the ellipse
  float innerDist = 1.0 - u_feather;
  float band = max(1.0 - innerDist, 0.001);
  return 1.0 - clamp((dist - innerDist) / band, 0.0, 1.0);
}

void main() {
  vec3 base = texture(u_image, v_uv).rgb;
  // Mask geometry is captured in DOM space (Y=0 at top), but WebGL's v_uv has Y=0 at the
  // bottom — flip just for the mask math so the applied effect lines up with the guide the
  // user actually drew. Horizontal drags hide this mismatch by coincidence; diagonal ones
  // show it clearly, which is why only diagonal masks looked mirrored.
  vec2 maskUv = vec2(v_uv.x, 1.0 - v_uv.y);
  float w;
  if (u_maskType == 0) w = linearWeight(maskUv);
  else if (u_maskType == 1) w = radialWeight(maskUv);
  else w = texture(u_brushMask, v_uv).a; // painted with the same upload flip as the main image — no manual flip needed
  if (u_invert) w = 1.0 - w;

  vec3 c = base * (1.0 + u_exposure);
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + u_saturation);
  c.r += u_temp * 0.12;
  c.b -= u_temp * 0.12;
  if (u_useDetailBlur) {
    vec3 blurred = texture(u_blurredForSharpen, v_uv).rgb;
    if (u_sharpen > 0.0) c = c + u_sharpen * (c - blurred);
    if (u_denoise > 0.0) c = mix(c, blurred, u_denoise);
  }
  c = clamp(c, 0.0, 1.0);

  outColor = vec4(mix(base, c, w), 1.0);
}`

// Handles Sharpen (mode 0, with edge-detected Masking), Luminance Noise Reduction
// (mode 1, smooths brightness only, keeps chroma), and Color Noise Reduction (mode 2,
// smooths chroma only, keeps luminance) — each reusing the same blur input, just combined
// differently. "Detail" in modes 1/2 is edge-preservation: less smoothing where the local
// blur difference (a proxy for edge strength) is already large.
export const DETAIL_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_original;
uniform sampler2D u_blurred;
uniform int u_mode;
uniform float u_amount;
uniform float u_detail;
uniform float u_masking;
uniform float u_contrast;

void main() {
  vec3 orig = texture(u_original, v_uv).rgb;
  vec3 blur = texture(u_blurred, v_uv).rgb;
  vec3 diff = orig - blur;
  float edge = length(diff);

  if (u_mode == 0) {
    float m = u_masking > 0.0 ? smoothstep(u_masking * 0.4, u_masking * 0.4 + 0.15, edge) : 1.0;
    outColor = vec4(clamp(orig + u_amount * m * diff, 0.0, 1.0), 1.0);
    return;
  }

  float luma = dot(orig, vec3(0.2126, 0.7152, 0.0722));
  float lumaBlur = dot(blur, vec3(0.2126, 0.7152, 0.0722));
  float edgePreserve = 1.0 - u_detail * clamp(edge * 4.0, 0.0, 1.0);

  if (u_mode == 1) {
    float newLuma = mix(luma, lumaBlur, u_amount * edgePreserve);
    vec3 result = orig + (newLuma - luma) + u_contrast * 0.3 * diff;
    outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
    return;
  }

  vec3 chroma = orig - vec3(luma);
  vec3 chromaBlur = blur - vec3(lumaBlur);
  vec3 newChroma = mix(chroma, chromaBlur, u_amount * edgePreserve);
  outColor = vec4(clamp(vec3(luma) + newChroma, 0.0, 1.0), 1.0);
}`

// Sample spacing is scaled by u_radius so a fixed tap count still gives a variable blur size.
export const BLUR_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_image;
uniform vec2 u_direction;
uniform vec2 u_texel;
uniform float u_radius;

void main() {
  float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 result = texture(u_image, v_uv).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 offset = u_direction * u_texel * float(i) * u_radius;
    result += texture(u_image, v_uv + offset).rgb * weights[i];
    result += texture(u_image, v_uv - offset).rgb * weights[i];
  }
  outColor = vec4(result, 1.0);
}`

// Combines an original image with its blurred version: mode 0 = unsharp-mask sharpening
// (push away from the blur), mode 1 = noise reduction (blend toward the blur).
export const COMBINE_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_original;
uniform sampler2D u_blurred;
uniform float u_amount;
uniform int u_mode;

void main() {
  vec3 orig = texture(u_original, v_uv).rgb;
  vec3 blur = texture(u_blurred, v_uv).rgb;
  vec3 result = u_mode == 0 ? orig + u_amount * (orig - blur) : mix(orig, blur, u_amount);
  outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`
