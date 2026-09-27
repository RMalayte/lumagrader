import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: 'readonly', document: 'readonly', indexedDB: 'readonly', Image: 'readonly', FileReader: 'readonly', URL: 'readonly', prompt: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', console: 'readonly', alert: 'readonly', confirm: 'readonly', Blob: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', atob: 'readonly', performance: 'readonly', Worker: 'readonly', ResizeObserver: 'readonly', DOMParser: 'readonly', navigator: 'readonly', fetch: 'readonly', createImageBitmap: 'readonly', ImageData: 'readonly' },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
  // Web Worker and Service Worker scripts run with `self` instead of `window`.
  {
    files: ['src/workers/**/*.js', 'public/sw.js'],
    languageOptions: { globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', Response: 'readonly', URL: 'readonly', Promise: 'readonly' } },
  },
]
