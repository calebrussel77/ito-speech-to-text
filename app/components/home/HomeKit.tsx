import { useMainStore } from '@/app/store/useMainStore'
import { useUserMetadataStore } from '@/app/store/useUserMetadataStore'
import { useOnboardingStore } from '@/app/store/useOnboardingStore'
import { useAuth } from '@/app/components/auth/useAuth'
import useBillingState from '@/app/hooks/useBillingState'
import { PaidStatus } from '@/lib/main/sqlite/models'
import { useEffect, useState, useRef } from 'react'
import HomeShell from './HomeShell'
import HomeContent from './contents/HomeContent'
import DictionaryContent from './contents/DictionaryContent'
import NotesContent from './contents/NotesContent'
import SettingsContent from './contents/SettingsContent'
import AboutContent from './contents/AboutContent'

export default function HomeKit() {
  const { currentPage, setCurrentPage } = useMainStore()
  const { metadata } = useUserMetadataStore()
  const { onboardingCompleted } = useOnboardingStore()
  const { isAuthenticated, user } = useAuth()
  const billingState = useBillingState()
  const hasStartedTrialRef = useRef(false)
  const previousUserIdRef = useRef<string | undefined>(undefined)
  const [isStartingTrial, setIsStartingTrial] = useState(false)

  const isPro =
    metadata?.paid_status === PaidStatus.PRO ||
    metadata?.paid_status === PaidStatus.PRO_TRIAL ||
    billingState.proStatus === 'active_pro' ||
    billingState.proStatus === 'free_trial'

  // Reset flags when user changes
  useEffect(() => {
    const currentUserId = user?.id
    const previousUserId = previousUserIdRef.current

    if (currentUserId && currentUserId !== previousUserId) {
      // User changed - reset trial start flag
      hasStartedTrialRef.current = false
      setIsStartingTrial(false)
      previousUserIdRef.current = currentUserId
    } else if (currentUserId && previousUserId === undefined) {
      // First time setting userId
      previousUserIdRef.current = currentUserId
    }
  }, [user?.id])

  // Start trial for users who don't have one yet
  // Case 1: New users after onboarding completes
  // Case 2: Existing users who completed onboarding but haven't started trial yet
  useEffect(() => {
    // Skip if still loading billing state or not authenticated
    if (billingState.isLoading || !isAuthenticated) return

    // Only proceed if onboarding is completed
    if (!onboardingCompleted) return

    // Check if user has a trial or subscription
    const hasTrialOrSubscription =
      billingState.proStatus === 'free_trial' ||
      billingState.proStatus === 'active_pro' ||
      isPro

    // Start trial if:
    // 1. User hasn't started trial yet (tracked by ref)
    // 2. User doesn't have a trial or subscription
    // 3. User has completed onboarding
    if (!hasStartedTrialRef.current && !hasTrialOrSubscription) {
      hasStartedTrialRef.current = true
      setIsStartingTrial(true) // Set flag to indicate trial is being started
      // Start trial
      window.api.trial.startAfterOnboarding().catch(err => {
        console.error('Failed to start trial:', err)
        // Reset flag so we can retry if needed
        hasStartedTrialRef.current = false
        setIsStartingTrial(false)
      })
    }
  }, [
    onboardingCompleted,
    isAuthenticated,
    billingState.isLoading,
    billingState.proStatus,
    isPro,
  ])

  // Listen for trial-started event to refresh billing state
  useEffect(() => {
    const offTrialStarted = window.api.on('trial-started', async () => {
      // Trial started successfully - refresh billing state
      // HomeContent will handle showing the dialog based on billing state transition
      await billingState.refresh()
      setIsStartingTrial(false) // Reset flag after trial starts
    })

    return () => {
      offTrialStarted?.()
    }
  }, [billingState])

  // Reset trial start flag when onboarding resets
  useEffect(() => {
    if (!onboardingCompleted) {
      hasStartedTrialRef.current = false
      setIsStartingTrial(false)
    }
  }, [onboardingCompleted])

  // Listen for billing deep-link events and finalize subscription
  useEffect(() => {
    const offSuccess = window.api.on(
      'billing-session-completed',
      async (sessionId: string) => {
        try {
          if (sessionId) {
            await window.api.billing.confirmSession(sessionId)
          }
          // Ensure trial is completed locally and on server
          await window.api.trial.complete()
        } catch (err) {
          console.error('Failed to finalize billing session', err)
        }
      },
    )

    const offCancel = window.api.on('billing-session-cancelled', () => {
      // No-op for now; could show a toast in the future
    })

    return () => {
      offSuccess?.()
      offCancel?.()
    }
  }, [])

  // Render the appropriate content based on current page
  const renderContent = () => {
    switch (currentPage) {
      case 'home':
        return <HomeContent isStartingTrial={isStartingTrial} />
      case 'dictionary':
        return <DictionaryContent />
      case 'notes':
        return <NotesContent />
      case 'settings':
        return <SettingsContent />
      case 'about':
        return <AboutContent />
      default:
        return <HomeContent />
    }
  }

  return (
    <HomeShell
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      isPro={isPro}
    >
      {renderContent()}
    </HomeShell>
  )
}
