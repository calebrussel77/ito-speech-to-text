import { useEffect, useMemo, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { MODE_PRESETS } from '@/lib/constants/modePresets'
import { assignModeColors } from '@/lib/constants/modeColors'
import { Button } from '@/app/components/ui/button'
import { SettingsGroup, SettingsNote } from '@/app/components/ui/settings'
import ModeRow from './modes/ModeRow'
import ModeEditor from './modes/ModeEditor'
import { modeIcon } from '@/app/components/modeIcons'
import type { KeyName } from '@/lib/types/keyboard'

export default function ModesContent() {
  const { modes, activeModeId, loaded, load, create, setActive } =
    useModesStore()
  const { keyboardShortcuts } = useSettingsStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [fileError, setFileError] = useState('')
  const [fileResult, setFileResult] = useState('')
  // Un fichier importé peut être long à transcrire (plusieurs minutes) : sans
  // ce garde-fou, un second clic pendant l'attente rouvrait le sélecteur et
  // lançait une seconde transcription concurrente — deux imports, deux lignes
  // d'historique, aucune exclusion mutuelle nulle part.
  const [transcribingFile, setTranscribingFile] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Une seule attribution pour toute la liste : c'est elle qui garantit que
  // deux modes ne portent pas la même teinte.
  const modeColors = useMemo(() => assignModeColors(modes), [modes])

  const shortcutFor = (modeId: string): KeyName[] | null => {
    const shortcut = keyboardShortcuts.find(s => s.modeId === modeId)
    if (!shortcut?.keys.length) return null
    return shortcut.keys as KeyName[]
  }

  if (editingId) {
    return <ModeEditor modeId={editingId} onBack={() => setEditingId(null)} />
  }

  return (
    <div className="px-1.5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xs font-semibold tracking-tight text-foreground">
            Modes
          </h2>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--subtle-foreground)]">
            A mode decides what a dictation becomes. The active one is what the
            default shortcut and the pill dictate in; a mode with its own
            shortcut is reached directly, whatever is active.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={transcribingFile}
            onClick={async () => {
              setFileError('')
              setFileResult('')
              setTranscribingFile(true)
              try {
                const result = await window.api.transcribeFile()
                if (result.error) {
                  setFileError(result.error)
                } else if (result.ok) {
                  // Sans ça, rien ne disait où la transcription avait atterri
                  // ni ce qu'elle avait trouvé — le bouton se contentait de
                  // redevenir cliquable.
                  const speakers = result.speakerCount ?? 0
                  setFileResult(
                    speakers >= 2
                      ? `Transcribed — ${speakers} speakers, split by voice. It is in History.`
                      : 'Transcribed as a single voice. It is in History.',
                  )
                }
              } finally {
                setTranscribingFile(false)
              }
            }}
          >
            {transcribingFile ? 'Transcribing…' : 'Transcribe a file'}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            Create mode
          </Button>
        </div>
      </div>

      {fileError && (
        <div className="mb-3">
          <SettingsNote tone="error">{fileError}</SettingsNote>
        </div>
      )}

      {transcribingFile && (
        <div className="mb-3">
          {/* Le fichier peut faire une heure : dire qu'on peut partir vaut
              mieux que de laisser regarder un bouton grisé. */}
          <SettingsNote>
            Transcribing — this can take a few minutes. You can leave the app, a
            notification will tell you when it is ready.
          </SettingsNote>
        </div>
      )}

      {fileResult && (
        <div className="mb-3">
          <SettingsNote>{fileResult}</SettingsNote>
        </div>
      )}

      {creating && (
        <SettingsGroup title="Pick a preset">
          <div className="space-y-1 py-1">
            {MODE_PRESETS.map(preset => {
              const Icon = modeIcon(preset.icon)
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={async () => {
                    const mode = await create(preset.key, preset.label)
                    setCreating(false)
                    setEditingId(mode.id)
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-secondary/40"
                >
                  <Icon className="mt-px size-4 shrink-0 text-[var(--muted-foreground)]" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">
                      {preset.label}
                    </span>
                    <span className="block text-[11px] leading-snug text-[var(--subtle-foreground)]">
                      {preset.description}
                    </span>
                  </span>
                </button>
              )
            })}
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </div>
        </SettingsGroup>
      )}

      <div className="space-y-0.5">
        {modes.map(mode => (
          <ModeRow
            key={mode.id}
            mode={mode}
            color={modeColors[mode.id]!}
            isActive={mode.id === activeModeId}
            shortcut={shortcutFor(mode.id)}
            onOpen={() => setEditingId(mode.id)}
            onActivate={() => void setActive(mode.id)}
          />
        ))}
      </div>
    </div>
  )
}
