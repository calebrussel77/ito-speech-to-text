import { audioRecorderService } from '../media/audio'
import {
  muteSystemAudio,
  unmuteSystemAudio,
  warmUpSystemAudioControl,
} from '../media/systemAudio'
import { getPillWindow, mainWindow } from './app'
import store from './store'
import { STORE_KEYS } from '../constants/store-keys'
import { IPC_EVENTS } from '../types/ipc'
import log from 'electron-log'
import { shouldMuteForMode } from './audio/audioSourceController'
import type { Mode } from './sqlite/models'

export class VoiceInputService {
  // Set by `startAudioRecording`, read by `stopAudioRecording`: whether
  // system audio was actually muted for the dictation currently in flight.
  // The global `settings.muteAudioWhenDictating` can't be re-read at stop
  // time to decide — it's only the default proposed to a *new* mode, and a
  // mid-session settings change would otherwise unmute a mode that never
  // asked for it (or leave a mute in place a mode had turned off).
  private mutedForThisSession = false

  /**
   * Prepares the native audio stream so recordings can start instantly.
   * Safe to call multiple times; it will no-op if already prepared.
   */
  public prepareAudioStream = () => {
    const settings = store.get(STORE_KEYS.SETTINGS)
    const deviceId = settings.microphoneDeviceId
    if (!deviceId) return

    console.log(
      '[VoiceInputService] Preparing audio stream with device:',
      deviceId,
    )
    audioRecorderService.prepareStream(deviceId)
  }

  /**
   * Starts audio recording and handles system audio muting.
   * Does NOT start the ItoStreamController - that should be done separately.
   *
   * The audio source and the mute policy both come from `mode`, not from
   * `settings.muteAudioWhenDictating` — see `shouldMuteForMode`.
   */
  public startAudioRecording = (mode: Mode) => {
    console.log('[VoiceInputService] Starting audio recording')

    const settings = store.get(STORE_KEYS.SETTINGS)
    const deviceId = settings.microphoneDeviceId

    if (shouldMuteForMode(mode)) {
      console.log('[VoiceInputService] Muting system audio for dictation')
      muteSystemAudio()
      this.mutedForThisSession = true
    } else {
      this.mutedForThisSession = false
    }

    // `deviceId` keeps flowing regardless of `mode.audioSource`: the chosen
    // microphone is a global setting (Settings → Audio & Mic), not something
    // a mode's source overrides. For `both` it is the primary/master-clock
    // device (see the Rust `CaptureKind` doc comment) — but pure `system`
    // capture ignores `device_name` entirely and lets the Rust side pick the
    // default output device, so `deviceId` is harmless dead weight there,
    // not something it relies on.
    console.log(
      '[VoiceInputService] Starting audio recorder with device:',
      deviceId,
      'source:',
      mode.audioSource,
    )
    audioRecorderService.startRecording({
      deviceId,
      audioSource: mode.audioSource,
    })

    console.log('[VoiceInputService] Audio recording started')
  }

  /**
   * Stops audio recording and handles system audio unmuting.
   * Waits for the audio recorder to drain before returning.
   */
  /**
   * Arrête l'enregistrement et attend la vidange du recorder. Rend
   * `drainTruncated: true` quand la vidange n'a pas confirmé à temps, pour
   * que l'historique puisse dire si une fin de phrase a pu être perdue.
   */
  public stopAudioRecording = async (): Promise<{
    drainTruncated: boolean
  }> => {
    console.log('[VoiceInputService] Stopping audio recording')
    audioRecorderService.stopRecording()
    console.log(
      '[VoiceInputService] Audio recorder stopped, waiting for drain...',
    )

    // Wait for explicit drain-complete signal from the recorder (with timeout fallback)
    let drainTruncated = false
    try {
      const drained = await audioRecorderService.awaitDrainComplete(500)
      drainTruncated = drained === false
      console.log('[VoiceInputService] Drain complete')
    } catch (e) {
      log.warn('[VoiceInputService] drain-complete wait failed, proceeding:', e)
    }

    // Unmute only if this session actually muted — not whatever the global
    // setting says right now: it may have changed mid-session, or the mode
    // that started this recording may never have asked to mute at all.
    if (this.mutedForThisSession) {
      console.log('[VoiceInputService] Unmuting system audio after dictation')
      unmuteSystemAudio()
      this.mutedForThisSession = false
    }

    console.log('[VoiceInputService] Audio recording stopped')
    return { drainTruncated }
  }

  public setUpAudioRecorderListeners = () => {
    // Note: audio-chunk and audio-config are now handled directly by ItoStreamController
    // when the gRPC stream starts. VoiceInputService only handles UI-related events.

    audioRecorderService.on('volume-update', volume => {
      getPillWindow()?.webContents.send(IPC_EVENTS.VOLUME_UPDATE, volume)
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(IPC_EVENTS.VOLUME_UPDATE, volume)
      }
    })

    audioRecorderService.on('error', err => {
      // Handle errors, maybe show a dialog to the user
      log.error('[VoiceInputService] Audio recorder error:', err.message)
    })

    audioRecorderService.initialize()

    // Pre-spawn the Windows mute helper so the first dictation mutes
    // instantly instead of paying the PowerShell startup cost.
    if (store.get(STORE_KEYS.SETTINGS).muteAudioWhenDictating) {
      warmUpSystemAudioControl()
    }
  }

  /**
   * Call this when microphone selection changes to update the transcription
   * config with the effective output sample rate for the chosen device.
   */
  public handleMicrophoneChanged = (deviceId: string) => {
    audioRecorderService.requestDeviceConfig(deviceId)
  }
}

export const voiceInputService = new VoiceInputService()
