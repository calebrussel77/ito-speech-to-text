import {
  LlmSettings,
  useAdvancedSettingsStore,
} from '@/app/store/useAdvancedSettingsStore'
import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { useWindowContext } from '@/app/components/window/WindowContext'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Checkbox } from '@/app/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import ApiKeySettings from './ApiKeySettings'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card'
import { Textarea } from '@/app/components/ui/textarea'

type LlmSettingConfig = {
  name: keyof LlmSettings
  label: string
  placeholder: string
  description: string
  maxLength: number
  resize?: boolean
  readOnly?: boolean
  isSelect?: boolean
  options?: string[]
}

const floatLengthLimit = 4
const asrPromptLengthLimit = 100
const llmPromptLengthLimit = 3500

// Model and provider choices moved to the Models section, which picks them
// from the curated catalogue instead of accepting free-form ids.
const llmSettingsConfig: LlmSettingConfig[] = [
  {
    name: 'asrLanguage',
    label: 'ASR Language',
    placeholder: 'fr',
    description:
      'ISO-639-1 language hint for transcription (e.g. fr, en). Improves accuracy and latency. Leave empty for auto-detection.',
    maxLength: 5,
  },
  {
    name: 'asrPrompt',
    label: 'ASR Prompt',
    placeholder: 'Enter custom ASR prompt',
    description:
      'A custom prompt to guide the ASR transcription process for better accuracy. Dictionary will be appended. (Leave empty for default)',
    maxLength: asrPromptLengthLimit,
    resize: true,
  },
  {
    name: 'llmTemperature',
    label: 'LLM Temperature',
    placeholder: 'Enter LLM temperature (e.g., 0.7)',
    description:
      'Controls the randomness of the LLM output. Higher values produce more diverse results.',
    maxLength: floatLengthLimit,
  },
  {
    name: 'transcriptionPrompt',
    label: 'Transcription Prompt',
    placeholder: 'Enter custom transcription prompt',
    description:
      'A custom prompt to guide the transcription process for better accuracy. (Leave empty for default)',
    maxLength: llmPromptLengthLimit,
    resize: true,
  },
  {
    name: 'noSpeechThreshold',
    label: 'No Speech Threshold',
    placeholder: 'e.g., 0.6',
    description: 'Threshold for detecting no speech segments in audio.',
    maxLength: floatLengthLimit,
  },
]

function formatDisplayValue(value: string): string {
  // If its a number then format it to 2 decimal places
  if (!isNaN(Number(value)) && value !== '') {
    return Number(value).toFixed(2)
  }
  return value
}

interface SettingInputProps {
  config: LlmSettingConfig
  value: string
  onChange: (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    config: LlmSettingConfig,
  ) => void
}

