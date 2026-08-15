import React, { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  useOnboardingStore,
  ONBOARDING_CATEGORIES,
} from '../../store/useOnboardingStore'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import { X, StopSquare } from '@mynaui/icons-react'
import { AudioBars } from './contents/AudioBars'
import { PreviewAudioBars } from './contents/PreviewAudioBars'
import { ProcessingBars } from './contents/ProcessingBars'
import { useAudioStore } from '@/app/store/useAudioStore'
import { useModesStore } from '@/app/store/useModesStore'
import { analytics, ANALYTICS_EVENTS } from '../analytics'
import { IPC_EVENTS } from '@/lib/types/ipc'
import type {
  InteractionSoundPlayPayload,
  RecordingStatePayload,
  ProcessingStatePayload,
} from '@/lib/types/ipc'
import { playInteractionSoundPayload } from '@/app/utils/interactionSoundPlayer'

/**
 * Palette de la pill.
 *
 * ATTENTION — la fenêtre de la pill ne charge PAS `app.css` (cf. renderer.tsx :
 * l'import est sauté pour la route `#/pill`, pour ne pas hériter des styles de
 * `body`). Les variables CSS de globals.css n'y existent donc pas, et ces
 * valeurs doivent être écrites en dur. Elles sont les équivalents sRGB exacts
 * des tokens ; globals.css reste la source de vérité, ceci en est le miroir.
 */
const THEME = {
  background: {
    primary: 'rgba(19, 18, 17, 0.92)', // --surface   #131211
    elevated: 'rgba(26, 25, 24, 0.92)', // --surface-2 #1A1918
    hover: 'rgba(34, 33, 31, 0.92)', // --surface-3 #22211F
    glass: 'rgba(10, 10, 10, 0.82)', // --background #0A0A0A
  },
  border: {
    subtle: 'rgba(251, 250, 249, 0.08)',
    hover: 'rgba(251, 250, 249, 0.16)',
    // Le violet d'origine (hsla(263 70% 55%)) n'appartenait à aucune palette
    // de l'app : l'état « traitement » se lit désormais au contraste seul.
    processing: 'rgba(251, 250, 249, 0.22)',
    // L'enregistrement se signale par une bordure blanche franche, deux fois
    // plus lumineuse que l'état de repos. Aucune teinte n'est en jeu.
    recording: 'rgba(251, 250, 249, 0.34)',
    // Mode Intelligent : même langage, poussé d'un cran — c'est la seule
    // différence entre les deux modes depuis le retrait du vermillon.
  },
  glow: {
    idle: '0 2px 8px rgba(0, 0, 0, 0.5)',
    hover: '0 3px 10px rgba(0, 0, 0, 0.55)',
    recording:
      '0 3px 14px rgba(0, 0, 0, 0.6), 0 0 20px -8px rgba(251, 250, 249, 0.35)',
    processing: '0 3px 12px rgba(0, 0, 0, 0.55)',
  },
  accent: {
    danger: '#D23855', // --destructive
    foreground: '#FBFAF9', // --foreground
    muted: '#A3A19F', // --muted-foreground
  },
}

// Les @font-face viennent de styles/pill.css, chargé par renderer.tsx.
const globalStyles = `
  html, body, #app {
    height: 100%;
    margin: 0;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;

    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 4px;

    pointer-events: none;

    font-family: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
  }

  @keyframes subtleBreathe {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.02);
    }
  }
`

const BAR_UPDATE_INTERVAL = 64

/**
 * Les barres sont blanches, quel que soit le mode : le blanc est la seule
 * couleur primaire de l'app. Le mode se lit à son nom, affiché à côté des
 * barres, pas à une teinte ni à une nuance de bordure.
 */
const AUDIO_BAR_COLOR = THEME.accent.foreground

