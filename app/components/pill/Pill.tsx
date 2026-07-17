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
import { LoadingAnimation } from './contents/LoadingAnimation'
import { useAudioStore } from '@/app/store/useAudioStore'
import { analytics, ANALYTICS_EVENTS } from '../analytics'
import { IPC_EVENTS } from '@/lib/types/ipc'
import type {
  InteractionSoundPlayPayload,
  RecordingStatePayload,
  ProcessingStatePayload,
} from '@/lib/types/ipc'
import { ItoMode } from '@/app/generated/ito_pb'
import { playInteractionSoundPayload } from '@/app/utils/interactionSoundPlayer'

// Premium Dark Theme Colors (matching globals.css Refined Obsidian palette)
const THEME = {
  // Base colors
  background: {
    primary: 'hsl(225, 15%, 8%)',
    elevated: 'hsl(225, 15%, 10%)',
    hover: 'hsl(225, 12%, 16%)',
    glass: 'hsla(225, 15%, 12%, 0.85)',
  },
  border: {
    subtle: 'hsla(210, 20%, 96%, 0.08)',
    hover: 'hsla(210, 20%, 96%, 0.15)',
    active: 'hsla(263, 70%, 55%, 0.4)',
    recording: 'hsla(0, 72%, 51%, 0.5)',
  },
  glow: {
    idle: '0 4px 12px hsla(0, 0%, 0%, 0.4), 0 1px 4px hsla(0, 0%, 0%, 0.3)',
    hover:
      '0 8px 24px hsla(263, 70%, 55%, 0.12), 0 4px 12px hsla(0, 0%, 0%, 0.4)',
    recording:
      '0 0 24px hsla(0, 80%, 55%, 0.25), 0 4px 16px hsla(0, 0%, 0%, 0.5)',
    processing:
      '0 0 24px hsla(263, 70%, 55%, 0.2), 0 4px 16px hsla(0, 0%, 0%, 0.5)',
  },
  accent: {
    violet: 'hsl(263, 70%, 55%)',
    amber: 'hsl(38, 95%, 55%)',
    red: 'hsl(0, 72%, 51%)',
    foreground: 'hsl(210, 20%, 96%)',
  },
}

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

    font-family:
      'Inter',
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;
  }

  @keyframes pulseGlow {
    0%, 100% {
      box-shadow: ${THEME.glow.recording};
    }
    50% {
      box-shadow: 0 0 32px hsla(0, 80%, 55%, 0.35), 0 8px 24px hsla(0, 0%, 0%, 0.6);
    }
  }

  @keyframes subtleBreathe {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.02);
    }
  }

  @keyframes recordingPulse {
    0%, 100% {
      border-color: hsla(0, 72%, 51%, 0.5);
    }
    50% {
      border-color: hsla(0, 72%, 51%, 0.8);
    }
  }
`

const BAR_UPDATE_INTERVAL = 64

// Premium color mapping for different recording modes
const getAudioBarColor = (mode: ItoMode | undefined): string => {
  switch (mode) {
    case ItoMode.TRANSCRIBE:
      return THEME.accent.foreground
    case ItoMode.EDIT:
      return THEME.accent.amber
    default:
      return THEME.accent.foreground
  }
}

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

  const [isRecording, setIsRecording] = useState(false)
  const [isManualRecording, setIsManualRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [recordingMode, setRecordingMode] = useState<ItoMode | undefined>()
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
    // Listen for recording state changes from the main process
    const unsubRecording = window.api.on(
      'recording-state-update',
      (state: RecordingStatePayload) => {
        // Update recording state - this is for global hotkey triggered recording
        setIsRecording(state.isRecording)
        setRecordingMode(state.mode ?? recordingMode)

        // Only track general recording analytics if it's not a manual recording
        if (!isManualRecordingRef.current) {
          const analyticsEvent = state.isRecording
            ? ANALYTICS_EVENTS.RECORDING_STARTED
            : ANALYTICS_EVENTS.RECORDING_COMPLETED
          analytics.track(analyticsEvent, {
            is_recording: state.isRecording,
            mode: state.mode,
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
  }, [volumeHistory, lastVolumeUpdate, recordingMode])

  // Premium dimensions for different states
  const idleWidth = 40
  const idleHeight = 10
  const hoveredWidth = 100
  const hoveredHeight = 36
  const recordingWidth = 100
  const recordingHeight = 38
  const manualRecordingWidth = 200
  const manualRecordingHeight = 46
  const processingWidth = 100
  const processingHeight = 38

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

  if (isManualRecording) {
    currentWidth = manualRecordingWidth
    currentHeight = manualRecordingHeight
    backgroundColor = THEME.background.primary
    borderColor = THEME.border.recording
    boxShadow = THEME.glow.recording
    animationName =
      'pulseGlow 2s ease-in-out infinite, recordingPulse 1.5s ease-in-out infinite'
  } else if (anyRecording) {
    currentWidth = recordingWidth
    currentHeight = recordingHeight
    backgroundColor = THEME.background.primary
    borderColor = THEME.border.recording
    boxShadow = THEME.glow.recording
    animationName = 'pulseGlow 2s ease-in-out infinite'
  } else if (isProcessing) {
    currentWidth = processingWidth
    currentHeight = processingHeight
    backgroundColor = THEME.background.primary
    borderColor = THEME.border.active
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
    background: 'hsla(210, 20%, 96%, 0.08)',
    border: '1px solid hsla(210, 20%, 96%, 0.12)',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
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
            padding: '0 18px',
            gap: '12px',
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCancel}
                style={{ ...actionButtonStyle, marginLeft: '3px' }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'hsla(210, 20%, 96%, 0.12)'
                  e.currentTarget.style.borderColor = 'hsla(210, 20%, 96%, 0.2)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'hsla(210, 20%, 96%, 0.06)'
                  e.currentTarget.style.borderColor = 'hsla(210, 20%, 96%, 0.1)'
                }}
              >
                <X
                  width={16}
                  height={16}
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

          <AudioBars
            volumeHistory={volumeHistory}
            barColor={getAudioBarColor(recordingMode)}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleStop}
                style={{
                  ...actionButtonStyle,
                  marginRight: '3px',
                  background: 'hsla(0, 72%, 51%, 0.15)',
                  borderColor: 'hsla(0, 72%, 51%, 0.3)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'hsla(0, 72%, 51%, 0.25)'
                  e.currentTarget.style.borderColor = 'hsla(0, 72%, 51%, 0.5)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'hsla(0, 72%, 51%, 0.15)'
                  e.currentTarget.style.borderColor = 'hsla(0, 72%, 51%, 0.3)'
                }}
              >
                <StopSquare width={16} height={16} color={THEME.accent.red} />
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
        <AudioBars
          volumeHistory={volumeHistory}
          barColor={getAudioBarColor(recordingMode)}
        />
      )
    }

    if (isProcessing) {
      return <LoadingAnimation color={getAudioBarColor(recordingMode)} />
    }

    if (isHovered) {
      return <PreviewAudioBars />
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
