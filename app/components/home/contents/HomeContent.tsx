import React, { useCallback, useEffect, useState } from 'react'
import {
  ChartNoAxesColumn,
  InfoCircle,
  Copy,
  Check,
  Download,
  Trash,
} from '@mynaui/icons-react'
import { EXTERNAL_LINKS } from '@/lib/constants/external-links'
import { useSettingsStore } from '../../../store/useSettingsStore'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../ui/tooltip'
import { useAuthStore } from '@/app/store/useAuthStore'
import { Interaction } from '@/lib/main/sqlite/models'
import { TotalWordsIcon } from '../../icons/TotalWordsIcon'
import { SpeedIcon } from '../../icons/SpeedIcon'
import {
  STREAK_MESSAGES,
  SPEED_MESSAGES,
  TOTAL_WORDS_MESSAGES,
  getStreakLevel,
  getSpeedLevel,
  getTotalWordsLevel,
  getActivityMessage,
} from './activityMessages'
import { ItoMode } from '@/app/generated/ito_pb'
import { getKeyDisplay } from '@/app/utils/keyboard'
import { createStereo48kWavFromMonoPCM } from '@/app/utils/audioUtils'
import { KeyName } from '@/lib/types/keyboard'
import { usePlatform } from '@/app/hooks/usePlatform'
import { ProUpgradeDialog } from '../ProUpgradeDialog'
import useBillingState from '@/app/hooks/useBillingState'

// Interface for interaction statistics
interface InteractionStats {
  streakDays: number
  totalWords: number
  averageWPM: number
}

const StatCard = ({
  title,
  value,
  description,
  icon,
}: {
  title: string
  value: string
  description: string
  icon: React.ReactNode
}) => {
  return (
    <div className="flex flex-col p-4 w-1/3 border border-border bg-card/50 backdrop-blur-sm rounded-xl gap-4 shadow-sm transition-all duration-300 hover:bg-card/80 hover:shadow-lg hover:border-border/80 hover:-translate-y-0.5 relative overflow-hidden group">
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="flex flex-row items-center relative z-10">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-muted-foreground">
            {title}
          </div>
          <div className="font-heading font-bold text-lg text-foreground">
            {value}
          </div>
        </div>
        <div className="flex flex-col items-end flex-1">{icon}</div>
      </div>
      <div className="w-full text-xs text-muted-foreground relative z-10">
        {description}
      </div>
    </div>
  )
}

interface HomeContentProps {
  isStartingTrial?: boolean
}

