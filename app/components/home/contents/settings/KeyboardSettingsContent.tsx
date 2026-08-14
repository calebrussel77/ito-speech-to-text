import { useEffect } from 'react'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { useModesStore } from '@/app/store/useModesStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import { getKeyDisplay } from '@/app/utils/keyboard'
import {
  SettingsGroup,
  SettingsRow,
  SettingsNote,
} from '@/app/components/ui/settings'
import KeyboardShortcutEditor from '@/app/components/ui/keyboard-shortcut-editor'
import type { KeyName } from '@/lib/types/keyboard'

/**
 * Les raccourcis de dictée s'éditent dans leur mode. Ils sont listés ici en
 * lecture seule pour une seule raison : avec six modes réglables depuis six
 * écrans, deux modes finiront par réclamer la même combinaison, et le symptôme
 * — « mon raccourci ne fait plus rien » — est le plus pénible à diagnostiquer.
 */
export default function KeyboardSettingsContent() {
  const { keyboardShortcuts, cycleModeShortcut, setCycleModeShortcut } =
    useSettingsStore()
  const { modes, loaded, load } = useModesStore()
  const platform = usePlatform()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const display = (keys: string[]) =>
    keys
      .map(key =>
        getKeyDisplay(key as KeyName, platform, { showDirectionalText: false }),
      )
      .join(' + ')

  const byCombo = new Map<string, string[]>()
  for (const shortcut of keyboardShortcuts) {
    if (!shortcut.keys.length) continue
    const combo = [...shortcut.keys].sort().join('+')
    const name =
      modes.find(mode => mode.id === shortcut.modeId)?.name ?? shortcut.modeId
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), name])
  }
  const conflicts = [...byCombo.entries()].filter(
    ([, names]) => names.length > 1,
  )

  return (
    <div className="px-1.5">
      <SettingsGroup title="Global">
        <SettingsRow
          title="Change the active mode"
          description="Walks through the modes without opening this window. It never starts a dictation."
          align="start"
        >
          <KeyboardShortcutEditor
            hideTitle
            keySize={40}
            minHeight={48}
            shortcut={{
              id: 'cycle-mode',
              keys: cycleModeShortcut,
              modeId: '',
            }}
            onShortcutChange={(_id, keys) => setCycleModeShortcut(keys)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Mode shortcuts"
        description="Edit these in Modes. A mode without a shortcut is reached through the active mode."
      >
        {keyboardShortcuts.map(shortcut => (
          <SettingsRow
            key={shortcut.id}
            title={
              modes.find(mode => mode.id === shortcut.modeId)?.name ??
              shortcut.modeId
            }
          >
            <span className="rounded border border-border px-1.5 py-px text-[10px] tabular-nums text-[var(--subtle-foreground)]">
              {display(shortcut.keys) || 'None'}
            </span>
          </SettingsRow>
        ))}
      </SettingsGroup>

      {conflicts.length > 0 && (
        <SettingsNote tone="error">
          {conflicts
            .map(([, names]) => `${names.join(' and ')} share a shortcut`)
            .join('. ')}
          . Only the first will ever trigger.
        </SettingsNote>
      )}
    </div>
  )
}