const Pill = () => {
  // Get initial values from store using separate selectors to avoid infinite re-renders
  const initialShowItoBarAlways = useSettingsStore(
    state => state.showItoBarAlways,
  )
  const initialOnboardingCategory = useOnboardingStore(
    state => state.onboardingCategory,
  )
  const initialOnboardingCompleted = useOnboardingStore(
    state => state.onboardingCompleted,
  )
  const { startRecording, stopRecording, cancelRecording } = useAudioStore()
  // Modes ne sont chargés et tenus à jour qu'ici, dans le store — la pill
  // avait sa propre copie via `modes.getActive()` / `getAll()`, une deuxième
  // source qui pouvait diverger de la page Modes.
  const {
    modes,
    activeModeId,
    loaded: modesLoaded,
    load: loadModes,
  } = useModesStore()

  const [isRecording, setIsRecording] = useState(false)
  const [isManualRecording, setIsManualRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [recordingModeName, setRecordingModeName] = useState<string>('')
  const isManualRecordingRef = useRef(false)
  const [showItoBarAlways, setShowItoBarAlways] = useState(
    initialShowItoBarAlways,
  )
  const [onboardingCategory, setOnboardingCategory] = useState(
    initialOnboardingCategory,
  )
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    initialOnboardingCompleted,
  )
  // Fixed size array of volume values to be used for the audio bars, size is 21
  const [volumeHistory, setVolumeHistory] = useState<number[]>([])
  const [lastVolumeUpdate, setLastVolumeUpdate] = useState(0)

  useEffect(() => {
    if (!modesLoaded) void loadModes()
  }, [modesLoaded, loadModes])

  const activeModeName =
    modes.find(mode => mode.id === activeModeId)?.name ?? ''

  useEffect(() => {
    // Listen for recording state changes from the main process
    const unsubRecording = window.api.on(
      'recording-state-update',
      (state: RecordingStatePayload) => {
        // Update recording state - this is for global hotkey triggered recording
        setIsRecording(state.isRecording)
        setRecordingModeName(state.modeName ?? recordingModeName)

        // Only track general recording analytics if it's not a manual recording
        if (!isManualRecordingRef.current) {
          const analyticsEvent = state.isRecording
            ? ANALYTICS_EVENTS.RECORDING_STARTED
            : ANALYTICS_EVENTS.RECORDING_COMPLETED
          analytics.track(analyticsEvent, {
            is_recording: state.isRecording,
            mode: state.modeId,
          })
        }

        // If global recording stops, also stop manual recording
        if (!state.isRecording) {
          setIsManualRecording(false)
          isManualRecordingRef.current = false
          // Only clear volume history when recording stops
          setVolumeHistory([])
        }
      },
    )

    // Listen for processing state changes from the main process
    const unsubProcessing = window.api.on(
      'processing-state-update',
      (state: ProcessingStatePayload) => {
        setIsProcessing(state.isProcessing)
      },
    )

    // Listen for volume updates from the main process
    const unsubVolume = window.api.on('volume-update', (vol: number) => {
      // throttle the volume updates to 80ms
      const now = Date.now()
      if (now - lastVolumeUpdate < BAR_UPDATE_INTERVAL) {
        return
      }
      const newVolumeHistory = [...volumeHistory, vol]
      if (newVolumeHistory.length > 42) {
        newVolumeHistory.shift()
      }
      setVolumeHistory(newVolumeHistory)
      setLastVolumeUpdate(now)
    })

    // Listen for settings updates from the main process
    const unsubSettings = window.api.on('settings-update', (settings: any) => {
      // Update local state with the new setting
      setShowItoBarAlways(settings.showItoBarAlways)
    })

    // Listen for onboarding updates from the main process
    const unsubOnboarding = window.api.on(
      'onboarding-update',
      (onboarding: any) => {
        setOnboardingCategory(onboarding.onboardingCategory)
        setOnboardingCompleted(onboarding.onboardingCompleted)
      },
    )

    // Listen for user auth updates from the main process
    const unsubUserAuth = window.api.on('user-auth-update', (authUser: any) => {
      if (authUser) {
        analytics.identifyUser(
          authUser.id,
          {
            user_id: authUser.id,
            email: authUser.email,
            name: authUser.name,
            provider: authUser.provider,
          },
          authUser.provider,
        )
      } else {
        // User logged out
        analytics.resetUser()
      }
    })

    const unsubInteractionSound = window.api.on(
      IPC_EVENTS.INTERACTION_SOUND_PLAY,
      (payload: InteractionSoundPlayPayload) => {
        void playInteractionSoundPayload(payload)
      },
    )

    // Cleanup listeners when the component unmounts
    return () => {
      unsubRecording()
      unsubProcessing()
      unsubVolume()
      unsubSettings()
      unsubOnboarding()
      unsubUserAuth()
      unsubInteractionSound()
    }
  }, [volumeHistory, lastVolumeUpdate, recordingModeName])

  // Compact dimensions — small and subtle, Wispr Flow style
  const idleWidth = 28
  const idleHeight = 6
  // Same bars as the recording state, now also carrying the active mode
  // label at rest — widened to match so the label isn't clipped to nothing.
  const hoveredWidth = 76
  const hoveredHeight = 22
  const recordingWidth = 76
  const recordingHeight = 24
  const manualRecordingWidth = 148
  const manualRecordingHeight = 32
  const processingWidth = 76
  const processingHeight = 24

  // Determine current state
  const anyRecording = isRecording || isManualRecording
  const shouldShow =
    (onboardingCategory === ONBOARDING_CATEGORIES.TRY_IT ||
      onboardingCompleted) &&
    (anyRecording || isProcessing || showItoBarAlways || isHovered)

  // Calculate dimensions and styling based on state
  let currentWidth = idleWidth
  let currentHeight = idleHeight
  let backgroundColor = THEME.background.glass
  let borderColor = THEME.border.subtle
  let boxShadow = THEME.glow.idle
  let animationName = 'none'

  // Un libellé lisible dit ce qu'une nuance de bordure ne pouvait que
  // suggérer : la bordure d'enregistrement est donc uniforme.
  const recordingBorder = THEME.border.recording
  // Pendant une dictée, le mode qui l'a démarrée ; au repos, le mode actif.
  const modeLabel = recordingModeName || activeModeName || null

  if (isManualRecording) {
    currentWidth = manualRecordingWidth
    currentHeight = manualRecordingHeight
    backgroundColor = THEME.background.primary
    borderColor = recordingBorder
    boxShadow = THEME.glow.recording
  } else if (anyRecording) {
    currentWidth = recordingWidth
    currentHeight = recordingHeight
    backgroundColor = THEME.background.primary
    borderColor = recordingBorder
    boxShadow = THEME.glow.recording
  } else if (isProcessing) {
    currentWidth = processingWidth
    currentHeight = processingHeight
    backgroundColor = THEME.background.primary
    borderColor = THEME.border.processing
    boxShadow = THEME.glow.processing
    animationName = 'subtleBreathe 2s ease-in-out infinite'
  } else if (isHovered) {
    currentWidth = hoveredWidth
    currentHeight = hoveredHeight
    backgroundColor = THEME.background.elevated
    borderColor = THEME.border.hover
    boxShadow = THEME.glow.hover
  }

  // Premium pill style with glassmorphism and refined aesthetics
  const pillStyle: React.CSSProperties = {
    // Flex properties to center the content inside
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',

    // Dynamic styles that change based on the state
    width: `${currentWidth}px`,
    height: `${currentHeight}px`,
    backgroundColor,
    border: `1px solid ${borderColor}`,
    boxShadow,

    // Show/hide animation using opacity and scale
    opacity: shouldShow ? 1 : 0,
    transform: shouldShow ? 'scale(1)' : 'scale(0.85)',
    transformOrigin: 'bottom center',
    visibility: shouldShow ? 'visible' : 'hidden',

    // Premium pill shape with generous border radius
    borderRadius: '100px',
    boxSizing: 'border-box',
    overflow: 'hidden',

    // Glassmorphism backdrop blur effect
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',

    // Enable pointer events for this element
    pointerEvents: 'auto',
    cursor: isHovered && !anyRecording ? 'pointer' : 'default',

    // Smooth transitions for all state changes
    transition: `
      width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      background-color 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      border-color 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.3s ease,
      transform 0.3s ease,
      visibility 0.3s ease
    `,

    // Recording/processing animations
    animation: animationName,
  }

  // Handle mouse enter - enable mouse events for the pill window and set hover state
  const handleMouseEnter = () => {
    setIsHovered(true)
    if (window.api?.setPillMouseEvents) {
      window.api.setPillMouseEvents(false) // Enable mouse events
    }
  }

  // Handle mouse leave - disable mouse events (with forwarding) for the pill window and clear hover state
  const handleMouseLeave = () => {
    setIsHovered(false)
    if (window.api?.setPillMouseEvents) {
      window.api.setPillMouseEvents(true, { forward: true }) // Disable mouse events but keep forwarding
    }
  }

  // Handle click to start manual recording
  const handleClick = () => {
    if (isHovered && !anyRecording) {
      setIsManualRecording(true)
      isManualRecordingRef.current = true
      // Trigger recording start via IPC
      startRecording()

      analytics.track(ANALYTICS_EVENTS.MANUAL_RECORDING_STARTED, {
        is_recording: true,
      })
    }
  }

  // Handle cancel recording (abandons recording without processing)
  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsManualRecording(false)
    cancelRecording()

    analytics.track(ANALYTICS_EVENTS.MANUAL_RECORDING_ABANDONED, {
      is_recording: false,
    })
  }

  // Handle stop recording
  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsManualRecording(false)
    stopRecording()

    analytics.track(ANALYTICS_EVENTS.MANUAL_RECORDING_COMPLETED, {
      is_recording: false,
    })
  }

  // Premium button style for action buttons
  const actionButtonStyle: React.CSSProperties = {
    background: 'rgba(251, 250, 249, 0.08)',
    border: '1px solid rgba(251, 250, 249, 0.14)',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    transition: 'all 0.2s ease',
    backdropFilter: 'blur(4px)',
    flexShrink: 0,
  }

  const renderContent = () => {
    if (isManualRecording) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            justifyContent: 'space-between',
            padding: '0 8px',
            gap: '8px',
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCancel}
                style={actionButtonStyle}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(251, 250, 249, 0.16)'
                  e.currentTarget.style.borderColor =
                    'rgba(251, 250, 249, 0.28)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(251, 250, 249, 0.08)'
                  e.currentTarget.style.borderColor =
                    'rgba(251, 250, 249, 0.14)'
                }}
              >
                <X
                  width={12}
                  height={12}
                  color={THEME.accent.foreground}
                  style={{ opacity: 0.85 }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              style={{
                backgroundColor: THEME.background.primary,
                color: THEME.accent.foreground,
                padding: '6px 10px',
                fontSize: '12px',
                marginBottom: '8px',
                borderRadius: '6px',
                border: `1px solid ${THEME.border.subtle}`,
                boxShadow: THEME.glow.idle,
              }}
              className="border-none"
            >
              Cancel
            </TooltipContent>
          </Tooltip>

          <AudioBars volumeHistory={volumeHistory} barColor={AUDIO_BAR_COLOR} />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleStop}
                style={{
                  ...actionButtonStyle,
                  background: 'rgba(210, 56, 85, 0.14)',
                  borderColor: 'rgba(210, 56, 85, 0.38)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(210, 56, 85, 0.24)'
                  e.currentTarget.style.borderColor = 'rgba(210, 56, 85, 0.6)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(210, 56, 85, 0.14)'
                  e.currentTarget.style.borderColor = 'rgba(210, 56, 85, 0.38)'
                }}
              >
                <StopSquare
                  width={12}
                  height={12}
                  color={THEME.accent.danger}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              style={{
                backgroundColor: THEME.background.primary,
                color: THEME.accent.foreground,
                padding: '6px 10px',
                fontSize: '12px',
                marginBottom: '8px',
                borderRadius: '6px',
                border: `1px solid ${THEME.border.subtle}`,
                boxShadow: THEME.glow.idle,
              }}
              className="border-none"
            >
              Stop and paste
            </TooltipContent>
          </Tooltip>
        </div>
      )
    }

    if (anyRecording) {
      return (
        <>
          <AudioBars volumeHistory={volumeHistory} barColor={AUDIO_BAR_COLOR} />
          {modeLabel && (
            <span className="ml-2 truncate text-[10px] tracking-tight text-[rgba(251,250,249,0.6)]">
              {modeLabel}
            </span>
          )}
        </>
      )
    }

    if (isProcessing) {
      return <ProcessingBars color={AUDIO_BAR_COLOR} />
    }

    if (isHovered) {
      return (
        <>
          <PreviewAudioBars />
          {/* Le commentaire sur modeLabel promettait déjà ce libellé au repos
              ; il n'était rendu que dans la branche anyRecording, où
              recordingModeName masque toujours activeModeName. */}
          {modeLabel && (
            <span className="ml-2 truncate text-[10px] tracking-tight text-[rgba(251,250,249,0.6)]">
              {modeLabel}
            </span>
          )}
        </>
      )
    }

    return null
  }

  return (
    <>
      <style>{globalStyles}</style>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            style={pillStyle}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {renderContent()}
          </div>
        </TooltipTrigger>
        {/* {isHovered && !anyRecording && (
          <TooltipContent
            side="top"
            style={{
              backgroundColor: THEME.background.primary,
              color: THEME.accent.foreground,
              padding: '8px 12px',
              fontSize: '13px',
              marginBottom: '8px',
              borderRadius: '8px',
              border: `1px solid ${THEME.border.subtle}`,
              boxShadow: THEME.glow.hover,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
            className="border-none"
          >
            Click and start speaking
          </TooltipContent>
        )} */}
      </Tooltip>
    </>
  )
}

export default Pill
