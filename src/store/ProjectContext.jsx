import { createContext, useContext, useReducer, useRef } from 'react'
import { migrateSettings } from '../engine/defaults'

const ProjectContext = createContext(null)

const initialState = {
  // { id, name, sourceBlob, thumbUrl, width, height, originalBlob, isRawPreview, rating, settings,
  //   history: { past, future }, bypass? } — decoded pixels live in engine/imageStore.js caches
  images: [],
  activeId: null,
  selectedIds: [],
  albums: [],         // [{ id, name }] — photos list the albums they're in (image.albumIds)
  activeAlbumId: null, // album shown in the filmstrip; null = all photos    // multi-select in the filmstrip, for "copy to selected" / preset-apply-to-selected
  luts: {},
  customPresets: {},
  currentBand: 'red',
  viewMode: 'filmstrip', // 'filmstrip' | 'loupe' | 'catalog'
  currentProjectId: null,
  currentProjectName: null,
  isDirty: false,     // true once anything has changed since the last successful Save Project
  eyedropperActive: false, // HSL "pick a color from the photo" mode
  wbPickActive: false, // White Balance eyedropper: next tap on the photo sets Temp/Tint
  // Last preset applied, for its Amount slider: { name, ids, before: {id: settings}, full: {id: settings}, amount }
  presetSession: null,
  selectedMaskId: null,
  maskDrawMode: null, // null | 'linear' | 'radial'
  maskOverlay: false, // tint the selected mask red on the preview
  maskPickColor: false, // next click on the photo picks the color range's colour
  brushSettings: { size: 20, hardness: 60, opacity: 100, erase: false },
  selectedSpotId: null, // spot removal: the spot being edited
  spotSettings: { size: 20, feather: 50, opacity: 100, mode: 'heal' }, // for new spots
  openAccordionId: null, // shared across sidebar accordions — opening one closes the rest
  clipping: { shadows: false, highlights: false }, // on-photo clipping warnings (J key / histogram triangles)
  importProgress: null, // { done, total } while photos are being imported
  // Photo Info overlay; starts hidden on phones where screen space is tight
  infoVisible: typeof window === 'undefined' || !window.matchMedia('(max-width: 859px)').matches, // (histogram + EXIF) shown/hidden
}

const HISTORY_CAP = 20

// Actions that don't represent "unsaved work" (navigation, selection, library management) —
// everything else that changes state marks isDirty.
const NON_DIRTY_ACTIONS = new Set([
  'SET_ACTIVE', 'SET_VIEW_MODE', 'SET_CURRENT_BAND', 'LOAD_CUSTOM_PRESETS',
  'ADD_LUT', 'ADD_CUSTOM_PRESET', 'DELETE_CUSTOM_PRESET',
  'LOAD_PROJECT', 'SET_CURRENT_PROJECT', 'NEW_PROJECT',
  'TOGGLE_SELECT', 'SET_SELECTION', 'CLEAR_SELECTION', 'SET_EYEDROPPER',
  'SET_SELECTED_MASK', 'SET_MASK_DRAW_MODE', 'SET_BRUSH_SETTING', 'SET_OPEN_ACCORDION',
  'SET_SELECTED_SPOT', 'SET_SPOT_SETTING', 'SET_MASK_OVERLAY', 'SET_MASK_PICK_COLOR',
  'SET_CLIPPING', 'SET_IMPORT_PROGRESS', 'SET_INFO_VISIBLE',
  'TOGGLE_PANEL_BYPASS', // bypass is a temporary view toggle, not saved work
  'SET_ACTIVE_ALBUM', 'SET_WB_PICK', 'SET_PRESET_SESSION', 'SET_PRESET_AMOUNT', 'REMEMBER_PRESET_AMOUNT',
])

/** Photos shown in the filmstrip: the open album's, or all of them. */
export function visibleImages(state) {
  if (!state.activeAlbumId) return state.images
  return state.images.filter((im) => im.albumIds?.includes(state.activeAlbumId))
}

const withAlbum = (im, albumId, on) => {
  const ids = im.albumIds || []
  if (on) return ids.includes(albumId) ? im : { ...im, albumIds: [...ids, albumId] }
  return ids.includes(albumId) ? { ...im, albumIds: ids.filter((a) => a !== albumId) } : im
}

