import { getPillWindow, mainWindow } from './app'
import {
  IPC_EVENTS,
  RecordingStatePayload,
  ProcessingStatePayload,
  PendingDictationsPayload,
  ActiveModePayload,
} from '../types/ipc'

/**
 * Helper class to notify UI windows about recording state changes.
 */
export class RecordingStateNotifier {
  public notifyRecordingStarted(mode: {
    id: string
    name: string
    icon: string
    color?: string | null
  }) {
    console.log('[RecordingStateNotifier] Notifying recording started:', {
      mode: mode.name,
    })
    this.sendToWindows(IPC_EVENTS.RECORDING_STATE_UPDATE, {
      isRecording: true,
      modeId: mode.id,
      modeName: mode.name,
      modeIcon: mode.icon,
      modeColor: mode.color ?? null,
    })
  }

  public notifyActiveModeChanged(
    mode: {
      id: string
      name: string
      icon: string
      color?: string | null
    },
    options?: { reveal?: boolean },
  ) {
    console.log(`[RecordingStateNotifier] Active mode: ${mode.name}`)
    this.sendToWindows(IPC_EVENTS.ACTIVE_MODE_UPDATE, {
      modeId: mode.id,
      modeName: mode.name,
      modeIcon: mode.icon,
      modeColor: mode.color ?? null,
      reveal: options?.reveal ?? false,
    })
  }

  public notifyRecordingStopped() {
    console.log('[RecordingStateNotifier] Notifying recording stopped')
    this.sendToWindows(IPC_EVENTS.RECORDING_STATE_UPDATE, {
      isRecording: false,
    })
  }

  public notifyProcessingStarted() {
    console.log('[RecordingStateNotifier] Notifying processing started')
    this.sendToWindows(IPC_EVENTS.PROCESSING_STATE_UPDATE, {
      isProcessing: true,
    })
  }

  public notifyProcessingStopped() {
    console.log('[RecordingStateNotifier] Notifying processing stopped')
    this.sendToWindows(IPC_EVENTS.PROCESSING_STATE_UPDATE, {
      isProcessing: false,
    })
  }

  public notifyPendingDictations(count: number) {
    this.sendToWindows(IPC_EVENTS.PENDING_DICTATIONS_UPDATE, { count })
  }

  /**
   * Signals that `keyboardShortcuts` changed in the main-process store
   * outside of a renderer-initiated write (e.g. a mode delete pruning its
   * shortcut). No payload — listeners re-read the store themselves via the
   * synchronous `window.electron.store.get`, so there is nothing to
   * serialize and no risk of the payload drifting from what actually landed
   * on disk.
   */
  public notifyKeyboardShortcutsChanged() {
    console.log('[RecordingStateNotifier] Notifying keyboard shortcuts changed')
    getPillWindow()?.webContents.send(IPC_EVENTS.KEYBOARD_SHORTCUTS_UPDATE)
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(IPC_EVENTS.KEYBOARD_SHORTCUTS_UPDATE)
    }
  }

  private sendToWindows(
    event: string,
    payload:
      | RecordingStatePayload
      | ProcessingStatePayload
      | PendingDictationsPayload
      | ActiveModePayload,
  ) {
    // Send to pill window
    getPillWindow()?.webContents.send(event, payload)

    // Send to main window if it exists and is not destroyed
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(event, payload)
    }
  }
}

export const recordingStateNotifier = new RecordingStateNotifier()
