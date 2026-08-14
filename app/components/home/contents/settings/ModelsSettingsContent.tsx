import { useState } from 'react'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import {
  SettingsGroup,
  SettingsRow,
  CONTROL_WIDTH,
} from '@/app/components/ui/settings'
import { Switch } from '@/app/components/ui/switch'
import { LONG_DICTATION_THRESHOLD_OPTIONS } from '@/lib/constants/transcription'
import {
  TEXT_MODELS,
  VOICE_MODELS,
  type CatalogModel,
} from '@/lib/constants/modelCatalog'
import ModelTable, { type ModelSlot } from './models/ModelTable'
import ProviderKeyRow from './models/ProviderKeyRow'
import { cn } from '@/lib/utils'

const isGroq = (model: CatalogModel) => model.provider === 'groq'
const isOpenRouter = (model: CatalogModel) => model.provider === 'openrouter'

function ThresholdPicker({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-lg border border-border',
        CONTROL_WIDTH,
      )}
    >
      {LONG_DICTATION_THRESHOLD_OPTIONS.map(option => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'flex-1 py-1 text-[11px] tabular-nums transition-colors duration-150',
            option === value
              ? 'bg-foreground text-[var(--background)]'
              : 'text-[var(--muted-foreground)] hover:text-foreground',
          )}
        >
          {option / 1000}s
        </button>
      ))}
    </div>
  )
}

export default function ModelsSettingsContent() {
  const {
    groqApiKey,
    openRouterApiKey,
    setGroqApiKey,
    setOpenRouterApiKey,
    shortVoiceModelKey,
    longVoiceModelKey,
    textModelKey,
    setShortVoiceModelKey,
    setLongVoiceModelKey,
    setTextModelKey,
    longDictationEnabled,
    setLongDictationEnabled,
    longDictationThresholdMs,
    setLongDictationThresholdMs,
  } = useAdvancedSettingsStore()

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)

  const availableProviders = new Set<string>()
  if (groqApiKey) availableProviders.add('groq')
  if (openRouterApiKey) availableProviders.add('openrouter')

  // With the long-dictation engine off, Groq transcribes everything, so the
  // single remaining slot has no reason to say "short".
  const voiceSlots: ModelSlot[] = longDictationEnabled
    ? [
        {
          id: 'short',
          label: 'Short',
          selectedKey: shortVoiceModelKey,
          onSelect: setShortVoiceModelKey,
          accepts: isGroq,
        },
        {
          id: 'long',
          label: 'Long',
          selectedKey: longVoiceModelKey,
          onSelect: setLongVoiceModelKey,
          accepts: isOpenRouter,
        },
      ]
    : [
        {
          id: 'short',
          selectedKey: shortVoiceModelKey,
          onSelect: setShortVoiceModelKey,
          accepts: isGroq,
        },
      ]

  const voiceModels = longDictationEnabled
    ? VOICE_MODELS
    : VOICE_MODELS.filter(isGroq)

  const textSlots: ModelSlot[] = [
    {
      id: 'text',
      selectedKey: textModelKey,
      onSelect: setTextModelKey,
      accepts: () => true,
    },
  ]

  return (
    <div className="px-1.5">
      <SettingsGroup
        title="Providers"
        description="Keys stay on this device. A provider without a key has its models greyed out below."
      >
        <ProviderKeyRow
          provider="groq"
          name="Groq"
          hint="Transcription and the fastest text models"
          placeholder="gsk_..."
          consoleUrl="https://console.groq.com/keys"
          storedKey={groqApiKey}
          expanded={expandedProvider === 'groq'}
          onToggle={() =>
            setExpandedProvider(expandedProvider === 'groq' ? null : 'groq')
          }
          onSave={setGroqApiKey}
          onTest={key => window.api.testGroqApiKey(key)}
        />
        <ProviderKeyRow
          provider="openrouter"
          name="OpenRouter"
          hint="Long-form transcription, plus every other text model — Cerebras included"
          placeholder="sk-or-v1-..."
          consoleUrl="https://openrouter.ai/settings/keys"
          storedKey={openRouterApiKey}
          expanded={expandedProvider === 'openrouter'}
          onToggle={() =>
            setExpandedProvider(
              expandedProvider === 'openrouter' ? null : 'openrouter',
            )
          }
          onSave={setOpenRouterApiKey}
          onTest={key => window.api.testOpenRouterApiKey(key)}
        />
      </SettingsGroup>

      <SettingsGroup title="Routing">
        <SettingsRow
          title="Dedicated engine for long dictations"
          description="Whisper starts hallucinating on long recordings. Above the threshold, transcription moves to OpenRouter; below it, Groq keeps its head start. A failed OpenRouter call always falls back to Groq."
        >
          <Switch
            checked={longDictationEnabled}
            onCheckedChange={setLongDictationEnabled}
          />
        </SettingsRow>
        {longDictationEnabled && (
          <SettingsRow
            title="Switch over at"
            description="Lower it if you dictate paragraphs, raise it if you dictate sentences."
          >
            <ThresholdPicker
              value={longDictationThresholdMs}
              onChange={setLongDictationThresholdMs}
            />
          </SettingsRow>
        )}
      </SettingsGroup>

      <ModelTable
        title="Voice models"
        description={
          longDictationEnabled
            ? 'Click a row to use it. Short dictations run on Groq, long ones on OpenRouter.'
            : 'Click a row to use it. Groq transcribes every dictation.'
        }
        models={voiceModels}
        slots={voiceSlots}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
        showAccuracy
      />

      <ModelTable
        title="Text models"
        description="Click a row to use it. Intelligent Mode rewrites a dictation into the document you asked for."
        models={TEXT_MODELS}
        slots={textSlots}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
      />
    </div>
  )
}