function rawReducer(state, action) {
  switch (action.type) {
    case 'ADD_IMAGES': {
      // Photos imported while an album is open go into that album (else they'd vanish from view).
      const added = state.activeAlbumId ? action.images.map((im) => withAlbum(im, state.activeAlbumId, true)) : action.images
      return { ...state, images: [...state.images, ...added] }
    }

    case 'ADD_ALBUM':
      return {
        ...state,
        albums: [...state.albums, action.album],
        images: action.ids?.length ? state.images.map((im) => (action.ids.includes(im.id) ? withAlbum(im, action.album.id, true) : im)) : state.images,
      }

    case 'RENAME_ALBUM':
      return { ...state, albums: state.albums.map((a) => (a.id === action.id ? { ...a, name: action.name } : a)) }

    case 'DELETE_ALBUM':
      return {
        ...state,
        albums: state.albums.filter((a) => a.id !== action.id),
        images: state.images.map((im) => withAlbum(im, action.id, false)),
        activeAlbumId: state.activeAlbumId === action.id ? null : state.activeAlbumId,
      }

    case 'SET_ALBUM_MEMBERSHIP': {
      const images = state.images.map((im) => (action.ids.includes(im.id) ? withAlbum(im, action.albumId, action.add) : im))
      if (images.every((im, i) => im === state.images[i])) return state
      return { ...state, images }
    }

    case 'SET_ACTIVE_ALBUM': {
      const next = { ...state, activeAlbumId: action.id, selectedIds: [] }
      const shown = visibleImages(next)
      if (shown.length && !shown.some((im) => im.id === state.activeId)) next.activeId = shown[0].id
      return next
    }

    case 'REMOVE_IMAGES': {
      const remaining = state.images.filter((im) => !action.ids.includes(im.id))
      const activeId = action.ids.includes(state.activeId) ? (remaining[0]?.id ?? null) : state.activeId
      const selectedIds = state.selectedIds.filter((id) => !action.ids.includes(id))
      return { ...state, images: remaining, activeId, selectedIds }
    }

    // Undo for REMOVE_IMAGES: puts the removed images back at their original positions.
    case 'RESTORE_IMAGES': {
      const images = [...state.images]
      ;[...action.entries].sort((a, b) => a.index - b.index).forEach(({ image, index }) => {
        images.splice(Math.min(index, images.length), 0, image)
      })
      return { ...state, images, activeId: action.activeId ?? state.activeId }
    }

    case 'TOGGLE_PANEL_BYPASS':
      return {
        ...state,
        images: state.images.map((im) =>
          im.id === action.id ? { ...im, bypass: { ...im.bypass, [action.panel]: !im.bypass?.[action.panel] } } : im,
        ),
      }

    case 'SET_CLIPPING':
      return { ...state, clipping: { ...state.clipping, ...action.patch } }

    case 'SET_IMPORT_PROGRESS':
      return { ...state, importProgress: action.progress }

    case 'SET_INFO_VISIBLE':
      return { ...state, infoVisible: action.visible }

    // Snapshots: named versions of a photo's settings, kept on the image record.
    case 'ADD_SNAPSHOT':
      return {
        ...state,
        images: state.images.map((im) => (im.id === action.id ? { ...im, snapshots: [...(im.snapshots || []), action.snapshot] } : im)),
      }

    case 'UPDATE_SNAPSHOT':
      return {
        ...state,
        images: state.images.map((im) =>
          im.id === action.id ? { ...im, snapshots: (im.snapshots || []).map((sn) => (sn.id === action.snapshotId ? { ...sn, ...action.patch } : sn)) } : im,
        ),
      }

    case 'DELETE_SNAPSHOT':
      return {
        ...state,
        images: state.images.map((im) => (im.id === action.id ? { ...im, snapshots: (im.snapshots || []).filter((sn) => sn.id !== action.snapshotId) } : im)),
      }

    case 'SET_RATING':
      return { ...state, images: state.images.map((im) => (im.id === action.id ? { ...im, rating: action.rating } : im)) }

    case 'SET_ACTIVE':
      return { ...state, activeId: action.id }

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode }

    case 'TOGGLE_SELECT': {
      const has = state.selectedIds.includes(action.id)
      return { ...state, selectedIds: has ? state.selectedIds.filter((id) => id !== action.id) : [...state.selectedIds, action.id] }
    }

    case 'SET_SELECTION':
      return { ...state, selectedIds: action.ids }

    case 'CLEAR_SELECTION':
      return { ...state, selectedIds: [] }

    case 'SET_EYEDROPPER':
      return { ...state, eyedropperActive: action.active, wbPickActive: action.active ? false : state.wbPickActive }

    case 'SET_WB_PICK':
      return { ...state, wbPickActive: action.active, eyedropperActive: action.active ? false : state.eyedropperActive }

    case 'SET_PRESET_SESSION':
      return { ...state, presetSession: action.session }

    case 'SET_PRESET_AMOUNT':
      return state.presetSession ? { ...state, presetSession: { ...state.presetSession, amount: action.amount } } : state

    // Remembers a committed Amount so Undo/Redo back to it keep the Amount slider.
    case 'REMEMBER_PRESET_AMOUNT': {
      const ps = state.presetSession
      if (!ps) return state
      return { ...state, presetSession: { ...ps, amounts: [...(ps.amounts || []).filter((a) => a !== ps.amount), ps.amount].slice(-30) } }
    }

    case 'SET_SELECTED_MASK':
      return { ...state, selectedMaskId: action.id, maskPickColor: false }

    case 'SET_MASK_DRAW_MODE':
      return { ...state, maskDrawMode: action.mode }

    case 'SET_BRUSH_SETTING':
      return { ...state, brushSettings: { ...state.brushSettings, ...action.patch } }

    case 'SET_MASK_OVERLAY':
      return { ...state, maskOverlay: action.on }

    case 'SET_MASK_PICK_COLOR':
      return { ...state, maskPickColor: action.on }

    case 'SET_SELECTED_SPOT':
      return { ...state, selectedSpotId: action.id }

    case 'SET_SPOT_SETTING':
      return { ...state, spotSettings: { ...state.spotSettings, ...action.patch } }

    case 'SET_OPEN_ACCORDION':
      return {
        ...state,
        openAccordionId: action.id,
        // Leaving the Masks accordion should also drop its on-canvas guides — that's what
        // made them linger distractingly while working on unrelated tools.
        selectedMaskId: action.id === 'masks' ? state.selectedMaskId : null,
        maskDrawMode: action.id === 'masks' ? state.maskDrawMode : null,
        maskPickColor: action.id === 'masks' ? state.maskPickColor : false,
        selectedSpotId: action.id === 'healing' ? state.selectedSpotId : null,
        wbPickActive: action.id === 'color' ? state.wbPickActive : false,
      }

    // Live preview update while dragging — does NOT touch history.
    case 'LIVE_UPDATE':
      return {
        ...state,
        images: state.images.map((im) =>
          im.id === action.id ? { ...im, settings: { ...im.settings, ...action.patch } } : im,
        ),
      }

    // Called on drag release: pushes the pre-drag snapshot onto the undo stack.
    case 'COMMIT':
      return {
        ...state,
        images: state.images.map((im) => {
          if (im.id !== action.id) return im
          if (JSON.stringify(action.before) === JSON.stringify(im.settings)) return im
          return { ...im, history: { past: [...im.history.past, action.before].slice(-HISTORY_CAP), future: [] } }
        }),
      }

    // Discrete replace (preset apply, reset) across one or more target images at once —
    // each target gets its own history entry.
    case 'SET_SETTINGS_COMMIT_MULTI':
      return {
        ...state,
        images: state.images.map((im) =>
          action.ids.includes(im.id)
            ? { ...im, settings: action.settings, history: { past: [...im.history.past, im.settings].slice(-HISTORY_CAP), future: [] } }
            : im,
        ),
      }

    // Like SET_SETTINGS_COMMIT_MULTI, but each photo gets its own settings ({ id: settings }).
    case 'SET_SETTINGS_PER_IMAGE':
      return {
        ...state,
        images: state.images.map((im) =>
          action.byId[im.id]
            ? { ...im, settings: action.byId[im.id], history: { past: [...im.history.past, im.settings].slice(-HISTORY_CAP), future: [] } }
            : im,
        ),
      }

    case 'COPY_TO_ALL': {
      const targetIds = action.ids && action.ids.length ? action.ids : state.images.map((im) => im.id)
      return {
        ...state,
        images: state.images.map((im) => {
          if (!targetIds.includes(im.id)) return im
          const cloned = JSON.parse(JSON.stringify(action.settings))
          cloned.geometry = im.settings.geometry // crop/rotation is per-photo — never overwritten by copy
          cloned.masks = im.settings.masks // local masks are per-photo too
          cloned.spots = im.settings.spots || [] // and so is spot removal
          return { ...im, settings: cloned, history: { past: [...im.history.past, im.settings].slice(-HISTORY_CAP), future: [] } }
        }),
      }
    }

    case 'UNDO':
      return {
        ...state,
        images: state.images.map((im) => {
          if (im.id !== action.id || im.history.past.length === 0) return im
          const past = [...im.history.past]
          const prev = past.pop()
          const future = [im.settings, ...im.history.future].slice(0, HISTORY_CAP)
          return { ...im, settings: prev, history: { past, future } }
        }),
      }

    case 'REDO':
      return {
        ...state,
        images: state.images.map((im) => {
          if (im.id !== action.id || im.history.future.length === 0) return im
          const future = [...im.history.future]
          const next = future.shift()
          const past = [...im.history.past, im.settings].slice(-HISTORY_CAP)
          return { ...im, settings: next, history: { past, future } }
        }),
      }

    case 'ADD_LUT':
      return { ...state, luts: { ...state.luts, [action.name]: { size: action.size, data: action.data } } }

    case 'ADD_CUSTOM_PRESET':
      return { ...state, customPresets: { ...state.customPresets, [action.name]: action.settings } }

    case 'DELETE_CUSTOM_PRESET': {
      const next = { ...state.customPresets }
      delete next[action.name]
      return { ...state, customPresets: next }
    }

    case 'LOAD_CUSTOM_PRESETS':
      return {
        ...state,
        customPresets: {
          ...state.customPresets,
          ...Object.fromEntries(Object.entries(action.presets).map(([k, v]) => [k, migrateSettings(v)])),
        },
      }

    case 'SET_CURRENT_BAND':
      return { ...state, currentBand: action.band }

    // Restored-from-recovery sessions are still unsaved work.
    case 'MARK_DIRTY':
      return state.isDirty ? state : { ...state, isDirty: true }

    case 'LOAD_PROJECT':
      return {
        ...state,
        images: action.images.map((im) => ({ ...im, settings: migrateSettings(im.settings) })),
        activeId: action.images[0]?.id ?? null,
        selectedIds: [],
        currentProjectId: action.projectId,
        currentProjectName: action.projectName,
        albums: Array.isArray(action.albums) ? action.albums : [],
        activeAlbumId: null,
        viewMode: 'filmstrip',
        isDirty: false,
      }

    case 'SET_CURRENT_PROJECT':
      return { ...state, currentProjectId: action.id, currentProjectName: action.name, isDirty: false }

    case 'NEW_PROJECT':
      return { ...state, images: [], activeId: null, selectedIds: [], albums: [], activeAlbumId: null, currentProjectId: null, currentProjectName: null, viewMode: 'filmstrip', isDirty: false }

    default:
      return state
  }
}

