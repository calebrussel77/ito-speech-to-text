import { InteractionsTable } from '../sqlite/repo'
import mainStore from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import { timingCollector } from '../timing/TimingCollector'
import type { AsrFallback } from '../itoStreamController'

export class InteractionManager {
  private currentInteractionId: string | null = null
  private interactionStartTime: number | null = null

  initialize(): string {
    this.currentInteractionId = uuidv4()
    this.interactionStartTime = Date.now()
    return this.currentInteractionId
  }

  getCurrentInteractionId(): string | null {
    return this.currentInteractionId
  }

  getInteractionStartTime(): number | null {
    return this.interactionStartTime
  }

  adoptInteractionId(id: string) {
    this.currentInteractionId = id
    this.interactionStartTime = Date.now()
  }

  async createInteraction(
    transcript: string,
    audioBuffer: Buffer,
    sampleRate: number,
    errorMessage?: string,
    errorCode?: string,
    audioDurationMs?: number,
    // How the transcript was produced: the engine that answered, and — when
    // the routed engine did not — why it was not the one asked for.
    asr?: { engine?: string; fallback?: AsrFallback },
  ) {
    if (!this.currentInteractionId) {
      log.warn(
        '[InteractionManager] No current interaction ID, skipping interaction creation.',
      )
      return
    }

    try {
      const userProfile = mainStore.get(STORE_KEYS.USER_PROFILE) as any
      const userId = userProfile?.id || 'self-hosted'

      // Wall-clock time of the whole interaction, transcription latency
      // included. Kept for diagnostics only.
      const interactionEndTime = Date.now()
      const interactionDurationMs = this.interactionStartTime
        ? interactionEndTime - this.interactionStartTime
        : 0

      // The `duration_ms` column feeds the dashboard's words-per-minute stat,
      // so it must be the time actually spent SPEAKING. Wall-clock would
      // include the transcription round-trip and halve the reported speed.
      const durationMs = audioDurationMs ?? interactionDurationMs

      // Create ASR output object with comprehensive information
      const asrOutput = {
        transcript,
        totalAudioBytes: audioBuffer.length,
        error: errorMessage || null,
        errorCode: errorCode || null,
        timestamp: new Date().toISOString(),
        durationMs,
        interactionDurationMs,
        engine: asr?.engine || null,
        fallback: asr?.fallback || null,
      }

      // Generate a meaningful title from the transcript
      const title =
        transcript && transcript.length > 50
          ? transcript.substring(0, 50) + '...'
          : transcript || 'Voice interaction'

      // Create interaction using upsert to specify our own ID
      const now = new Date().toISOString()
      const interactionData = {
        id: this.currentInteractionId,
        user_id: userId,
        title,
        asr_output: asrOutput,
        llm_output: errorMessage ? { error: errorMessage } : {},
        raw_audio: null, // Do not persist audio in local-only mode
        raw_audio_id: null,
        duration_ms: durationMs,
        sample_rate: sampleRate,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }

      await InteractionsTable.upsert(interactionData)

      // Notify all windows about the new interaction
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('interaction-created', {
          id: this.currentInteractionId,
          transcript,
          timestamp: now,
          durationMs,
        })
      })
    } catch (error) {
      log.error('[InteractionManager] Failed to create interaction:', error)
      console.error('[InteractionManager] interaction data that failed:', {
        id: this.currentInteractionId,
        hasTranscript: !!transcript,
      })
      // Clear timing on error
      if (this.currentInteractionId) {
        timingCollector.clearInteraction(this.currentInteractionId)
      }
    }
  }

  clearCurrentInteraction() {
    this.currentInteractionId = null
    this.interactionStartTime = null
  }

  /**
   * Records a dictation whose transcription failed. The audio is still on
   * disk, so the row is marked `pending` and the history shows it as waiting
   * for the network instead of silently dropping the dictation.
   *
   * `pendingPath` links the row to its WAV so the later recovery can update
   * this same row rather than adding a duplicate.
   */
  async createFailedInteraction(params: {
    errorMessage: string
    errorCode?: string
    sampleRate: number
    audioDurationMs?: number
    pendingPath?: string | null
  }) {
    if (!this.currentInteractionId) {
      log.warn(
        '[InteractionManager] No current interaction ID, skipping failed interaction.',
      )
      return
    }

    try {
      const userProfile = mainStore.get(STORE_KEYS.USER_PROFILE) as any
      const userId = userProfile?.id || 'self-hosted'
      const now = new Date().toISOString()
      const isPending = !!params.pendingPath

      await InteractionsTable.upsert({
        id: this.currentInteractionId,
        user_id: userId,
        title: isPending ? 'Dictation awaiting retry' : 'Failed dictation',
        asr_output: {
          transcript: '',
          totalAudioBytes: 0,
          error: params.errorMessage,
          errorCode: params.errorCode || null,
          timestamp: now,
          durationMs: params.audioDurationMs ?? 0,
          pending: isPending,
          pendingPath: params.pendingPath ?? null,
        },
        llm_output: { error: params.errorMessage },
        raw_audio: null,
        raw_audio_id: null,
        duration_ms: params.audioDurationMs ?? null,
        sample_rate: params.sampleRate,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })

      this.notifyInteractionCreated(this.currentInteractionId, '', now, 0)
    } catch (error) {
      log.error(
        '[InteractionManager] Failed to store failed interaction:',
        error,
      )
    }
  }

  /**
   * Stores a transcript recovered from a previously failed dictation.
   *
   * When the dictation already has a `pending` row (created by
   * createFailedInteraction), that row is updated in place — otherwise the
   * history would show both a failure and a success for the same dictation.
   * Falls back to a fresh row when no match exists (audio recovered from a
   * previous app version, or a row the user deleted meanwhile).
   */
  async createRecoveredInteraction(
    transcript: string,
    sampleRate: number,
    pendingPath?: string | null,
    audioDurationMs?: number,
    asrEngine?: string,
  ) {
    try {
      const userProfile = mainStore.get(STORE_KEYS.USER_PROFILE) as any
      const userId = userProfile?.id || 'self-hosted'
      const now = new Date().toISOString()
      const title =
        transcript.length > 50
          ? transcript.substring(0, 50) + '...'
          : transcript || 'Recovered dictation'

      const existing = pendingPath
        ? await this.findPendingInteraction(userId, pendingPath)
        : undefined
      const id = existing?.id ?? uuidv4()

      await InteractionsTable.upsert({
        id,
        user_id: userId,
        title,
        asr_output: {
          transcript,
          totalAudioBytes: 0,
          error: null,
          errorCode: null,
          timestamp: now,
          durationMs: audioDurationMs ?? 0,
          pending: false,
          recovered: true,
          engine: asrEngine || null,
        },
        llm_output: {},
        raw_audio: null,
        raw_audio_id: null,
        duration_ms: audioDurationMs ?? null,
        sample_rate: sampleRate,
        // Keep the original timestamp so the dictation stays where the user
        // expects it in the history, not at the top hours later.
        created_at: existing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      })

      this.notifyInteractionCreated(id, transcript, now, audioDurationMs ?? 0)
    } catch (error) {
      log.error(
        '[InteractionManager] Failed to store recovered interaction:',
        error,
      )
    }
  }

  private async findPendingInteraction(userId: string, pendingPath: string) {
    try {
      const interactions = await InteractionsTable.findAll(userId)
      return interactions.find(
        interaction => interaction.asr_output?.pendingPath === pendingPath,
      )
    } catch (error) {
      log.warn('[InteractionManager] Pending interaction lookup failed:', error)
      return undefined
    }
  }

  private notifyInteractionCreated(
    id: string,
    transcript: string,
    timestamp: string,
    durationMs: number,
  ) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('interaction-created', {
        id,
        transcript,
        timestamp,
        durationMs,
      })
    })
  }
}

export const interactionManager = new InteractionManager()
