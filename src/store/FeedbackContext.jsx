import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'

// App-wide user feedback: toast notifications (with optional Undo action) and themed
// confirm/prompt dialogs that replace the browser's native alert/confirm/prompt.
const FeedbackContext = createContext(null)

let toastSeq = 1
const DEFAULT_DURATION = 3200
const ACTION_DURATION = 6000

function Toast({ toast, onDismiss }) {
  // Stable per-toast close so the auto-dismiss timer isn't restarted by provider re-renders.
  const onClose = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id])
  useEffect(() => {
    const t = setTimeout(onClose, toast.duration)
    return () => clearTimeout(t)
  }, [toast.duration, onClose])

  return (
    <div className={'toast toast-' + toast.type} role={toast.type === 'error' ? 'alert' : 'status'}>
      <Icon name={toast.type === 'error' ? 'alert' : toast.type === 'info' ? 'info' : 'check'} size={15} className="toast-icon" />
      <span className="toast-msg">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action.onClick()
            onClose()
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss notification">
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

function Dialog({ dialog, onResolve }) {
  const [value, setValue] = useState(dialog.defaultValue || '')
  const inputRef = useRef(null)
  const confirmRef = useRef(null)
  const isPrompt = dialog.kind === 'prompt'

  useEffect(() => {
    if (isPrompt) inputRef.current?.select()
    else confirmRef.current?.focus()
  }, [isPrompt])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onResolve(isPrompt ? null : false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isPrompt, onResolve])

  function submit(e) {
    e?.preventDefault()
    if (isPrompt) {
      const trimmed = value.trim()
      if (!trimmed) return
      onResolve(trimmed)
    } else {
      onResolve(true)
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onResolve(isPrompt ? null : false)}>
      <form className="modal-panel dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={submit}>
        <div className="modal-body">
          <h3 id="dialog-title" className="dialog-title">{dialog.title}</h3>
          {dialog.message && <p className="dialog-message">{dialog.message}</p>}
          {isPrompt && (
            <input
              ref={inputRef}
              className="text-input"
              value={value}
              maxLength={80}
              placeholder={dialog.placeholder}
              aria-label={dialog.title}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="action secondary" onClick={() => onResolve(isPrompt ? null : false)}>
            {dialog.cancelLabel || 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="submit"
            className={'action ' + (dialog.danger ? 'danger' : 'primary')}
            disabled={isPrompt && !value.trim()}
          >
            {dialog.confirmLabel || 'OK'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const toast = useCallback((message, opts = {}) => {
    const id = toastSeq++
    const entry = {
      id,
      message,
      type: opts.type || 'success',
      action: opts.action || null,
      duration: opts.duration || (opts.action ? ACTION_DURATION : DEFAULT_DURATION),
    }
    setToasts((list) => [...list.slice(-3), entry]) // keep at most 4 on screen
    return id
  }, [])

  const openDialog = useCallback(
    (kind, opts) =>
      new Promise((resolve) => {
        setDialog({ ...opts, kind, resolve })
      }),
    [],
  )

  const confirmDialog = useCallback((opts) => openDialog('confirm', opts), [openDialog])
  const promptDialog = useCallback((opts) => openDialog('prompt', opts), [openDialog])

  const value = useMemo(() => ({ toast, confirm: confirmDialog, prompt: promptDialog }), [toast, confirmDialog, promptDialog])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
      {dialog && (
        <Dialog
          dialog={dialog}
          onResolve={(result) => {
            dialog.resolve(result)
            setDialog(null)
          }}
        />
      )}
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider')
  return ctx
}
