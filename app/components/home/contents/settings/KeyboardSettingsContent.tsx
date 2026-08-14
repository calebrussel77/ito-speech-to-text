import { useSettingsStore } from '@/app/store/useSettingsStore'
import { ItoMode } from '@/app/generated/ito_pb'
import MultiShortcutEditor from '@/app/components/ui/multi-shortcut-editor'
import { SettingsGroup, SettingsRow } from '@/app/components/ui/settings'

export default function KeyboardSettingsContent() {
  const { getItoModeShortcuts } = useSettingsStore()
  const transcribeShortcuts = getItoModeShortcuts(ItoMode.TRANSCRIBE)
  const editShortcuts = getItoModeShortcuts(ItoMode.EDIT)

  return (
    <SettingsGroup>
      <SettingsRow
        title="Dictation"
        description="Hold these keys, speak, and the transcript is inserted where you're typing."
        align="start"
      >
        <MultiShortcutEditor
          shortcuts={transcribeShortcuts}
          mode={ItoMode.TRANSCRIBE}
        />
      </SettingsRow>

      <SettingsRow
        title="Intelligent Mode"
        description="Same gesture, but the transcript goes through the LLM before being pasted."
        align="start"
      >
        <MultiShortcutEditor shortcuts={editShortcuts} mode={ItoMode.EDIT} />
      </SettingsRow>
    </SettingsGroup>
  )
}
