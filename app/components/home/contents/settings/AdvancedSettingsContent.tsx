import {
  LlmSettings,
  useAdvancedSettingsStore,
} from '@/app/store/useAdvancedSettingsStore'
import { useEffect, useRef, useState } from 'react'
import { useWindowContext } from '@/app/components/window/WindowContext'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Switch } from '@/app/components/ui/switch'
import {
  SettingsCard,
  SettingsGroup,
  SettingsRow,
  CONTROL_WIDTH,
} from '@/app/components/ui/settings'

const FLOAT_LENGTH_LIMIT = 4
const ASR_PROMPT_LENGTH_LIMIT = 100
const LLM_PROMPT_LENGTH_LIMIT = 3500

type PromptField = {
  name: keyof LlmSettings
  title: string
  description: string
  placeholder: string
  maxLength: number
  rows: number
}

const PROMPT_FIELDS: PromptField[] = [
  {
    name: 'asrPrompt',
    title: 'Transcription priming',
    description:
      'Whisper mimics this text rather than obeying it: write a sample of the style you dictate in. Your dictionary is appended automatically.',
    placeholder: 'Leave empty for the French default',
    maxLength: ASR_PROMPT_LENGTH_LIMIT,
    rows: 3,
  },
  {
    name: 'transcriptionPrompt',
    title: 'Transcription instructions',
    description:
      'Sent to the model that returns the raw transcript, before any editing.',
    placeholder: 'Leave empty for the default',
    maxLength: LLM_PROMPT_LENGTH_LIMIT,
    rows: 4,
  },
  {
    name: 'editingPrompt',
    title: 'Intelligent Mode instructions',
    description:
      'Drives what Intelligent Mode turns a dictation into — an issue, an email, a summary. This is the prompt to change when its output is not shaped the way you want.',
    placeholder: 'Leave empty for the default',
    maxLength: LLM_PROMPT_LENGTH_LIMIT,
    rows: 6,
  },
]

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
          title="Transcription language"
          description="ISO-639-1 hint (fr, en…). Improves accuracy and latency. Empty means auto-detect."
        >
          <Input
            className={CONTROL_WIDTH}
            value={llm.asrLanguage}
            placeholder="fr"
            maxLength={5}
            onChange={e => updateLlm('asrLanguage', e.target.value)}
          />
        </SettingsRow>

        <SettingsRow
          title="Temperature"
          description="How much freedom Intelligent Mode has. Higher wanders further from what you said."
        >
          <NumericInput
            value={String(llm.llmTemperature ?? '')}
            placeholder="0.10"
            onChange={value => updateLlm('llmTemperature', value)}
          />
        </SettingsRow>

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

      <SettingsGroup title="Prompts">
        {PROMPT_FIELDS.map(field => (
          <SettingsCard
            key={field.name}
            title={field.title}
            description={field.description}
            action={
              <span className="text-[10px] tabular-nums text-[var(--subtle-foreground)]">
                {String(llm[field.name] ?? '').length}/{field.maxLength}
              </span>
            }
          >
            <Textarea
              value={String(llm[field.name] ?? '')}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
              rows={field.rows}
              onChange={e => updateLlm(field.name, e.target.value)}
            />
          </SettingsCard>
        ))}
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
