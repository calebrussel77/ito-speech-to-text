import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  useOnboardingStore,
  ONBOARDING_CATEGORIES,
} from '../../store/useOnboardingStore'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import { X, StopSquare } from '@mynaui/icons-react'
import { AudioBars } from './contents/AudioBars'
import { BAR_COUNT, BAR_WIDTH, BAR_GAP } from './contents/AudioBarsBase'
import { PreviewAudioBars } from './contents/PreviewAudioBars'
import { ProcessingBars } from './contents/ProcessingBars'
import { useAudioStore } from '@/app/store/useAudioStore'
import { useModesStore } from '@/app/store/useModesStore'
import { modeColor } from '@/lib/constants/modeColors'
import { modeIcon } from '@/app/components/modeIcons'
import { pillMode } from './pillMode'
import { analytics, ANALYTICS_EVENTS } from '../analytics'
import { IPC_EVENTS } from '@/lib/types/ipc'
import type {
  InteractionSoundPlayPayload,
  RecordingStatePayload,
  ProcessingStatePayload,
  ActiveModePayload,
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
 * couleur primaire de l'app. Le mode se lit à son nom et à la pastille de 6 px
 * posée devant les barres — jamais à des barres teintées, ni à une nuance de
 * bordure.
 */
const AUDIO_BAR_COLOR = THEME.accent.foreground

/**
 * Marge intérieure horizontale de la pill.
 *
 * Elle doit rester supérieure au retrait que le rayon de 100 px creuse sur les
 * flancs, sans quoi le contenu passe sous l'arrondi et `overflow: hidden` le
 * coupe — c'est ce qui rognait les barres.
 */
const PILL_PADDING_X = 10

/** Écart entre la pastille, les barres et l'icône. */
const PILL_GAP = 6

/**
 * Largeur maximale de la pill. La fenêtre qui l'héberge fait 220 px de large
 * (`PILL_MAX_WIDTH` dans lib/main/app.ts) : au-delà, ce n'est plus l'arrondi
 * qui coupe le contenu, c'est la fenêtre elle-même.
 */
const PILL_LIMIT_WIDTH = 206

/**
 * Taille et matière de l'icône du mode.
 *
 * Elle remplace le nom écrit : à 10 px, un libellé de mode tenait rarement sans
 * être abrégé, et il élargissait la pill de tout son texte. L'icône dit la même
 * chose en 14 px — et c'est la même icône que celle de la page Modes.
 *
 * `strokeWidth` est monté à 1,75 : le trait par défaut de Myna, pensé pour du
 * 16-24 px sur fond clair, disparaît à cette taille sur du near-black.
 */
const MODE_ICON_SIZE = 14
const MODE_ICON_STROKE = 1.75
const MODE_ICON_COLOR = 'rgba(251, 250, 249, 0.82)'

/**
 * Durée d'affichage de l'aperçu après un cycle de mode au raccourci : le temps
 * de lire un nom court, pas plus — et réarmée à chaque pression, pour qu'une
 * rafale de cycles reste lisible jusqu'au mode où elle s'arrête.
 */
const PEEK_DURATION_MS = 1600

/** Au-delà, le nom du mode s'abrège — la pill ne doit pas traverser l'écran. */
const PEEK_NAME_MAX_WIDTH = 140

/**
 * La pastille du mode : 6 px, la seule couleur autorisée par la charte.
 *
 * C'est elle qui dit quel mode enregistre, avant même qu'on regarde l'icône.
 * Les barres, elles, restent blanches.
 */
const ModeDot = ({ color }: { color: string }) => (
  <span
    style={{
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      backgroundColor: color,
      boxShadow: `0 0 6px ${color}66`,
      flexShrink: 0,
    }}
  />
)

/**
 * L'icône du mode.
 *
 * Dimensionnée et colorée par props, jamais par classes : la fenêtre de la pill
 * ne charge pas `app.css` (cf. renderer.tsx), une classe utilitaire n'y définit
 * rien — c'est exactement ce qui rendait l'ancien libellé noir et surdimensionné.
 * `display: block` supprime l'espace de ligne de base que le SVG traînerait,
 * qui décalait l'icône d'un pixel vers le bas par rapport aux barres.
 */
const ModeGlyph = ({ icon }: { icon: string }) => {
  const Icon = modeIcon(icon)
  return (
    <Icon
      width={MODE_ICON_SIZE}
      height={MODE_ICON_SIZE}
      color={MODE_ICON_COLOR}
      strokeWidth={MODE_ICON_STROKE}
      style={{ display: 'block', flexShrink: 0 }}
    />
  )
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
  // Le mode qui enregistre : son id pour la teinte, son icône pour le glyphe.
  // Les deux viennent de la diffusion plutôt que du store, parce qu'un
  // raccourci dédié peut dicter dans un mode qui n'est pas le mode actif.
  const [recordingModeId, setRecordingModeId] = useState<string>('')
  const [recordingModeIcon, setRecordingModeIcon] = useState<string>('')
  // Teinte choisie du mode qui enregistre, telle que le processus principal
  // vient de la lire en base — vide quand ce mode n'en a pas, et la couleur
  // est alors dérivée de son id comme partout ailleurs.
  const [recordingModeColor, setRecordingModeColor] = useState<string>('')
  // Aperçu du mode qui vient d'être activé au raccourci de cycle. Servi depuis
  // la diffusion, pas depuis le store : les deux écoutent le même événement et
  // l'aperçu ne doit pas dépendre de l'ordre dans lequel ils l'ont reçu.
  const [peekMode, setPeekMode] = useState<ActiveModePayload | null>(null)
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // Largeur naturelle du contenu, mesurée. La pill se dimensionne dessus au
  // lieu de tenir sur des largeurs écrites à la main, qui ne pouvaient pas
  // anticiper la longueur d'un nom de mode.
  const contentRef = useRef<HTMLDivElement>(null)
  // Amorcée sur la largeur d'un état déployé — pastille, barres, icône — pour
  // que la toute première ouverture parte déjà à la bonne échelle, avant que
  // la mesure ne la corrige.
  const [contentWidth, setContentWidth] = useState(
    6 +
      PILL_GAP +
      BAR_COUNT * BAR_WIDTH +
      (BAR_COUNT - 1) * BAR_GAP +
      PILL_GAP +
      MODE_ICON_SIZE,
  )

  useEffect(() => {
    if (!modesLoaded) void loadModes()
  }, [modesLoaded, loadModes])

  // À part du grand effet plus bas : celui-ci se réabonne à chaque variation
  // de volume, et son nettoyage aurait éteint l'aperçu en pleine dictée.
  useEffect(() => {
    const unsubActiveMode = window.api.on(
      IPC_EVENTS.ACTIVE_MODE_UPDATE,
      (payload: ActiveModePayload) => {
        // Seul le cycle au raccourci se montre : un clic dans la page Modes a
        // déjà son retour visuel sous le curseur.
        if (!payload.reveal) return
        setPeekMode(payload)
        if (peekTimerRef.current) clearTimeout(peekTimerRef.current)
        peekTimerRef.current = setTimeout(
          () => setPeekMode(null),
          PEEK_DURATION_MS,
        )
      },
    )
    return () => {
      unsubActiveMode()
      if (peekTimerRef.current) clearTimeout(peekTimerRef.current)
    }
  }, [])

  const activeMode = modes.find(mode => mode.id === activeModeId)

  /**
   * Le contenu est mesuré, jamais deviné : un `ResizeObserver` plutôt qu'un
   * effet à dépendances, parce que Geist arrive après le premier rendu et que
   * le libellé s'élargit à ce moment-là, sans qu'aucun état ne change.
   */
  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return

    const measure = () => {
      const width = Math.ceil(element.getBoundingClientRect().width)
      // Un contenu vide (état de repos) ne remet pas la mesure à zéro : la
      // largeur de repos est fixe, et garder la dernière mesure évite que la
      // réouverture parte de rien puis s'élargisse d'un coup.
      if (width === 0) return
      setContentWidth(previous => (previous === width ? previous : width))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Listen for recording state changes from the main process
    const unsubRecording = window.api.on(
      'recording-state-update',
      (state: RecordingStatePayload) => {
        // Update recording state - this is for global hotkey triggered recording
        setIsRecording(state.isRecording)
        // Rien n'est effacé à l'arrêt, et c'est délibéré : le traitement suit
        // immédiatement (`notifyRecordingStopped` puis `notifyProcessingStarted`,
        // deux diffusions distinctes) et doit rester sur le mode qui vient de
        // dicter. Vider ici faisait retomber la pill sur le mode actif pour
        // toute la durée de la transcription. Ces valeurs ne sont donc lues que
        // pendant une dictée ou son traitement, et réécrites au démarrage de la
        // suivante — voir `dictating` plus bas.
        if (state.isRecording) {
          setRecordingModeId(state.modeId ?? '')
          setRecordingModeIcon(state.modeIcon ?? '')
          setRecordingModeColor(state.modeColor ?? '')
        }

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
  }, [volumeHistory, lastVolumeUpdate])

  // Compact dimensions — small and subtle, Wispr Flow style
  const idleWidth = 28
  const idleHeight = 6
  // Même hauteur au survol qu'en dictée : le contenu y est le même — pastille,
  // barres, icône — et une pill qui grandit d'un pixel au démarrage de la
  // dictée se lisait comme un sursaut plutôt que comme une transition.
  const hoveredHeight = 24
  const recordingHeight = 24
  const manualRecordingHeight = 32
  const processingHeight = 24

  /**
   * La largeur suit le contenu mesuré, jamais l'inverse.
   *
   * Les états déployés tenaient sur des constantes (76 px) plus étroites que
   * leur propre contenu dès qu'un nom de mode s'y ajoutait : le conteneur des
   * barres se comprimait, et `overflow: hidden` rognait les barres des deux
   * côtés. Le contenu ne se comprime plus (`flexShrink: 0`), c'est la pill qui
   * s'ajuste — et le nom, lui, s'abrège en points de suspension.
   */
  const expandedWidth = Math.min(
    PILL_LIMIT_WIDTH,
    contentWidth + PILL_PADDING_X * 2,
  )

  // Determine current state
  const anyRecording = isRecording || isManualRecording
  // Une dictée ou son traitement passent devant l'aperçu : cycler pendant
  // qu'on dicte ne change pas le mode qui enregistre, la pill n'a donc rien
  // de nouveau à montrer.
  const peeking = peekMode !== null && !anyRecording && !isProcessing
  const shouldShow =
    (onboardingCategory === ONBOARDING_CATEGORIES.TRY_IT ||
      onboardingCompleted) &&
    (anyRecording || isProcessing || showItoBarAlways || isHovered || peeking)

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
  // Quel mode la pill montre, et d'où elle le tient : la règle, ses raisons et
  // ses tests vivent dans pillMode.ts.
  const shown = pillMode({
    recording: anyRecording,
    processing: isProcessing,
    broadcast: {
      id: recordingModeId,
      icon: recordingModeIcon,
      color: recordingModeColor,
    },
    active: { id: activeModeId, icon: activeMode?.icon },
  })
  const modeGlyph = shown.icon
  // Une teinte choisie est servie telle quelle ; sinon elle se dérive de l'id,
  // sur la liste complète, comme partout ailleurs dans l'app.
  const modeDotColor = shown.color ?? modeColor(shown.id, modes)

  if (isManualRecording) {
    currentWidth = expandedWidth
    currentHeight = manualRecordingHeight
    backgroundColor = THEME.background.primary
    borderColor = recordingBorder
    boxShadow = THEME.glow.recording
  } else if (anyRecording) {
    currentWidth = expandedWidth
    currentHeight = recordingHeight
    backgroundColor = THEME.background.primary
    borderColor = recordingBorder
    boxShadow = THEME.glow.recording
  } else if (isProcessing) {
    currentWidth = expandedWidth
    currentHeight = processingHeight
    backgroundColor = THEME.background.primary
    borderColor = THEME.border.processing
    boxShadow = THEME.glow.processing
    animationName = 'subtleBreathe 2s ease-in-out infinite'
  } else if (peeking || isHovered) {
    currentWidth = expandedWidth
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
    padding: `0 ${PILL_PADDING_X}px`,
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
        <>
          {modeDotColor && <ModeDot color={modeDotColor} />}
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

          {modeGlyph && <ModeGlyph icon={modeGlyph} />}

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
        </>
      )
    }

    if (anyRecording) {
      return (
        <>
          {modeDotColor && <ModeDot color={modeDotColor} />}
          <AudioBars volumeHistory={volumeHistory} barColor={AUDIO_BAR_COLOR} />
          {modeGlyph && <ModeGlyph icon={modeGlyph} />}
        </>
      )
    }

    if (isProcessing) {
      return (
        <>
          {modeDotColor && <ModeDot color={modeDotColor} />}
          <ProcessingBars color={AUDIO_BAR_COLOR} />
          {modeGlyph && <ModeGlyph icon={modeGlyph} />}
        </>
      )
    }

    if (peeking && peekMode) {
      // L'aperçu écrit le NOM du mode : contrairement à la dictée, où l'icône
      // suffit parce qu'on vient de choisir le mode soi-même, le cycle au
      // raccourci atterrit sur un mode qu'on ne connaît pas encore.
      const peekDotColor =
        peekMode.modeColor ?? modeColor(peekMode.modeId, modes)
      return (
        <>
          {peekDotColor && <ModeDot color={peekDotColor} />}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 500,
              lineHeight: 1,
              color: THEME.accent.foreground,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: `${PEEK_NAME_MAX_WIDTH}px`,
            }}
          >
            {peekMode.modeName}
          </span>
          {peekMode.modeIcon && <ModeGlyph icon={peekMode.modeIcon} />}
        </>
      )
    }

    if (isHovered) {
      return (
        <>
          {/* Le mode se lit au repos comme pendant la dictée : même pastille,
              même icône, même largeur — la pill ne change pas de forme entre
              les deux, elle ne fait qu'animer ses barres. */}
          {modeDotColor && <ModeDot color={modeDotColor} />}
          <PreviewAudioBars />
          {modeGlyph && <ModeGlyph icon={modeGlyph} />}
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
            {/* Le contenu garde sa largeur naturelle (`max-content`, jamais
                comprimé) : c'est lui qu'on mesure, et la pill qui s'y adapte. */}
            <div
              ref={contentRef}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: `${PILL_GAP}px`,
                width: 'max-content',
                flexShrink: 0,
              }}
            >
              {renderContent()}
            </div>
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
