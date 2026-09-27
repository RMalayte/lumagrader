// User-facing release notes — newest first. Shown in the "What's new" popup after an update
// and in About. Keep items short and written for photographers, not developers.
export const CHANGELOG = [
  {
    version: '0.9.0',
    date: '2026-09-27',
    title: 'Presence & Effects',
    items: [
      'Clarity and Texture now work on brightness only (no colour shifts); Clarity focuses on the midtones without halos, Texture on fine detail (skin, foliage) and leaves strong edges alone.',
      'Dehaze now estimates the haze in each area of the photo; negative Dehaze adds a soft haze.',
      'Presence effects look the same in the preview and in the full-size export.',
      'Vignette: new Midpoint, Roundness, Feather and Highlights sliders (like Lightroom\'s post-crop vignette).',
      'Grain: new Size and Roughness sliders.',
      'This "What\'s new" popup, and an About page with the version and full history.',
    ],
  },
  {
    version: '0.8.1',
    date: '2026-09-27',
    title: 'Color Grading calibrated to Lightroom',
    items: [
      'Color Grading strength, tonal ranges and wheel hues now match Lightroom (e.g. 200° is teal).',
      'Softer, film-like Grain that looks the same in the preview and the export.',
      'A notice appears if a RAW could only be opened as the camera preview.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-09-27',
    title: 'Color Grading',
    items: [
      'Shadows / Midtones / Highlights / Global colour wheels with Luminance, Blending and Balance.',
      'Lightroom presets with Color Grading or Split Toning import fully.',
    ],
  },
  {
    version: '0.7.4',
    date: '2026-09-27',
    title: 'White balance in Kelvin',
    items: [
      'RAW photos: Temp in Kelvin and Tint, starting from the camera\'s As Shot values (on Lightroom\'s scale).',
      'The histogram updates live while you drag a slider.',
      'New "Luma Color" base look for RAW photos, closer to Lightroom\'s default colour.',
      'Profiles renamed: Luma Color, Luma Standard, Luma Vivid, …',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-09-27',
    title: 'New colour engine',
    items: [
      'Real white balance, Lightroom-like Vibrance, Saturation and HSL.',
      'Texture, Clarity and Dehaze go negative; Vignette uses Lightroom\'s direction.',
    ],
  },
  {
    version: '0.6.3',
    date: '2026-09-27',
    title: 'Safer editing on phones',
    items: [
      'Unsaved work is kept if the app closes — you\'re offered to restore it next time.',
      'Sliders only move when you drag their handle, so scrolling never changes a value.',
      'Bigger photo on phones.',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-09-27',
    title: 'Curves',
    items: ['Separate Red, Green and Blue tone curves, drawn as smooth curves.'],
  },
]

/** Compares dotted versions: negative if a < b. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}
