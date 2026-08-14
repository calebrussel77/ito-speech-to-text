import {
  LlmSettings,
  useAdvancedSettingsStore,
} from '@/app/store/useAdvancedSettingsStore'
import { useEffect, useRef, useState } from 'react'
import { useWindowContext } from '@/app/components/window/WindowContext'
import { Input } from '@/app/components/ui/input'
import { Switch } from '@/app/components/ui/switch'
import {
  SettingsGroup,
  SettingsRow,
  CONTROL_WIDTH,
} from '@/app/components/ui/settings'

// La langue et les amorces de prompt appartiennent désormais au mode : les
// garder ici créerait deux sources pour la même valeur, qui divergeraient.

const FLOAT_LENGTH_LIMIT = 4
/** Numeric settings read better rounded, but only while not being edited. */
function formatDisplayValue(value: string): string {
  if (value !== '' && !isNaN(Number(value))) {
    return Number(value).toFixed(2)
  }
  return value
}

function NumericInput({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [editingValue, setEditingValue] = useState('')

  return (
    <Input
      className={CONTROL_WIDTH}
      value={isFocused ? editingValue : formatDisplayValue(value)}
      placeholder={placeholder}
      maxLength={FLOAT_LENGTH_LIMIT}
      onFocus={() => {
        setIsFocused(true)
        setEditingValue(formatDisplayValue(value))
      }}
      onBlur={() => {
        setIsFocused(false)
        setEditingValue('')
      }}
      onChange={e => {
        setEditingValue(e.target.value)
        onChange(e.target.value)
      }}
    />
  )
}

export default function AdvancedSettingsContent() {
  const {
    llm,
    grammarServiceEnabled,
    macosAccessibilityContextEnabled,
    setLlmSettings,
    setGrammarServiceEnabled,
    setMacosAccessibilityContextEnabled,
  } = useAdvancedSettingsStore()
  const windowContext = useWindowContext()
  const debounceRef = useRef<NodeJS.Timeout>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function scheduleUpdate(
    nextLlm: LlmSettings,
    nextGrammarEnabled: boolean,
    nextMacosAccessibilityEnabled: boolean,
  ) {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      await window.api.updateAdvancedSettings({
        llm: nextLlm,
        grammarServiceEnabled: nextGrammarEnabled,
        macosAccessibilityContextEnabled: nextMacosAccessibilityEnabled,
      })
    }, 1000)
  }

  function updateLlm(name: keyof LlmSettings, value: string) {
    setLlmSettings({ [name]: value })
    scheduleUpdate(
      { ...llm, [name]: value },
      grammarServiceEnabled,
      macosAccessibilityContextEnabled,
    )
  }

  return (
    <div className="px-1.5">
      <SettingsGroup
        title="Tuning"
        description="Sane defaults ship with the app; these only matter when something is off."
      >
        <SettingsRow
          title="No-speech threshold"
          description="Above this confidence a segment is dropped as silence. Raise it if whole words go missing, lower it if phantom text appears."
        >
          <NumericInput
            value={String(llm.noSpeechThreshold ?? '')}
            placeholder="0.60"
            onChange={value => updateLlm('noSpeechThreshold', value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="System">
        <SettingsRow
          title="Grammar service"
          description="Apply Ito's local grammar adjustments before inserting text."
        >
          <Switch
            checked={grammarServiceEnabled}
            onCheckedChange={enabled => {
              setGrammarServiceEnabled(enabled)
              scheduleUpdate(llm, enabled, macosAccessibilityContextEnabled)
            }}
          />
        </SettingsRow>

        {windowContext?.window?.platform === 'darwin' && (
          <SettingsRow
            title="Accessibility context"
            description="Read the text around the cursor through the Accessibility APIs to sharpen Intelligent Mode."
          >
            <Switch
              checked={macosAccessibilityContextEnabled}
              onCheckedChange={enabled => {
                setMacosAccessibilityContextEnabled(enabled)
                scheduleUpdate(llm, grammarServiceEnabled, enabled)
              }}
            />
          </SettingsRow>
        )}
      </SettingsGroup>
    </div>
  )
}
