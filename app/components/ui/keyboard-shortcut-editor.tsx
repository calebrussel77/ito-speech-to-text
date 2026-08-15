import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { Button } from '@/app/components/ui/button'
import KeyboardKey from '@/app/components/ui/keyboard-key'
import { Kbd } from '@/app/components/ui/kbd'
import {
  KeyState,
  formatChord,
  formatChordDetailed,
  isReservedCombination,
} from '@/app/utils/keyboard'
import { keyNameMap } from '@/lib/types/keyboard'
import { useAudioStore } from '@/app/store/useAudioStore'
import { KeyboardShortcutConfig } from './multi-shortcut-editor'
import { KeyName } from '@/lib/types/keyboard'
import { usePlatform } from '@/app/hooks/usePlatform'
import { useShortcutEditingStore } from '@/app/store/useShortcutEditingStore'

interface KeyboardShortcutEditorProps {
  shortcut: KeyboardShortcutConfig
  onShortcutChange: (shortcutId: string, newShortcutKeys: KeyName[]) => void
  hideTitle?: boolean
  className?: string
  keySize?: number
  /**
   * `tiles` : les grosses touches SVG des écrans d'accueil, où le raccourci
   * est la vedette. `kbd` : la pastille d'accord unique (« Ctrl + ⊞ ») que
   * tout le reste de l'app utilise — c'est la forme des pages de réglages,
   * où trois étages de texte par touche ne font que de l'encombrement.
   */
  variant?: 'tiles' | 'kbd'
  editButtonText?: string
  confirmButtonText?: string
  showConfirmButton?: boolean
  onConfirm?: () => void
  editModeTitle?: string
  viewModeTitle?: string
  minHeight?: number
  editButtonClassName?: string
  confirmButtonClassName?: string
}

const MAX_KEYS_PER_SHORTCUT = 5

