// Small inline stroke-icon set (no icon-font dependency). All icons are 24×24, drawn with
// currentColor so they inherit button text color.
const PATHS = {
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  compare: 'M12 3v18M4 5h5v14H4zM15 5h5v14h-5',
  crop: 'M6 2v16h16M2 6h16v16',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 6h6l2 2h10v11H3z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  close: 'M6 6l12 12M18 6L6 18',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  filmstrip: 'M3 5h18v14H3zM7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4',
  loupe: 'M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  coffee: 'M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3',
}

export default function Icon({ name, size = 16, className = '', strokeWidth = 2 }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      className={'icon ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  )
}
