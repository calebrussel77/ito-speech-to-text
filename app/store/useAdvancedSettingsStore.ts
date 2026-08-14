import { create } from 'zustand'
import { STORE_KEYS } from '../../lib/constants/store-keys'
import { DEFAULT_ADVANCED_SETTINGS } from '../../lib/constants/generated-defaults'
import { LONG_DICTATION_THRESHOLD_MS } from '../../lib/constants/transcription'
import {
  DEFAULT_LONG_VOICE_KEY,
  DEFAULT_SHORT_VOICE_KEY,
  DEFAULT_TEXT_KEY,
} from '../../lib/constants/modelCatalog'

export interface LlmSettings {
  asrProvider: string
  asrModel: string
  llmProvider: string
  llmModel: string
  llmTemperature: number
  noSpeechThreshold: number
}

interface AdvancedSettingsState {
  llm: LlmSettings
  grammarServiceEnabled: boolean
  macosAccessibilityContextEnabled: boolean
  groqApiKey: string
  openRouterApiKey: string
  // Keys into the curated catalogue, never raw model slugs.
  shortVoiceModelKey: string
  longVoiceModelKey: string
  textModelKey: string
  longDictationEnabled: boolean
  longDictationThresholdMs: number
  setLlmSettings: (settings: Partial<LlmSettings>) => void
  setGrammarServiceEnabled: (enabled: boolean) => void
  setMacosAccessibilityContextEnabled: (enabled: boolean) => void
  setGroqApiKey: (apiKey: string) => void
  setOpenRouterApiKey: (apiKey: string) => void
  setShortVoiceModelKey: (key: string) => void
  setLongVoiceModelKey: (key: string) => void
  setTextModelKey: (key: string) => void
  setLongDictationEnabled: (enabled: boolean) => void
  setLongDictationThresholdMs: (thresholdMs: number) => void
}

// Initialize from electron store
const DECOMMISSIONED_MODELS: Record<string, string> = {
  'llama3-8b-8192': 'openai/gpt-oss-20b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
}

const mapModel = (model?: string) =>
  model && DECOMMISSIONED_MODELS[model] ? DECOMMISSIONED_MODELS[model] : model

const getInitialState = () => {
  const storedAdvancedSettings =
    window.electron.store.get(STORE_KEYS.ADVANCED_SETTINGS) || {}
  const storedLlm = storedAdvancedSettings.llm || {}

  return {
    llm: {
      asrProvider:
        storedLlm.asrProvider ?? DEFAULT_ADVANCED_SETTINGS.asrProvider,
      asrModel: storedLlm.asrModel ?? DEFAULT_ADVANCED_SETTINGS.asrModel,
      llmProvider:
        storedLlm.llmProvider ?? DEFAULT_ADVANCED_SETTINGS.llmProvider,
      llmModel:
        mapModel(storedLlm.llmModel) ?? DEFAULT_ADVANCED_SETTINGS.llmModel,
      llmTemperature:
        storedLlm.llmTemperature ?? DEFAULT_ADVANCED_SETTINGS.llmTemperature,
      noSpeechThreshold:
        storedLlm.noSpeechThreshold ??
        DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold,
    },
    grammarServiceEnabled:
      storedAdvancedSettings.grammarServiceEnabled ?? false,
    macosAccessibilityContextEnabled:
      storedAdvancedSettings.macosAccessibilityContextEnabled ?? false,
    groqApiKey: storedAdvancedSettings.groqApiKey || '',
    openRouterApiKey: storedAdvancedSettings.openRouterApiKey || '',
    shortVoiceModelKey:
      storedAdvancedSettings.shortVoiceModelKey ?? DEFAULT_SHORT_VOICE_KEY,
    longVoiceModelKey:
      storedAdvancedSettings.longVoiceModelKey ?? DEFAULT_LONG_VOICE_KEY,
    textModelKey: storedAdvancedSettings.textModelKey ?? DEFAULT_TEXT_KEY,
    longDictationEnabled: storedAdvancedSettings.longDictationEnabled ?? true,
    longDictationThresholdMs:
      storedAdvancedSettings.longDictationThresholdMs ??
      LONG_DICTATION_THRESHOLD_MS,
  }
}

// Sync to electron store
const syncToStore = (state: Partial<AdvancedSettingsState>) => {
  const currentAdvancedSettings =
    window.electron.store.get(STORE_KEYS.ADVANCED_SETTINGS) || {}

  const updatedAdvancedSettings = {
    ...currentAdvancedSettings,
    ...state,
  }

  window.electron.store.set(
    STORE_KEYS.ADVANCED_SETTINGS,
    updatedAdvancedSettings,
  )
}

export const useAdvancedSettingsStore = create<AdvancedSettingsState>(set => {
  const initialState = getInitialState()

  return {
    ...initialState,
    setLlmSettings: (settings: Partial<LlmSettings>) => {
      set(state => {
        const newLlmSettings = { ...state.llm, ...settings }
        const partialState = { llm: newLlmSettings }
        syncToStore(partialState)
        return partialState
      })
    },
    setGrammarServiceEnabled: (enabled: boolean) => {
      set(() => {
        const partialState = { grammarServiceEnabled: enabled }
        syncToStore(partialState)
        return partialState
      })
    },
    setMacosAccessibilityContextEnabled: (enabled: boolean) => {
      set(() => {
        const partialState = { macosAccessibilityContextEnabled: enabled }
        syncToStore(partialState)
        return partialState
      })
    },
    setGroqApiKey: (apiKey: string) => {
      set(() => {
        const partialState = { groqApiKey: apiKey }
        syncToStore(partialState)
        return partialState
      })
    },
    setOpenRouterApiKey: (apiKey: string) => {
      set(() => {
        const partialState = { openRouterApiKey: apiKey }
        syncToStore(partialState)
        return partialState
      })
    },
    setShortVoiceModelKey: (key: string) => {
      set(() => {
        const partialState = { shortVoiceModelKey: key }
        syncToStore(partialState)
        return partialState
      })
    },
    setLongVoiceModelKey: (key: string) => {
      set(() => {
        const partialState = { longVoiceModelKey: key }
        syncToStore(partialState)
        return partialState
      })
    },
    setTextModelKey: (key: string) => {
      set(() => {
        const partialState = { textModelKey: key }
        syncToStore(partialState)
        return partialState
      })
    },
    setLongDictationEnabled: (enabled: boolean) => {
      set(() => {
        const partialState = { longDictationEnabled: enabled }
        syncToStore(partialState)
        return partialState
      })
    },
    setLongDictationThresholdMs: (thresholdMs: number) => {
      set(() => {
        const partialState = { longDictationThresholdMs: thresholdMs }
        syncToStore(partialState)
        return partialState
      })
    },
  }
})
