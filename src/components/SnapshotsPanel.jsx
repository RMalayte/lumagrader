import { useProject } from '../store/ProjectContext'
import { useFeedback } from '../store/FeedbackContext'
import { migrateSettings } from '../engine/defaults'
import Accordion from './Accordion.jsx'

const newSnapshotId = () => `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
const clone = (v) => JSON.parse(JSON.stringify(v))

function when(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Lightroom-style snapshots: named versions of this photo's edit (every setting, including
 * crop, masks and spot removal) to come back to or compare. Applying one is undoable.
 */
export default function SnapshotsPanel() {
  const { state, dispatch } = useProject()
  const { prompt, confirm, toast } = useFeedback()
  const active = state.images.find((im) => im.id === state.activeId)
  if (!active) return null
  const snapshots = active.snapshots || []

  async function create() {
    const name = await prompt({
      title: 'New snapshot',
      message: 'Saves this photo\'s current edit so you can come back to it.',
      defaultValue: `Snapshot ${snapshots.length + 1}`,
      confirmLabel: 'Save',
    })
    if (!name) return
    dispatch({ type: 'ADD_SNAPSHOT', id: active.id, snapshot: { id: newSnapshotId(), name: name.slice(0, 60), createdAt: Date.now(), settings: clone(active.settings) } })
    toast(`Snapshot "${name}" saved`)
  }

  function apply(snap) {
    // Replaces the whole edit; the previous one goes on the undo stack.
    dispatch({ type: 'SET_SETTINGS_COMMIT_MULTI', ids: [active.id], settings: migrateSettings(clone(snap.settings)) })
    toast(`Applied "${snap.name}" — Undo brings back the previous edit`)
  }

  async function rename(snap) {
    const name = await prompt({ title: 'Rename snapshot', defaultValue: snap.name, confirmLabel: 'Rename' })
    if (name) dispatch({ type: 'UPDATE_SNAPSHOT', id: active.id, snapshotId: snap.id, patch: { name: name.slice(0, 60) } })
  }

  async function update(snap) {
    const ok = await confirm({ title: `Update "${snap.name}"?`, message: 'Replaces this snapshot with the current edit.', confirmLabel: 'Update' })
    if (ok) dispatch({ type: 'UPDATE_SNAPSHOT', id: active.id, snapshotId: snap.id, patch: { settings: clone(active.settings), createdAt: Date.now() } })
  }

  async function remove(snap) {
    const ok = await confirm({ title: `Delete "${snap.name}"?`, confirmLabel: 'Delete', danger: true })
    if (ok) dispatch({ type: 'DELETE_SNAPSHOT', id: active.id, snapshotId: snap.id })
  }

  return (
    <Accordion title={`Snapshots${snapshots.length ? ` (${snapshots.length})` : ''}`} id="snapshots">
      {snapshots.length === 0 && <p className="panel-hint" style={{ marginTop: 0 }}>Save versions of this photo&apos;s edit (e.g. &quot;Warm&quot; and &quot;B&amp;W&quot;) and switch between them anytime.</p>}
      <ul className="snapshot-list">
        {snapshots.map((snap) => (
          <li key={snap.id} className="snapshot-row">
            <button type="button" className="snapshot-apply" onClick={() => apply(snap)} title="Apply this snapshot">
              <span className="snapshot-name">{snap.name}</span>
              <span className="snapshot-date">{when(snap.createdAt)}</span>
            </button>
            <div className="snapshot-actions">
              <button type="button" className="snap-btn" onClick={() => rename(snap)}>Rename</button>
              <button type="button" className="snap-btn" onClick={() => update(snap)}>Update</button>
              <button type="button" className="snap-btn danger" onClick={() => remove(snap)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="btnrow">
        <button type="button" className="action secondary" onClick={create}>+ Create snapshot</button>
      </div>
    </Accordion>
  )
}
