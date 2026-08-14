export interface Interaction {
  id: string
  user_id: string | null
  title: string | null
  asr_output: any
  llm_output: any
  raw_audio: Buffer | null
  raw_audio_id?: string | null
  duration_ms: number | null
  sample_rate?: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Note {
  id: string
  user_id: string
  interaction_id: string | null
  content: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DictionaryItem {
  id: string
  user_id: string
  word: string
  pronunciation: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export enum PaidStatus {
  FREE = 'FREE',
  PRO_TRIAL = 'PRO_TRIAL',
  PRO = 'PRO',
}

export interface UserMetadata {
  id: string
  user_id: string
  paid_status: PaidStatus
  free_words_remaining: number | null
  pro_trial_start_date: Date | null
  pro_trial_end_date: Date | null
  pro_subscription_start_date: Date | null
  pro_subscription_end_date: Date | null
  created_at: Date
  updated_at: Date
}

export type ModeLanguageValue = 'fr' | 'en' | 'es' | 'auto'
export type AudioSourceValue = 'microphone' | 'system' | 'both'
export type PlaybackWhenRecordingValue = 'mute' | 'leave'

/**
 * Un mode tel qu'il sort de SQLite : booléens en 0/1, noms en `snake_case`.
 * Le repository le convertit en `Mode` avant de le rendre.
 */
export interface ModeRow {
  id: string
  user_id: string
  name: string
  preset: string
  icon: string
  instructions: string
  language: ModeLanguageValue
  voice_model_key: string | null
  text_model_key: string | null
  use_llm: number
  context_application: number
  context_clipboard: number
  context_selection: number
  audio_source: AudioSourceValue
  playback_when_recording: PlaybackWhenRecordingValue
  auto_paste: number
  autocapitalize: number
  identify_speakers: number
  asr_prompt: string
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Un mode tel que le reste de l'application le manipule. */
export interface Mode {
  id: string
  userId: string
  name: string
  preset: string
  icon: string
  instructions: string
  language: ModeLanguageValue
  voiceModelKey: string | null
  textModelKey: string | null
  useLlm: boolean
  contextApplication: boolean
  contextClipboard: boolean
  contextSelection: boolean
  audioSource: AudioSourceValue
  playbackWhenRecording: PlaybackWhenRecordingValue
  autoPaste: boolean
  autocapitalize: boolean
  identifySpeakers: boolean
  asrPrompt: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ModeExample {
  id: string
  modeId: string
  spokenInput: string
  aiOutput: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}
