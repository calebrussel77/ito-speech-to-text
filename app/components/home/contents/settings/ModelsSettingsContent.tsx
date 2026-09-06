import { useEffect, useState } from 'react'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import { SettingsGroup, SettingsRow } from '@/app/components/ui/settings'
import {
  FILE_TRANSCRIPTION_KEYS,
  TEXT_MODELS,
  VOICE_MODELS,
} from '@/lib/constants/modelCatalog'
import ModelTable from './models/ModelTable'
import ProviderKeyRow, { type KeyRejection } from './models/ProviderKeyRow'
import ModelSelect from '../modes/ModelSelect'

/**
 * Page de référence : ce que chaque modèle coûte, ce qu'il vaut, et quelles
 * clés sont en place. Le choix d'un modèle appartient au mode — le faire
 * aussi ici créerait deux endroits pour la même décision.
 */
export default function ModelsSettingsContent() {
  const {
    groqApiKey,
    openRouterApiKey,
    deepgramApiKey,
    googleApiKey,
    openaiApiKey,
    setGroqApiKey,
    setOpenRouterApiKey,
    setDeepgramApiKey,
    setGoogleApiKey,
    setOpenaiApiKey,
    textModelKey,
    setTextModelKey,
    fileTranscriptionModelKey,
    setFileTranscriptionModelKey,
  } = useAdvancedSettingsStore()

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)

  // Read once on mount: the main process only returns a failure that still
  // describes the key currently stored, so there is nothing to keep in sync.
  const [openRouterRejection, setOpenRouterRejection] =
    useState<KeyRejection | null>(null)
  const [deepgramRejection, setDeepgramRejection] =
    useState<KeyRejection | null>(null)
  useEffect(() => {
    window.api
      .getProviderFailure('openrouter')
      .then((failure: KeyRejection | null) =>
        setOpenRouterRejection(failure ?? null),
      )
      .catch(() => setOpenRouterRejection(null))
    window.api
      .getProviderFailure('deepgram')
      .then((failure: KeyRejection | null) =>
        setDeepgramRejection(failure ?? null),
      )
      .catch(() => setDeepgramRejection(null))
  }, [])

  const availableProviders = new Set<string>()
  if (groqApiKey) availableProviders.add('groq')
  if (openRouterApiKey) availableProviders.add('openrouter')
  if (googleApiKey) availableProviders.add('google')
  if (openaiApiKey) availableProviders.add('openai')
  if (deepgramApiKey) availableProviders.add('deepgram')

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
          rejection={openRouterRejection}
          expanded={expandedProvider === 'openrouter'}
          onToggle={() =>
            setExpandedProvider(
              expandedProvider === 'openrouter' ? null : 'openrouter',
            )
          }
          onSave={setOpenRouterApiKey}
          onTest={key => window.api.testOpenRouterApiKey(key)}
        />
        <ProviderKeyRow
          provider="deepgram"
          name="Deepgram"
          hint="Long recordings and speaker separation — used by the Meeting mode"
          placeholder="Token…"
          consoleUrl="https://console.deepgram.com/"
          storedKey={deepgramApiKey}
          rejection={deepgramRejection}
          expanded={expandedProvider === 'deepgram'}
          onToggle={() =>
            setExpandedProvider(
              expandedProvider === 'deepgram' ? null : 'deepgram',
            )
          }
          onSave={setDeepgramApiKey}
          onTest={key => window.api.testDeepgramApiKey(key)}
        />
        <ProviderKeyRow
          provider="openai"
          name="OpenAI"
          hint="GPT Transcribe and the 4o family — strongest on imported files"
          placeholder="sk-..."
          consoleUrl="https://platform.openai.com/api-keys"
          storedKey={openaiApiKey}
          expanded={expandedProvider === 'openai'}
          onToggle={() =>
            setExpandedProvider(expandedProvider === 'openai' ? null : 'openai')
          }
          onSave={setOpenaiApiKey}
          onTest={key => window.api.testOpenaiApiKey(key)}
        />
        <ProviderKeyRow
          provider="google"
          name="Google"
          hint="Gemini reads a whole recording at once — the imported-file path"
          placeholder="AIza…"
          consoleUrl="https://aistudio.google.com/apikey"
          storedKey={googleApiKey}
          expanded={expandedProvider === 'google'}
          onToggle={() =>
            setExpandedProvider(expandedProvider === 'google' ? null : 'google')
          }
          onSave={setGoogleApiKey}
          onTest={key => window.api.testGoogleApiKey(key)}
        />
      </SettingsGroup>

      <SettingsGroup title="Defaults">
        <SettingsRow
          title="Text model for new modes"
          description="Only prefills a mode when it is created. Change the model itself in Modes."
        >
          <ModelSelect
            kind="text"
            value={textModelKey}
            availableProviders={availableProviders}
            onChange={key => setTextModelKey(key ?? '')}
          />
        </SettingsRow>

        <SettingsRow
          title="Imported file transcription"
          description="Used by “Transcribe a file”. That path has no mode, so it has its own model. Default picks the first provider with a key: Deepgram, then Gemini via OpenRouter, then Google, then OpenAI."
        >
          <ModelSelect
            kind="voice"
            keys={FILE_TRANSCRIPTION_KEYS}
            value={fileTranscriptionModelKey}
            availableProviders={availableProviders}
            onChange={key => setFileTranscriptionModelKey(key ?? '')}
          />
        </SettingsRow>
      </SettingsGroup>

      <ModelTable
        title="Voice models"
        description="What each model costs and how it scored on real dictations. Pick one per mode, in Modes."
        models={VOICE_MODELS}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
        showAccuracy
        markOpenRouter
      />

      <ModelTable
        title="Text models"
        description="Used by modes that rewrite the dictation."
        models={TEXT_MODELS}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
      />
    </div>
  )
}