export default function KeyboardShortcutEditor({
  shortcut,
  onShortcutChange,
  hideTitle = false,
  className = '',
  keySize = 60,
  variant = 'tiles',
  editButtonText = 'Change Shortcut',
  confirmButtonText = 'Yes',
  showConfirmButton = false,
  onConfirm,
  editModeTitle = 'Press a key to add it to the shortcut, press it again to remove it',
  viewModeTitle,
  minHeight = 84,
  editButtonClassName = '',
  confirmButtonClassName = '',
}: KeyboardShortcutEditorProps) {
  const shortcutKeys = shortcut.keys
  const platform = usePlatform()
  const editorKey = useMemo(
    () => `keyboard-shortcut-editor:${shortcut.id}`,
    [shortcut.id],
  )
  const { start, stop, activeEditor } = useShortcutEditingStore()

  const cleanupRef = useRef<(() => void) | null>(null)
  const keyStateRef = useRef<KeyState>(new KeyState())
  const [pressedKeys, setPressedKeys] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [newShortcut, setNewShortcut] = useState<KeyName[]>([])
  const [validationError, setValidationError] = useState<string>('')
  const [temporaryError, setTemporaryError] = useState<string>('')
  const { setIsShortcutEnabled } = useAudioStore()
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleKeyEvent = useCallback(
    (event: any) => {
      // Update the key state
      keyStateRef.current.update(event)

      // Get the current pressed keys and update state
      const currentPressedKeys = keyStateRef.current.getPressedKeys()
      setPressedKeys(currentPressedKeys)

      if (isEditing) {
        // In edit mode, handle adding/removing keys
        if (event.type === 'keydown') {
          const normalizedKey = keyNameMap[event.key] || event.key.toLowerCase()
          if (normalizedKey === 'fn_fast') {
            return
          }

          let updatedShortcut: KeyName[]
          if (!newShortcut.includes(normalizedKey)) {
            // Check if we're at the limit before adding
            if (newShortcut.length >= MAX_KEYS_PER_SHORTCUT) {
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

              return
            }
            updatedShortcut = [...newShortcut, normalizedKey]
          } else {
            updatedShortcut = newShortcut.filter(key => key !== normalizedKey)
          }

          // Check for reserved combinations
          const reservedCheck = isReservedCombination(updatedShortcut, platform)
          if (reservedCheck.isReserved) {
            setValidationError(
              reservedCheck.reason || 'This key combination is reserved',
            )
          } else {
            setValidationError('')
          }

          setNewShortcut(updatedShortcut)
        }
      }
    },
    [isEditing, newShortcut, platform],
  )

  useEffect(() => {
    // Capture the current keyState ref value for cleanup
    const currentKeyState = keyStateRef.current

    // Listen for key events and store cleanup function
    try {
      const cleanup = window.api.onKeyEvent(handleKeyEvent)
      cleanupRef.current = cleanup
    } catch (error) {
      console.error('Failed to set up key event handler:', error)
    }

    // Clean up when component unmounts or editing changes
    return () => {
      if (cleanupRef.current) {
        try {
          cleanupRef.current()
        } catch (error) {
          console.error('Error during cleanup:', error)
        }
      }
      // Clear the key state when unmounting using captured ref value
      if (currentKeyState) {
        currentKeyState.clear()
      }
    }
  }, [handleKeyEvent, isEditing])

  useEffect(() => {
    return () => {
      if (isEditing) {
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
  }, [isEditing, stop, editorKey])

  const handleStartEditing = () => {
    if (!start(editorKey)) {
      return
    }
    // Disable the shortcut in the main process via IPC
    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      false,
    )
    setIsShortcutEnabled(false)
    setIsEditing(true)
    setNewShortcut([])
    setValidationError('')
    setTemporaryError('')
  }

  const handleCancel = () => {
    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      true,
    )
    setIsShortcutEnabled(true)
    setIsEditing(false)
    setNewShortcut([])
    setTemporaryError('')
    stop(editorKey)
  }

  const handleSave = () => {
    if (newShortcut.length === 0) {
      // Don't save empty shortcuts
      return
    }
    onShortcutChange(shortcut.id, newShortcut)
    setIsEditing(false)
    setIsShortcutEnabled(true)
    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      true,
    )
    stop(editorKey)
  }

  function isDisplayKeyPressed(displayKey: string, pressed: string[]): boolean {
    return pressed.includes(displayKey.toLowerCase())
  }

  if (variant === 'kbd') {
    return (
      <div className={className}>
        {isEditing ? (
          <div className="flex flex-col items-end gap-1.5">
            {/* Un champ de saisie, pas une vitrine : l'accord se construit
                sous les yeux dans la même pastille que celle qui l'affichera
                ensuite — ce qu'on voit pendant l'édition EST le résultat. */}
            <div className="flex h-8 min-w-[190px] items-center justify-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] px-3">
              {newShortcut.length ? (
                <Kbd
                  className="h-5 px-1.5 text-[11px] text-foreground"
                  title={formatChordDetailed(newShortcut, platform)}
                >
                  {formatChord(newShortcut, platform)}
                </Kbd>
              ) : (
                <span className="text-[11px] text-[var(--subtle-foreground)]">
                  Press the keys — press one again to remove it
                </span>
              )}
            </div>
            {(validationError || temporaryError) && (
              <div className="text-right text-[10px] text-destructive">
                {temporaryError || validationError}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={handleSave}
                disabled={newShortcut.length === 0 || !!validationError}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2.5">
            {shortcutKeys.length ? (
              <Kbd
                className="h-6 px-2 text-[11px] text-foreground"
                title={formatChordDetailed(shortcutKeys, platform)}
              >
                {formatChord(shortcutKeys, platform)}
              </Kbd>
            ) : (
              <span className="text-[11px] text-[var(--subtle-foreground)]">
                No shortcut set
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleStartEditing}
              className={editButtonClassName}
              disabled={activeEditor !== null && activeEditor !== editorKey}
            >
              {editButtonText}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-lg ${className}`}>
      {isEditing ? (
        <>
          {!hideTitle && (
            <div className="text-sm font-medium mb-3 text-center text-foreground">
              {editModeTitle}
            </div>
          )}
          <div
            className="flex justify-center items-center mb-3 w-full bg-[var(--surface-2)] border border-border py-2.5 rounded-lg gap-1.5"
            style={{ minHeight }}
          >
            {newShortcut.map((keyboardKey, index) => (
              <KeyboardKey
                key={index}
                keyboardKey={keyboardKey}
                className="border border-[var(--border-strong)] bg-[var(--surface-3)] text-foreground"
                style={{
                  width: `${keySize}px`,
                  height: `${keySize}px`,
                }}
              />
            ))}
            {newShortcut.length === 0 && (
              <div className="text-[var(--subtle-foreground)] text-xs">
                Press keys to add them (max {MAX_KEYS_PER_SHORTCUT} keys)
              </div>
            )}
          </div>
          {(validationError || temporaryError) && (
            <div className="text-destructive text-xs text-center mb-2">
              {temporaryError || validationError}
            </div>
          )}
          <div className="flex gap-2 justify-end w-full mt-1">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              type="button"
              onClick={handleSave}
              disabled={newShortcut.length === 0 || !!validationError}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          {viewModeTitle && !hideTitle && (
            <div className="text-sm font-medium mb-3 text-center text-foreground">
              {viewModeTitle}
            </div>
          )}
          <div
            className="flex justify-center items-center mb-3 w-full bg-[var(--surface-2)] border border-border py-2.5 rounded-lg gap-1.5"
            style={{ minHeight }}
          >
            {shortcutKeys.map((keyboardKey, index) => (
              <KeyboardKey
                key={index}
                keyboardKey={keyboardKey}
                className={
                  isDisplayKeyPressed(String(keyboardKey), pressedKeys)
                    ? 'border border-[var(--foreground)] bg-[var(--surface-3)] text-foreground'
                    : 'border border-border bg-[var(--surface-3)] text-[var(--muted-foreground)]'
                }
                style={{
                  width: `${keySize}px`,
                  height: `${keySize}px`,
                }}
              />
            ))}
            {shortcutKeys.length === 0 && (
              <div className="text-[var(--subtle-foreground)] text-xs">
                No shortcut set
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 w-full mt-1">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleStartEditing}
              className={editButtonClassName}
              disabled={activeEditor !== null && activeEditor !== editorKey}
            >
              {editButtonText}
            </Button>
            {showConfirmButton && onConfirm && (
              <Button
                size="sm"
                type="button"
                onClick={onConfirm}
                className={confirmButtonClassName}
                disabled={activeEditor !== null && activeEditor !== editorKey}
              >
                {confirmButtonText}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
