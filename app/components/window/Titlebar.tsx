import { useWindowContext } from './WindowContext'
import React, { useState, useEffect } from 'react'
import { OnboardingTitlebar } from './OnboardingTitlebar'
import { useOnboardingStore } from '@/app/store/useOnboardingStore'
import { PanelLeft, CogFour, Logout } from '@mynaui/icons-react'
import { useMainStore } from '@/app/store/useMainStore'
import { useAuthStore } from '@/app/store/useAuthStore'
import { useAuth } from '@/app/components/auth/useAuth'
import UserAvatar from '@/app/components/UserAvatar'

export const Titlebar = () => {
  const { onboardingCompleted } = useOnboardingStore()
  const { isAuthenticated, user } = useAuthStore()
  const showOnboarding = !onboardingCompleted || !isAuthenticated
  const { toggleNavExpanded, setCurrentPage, setSettingsPage, navExpanded } =
    useMainStore()
  const { logoutUser } = useAuth()
  const wcontext = useWindowContext().window
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false)
  const [isUpdateDownloaded, setUpdateDownloaded] = useState(false)

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = () => {
      setShowUserDropdown(false)
    }

    if (showUserDropdown) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }

    return () => {}
  }, [showUserDropdown])

  useEffect(() => {
    // Check current update status on mount
    window.api.updater.getUpdateStatus().then(status => {
      if (status.updateAvailable) {
        setIsUpdateAvailable(true)
      }
      if (status.updateDownloaded) {
        setUpdateDownloaded(true)
      }
    })

    // Listen for future update events
    window.api.updater.onUpdateAvailable(() => {
      setIsUpdateAvailable(true)
    })

    window.api.updater.onUpdateDownloaded(() => {
      setUpdateDownloaded(true)
    })
  }, [])

  const toggleUserDropdown = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowUserDropdown(!showUserDropdown)
  }

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentPage('settings')
    setSettingsPage('account')
    setShowUserDropdown(false)
  }

  const handleSignOutClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await logoutUser()
    } catch (error) {
      console.error('Logout failed:', error)
    }
    setShowUserDropdown(false)
  }

  // Inline style override for onboarding completed
  const style: React.CSSProperties = onboardingCompleted
    ? {
        position: 'relative' as const,
        borderBottom: 'none',
      }
    : { position: 'relative' as const }

  return (
    <div
      className={`window-titlebar ${wcontext?.platform ? `platform-${wcontext.platform}` : ''}`}
      style={style}
    >
      {/* Repli de la sidebar — collé au bord gauche. Il pilote un panneau
          qu'il ne peut pas habiter : placé dans la sidebar, il disparaîtrait
          avec elle. */}
      {!showOnboarding && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: '8px',
            zIndex: 10,
          }}
        >
          <div
            className="titlebar-action-btn hover:bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-foreground transition-colors w-7 h-6 flex items-center justify-center rounded-md cursor-pointer"
            aria-label="Open Panel"
            aria-pressed={navExpanded}
            tabIndex={0}
            onClick={toggleNavExpanded}
          >
            <PanelLeft style={{ width: 15, height: 15 }} />
          </div>
        </div>
      )}

      {showOnboarding && <OnboardingTitlebar />}

      {!showOnboarding && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            paddingRight: '4px',
            zIndex: 10,
          }}
        >
          {isUpdateAvailable && (
            <button
              className={`titlebar-action-btn bg-primary text-primary-foreground px-3 py-1 rounded-md font-semibold text-xs shadow-sm hover:opacity-90 transition-opacity ${
                isUpdateDownloaded
                  ? 'cursor-pointer'
                  : 'cursor-not-allowed opacity-70'
              }`}
              disabled={!isUpdateDownloaded}
              onClick={() => {
                if (
                  confirm(
                    'Are you sure you want to install the update? The app will restart.',
                  )
                ) {
                  window.api.updater.installUpdate()
                }
              }}
            >
              {isUpdateDownloaded ? 'Update Ready' : 'Downloading...'}
            </button>
          )}
          <div className="relative">
            <div
              className="titlebar-action-btn hover:bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-foreground transition-colors w-7 h-6 flex items-center justify-center rounded-md cursor-pointer"
              aria-label="Account"
              tabIndex={0}
              onClick={toggleUserDropdown}
            >
              <UserAvatar
                name={user?.name}
                email={user?.email}
                id={user?.id}
                size={16}
                className="overflow-hidden rounded-full"
              />
            </div>

            {/* User Dropdown Menu */}
            {showUserDropdown && (
              <div className="absolute top-full right-0 mt-1.5 w-40 glass-card rounded-lg overflow-hidden animate-fade-in z-50">
                <button
                  onClick={handleSettingsClick}
                  className="w-full px-3 py-2 text-left text-xs text-[var(--muted-foreground)] hover:bg-[var(--surface-3)] hover:text-foreground flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <CogFour className="w-3.5 h-3.5" />
                  Settings
                </button>
                <div className="h-px bg-border mx-2"></div>
                <button
                  onClick={handleSignOutClick}
                  className="w-full px-3 py-2 text-left text-xs text-destructive hover:bg-[var(--destructive-soft)] flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Logout className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            )}
          </div>

          {/* Contrôles de fenêtre, à droite — convention Windows. */}
          {wcontext?.platform === 'win32' && <TitlebarControls />}
        </div>
      )}
    </div>
  )
}

const TitlebarControls = () => {
  const closePath =
    'M 0,0 0,0.7 4.3,5 0,9.3 0,10 0.7,10 5,5.7 9.3,10 10,10 10,9.3 5.7,5 10,0.7 10,0 9.3,0 5,4.3 0.7,0 Z'
  const maximizePath = 'M 0,0 0,10 10,10 10,0 Z M 1,1 9,1 9,9 1,9 Z'
  const minimizePath = 'M 0,5 10,5 10,6 0,6 Z'
  const wcontext = useWindowContext().window

  // Ordre Windows : réduire, agrandir, fermer — de gauche à droite.
  // `maximize` ne s'affiche que si la fenêtre est réellement agrandissable ;
  // elle est aujourd'hui à taille fixe, donc le bouton reste masqué plutôt
  // que d'être présent et inerte.
  return (
    <div className="window-titlebar-controls">
      {wcontext?.minimizable && (
        <TitlebarControlButton label="minimize" svgPath={minimizePath} />
      )}
      {wcontext?.maximizable && (
        <TitlebarControlButton label="maximize" svgPath={maximizePath} />
      )}
      <TitlebarControlButton label="close" svgPath={closePath} />
    </div>
  )
}

const TitlebarControlButton = ({
  svgPath,
  label,
}: {
  svgPath: string
  label: string
}) => {
  const handleAction = () => {
    switch (label) {
      case 'minimize':
        window.api.invoke('window-minimize')
        break
      case 'maximize':
        window.api.invoke('window-maximize-toggle')
        break
      case 'close':
        window.api.invoke('window-close')
        break
      default:
        console.warn(`Unhandled action for label: ${label}`)
    }
  }

  return (
    <div
      aria-label={label}
      className="titlebar-controlButton"
      onClick={handleAction}
    >
      <svg width="10" height="10">
        <path fill="currentColor" d={svgPath} />
      </svg>
    </div>
  )
}

export interface TitlebarProps {
  title: string
  titleCentered?: boolean
  icon?: string
}
