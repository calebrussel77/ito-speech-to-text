/**
 * Transcription failures for which keeping the audio makes no sense: there is
 * nothing to recover from silence or a sub-100ms clip.
 *
 * Kept in a constants module rather than next to `LocalTranscriptionError`
 * because both the retry queue and the session manager need it, and both mock
 * the transcription service in their tests.
 */
export const UNRECOVERABLE_CODES = new Set(['NO_SPEECH', 'AUDIO_TOO_SHORT'])

/**
 * Engine routing for transcription. In 'auto' mode, recordings at or above
 * the threshold go to the OpenRouter engine (precision-first, paid) and
 * shorter ones stay on Groq (instant, free). Whisper's long-form
 * hallucinations start around the one-minute mark on real dictations.
 */
export type TranscriptionEngineMode = 'auto' | 'groq' | 'openrouter'

export const LONG_DICTATION_THRESHOLD_MS = 60_000

// Model ids proven in the blind bake-off (.wayfinder/assets/015-bakeoff).
// Stored as plain strings in settings so switching never requires a rebuild.
export const OPENROUTER_TRANSCRIPTION_MODELS = [
  'openai/gpt-transcribe',
  'mistralai/voxtral-mini-transcribe',
] as const

export const DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL =
  OPENROUTER_TRANSCRIPTION_MODELS[0]
