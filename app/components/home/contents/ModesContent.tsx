import { useEffect, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import { getKeyDisplay } from '@/app/utils/keyboard'
import { MODE_PRESETS } from '@/lib/constants/modePresets'
import { Button } from '@/app/components/ui/button'
import { SettingsGroup } from '@/app/components/ui/settings'
import ModeRow from './modes/ModeRow'
import ModeEditor from './modes/ModeEditor'
import { modeIcon } from './modes/modeIcons'
import type { KeyName } from '@/lib/types/keyboard'

export default function ModesContent() {
  const { modes, activeModeId, loaded, load, create, setActive } =
    useModesStore()
  const { keyboardShortcuts } = useSettingsStore()
  const platform = usePlatform()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const shortcutFor = (modeId: string): string | null => {
    const shortcut = keyboardShortcuts.find(s => s.modeId === modeId)
    if (!shortcut?.keys.length) return null
    return shortcut.keys
      .map(key =>
        getKeyDisplay(key as KeyName, platform, { showDirectionalText: false }),
      )
      .join(' ')
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
            A mode decides what a dictation becomes. The active one is used
            unless a dedicated shortcut says otherwise.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          Create mode
        </Button>
      </div>

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
                  <Icon className="mt-px size-4 shrink-0 text-[var(--subtle-foreground)]" />
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
