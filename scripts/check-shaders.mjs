// Guards against GLSL that some mobile GPU drivers reject even though WebGL accepts it.
// Run by `npm run lint` (and so by CI).
//  - Array constructors like `float[4](…)`: Mali drivers behind Chrome's ANGLE fail with
//    "no default precision defined for variable 'float[4]'" → the GPU preview can't start and
//    phones drop into the slow compatibility mode. Use vecN or a small function instead.
import { readFileSync } from 'node:fs'

const FILE = new URL('../src/engine/webgl/shaders.js', import.meta.url)
const RULES = [
  { re: /\b(?:float|int|uint|bool|[iub]?vec[234]|mat[234])\s*\[\s*\d*\s*\]\s*\(/g, why: 'array constructor (Mali/ANGLE rejects it) — use vecN or a function' },
]

const lines = readFileSync(FILE, 'utf8').split('\n')
const problems = []
lines.forEach((line, i) => {
  const code = line.replace(/\/\/.*$/, '') // ignore comments
  for (const { re, why } of RULES) {
    re.lastIndex = 0
    if (re.test(code)) problems.push(`shaders.js:${i + 1}: ${why}\n    ${line.trim()}`)
  }
})
if (problems.length) {
  console.error('Shader check failed:\n' + problems.join('\n'))
  process.exit(1)
}
console.log('Shader check OK')