function reducer(state, action) {
  const next = rawReducer(state, action)
  if (next === state) return state
  if (NON_DIRTY_ACTIONS.has(action.type)) return next
  return next.isDirty ? next : { ...next, isDirty: true }
}

export function ProjectProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const pendingRef = useRef(new Map())

  function liveUpdate(id, patch) {
    dispatch({ type: 'LIVE_UPDATE', id, patch })
  }
  function beginEdit(id) {
    if (pendingRef.current.has(id)) return
    const im = state.images.find((i) => i.id === id)
    if (im) pendingRef.current.set(id, JSON.parse(JSON.stringify(im.settings)))
  }
  function commitEdit(id) {
    const before = pendingRef.current.get(id)
    pendingRef.current.delete(id)
    if (before) dispatch({ type: 'COMMIT', id, before })
  }
  // For discrete, single-shot changes (a click, not a drag): snapshot + apply + commit in one go.
  function commitPatch(id, patch) {
    beginEdit(id)
    liveUpdate(id, patch)
    commitEdit(id)
  }
  // Applies to the whole current selection if one exists, else just to `id` — so preset/reset
  // actions naturally respect a multi-photo selection in the filmstrip without callers changing.
  function commitSettings(id, settings) {
    const ids = state.selectedIds.length > 0 ? state.selectedIds : [id]
    dispatch({ type: 'SET_SETTINGS_COMMIT_MULTI', ids, settings })
  }
  function undo(id) {
    dispatch({ type: 'UNDO', id })
  }
  function redo(id) {
    dispatch({ type: 'REDO', id })
  }

  const value = { state, dispatch, liveUpdate, beginEdit, commitEdit, commitPatch, commitSettings, undo, redo }
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider')
  return ctx
}
