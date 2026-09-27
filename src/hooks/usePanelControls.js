import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { isPanelEdited, panelResetPatch } from '../engine/panels'
import { deleteBrushCanvas } from '../engine/brushMaskStore'

/** Edited / bypassed state and actions for one sidebar panel of the active photo. */
export function usePanelControls(panelId, title) {
  const { state, dispatch, commitPatch, undo } = useProject()
  const { toast } = useFeedback()
  const active = state.images.find((im) => im.id === state.activeId)

  if (!active || !panelId) return { edited: false, bypassed: false, reset: () => {}, toggleBypass: () => {} }

  const edited = isPanelEdited(active.settings, panelId)
  const bypassed = !!active.bypass?.[panelId]

  function reset() {
    const id = active.id
    const removedBrushIds = panelId === 'masks' ? (active.settings.masks || []).filter((m) => m.type === 'brush').map((m) => m.id) : []
    commitPatch(id, panelResetPatch(panelId))
    if (bypassed) dispatch({ type: 'TOGGLE_PANEL_BYPASS', id, panel: panelId })
    if (panelId === 'masks') dispatch({ type: 'SET_SELECTED_MASK', id: null })
    // Brush pixel data can't come back via undo, so only free it when the toast expires unused.
    let undone = false
    toast(`${title} reset`, {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          undo(id)
        },
      },
    })
    if (removedBrushIds.length) {
      setTimeout(() => {
        if (!undone) removedBrushIds.forEach(deleteBrushCanvas)
      }, 7000)
    }
  }

  function toggleBypass() {
    dispatch({ type: 'TOGGLE_PANEL_BYPASS', id: active.id, panel: panelId })
  }

  return { edited, bypassed, reset, toggleBypass }
}
