export const APP_VERSION = __APP_VERSION__
export const BUILD_DATE = __BUILD_DATE__

export function ReleaseNotes({ entries }) {
  return entries.map((e) => (
    <section key={e.version} className="release">
      <h4 className="release-head">
        <span className="release-version">v{e.version}</span> {e.title}
        <span className="release-date">{e.date}</span>
      </h4>
      <ul>
        {e.items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </section>
  ))
}
