import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ProjectProvider } from './store/ProjectContext.jsx'
import { FeedbackProvider } from './store/FeedbackContext.jsx'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FeedbackProvider>
      <ProjectProvider>
        <App />
      </ProjectProvider>
    </FeedbackProvider>
  </React.StrictMode>,
)

// Offline support (production builds only — a service worker would cache dev files too).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable:', err))
  })
}