function SettingInput({ config, value, onChange }: SettingInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [editingValue, setEditingValue] = useState('')

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const newValue = e.target.value
    setEditingValue(newValue)
    onChange(e, config)
  }

  const handleSelectChange = (newValue: string) => {
    const syntheticEvent = {
      target: { value: newValue },
    } as ChangeEvent<HTMLSelectElement>
    onChange(syntheticEvent, config)
  }

  const handleFocus = () => {
    setIsFocused(true)
    const startValue = formatDisplayValue(value)
    setEditingValue(startValue)
  }

  const handleBlur = () => {
    setIsFocused(false)
    setEditingValue('')
  }

  const displayValue = isFocused ? editingValue : formatDisplayValue(value)

  return (
    <div className="mb-6">
      <Label
        htmlFor={config.name}
        className="block text-xs font-medium text-foreground mb-1"
      >
        {config.label}{' '}
        {config?.maxLength &&
          value?.length > 0 &&
          `(${value.length}/${config.maxLength})`}
      </Label>
      {config.isSelect ? (
        <Select
          value={value}
          onValueChange={handleSelectChange}
          disabled={config.readOnly}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={config.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {config.options?.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : config.resize ? (
        <Textarea
          id={config.name}
          value={displayValue}
          onChange={handleChange as never}
          onFocus={handleFocus}
          onBlur={handleBlur}
          rows={3}
          placeholder={config.placeholder}
          maxLength={config.maxLength}
          readOnly={config.readOnly}
        />
      ) : (
        <Input
          id={config.name}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={config.placeholder}
          maxLength={config.maxLength}
          readOnly={config.readOnly}
          disabled={config.readOnly}
        />
      )}
      <p className="mt-1 text-[11px] leading-snug text-[var(--subtle-foreground)]">
        {config.description}
      </p>
    </div>
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
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  function scheduleAdvancedSettingsUpdate(
    nextLlm: LlmSettings,
    nextGrammarEnabled: boolean,
    nextMacosAccessibilityEnabled: boolean,
  ) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(async () => {
      const settingsToSave = {
        llm: nextLlm,
        grammarServiceEnabled: nextGrammarEnabled,
        macosAccessibilityContextEnabled: nextMacosAccessibilityEnabled,
      }
      console.log('[AdvancedSettings] Saving settings...')
      await window.api.updateAdvancedSettings(settingsToSave)
    }, 1000)
  }

  function handleInputChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    config: LlmSettingConfig,
  ) {
    const newValue = e.target.value
    const updatedLlm = { ...llm, [config.name]: newValue }
    setLlmSettings({ [config.name]: newValue })
    scheduleAdvancedSettingsUpdate(
      updatedLlm,
      grammarServiceEnabled,
      macosAccessibilityContextEnabled,
    )
  }

  function handleGrammarServiceToggle(e: ChangeEvent<HTMLInputElement>) {
    const enabled = e.target.checked
    setGrammarServiceEnabled(enabled)
    scheduleAdvancedSettingsUpdate(
      llm,
      enabled,
      macosAccessibilityContextEnabled,
    )
  }

  function handleMacosAccessibilityContextToggle(
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const enabled = e.target.checked
    setMacosAccessibilityContextEnabled(enabled)
    scheduleAdvancedSettingsUpdate(llm, grammarServiceEnabled, enabled)
  }

  return (
    <div className="px-1.5">
      {/* LLM Settings Section */}
      <div className="space-y-4">
        <ApiKeySettings />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>
                  Configure advanced settings for Ito.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pb-8">
            <div>
              <h3 className="font-heading text-xs font-semibold tracking-tight text-foreground mb-2">
                LLM Settings
              </h3>
              <div className="space-y-4">
                {llmSettingsConfig.map(config => (
                  <SettingInput
                    key={config.name}
                    config={config}
                    value={llm[config.name as string]}
                    onChange={handleInputChange}
                  />
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-heading text-xs font-semibold tracking-tight text-foreground mb-2">
                Grammar
              </h3>
              <label className="flex items-start gap-3 ml-1 cursor-pointer">
                <Checkbox
                  checked={grammarServiceEnabled}
                  onCheckedChange={checked =>
                    handleGrammarServiceToggle({
                      target: { checked },
                    } as ChangeEvent<HTMLInputElement>)
                  }
                  className="mt-1"
                />
                <span>
                  <span className="block text-xs font-medium text-foreground">
                    Enable Grammar Service
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-[var(--subtle-foreground)]">
                    Apply Ito's local grammar adjustments before inserting text.
                  </span>
                </span>
              </label>
            </div>

            {windowContext?.window?.platform === 'darwin' && (
              <div>
                <h3 className="font-heading text-xs font-semibold tracking-tight text-foreground mb-2">
                  Context
                </h3>
                <label className="flex items-start gap-3 ml-1 cursor-pointer">
                  <Checkbox
                    checked={macosAccessibilityContextEnabled}
                    onCheckedChange={checked =>
                      handleMacosAccessibilityContextToggle({
                        target: { checked },
                      } as ChangeEvent<HTMLInputElement>)
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-xs font-medium text-foreground">
                      Use Accessibility Context
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--subtle-foreground)]">
                      Use Accessibility APIs to capture text context around the
                      cursor for improved accuracy.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
