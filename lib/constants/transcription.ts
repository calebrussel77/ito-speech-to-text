/**
 * Transcription failures for which keeping the audio makes no sense: there is
 * nothing to recover from silence or a sub-100ms clip.
 *
 * Kept in a constants module rather than next to `LocalTranscriptionError`
 * because both the retry queue and the session manager need it, and both mock
 * the transcription service in their tests.
 */
export const UNRECOVERABLE_CODES = new Set(['NO_SPEECH', 'AUDIO_TOO_SHORT'])
