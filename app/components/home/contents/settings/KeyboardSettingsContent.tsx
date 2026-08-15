import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { useModesStore } from '@/app/store/useModesStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import {
  formatChord,
  formatChordDetailed,
  normalizeChord,
} from '@/app/utils/keyboard'
import {
  SettingsGroup,
  SettingsRow,
  SettingsNote,
} from '@/app/components/ui/settings'
import KeyboardShortcutEditor from '@/app/components/ui/keyboard-shortcut-editor'
import { Kbd } from '@/app/components/ui/kbd'
import { ACTIVE_MODE_SHORTCUT_ID } from '@/lib/constants/keyboard-defaults'
import { normalizeLegacyKey } from '@/lib/types/keyboard'

/**
 * Les raccourcis de dictée s'éditent dans leur mode. Ils sont listés ici en
 * lecture seule pour une seule raison : avec six modes réglables depuis six
 * écrans, deux modes finiront par réclamer la même combinaison, et le symptôme
 * — « mon raccourci ne fait plus rien » — est le plus pénible à diagnostiquer.
 */
export default function KeyboardSettingsContent() {
  const {
    keyboardShortcuts,
    cycleModeShortcut,
    setCycleModeShortcut,
    setActiveModeShortcut,
  } = useSettingsStore()
  const { modes, activeModeId, loaded, load } = useModesStore()
  const platform = usePlatform()
  const [shortcutError, setShortcutError] = useState('')

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Le raccourci qui ne nomme aucun mode. Il n'y en a qu'un, et il vit ici
  // plutôt que dans un mode : par construction il n'appartient à aucun.
  const activeModeShortcut = keyboardShortcuts.find(
    shortcut => shortcut.modeId === null,
  )
  const activeModeName =
    modes.find(mode => mode.id === activeModeId)?.name ?? 'the active mode'

  // The runtime matcher (lib/media/keyboard.ts) normalizes legacy key names
  // — 'control' becomes 'control-left', etc. — before comparing shortcuts, so
  // 'control' and 'control-left' collide there even though they are
  // different strings here. Comparing raw keys would miss exactly the
  // conflict this panel exists to catch, so the same normalization runs
  // first, matching isDuplicateShortcut's approach in app/utils/keyboard.ts.
  const byCombo = new Map<string, string[]>()
  for (const shortcut of keyboardShortcuts) {
    if (!shortcut.keys.length) continue
    const combo = normalizeChord(
      shortcut.keys.map(key => normalizeLegacyKey(key)),
    ).join('+')
    const name =
      shortcut.modeId === null
        ? 'The active mode'
        : (modes.find(mode => mode.id === shortcut.modeId)?.name ??
          shortcut.modeId)
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), name])
  }
  const conflicts = [...byCombo.entries()].filter(
    ([, names]) => names.length > 1,
  )

  return (
    <div className="px-1.5">
      <SettingsGroup title="Global">
        {/* Le raccourci que l'app promettait sans l'offrir : jusqu'ici tout
            raccourci imposait son mode, et le mode actif ne pilotait que le
            clic sur la pill. */}
        <SettingsRow
          title="Dictate in the active mode"
          description={`Starts a dictation in whichever mode is active — ${activeModeName} right now. Change the mode in Modes, without touching this shortcut.`}
          align="start"
        >
          <KeyboardShortcutEditor
            hideTitle
            keySize={40}
            minHeight={48}
            shortcut={{
              id: activeModeShortcut?.id ?? ACTIVE_MODE_SHORTCUT_ID,
              keys: activeModeShortcut?.keys ?? [],
              modeId: null,
            }}
            onShortcutChange={(_id, keys) => {
              setShortcutError('')
              void setActiveModeShortcut(keys).then(result => {
                if (!result.success) {
                  setShortcutError(
                    result.errorMessage ??
                      'That combination is already taken by another shortcut.',
                  )
                }
              })
            }}
          />
        </SettingsRow>

        {shortcutError && (
          <SettingsNote tone="error">{shortcutError}</SettingsNote>
        )}

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
        description="Edit these in Modes. Each one dictates in its own mode, whatever the active mode is. A mode without a shortcut is reached by making it active."
      >
        {keyboardShortcuts
          .filter(shortcut => shortcut.modeId !== null)
          .map(shortcut => (
            <SettingsRow
              key={shortcut.id}
              title={
                modes.find(mode => mode.id === shortcut.modeId)?.name ??
                shortcut.modeId ??
                ''
              }
            >
              {shortcut.keys.length ? (
                <Kbd title={formatChordDetailed(shortcut.keys, platform)}>
                  {formatChord(shortcut.keys, platform)}
                </Kbd>
              ) : (
                <span className="text-[11px] text-[var(--subtle-foreground)]">
                  None
                </span>
              )}
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
