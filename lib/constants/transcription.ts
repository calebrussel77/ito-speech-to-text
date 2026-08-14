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
 * Engine routing for transcription. When the long-dictation engine is on,
 * recordings at or above the threshold go to OpenRouter (precision-first,
 * paid) and shorter ones stay on Groq (instant, cheap). Whisper's long-form
 * hallucinations start around the one-minute mark on real dictations, which is
 * where the default threshold comes from.
 */
export const LONG_DICTATION_THRESHOLD_MS = 60_000

/**
 * The only thresholds we let users pick. A free-form field would turn a
 * measured value into an arbitrary slider; three coarse steps keep the choice
 * meaningful (a shorter one is for people who dictate paragraphs, a longer one
 * for people who dictate sentences).
 */
export const LONG_DICTATION_THRESHOLD_OPTIONS = [30_000, 60_000, 120_000]
