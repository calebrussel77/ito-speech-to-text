import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import KeyboardKey from '@/app/components/ui/keyboard-key'
import { ShortcutError } from '@/app/utils/keyboard'
import { keyNameMap } from '@/lib/types/keyboard'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { Check, Pencil } from '@mynaui/icons-react'
import { cx } from 'class-variance-authority'
import { KeyName } from '@/lib/types/keyboard'
import { useShortcutEditingStore } from '@/app/store/useShortcutEditingStore'

export interface KeyboardShortcutConfig {
  id: string
  keys: KeyName[]
  /** Id d'une ligne de la table `modes`. */
  modeId: string
}

type Props = {
  shortcuts: KeyboardShortcutConfig[] // persisted rows
  modeId: string
  className?: string
  keySize?: number
  maxShortcutsPerMode?: number
  /** Mirrors the current inline error so a host screen can surface it too. */
  onError?: (message: string) => void
}

const MAX_KEYS_PER_SHORTCUT = 5

export default function MultiShortcutEditor({
  shortcuts,
  modeId,
  className = '',
  maxShortcutsPerMode = 5,
  onError,
}: Props) {
  const {
    createKeyboardShortcut,
    removeKeyboardShortcut,
    updateKeyboardShortcut,
  } = useSettingsStore()

  // global editing lock
  const editorKey = useMemo(() => `multi-shortcut-editor:${modeId}`, [modeId])
  const { start, stop, activeEditor } = useShortcutEditingStore()

  const rows = useMemo(
    () =>
      modeId == null ? shortcuts : shortcuts.filter(s => s.modeId === modeId),
    [shortcuts, modeId],
  )
  const isAtLimit = rows.length >= maxShortcutsPerMode
  // A mode's shortcut is entirely optional (that's the point of this editor),
  // so the last remaining row must stay deletable — otherwise a mode could be
  // given a shortcut but never cleared of it again.

  // editing state
  const [editingId, setEditingId] = useState<string | null>(null) // existing row id or "__new__"
  const [draftKeys, setDraftKeys] = useState<KeyName[]>([])
  const [error, setError] = useState<string>('')
  const [temporaryError, setTemporaryError] = useState<string>('')

  const cleanupRef = useRef<(() => void) | null>(null)
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // A rejected shortcut (duplicate or reserved) must not fail silently: the
  // persistent `error` is mirrored to the host screen, which can render it
  // as a SettingsNote — the inline text here alone is easy to miss below
  // the fold of a 620px window.
  useEffect(() => {
    onError?.(error)
  }, [error, onError])

  const beginEditExisting = (row: KeyboardShortcutConfig) => {
    if (!start(editorKey)) {
      setError('Finish editing the other shortcut set first.')
      return
    }
    setEditingId(row.id)
    setDraftKeys([])
    setError('')
    setTemporaryError('')

    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      false,
    )
  }

  const getErrorMessage = (error: ShortcutError, message?: string) => {
    switch (error) {
      case 'duplicate-key-same-mode':
        return 'This key combination is already in use for this mode.'
      case 'duplicate-key-diff-mode':
        return 'This key combination is already in use for a different mode.'
      case 'not-found':
        return 'The specified shortcut was not found.'
      case 'reserved-combination':
        return message || 'This key combination is reserved and cannot be used.'
      default:
        return 'An unknown error occurred.'
    }
  }

  const addNew = () => {
    const result = createKeyboardShortcut(modeId)
    if (!result.success && result.error) {
      setError(getErrorMessage(result.error, result.errorMessage))
      return
    }
  }

  const stopEdit = () => {
    setEditingId(null)
    setDraftKeys([])
    setError('')
    setTemporaryError('')

    // Clear any pending error timeout
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = null
    }

    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      true,
    )
    stop(editorKey)
  }

  const saveEdit = async (original: KeyboardShortcutConfig) => {
    if (!draftKeys.length) return

    // update existing
    const result = await updateKeyboardShortcut(original.id, draftKeys)
    if (!result.success && result.error) {
      setError(getErrorMessage(result.error, result.errorMessage))
      return
    }

    stopEdit()
  }

  // capture keys (no normalization/cleanup here by request)
  const handleKeyEvent = useCallback(
    (event: any) => {
      if (!editingId || event.type !== 'keydown') return
      const key = keyNameMap[event.key] || event.key.toLowerCase()
      if (key === 'fn_fast') return

      setDraftKeys(prev => {
        // If key exists, remove it
        if (prev.includes(key)) {
          return prev.filter(k => k !== key)
        }

        // If at max keys, show temporary error and don't add
        if (prev.length >= MAX_KEYS_PER_SHORTCUT) {
          // Clear any existing timeout
          if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current)
          }

          // Show temporary error
          setTemporaryError(`Maximum ${MAX_KEYS_PER_SHORTCUT} keys allowed`)

          // Clear temporary error after 2 seconds
          errorTimeoutRef.current = setTimeout(() => {
            setTemporaryError('')
            errorTimeoutRef.current = null
          }, 2000)

          return prev
        }

        // Add the new key and clear any errors
        setError('')
        setTemporaryError('')
        return [...prev, key]
      })
    },
    [editingId],
  )

  useEffect(() => {
    if (!editingId) return

    cleanupRef.current = window.api.onKeyEvent(handleKeyEvent)

    return () => {
      cleanupRef.current?.()
    }
  }, [handleKeyEvent, editingId])

  // Ensure lock is released and global shortcuts re-enabled on unmount
  useEffect(() => {
    return () => {
      if (editingId) {
        window.api.send(
          'electron-store-set',
          'settings.isShortcutGloballyEnabled',
          true,
        )
        stop(editorKey)
      }
      // Clean up any pending error timeout
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
    }
  }, [editingId, stop, editorKey])

  const base =
    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ' +
    'text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-3)] hover:text-foreground'

  const isLockedByOther = activeEditor !== null && activeEditor !== editorKey

  return (
    <div className={cx('w-[220px]', className)}>
      {rows.map(row => {
        const isEditing = editingId === row.id
        const displayKeys = isEditing ? draftKeys : row.keys

        return (
          <div
            key={row.id}
            className="mb-1.5 rounded-lg border border-border bg-[var(--surface-2)] py-1 pl-1.5 pr-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center justify-between gap-1">
                {displayKeys.length ? (
                  <>
                    {displayKeys.map((k, idx) => (
                      <KeyboardKey key={idx} keyboardKey={k} variant="inline" />
                    ))}
                    {isEditing &&
                      displayKeys.length < MAX_KEYS_PER_SHORTCUT && (
                        <span className="ml-1.5 text-[10px] text-[var(--subtle-foreground)]">
                          ({MAX_KEYS_PER_SHORTCUT - displayKeys.length} more
                          allowed)
                        </span>
                      )}
                  </>
                ) : (
                  <span className="text-[11px] text-[var(--subtle-foreground)]">
                    {isEditing
                      ? `Press keys to add (max ${MAX_KEYS_PER_SHORTCUT})`
                      : `No keys set`}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {editingId === row.id ? (
                  <button
                    type="button"
                    onClick={() => saveEdit(row)}
                    className={base}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => beginEditExisting(row)}
                    className={
                      base + ' disabled:opacity-50 disabled:cursor-not-allowed'
                    }
                    disabled={isLockedByOther}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {editingId === row.id && (error || temporaryError) && (
              <div className="mt-1 px-1 text-[10px] text-destructive">
                {temporaryError || error}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            const lastRow = rows.at(-1)
            if (!lastRow) return
            // Deleting the row being edited would otherwise leave the
            // shortcut-editing lock held and global shortcuts disabled,
            // since stopEdit() would never run for it.
            if (editingId === lastRow.id) stopEdit()
            removeKeyboardShortcut(lastRow.id)
          }}
          hidden={rows.length === 0}
          className="ml-auto text-[11px] text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLockedByOther}
        >
          Delete
        </button>
      </div>

      {/* Add new */}
      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (isLockedByOther) return
            addNew()
          }}
          hidden={isAtLimit}
          className="rounded-full border border-border bg-[var(--surface-2)] px-3 py-1 text-[11px] text-foreground transition-colors hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLockedByOther}
        >
          Add another
        </button>
      </div>
    </div>
  )
}
