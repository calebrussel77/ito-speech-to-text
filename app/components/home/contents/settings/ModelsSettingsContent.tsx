import { useEffect, useState } from 'react'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import { SettingsGroup, SettingsRow } from '@/app/components/ui/settings'
import { TEXT_MODELS, VOICE_MODELS } from '@/lib/constants/modelCatalog'
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
    setGroqApiKey,
    setOpenRouterApiKey,
    setDeepgramApiKey,
    textModelKey,
    setTextModelKey,
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
      </SettingsGroup>

      <ModelTable
        title="Voice models"
        description="What each model costs and how it scored on real dictations. Pick one per mode, in Modes."
        models={VOICE_MODELS}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
        showAccuracy
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
