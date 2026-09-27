# LumaGrader — Developer notes

How the app is put together, for contributors. For how to *use* the app, see the
[User guide](USER_GUIDE.md).

## Stack

React 18 + Vite 5, plain JavaScript. Rendering is WebGL2 with an automatic Canvas 2D fallback.
Storage is IndexedDB. There is no backend: the app is a static site on GitHub Pages and works
offline through a service worker (`public/sw.js`).

## Image pipeline

For every render, the source photo goes through these steps in order:

1. **Source prep** (`engine/sourcePrep.js`, CPU, cached): lens corrections (`lens.js`) →
   spot removal (`heal.js`) → rotate/straighten/crop (`geometry.js`).
2. **Main shader** (`engine/webgl/shaders.js`; the same maths in JS in `color.js`, `tone.js`
   and `pipeline.js` for the Canvas fallback), in linear light: white balance → tone
   (Exposure, local Highlights/Shadows from an edge-aware base in `localBase.js`,
   Whites/Blacks/Contrast) → Vibrance/Saturation → curves → LUT → HSL → Color Grading (Oklab)
   → grain → vignette.
3. **Detail passes** (`renderer.js`): Texture, Clarity and Dehaze (blurs at preview scale so
   preview and export match), sharpening, noise reduction, then local masks.

RAW files are decoded by LibRaw (WebAssembly, `public/libraw/`) in a worker and "developed"
(`rawDevelop.js`, `rawLook.js`) into the 8-bit image the editor starts from. Imports use a
half-size decode; export and 1:1 zoom decode full size with the same parameters.

## Memory rules

- State keeps no decoded pixels: only the file blob, a thumbnail URL and the size.
- Previews are 1600 px (LRU of 3); at most one full-size image is decoded at a time.
- Large JPEGs are decoded straight to the needed size (`imageStore.decodeScaled`).
- Only the main preview canvas owns a WebGL context; everything else renders through one shared
  scratch canvas (`pipeline.renderToCanvas`). Phones cap zoom/export to the GPU's limits.

## Settings and migration

A photo's edit is one plain `settings` object (defaults in `engine/defaults.js`). When a
setting's meaning changes, bump `ENGINE_VERSION` and convert old values in `migrateSettings`,
which runs on every project, preset and recovery load. Panel ↔ setting keys live in
`engine/panels.js`.

Adding a new setting:
1. Add its default to `defaultSettings()` and its key to the right panel in `panels.js`.
2. Implement it in the shader **and** the Canvas fallback (or in source prep).
3. Map it in `xmpPreset.js` if presets from other editors can carry it.

## Storage

IndexedDB database `lumagrade` (name kept for existing users): `presets`, `projects`,
`session` + `sessionFiles` (crash recovery). Presets are mirrored in localStorage. A project
stores the original files, settings, ratings, albums, snapshots and brush-mask PNGs
(`engine/photoExtras.js`). `.lumagrader` files are ZIPs of the same data
(`engine/projectFile.js`).

## Releasing

1. Bump `version` in `package.json` (and `package-lock.json`).
2. Add an entry at the top of `CHANGELOG` in `src/changelog.js`, written for photographers.
   It appears in About and in the "What's new" popup (versions from `POPUP_FROM` on;
   `quiet: true` keeps a small fix out of the popup).
3. `npm run lint && npm run build`, test on a phone, then push to `main`.
