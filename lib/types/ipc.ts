// IPC Event Constants
export const IPC_EVENTS = {
  RECORDING_STATE_UPDATE: 'recording-state-update',
  PROCESSING_STATE_UPDATE: 'processing-state-update',
  VOLUME_UPDATE: 'volume-update',
  FORCE_DEVICE_LIST_RELOAD: 'force-device-list-reload',
  SETTINGS_UPDATE: 'settings-update',
  INTERACTION_SOUND_PLAY: 'interaction-sound-play',
  ONBOARDING_UPDATE: 'onboarding-update',
  USER_AUTH_UPDATE: 'user-auth-update',
  PENDING_DICTATIONS_UPDATE: 'pending-dictations-update',
  ACTIVE_MODE_UPDATE: 'active-mode-update',
} as const

// IPC Payload Types
export interface RecordingStatePayload {
  isRecording: boolean
  modeId?: string
  modeName?: string
  modeIcon?: string
}

export interface ActiveModePayload {
  modeId: string
  modeName: string
  modeIcon: string
}

export interface ProcessingStatePayload {
  isProcessing: boolean
  modeId?: string
}

export interface VolumeUpdatePayload {
  volume: number
}

export interface PendingDictationsPayload {
  count: number
}

export interface InteractionSoundPlayPayload {
  audioData: Uint8Array
  mimeType: string
  fileName: string
  theme: 'pop' | 'marimba' | 'custom'
}

// Generic IPC Response Types
export type IpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; errorType?: string }

export type IpcResponse<T> = Promise<IpcResult<T>>
