import { getPillWindow, mainWindow } from './app'
import {
  IPC_EVENTS,
  RecordingStatePayload,
  ProcessingStatePayload,
  PendingDictationsPayload,
} from '../types/ipc'

/**
 * Helper class to notify UI windows about recording state changes.
 */
export class RecordingStateNotifier {
  public notifyRecordingStarted(mode: {
    id: string
    name: string
    icon: string
  }) {
    console.log('[RecordingStateNotifier] Notifying recording started:', {
      mode: mode.name,
    })
    this.sendToWindows(IPC_EVENTS.RECORDING_STATE_UPDATE, {
      isRecording: true,
      modeId: mode.id,
      modeName: mode.name,
      modeIcon: mode.icon,
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

  private sendToWindows(
    event: string,
    payload:
      | RecordingStatePayload
      | ProcessingStatePayload
      | PendingDictationsPayload,
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
