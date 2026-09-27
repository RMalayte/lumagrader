import { useProject } from '../store/ProjectContext'
import { COLOR_PROFILE_NAMES } from '../engine/colorProfiles'
import Accordion from './Accordion.jsx'

export default function ColorProfilePicker() {
  const { state, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const current = active.settings.colorProfile || 'Adobe Color'

  return (
    <Accordion title="Profile" id="profile" panelId="profile">
      <div className="presets" role="radiogroup" aria-label="Color profile">
        {COLOR_PROFILE_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={current === name}
            className={'preset-chip' + (current === name ? ' active' : '')}
            onClick={() => commitPatch(active.id, { colorProfile: name })}
          >
            {name.replace('Adobe ', '')}
          </button>
        ))}
      </div>
    </Accordion>
  )
}