export default function HomeContent({
  isStartingTrial = false,
}: HomeContentProps) {
  const { getItoModeShortcuts } = useSettingsStore()
  const keyboardShortcut = getItoModeShortcuts(ItoMode.TRANSCRIBE)[0].keys
  const { user } = useAuthStore()
  const firstName = user?.name?.split(' ')[0]
  const platform = usePlatform()
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(true)
  const [isClearingAll, setIsClearingAll] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [isRetryingPending, setIsRetryingPending] = useState(false)
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set())
  const [openTooltipKey, setOpenTooltipKey] = useState<string | null>(null)
  const [stats, setStats] = useState<InteractionStats>({
    streakDays: 0,
    totalWords: 0,
    averageWPM: 0,
  })
  const [showProDialog, setShowProDialog] = useState(false)
  const billingState = useBillingState()

  // Persist "has shown trial dialog" flag in electron-store to survive remounts
  const [hasShownTrialDialog, setHasShownTrialDialogState] = useState(() => {
    try {
      const authStore = window.electron?.store?.get('auth') || {}
      const value = authStore?.hasShownTrialDialog === true
      return value
    } catch {
      return false
    }
  })

  const setHasShownTrialDialog = useCallback((value: boolean) => {
    try {
      setHasShownTrialDialogState(value)
      window.api.send('electron-store-set', 'auth.hasShownTrialDialog', value)
    } catch {
      console.warn('Failed to persist hasShownTrialDialog flag')
    }
  }, [])

  // Show trial dialog when trial starts
  useEffect(() => {
    if (
      billingState.isTrialActive &&
      billingState.proStatus === 'free_trial' &&
      !hasShownTrialDialog &&
      !billingState.isLoading
    ) {
      setShowProDialog(true)
      setHasShownTrialDialog(true)
    }
  }, [
    billingState.isTrialActive,
    billingState.proStatus,
    billingState.isLoading,
    isStartingTrial,
    hasShownTrialDialog,
    setHasShownTrialDialog,
  ])

  // Listen for trial start event to refresh billing state
  useEffect(() => {
    const offTrialStarted = window.api.on('trial-started', async () => {
      await billingState.refresh()
    })

    const offBillingSuccess = window.api.on(
      'billing-session-completed',
      async () => {
        await billingState.refresh()
      },
    )

    return () => {
      offTrialStarted?.()
      offBillingSuccess?.()
    }
  }, [billingState])

  // Reset dialog flag when trial is no longer active or user becomes pro
  // Only reset if we're certain the trial has ended (not just during loading/refreshing)
  useEffect(() => {
    if (billingState.isLoading) {
      // Don't reset during loading to avoid race conditions
      return
    }

    const shouldReset =
      billingState.proStatus === 'active_pro' ||
      (billingState.proStatus === 'none' && !billingState.isTrialActive)

    if (shouldReset && hasShownTrialDialog) {
      setHasShownTrialDialog(false)
    }
  }, [
    billingState.proStatus,
    billingState.isTrialActive,
    billingState.isLoading,
    hasShownTrialDialog,
    setHasShownTrialDialog,
  ])

  // Calculate statistics from interactions
  const calculateStats = useCallback(
    (interactions: Interaction[]): InteractionStats => {
      if (interactions.length === 0) {
        return { streakDays: 0, totalWords: 0, averageWPM: 0 }
      }

      // Calculate streak (consecutive days with interactions)
      const streakDays = calculateStreak(interactions)

      // Calculate total words from transcripts
      const totalWords = calculateTotalWords(interactions)

      // Calculate average WPM (estimate based on average speaking rate)
      const averageWPM = calculateAverageWPM(interactions)

      return { streakDays, totalWords, averageWPM }
    },
    [],
  )

  const calculateStreak = (interactions: Interaction[]): number => {
    if (interactions.length === 0) return 0

    // Group interactions by date
    const dateGroups = new Map<string, Interaction[]>()
    interactions.forEach(interaction => {
      const date = new Date(interaction.created_at).toDateString()
      if (!dateGroups.has(date)) {
        dateGroups.set(date, [])
      }
      dateGroups.get(date)!.push(interaction)
    })

    // Sort dates in descending order (most recent first)
    const sortedDates = Array.from(dateGroups.keys()).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    )

    let streak = 0
    const today = new Date()

    for (let i = 0; i < sortedDates.length; i++) {
      const currentDate = new Date(sortedDates[i])
      const expectedDate = new Date(today)
      expectedDate.setDate(today.getDate() - i)

      // Check if current date matches expected date (allowing for today or previous consecutive days)
      if (currentDate.toDateString() === expectedDate.toDateString()) {
        streak++
      } else {
        break
      }
    }

    return streak
  }

  const calculateTotalWords = (interactions: Interaction[]): number => {
    return interactions.reduce((total, interaction) => {
      const transcript = interaction.asr_output?.transcript?.trim()
      if (transcript) {
        // Count words by splitting on whitespace and filtering out empty strings
        const words = transcript.split(/\s+/).filter(word => word.length > 0)
        return total + words.length
      }
      return total
    }, 0)
  }

  const calculateAverageWPM = (interactions: Interaction[]): number => {
    const validInteractions = interactions.filter(
      interaction =>
        interaction.asr_output?.transcript?.trim() && interaction.duration_ms,
    )

    if (validInteractions.length === 0) return 0

    let totalWords = 0
    let totalDurationMs = 0

    validInteractions.forEach(interaction => {
      const transcript = interaction.asr_output?.transcript?.trim()
      if (transcript && interaction.duration_ms) {
        // Count words by splitting on whitespace and filtering out empty strings
        const words = transcript.split(/\s+/).filter(word => word.length > 0)
        totalWords += words.length
        totalDurationMs += interaction.duration_ms
      }
    })

    if (totalDurationMs === 0) return 0

    // Calculate WPM: (total words / total duration in minutes)
    const totalMinutes = totalDurationMs / (1000 * 60)
    const wpm = totalWords / totalMinutes

    // Round to nearest integer and ensure it's reasonable
    return Math.round(Math.max(1, wpm))
  }

  const formatStreakText = (days: number): string => {
    if (days === 0) return '0 days'
    if (days === 1) return '1 day'
    if (days < 7) return `${days} days`
    if (days < 14) return '1 week'
    if (days < 30) return `${Math.floor(days / 7)} weeks`
    if (days < 60) return '1 month'
    return `${Math.floor(days / 30)} months`
  }

  const loadInteractions = useCallback(async () => {
    try {
      const allInteractions = await window.api.interactions.getAll()

      // Sort by creation date (newest first) - remove the slice(0, 10) to show all interactions
      const sortedInteractions = allInteractions.sort(
        (a: Interaction, b: Interaction) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      setInteractions(sortedInteractions)

      // Calculate and set statistics
      const calculatedStats = calculateStats(sortedInteractions)
      setStats(calculatedStats)
    } catch (error) {
      console.error('Failed to load interactions:', error)
    } finally {
      setLoading(false)
    }
  }, [calculateStats])

  useEffect(() => {
    loadInteractions()

    // Listen for new interactions
    const handleInteractionCreated = () => {
      loadInteractions()
    }

    const unsubscribe = window.api.on(
      'interaction-created',
      handleInteractionCreated,
    )

    // Cleanup listener on unmount
    return unsubscribe
  }, [loadInteractions])

  // Track failed dictations waiting on disk for a network retry
  useEffect(() => {
    window.api.pendingDictations
      .count()
      .then(setPendingCount)
      .catch(() => {})

    const unsubscribe = window.api.on(
      'pending-dictations-update',
      (payload: { count: number }) => setPendingCount(payload.count),
    )

    // When the network comes back, resume recovery right away instead of
    // waiting for the next app start or successful dictation.
    const handleOnline = () => {
      window.api.pendingDictations.retry().catch(() => {})
    }
    window.addEventListener('online', handleOnline)

    return () => {
      unsubscribe()
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  const handleRetryPending = async () => {
    setIsRetryingPending(true)
    try {
      await window.api.pendingDictations.retry()
    } catch (error) {
      console.error('Failed to retry pending dictations:', error)
    } finally {
      setIsRetryingPending(false)
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)

    const isToday = date.toDateString() === today.toDateString()
    const isYesterday = date.toDateString() === yesterday.toDateString()

    if (isToday) return 'TODAY'
    if (isYesterday) return 'YESTERDAY'

    return date
      .toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
      .toUpperCase()
  }

  const groupInteractionsByDate = (interactions: Interaction[]) => {
    const groups: { [key: string]: Interaction[] } = {}

    interactions.forEach(interaction => {
      const dateKey = formatDate(interaction.created_at)
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(interaction)
    })

    return groups
  }

  const getDisplayText = (
    interaction: Interaction,
  ): {
    text: string
    isError: boolean
    tone: 'ok' | 'error' | 'pending'
    tooltip: string | null
  } => {
    // Check for errors first
    if (interaction.asr_output?.error) {
      // A pending dictation still has its audio on disk: it is queued, not
      // lost, so it gets a warning tone rather than the destructive one.
      if (interaction.asr_output?.pending) {
        return {
          text: 'Waiting for network — will retry automatically',
          isError: true,
          tone: 'pending',
          tooltip: `Transcription failed (${interaction.asr_output.error}). The audio is saved and will be transcribed as soon as the connection is back.`,
        }
      }

      // Prefer precise error code mapping when available
      const code = interaction.asr_output?.errorCode
      if (code === 'CLIENT_TRANSCRIPTION_QUALITY_ERROR') {
        return {
          text: 'Audio quality too low',
          isError: true,
          tone: 'error',
          tooltip:
            'Audio quality was too low to generate a reliable transcript',
        }
      }
      if (
        interaction.asr_output.error.includes('No speech detected in audio.') ||
        interaction.asr_output.error.includes('Unable to transcribe audio.')
      ) {
        return {
          text: 'Audio is silent',
          isError: true,
          tone: 'error',
          tooltip: "Ito didn't detect any words so the transcript is empty",
        }
      }
      return {
        text: 'Transcription failed',
        isError: true,
        tone: 'error',
        tooltip: interaction.asr_output.error,
      }
    }

    // Check for empty transcript
    const transcript = interaction.asr_output?.transcript?.trim()

    if (!transcript) {
      return {
        text: 'Audio is silent.',
        isError: true,
        tone: 'error',
        tooltip: "Ito didn't detect any words so the transcript is empty",
      }
    }

    // Return the actual transcript
    return {
      text: transcript,
      isError: false,
      tone: 'ok',
      tooltip: null,
    }
  }

  const handleDeleteInteraction = async (interactionId: string) => {
    try {
      await window.api.interactions.delete(interactionId)
      setInteractions(prev => prev.filter(i => i.id !== interactionId))
    } catch (error) {
      console.error('Failed to delete interaction:', error)
    }
  }

  const handleClearAllInteractions = async () => {
    if (loading || interactions.length === 0 || isClearingAll) return

    const confirmed = window.confirm(
      'Clear all transcriptions?\n\nThis will remove everything in Recent activity and cannot be undone.',
    )
    if (!confirmed) return

    try {
      setIsClearingAll(true)
      setOpenTooltipKey(null)
      await window.api.interactions.clearAll()
      setInteractions([])
      setStats({
        streakDays: 0,
        totalWords: 0,
        averageWPM: 0,
      })
    } catch (error) {
      console.error('Failed to clear interactions:', error)
    } finally {
      setIsClearingAll(false)
    }
  }

  const groupedInteractions = groupInteractionsByDate(interactions)

  const copyToClipboard = async (text: string, interactionId: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedItems(prev => new Set(prev).add(interactionId))
      setOpenTooltipKey(`copy:${interactionId}`) // Keep tooltip open

      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev)
          newSet.delete(interactionId)
          return newSet
        })
        // Close tooltip if it's still open for this item (do not override if user hovered elsewhere)
        setOpenTooltipKey(prev =>
          prev === `copy:${interactionId}` ? null : prev,
        )
      }, 2000)
    } catch (error) {
      console.error('Failed to copy text:', error)
    }
  }

  const handleAudioDownload = async (interaction: Interaction) => {
    try {
      if (!interaction.raw_audio) {
        console.warn('No audio data available for download')
        return
      }

      const pcmData = new Uint8Array(interaction.raw_audio)
      // Convert raw PCM to WAV format
      const wavBuffer = createStereo48kWavFromMonoPCM(
        pcmData,
        interaction.sample_rate || 16000,
        48000,
      )
      const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' })
      const audioUrl = URL.createObjectURL(audioBlob)

      // Format filename with timestamp (YYYYMMDD_HHMMSS)
      const date = new Date(interaction.created_at)
      const timestamp = date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .slice(0, 15)
      const filename = `ito-recording-${timestamp}.wav`

      // Create temporary link and trigger download
      const link = document.createElement('a')
      link.href = audioUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Clean up the blob URL
      URL.revokeObjectURL(audioUrl)
    } catch (error) {
      console.error('Failed to download audio:', error)
    }
  }

  return (
    <div className="w-full h-full flex flex-col font-sans">
      {/* Fixed Header Content */}
      <div className="flex-shrink-0 px-24">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-heading font-semibold tracking-tight text-foreground">
              Welcome back{firstName ? `, ${firstName}!` : '!'}
            </h1>
          </div>
        </div>
        <div className="flex gap-4 w-full mb-6">
          <div className="flex w-full items-center text-sm text-gray-700 gap-2">
            <StatCard
              title="Weekly Streak"
              value={formatStreakText(stats.streakDays)}
              description={getActivityMessage(
                STREAK_MESSAGES,
                getStreakLevel(stats.streakDays),
              )}
              icon={
                <div className="p-2.5 bg-blue-500/10 dark:bg-blue-500/15 rounded-xl">
                  <ChartNoAxesColumn
                    className="w-5 h-5 text-blue-500 dark:text-blue-400"
                    strokeWidth={2.5}
                  />
                </div>
              }
            />
            <StatCard
              title="Average Speed"
              value={`${stats.averageWPM} words / minute`}
              description={getActivityMessage(
                SPEED_MESSAGES,
                getSpeedLevel(stats.averageWPM),
              )}
              icon={
                <div className="p-2.5 bg-emerald-500/10 dark:bg-emerald-500/15 rounded-xl">
                  <SpeedIcon className="text-emerald-500 dark:text-emerald-400" />
                </div>
              }
            />
            <StatCard
              title="Total Words"
              value={`${stats.totalWords} ${stats.totalWords === 1 ? 'word' : 'words'}`}
              description={getActivityMessage(
                TOTAL_WORDS_MESSAGES,
                getTotalWordsLevel(stats.totalWords),
              )}
              icon={
                <div className="p-2.5 bg-amber-500/10 dark:bg-amber-500/15 rounded-xl">
                  <TotalWordsIcon className="text-amber-500 dark:text-amber-400" />
                </div>
              }
            />
          </div>
        </div>

        {/* Dictation Info Box */}
        <div className="glass-card rounded-xl p-6 flex items-center justify-between mb-10 transition-all duration-300 hover:shadow-lg relative overflow-hidden group">
          {/* Subtle gradient glow on hover */}
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="relative z-10">
            <div className="text-base font-medium mb-1 font-heading text-foreground">
              Voice dictation in any app
            </div>
            <div className="text-sm text-muted-foreground">
              <span key="hold-down">Hold down the trigger key </span>
              {keyboardShortcut.map((key, index) => (
                <React.Fragment key={index}>
                  <span className="bg-muted/80 dark:bg-muted px-1.5 py-0.5 rounded text-xs font-mono shadow-sm border border-border/50 dark:border-border text-foreground">
                    {getKeyDisplay(key as KeyName, platform, {
                      showDirectionalText: false,
                      format: 'label',
                    })}
                  </span>
                  <span>{index < keyboardShortcut.length - 1 && ' + '}</span>
                </React.Fragment>
              ))}
              <span key="and"> and speak into any textbox</span>
            </div>
          </div>
          <button
            className="relative z-10 bg-foreground dark:bg-white/95 text-background dark:text-[hsl(225_15%_10%)] px-6 py-2.5 rounded-full font-semibold text-sm hover:opacity-90 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-[1.02] cursor-pointer"
            onClick={() =>
              window.api?.invoke('web-open-url', EXTERNAL_LINKS.WEBSITE)
            }
          >
            Explore use cases
          </button>
        </div>

        {/* Pending dictations banner — failed transcriptions waiting for network */}
        {pendingCount > 0 && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center gap-2.5 text-sm text-amber-600 dark:text-amber-400">
              <InfoCircle className="w-4 h-4 shrink-0" />
              <span>
                {pendingCount} dictation{pendingCount > 1 ? 's' : ''} could not
                be transcribed and {pendingCount > 1 ? 'are' : 'is'} waiting for
                the network — recovery will resume automatically.
              </span>
            </div>
            <button
              className="shrink-0 rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleRetryPending}
              disabled={isRetryingPending}
            >
              {isRetryingPending ? 'Retrying…' : 'Retry now'}
            </button>
          </div>
        )}

        {/* Recent Activity Header */}
        <div className="mb-4 pl-1 flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">
            Recent activity
          </div>
          <Tooltip
            open={openTooltipKey === 'clear-all'}
            onOpenChange={open => setOpenTooltipKey(open ? 'clear-all' : null)}
          >
            <TooltipTrigger asChild>
              <button
                className="p-1.5 hover:bg-destructive/10 rounded transition-colors cursor-pointer text-destructive/80 hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handleClearAllInteractions}
                disabled={loading || interactions.length === 0 || isClearingAll}
              >
                <Trash className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={5}>
              {isClearingAll ? 'Clearing…' : 'Clear all transcriptions'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Scrollable Recent Activity Section */}
      <div className="flex-1 px-24">
        {loading ? (
          <div className="glass-card rounded-lg p-8 text-center text-muted-foreground">
            Loading recent activity...
          </div>
        ) : interactions.length === 0 ? (
          <div className="glass-card rounded-lg p-8 text-center text-muted-foreground">
            <p className="text-sm">No interactions yet</p>
            <p className="text-xs mt-1 opacity-70">
              Try using voice dictation by pressing{' '}
              {keyboardShortcut.join(' + ')}
            </p>
          </div>
        ) : (
          Object.entries(groupedInteractions).map(
            ([dateLabel, dateInteractions]) => (
              <div key={dateLabel} className="mb-6">
                <div className="text-xs font-semibold text-muted-foreground mb-3 pl-1 tracking-wider uppercase">
                  {dateLabel}
                </div>
                <div className="glass-card rounded-lg divide-y divide-border/50 overflow-hidden">
                  {dateInteractions.map(interaction => {
                    const displayInfo = getDisplayText(interaction)

                    return (
                      <div
                        key={interaction.id}
                        className="flex items-center justify-between px-6 py-4 gap-10 hover:bg-secondary/40 transition-colors duration-200 group"
                      >
                        <div className="flex items-center gap-10">
                          <div className="text-muted-foreground text-xs min-w-[60px] font-medium">
                            {formatTime(interaction.created_at)}
                          </div>
                          <div
                            className={`${
                              displayInfo.tone === 'pending'
                                ? 'text-amber-600 dark:text-amber-400'
                                : displayInfo.isError
                                  ? 'text-destructive'
                                  : 'text-foreground'
                            } flex items-center gap-2`}
                          >
                            {displayInfo.text}
                            {displayInfo.tooltip && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <InfoCircle className="w-4 h-4 text-gray-400" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  {displayInfo.tooltip}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>

                        {/* Copy, Download, and Play buttons - only show on hover or when playing */}
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          {/* Copy button */}
                          {!displayInfo.isError && (
                            <Tooltip
                              open={openTooltipKey === `copy:${interaction.id}`}
                              onOpenChange={open => {
                                if (open) {
                                  // Opening: exclusively show this tooltip
                                  setOpenTooltipKey(`copy:${interaction.id}`)
                                } else {
                                  // Closing: if in copied state, keep it open until timer clears,
                                  // otherwise close normally
                                  if (!copiedItems.has(interaction.id)) {
                                    setOpenTooltipKey(prev =>
                                      prev === `copy:${interaction.id}`
                                        ? null
                                        : prev,
                                    )
                                  }
                                }
                              }}
                            >
                              <TooltipTrigger asChild>
                                <button
                                  className={`p-1.5 hover:bg-secondary rounded transition-colors cursor-pointer ${
                                    copiedItems.has(interaction.id)
                                      ? 'text-emerald-500'
                                      : 'text-muted-foreground hover:text-foreground'
                                  }`}
                                  onClick={() =>
                                    copyToClipboard(
                                      displayInfo.text,
                                      interaction.id,
                                    )
                                  }
                                >
                                  {copiedItems.has(interaction.id) ? (
                                    <Check className="w-4 h-4" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={5}>
                                {copiedItems.has(interaction.id)
                                  ? 'Copied 🎉'
                                  : 'Copy'}
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {/* Download button */}
                          {interaction.raw_audio && (
                            <Tooltip
                              open={
                                openTooltipKey === `download:${interaction.id}`
                              }
                              onOpenChange={open => {
                                setOpenTooltipKey(
                                  open ? `download:${interaction.id}` : null,
                                )
                              }}
                            >
                              <TooltipTrigger asChild>
                                <button
                                  className="p-1.5 hover:bg-secondary rounded transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    handleAudioDownload(interaction)
                                  }
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={5}>
                                Download audio
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {/* Delete button */}
                          <Tooltip
                            open={openTooltipKey === `delete:${interaction.id}`}
                            onOpenChange={open => {
                              setOpenTooltipKey(
                                open ? `delete:${interaction.id}` : null,
                              )
                            }}
                          >
                            <TooltipTrigger asChild>
                              <button
                                className="p-1.5 hover:bg-destructive/10 rounded transition-colors cursor-pointer text-destructive/80 hover:text-destructive"
                                onClick={() =>
                                  handleDeleteInteraction(interaction.id)
                                }
                              >
                                <Trash className="w-4 h-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={5}>
                              Delete transcription
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ),
          )
        )}
      </div>

      {/* Pro Upgrade Dialog */}
      <ProUpgradeDialog open={showProDialog} onOpenChange={setShowProDialog} />
    </div>
  )
}
