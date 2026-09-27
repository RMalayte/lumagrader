# LumaGrader by Rax

Browser-based, Lightroom-style photo editor. Adjustments, curves, HSL, LUT import,
color grading and batch export — all client-side, no backend.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + React | Fast dev server, simple component model |
| Image pipeline | Canvas 2D (`src/engine/`) | Ships first; swap to WebGL here if per-pixel ops (LUT/HSL/curve/grain) become a bottleneck on large images |
| Persistence | IndexedDB (`src/hooks/useProjectStore.js`) | Saves presets and project state locally in the browser — no account/server needed |
| Hosting | GitHub Pages | Static SPA, deployed via the included Actions workflow |

## Project structure

```
src/
├── components/   # UI: ThumbnailStrip, CanvasPreview, ControlsPanel, PresetChips, HSLPanel, ColorGradePicker
├── engine/       # Pixel pipeline: adjustments, curve, hsl, lut
├── hooks/        # useProjectStore (IndexedDB-backed)
├── store/        # ProjectContext (Context + useReducer — no Redux/Zustand for this scope)
├── App.jsx
└── main.jsx
```

## Getting started

```bash
npm install
npm run dev       # local dev server
npm run build     # production build -> dist/
npm run preview   # preview the production build locally
```

## Deploying to GitHub Pages

Push to `main` — `.github/workflows/deploy.yml` lints, builds and publishes `dist/` to
GitHub Pages. One-time setup: repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**. The site appears at `https://<username>.github.io/<repo>/`.

## Mobile viewer (v0.6.2)

Lightroom-Mobile-style layout under 860 px: one-row header (view icons, "⋯" menu for Reset /
Copy / Remove, Export, Save), edge-to-edge photo, filmstrip hidden until the filmstrip button is
tapped (choice remembered), swipe left/right on the photo (at Fit) to change photos, touch & hold
the photo to see the original, tap the active tool tab to hide the tool sheet for a bigger photo.

## Tone curves (v0.6.1)

Curves panel has **RGB, Red, Green, Blue** point curves (like Lightroom's Point Curve). Points are
joined by a smooth cubic spline (`src/engine/curvePoints.js`, modeled on Adobe's DNG SDK spline),
not straight lines. The RGB curve is applied first, then each channel curve on its result; all
four are pre-composed into one RGBA lookup texture. Tap/drag on the graph to add a point, drag to
move, double-click or drag it off the graph to remove. XMP presets import `ToneCurvePV2012` and the
Red/Green/Blue curves.

## RAW photos (v0.6.0)

RAW files (ARW, CR2/CR3, NEF, DNG, RAF, ORF, RW2, …) are decoded from the **sensor data** with
[LibRaw](https://www.libraw.org/) compiled to WebAssembly (`libraw-wasm`), entirely in the browser.

- Import: half-size decode → "develop" (`src/engine/rawDevelop.js`, in a worker) that matches the
  camera's own look (brightness/contrast/saturation measured from the RAW's embedded JPEG), with
  extra highlight gradation and chroma noise reduction. Params are stored on the photo.
- Export / 1:1: full-size decode developed with the same params, so it matches the preview.
- Fallback: if LibRaw can't read a file, the embedded JPEG preview is used (badge: "RAW preview").
- `npm install` / `dev` / `build` copy the LibRaw worker + wasm into `public/libraw/`
  (`scripts/copy-libraw.mjs`); that folder is git-ignored.
- Licensing: LibRaw is LGPL-2.1 / CDDL-1.0 (see `public/libraw/NOTICE.txt`). It is loaded as a
  separate, unmodified, replaceable `.wasm` file.

## Known limitations

- No cloud sync — projects/presets are local to the browser they're saved in.
- Full-size RAW export takes ~10–15 s for a 24 MP file on a laptop and needs a few hundred MB of
  memory; if it fails (low-memory phones) the half-size develop is exported with a notice.
- Reopening a saved project re-develops its RAW photos (≈1–4 s each).
