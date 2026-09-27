// Public links shown in the app. Leave kofiUsername empty ('') to hide the Support buttons.
export const LINKS = {
  kofiUsername: 'raxsoller', // ko-fi.com/<kofiUsername>
}

export const kofiUrl = () => (LINKS.kofiUsername ? `https://ko-fi.com/${encodeURIComponent(LINKS.kofiUsername)}` : '')
