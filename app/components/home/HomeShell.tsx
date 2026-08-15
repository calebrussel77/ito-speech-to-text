import {
  Home,
  BookOpen,
  FileText,
  CogFour,
  InfoCircle,
  Sparkles,
  Chip,
} from '@mynaui/icons-react'
import type { ReactNode } from 'react'
import { ItoIcon } from '../icons/ItoIcon'
import { useMainStore } from '@/app/store/useMainStore'
import { useAudioStore } from '@/app/store/useAudioStore'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import { formatChord, formatChordDetailed } from '@/app/utils/keyboard'
import { Kbd } from '@/app/components/ui/kbd'
import type { KeyName } from '@/lib/types/keyboard'

type PageKey =
  | 'home'
  | 'modes'
  | 'models'
  | 'dictionary'
  | 'notes'
  | 'settings'
  | 'about'

const NAV: {
  key: PageKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'modes', label: 'Modes', icon: Sparkles },
  { key: 'models', label: 'Models', icon: Chip },
  { key: 'dictionary', label: 'Dictionary', icon: BookOpen },
  { key: 'notes', label: 'Notes', icon: FileText },
  { key: 'settings', label: 'Settings', icon: CogFour },
  { key: 'about', label: 'About', icon: InfoCircle },
]

/**
 * Coquille du dashboard : sidebar repliable à gauche, contenu dans un panneau
 * bordé à droite. Le repli est piloté depuis la titlebar (`navExpanded`), pas
 * depuis la sidebar elle-même — un bouton de repli placé dans le panneau qu'il
 * replie disparaît avec lui.
 */
export default function HomeShell({
  currentPage,
  setCurrentPage,
  isPro,
  children,
}: {
  currentPage: PageKey
  setCurrentPage: (page: PageKey) => void
  isPro: boolean
  children: ReactNode
}) {
  const { navExpanded } = useMainStore()
  const isRecording = useAudioStore(s => s.isRecording)
  const { keyboardShortcuts } = useSettingsStore()
  const platform = usePlatform()
  const groqApiKey = useAdvancedSettingsStore(s => s.groqApiKey)

  // L'accord du raccourci par défaut s'il existe, sinon celui de Voice to text
  // — la barre latérale annonce ce qu'une pression déclenche, et depuis que le
  // raccourci par défaut existe, c'est lui qui répond en premier.
  const keys = (
    keyboardShortcuts.find(s => s.modeId === null) ??
    keyboardShortcuts.find(s => s.modeId === 'voice-to-text')
  )?.keys as KeyName[] | undefined

  const canDictate = !!groqApiKey?.trim()
  const statusLabel = isRecording
    ? 'Listening'
    : canDictate
      ? 'Ready'
      : 'Setup needed'
  const dotClass = isRecording
    ? 'animate-pulse-soft bg-foreground'
    : canDictate
      ? 'bg-[var(--positive)]'
      : 'bg-[var(--border-strong)]'

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground font-sans select-none">
      {/* Sidebar */}
      <aside
        className={`${
          navExpanded ? 'w-[196px]' : 'w-[52px]'
        } flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out`}
      >
        <div
          className={`flex h-8 items-center gap-2 ${navExpanded ? 'px-3' : 'justify-center px-0'}`}
        >
          <ItoIcon
            className="w-[15px] shrink-0 text-foreground"
            style={{ height: '18px' }}
          />
          {navExpanded && (
            <>
              <span className="font-heading text-[13px] font-semibold tracking-tight">
                ito
              </span>
              {isPro && (
                <span className="ml-auto rounded-full border border-border px-1.5 py-[1px] font-mono text-[8px] font-medium tracking-[0.12em] text-[var(--muted-foreground)]">
                  PRO
                </span>
              )}
            </>
          )}
        </div>

        <nav className="mt-3 flex flex-col gap-px px-2">
          {NAV.map(({ key, label, icon: Icon }) => {
            const isActive = key === currentPage
            return (
              <button
                key={key}
                onClick={() => setCurrentPage(key)}
                aria-current={isActive ? 'page' : undefined}
                title={navExpanded ? undefined : label}
                className={`flex items-center gap-2 rounded-lg py-1.5 text-xs transition-colors duration-150 ${
                  navExpanded ? 'px-2' : 'justify-center px-0'
                } ${
                  isActive
                    ? 'bg-[var(--surface-3)] text-foreground'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--surface-2)] hover:text-foreground'
                }`}
              >
                <Icon className="h-[15px] w-[15px] shrink-0" />
                {navExpanded && label}
              </button>
            )
          })}
        </nav>

        <div className="flex-1" />

        {/* État de dictée. Le point passe du gris de bordure au blanc plein et
            se met à pulser pendant l'enregistrement. Au repos il est vert dès
            qu'Ito peut réellement dicter — la clé Groq est le seul verrou :
            sans elle `LocalTranscriptionService.initialize()` lève, alors que
            le micro et le raccourci ont des défauts qui fonctionnent. Sans
            clé, le libellé ne peut pas dire « Ready » sans mentir. */}
        <div className="px-2 pb-2">
          {navExpanded ? (
            <div
              className={`flex items-center justify-between rounded-lg border px-2 py-1.5 transition-colors ${
                isRecording
                  ? 'border-[var(--border-strong)] bg-[var(--surface-3)]'
                  : 'border-border bg-[var(--surface)]'
              }`}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                {statusLabel}
              </span>
              {keys?.length ? (
                <Kbd title={formatChordDetailed(keys, platform)}>
                  {formatChord(keys, platform)}
                </Kbd>
              ) : null}
            </div>
          ) : (
            <div className="flex justify-center py-1.5" title={statusLabel}>
              <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            </div>
          )}
        </div>
      </aside>

      {/* Panneau de contenu — bordé et détaché du fond, comme la référence. */}
      <main className="mr-1.5 mb-1.5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-[var(--surface)]">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </main>
    </div>
  )
}
