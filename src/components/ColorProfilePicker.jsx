import { useProject } from '../store/ProjectContext'
import { COLOR_PROFILE_NAMES, canonicalProfile } from '../engine/colorProfiles'
import Accordion from './Accordion.jsx'

export default function ColorProfilePicker() {
  const { state, commitPatch } = useProject()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const current = canonicalProfile(active.settings.colorProfile)

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
            {name}
          </button>
        ))}
      </div>
    </Accordion>
  )
}
