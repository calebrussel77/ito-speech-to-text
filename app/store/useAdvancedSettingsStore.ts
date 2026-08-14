import { create } from 'zustand'
import { STORE_KEYS } from '../../lib/constants/store-keys'
import { DEFAULT_ADVANCED_SETTINGS } from '../../lib/constants/generated-defaults'
import {
  DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL,
  TranscriptionEngineMode,
} from '../../lib/constants/transcription'

export interface LlmSettings {
  asrProvider: string
  asrModel: string
  asrPrompt: string
  asrLanguage: string
  llmProvider: string
  llmModel: string
  llmTemperature: number
  transcriptionPrompt: string
  editingPrompt: string
  noSpeechThreshold: number
}

interface AdvancedSettingsState {
  llm: LlmSettings
  grammarServiceEnabled: boolean
  macosAccessibilityContextEnabled: boolean
  groqApiKey: string
  transcriptionEngineMode: TranscriptionEngineMode
  openRouterModel: string
  openRouterApiKey: string
  setLlmSettings: (settings: Partial<LlmSettings>) => void
  setGrammarServiceEnabled: (enabled: boolean) => void
  setMacosAccessibilityContextEnabled: (enabled: boolean) => void
  setGroqApiKey: (apiKey: string) => void
  setTranscriptionEngineMode: (mode: TranscriptionEngineMode) => void
  setOpenRouterModel: (model: string) => void
  setOpenRouterApiKey: (apiKey: string) => void
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
      asrPrompt: storedLlm.asrPrompt ?? DEFAULT_ADVANCED_SETTINGS.asrPrompt,
      asrLanguage:
        storedLlm.asrLanguage ?? DEFAULT_ADVANCED_SETTINGS.asrLanguage,
      llmProvider:
        storedLlm.llmProvider ?? DEFAULT_ADVANCED_SETTINGS.llmProvider,
      llmModel:
        mapModel(storedLlm.llmModel) ?? DEFAULT_ADVANCED_SETTINGS.llmModel,
      llmTemperature:
        storedLlm.llmTemperature ?? DEFAULT_ADVANCED_SETTINGS.llmTemperature,
      transcriptionPrompt:
        storedLlm.transcriptionPrompt ??
        DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
      editingPrompt:
        storedLlm.editingPrompt ?? DEFAULT_ADVANCED_SETTINGS.editingPrompt,
      noSpeechThreshold:
        storedLlm.noSpeechThreshold ??
        DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold,
    },
    grammarServiceEnabled:
      storedAdvancedSettings.grammarServiceEnabled ?? false,
    macosAccessibilityContextEnabled:
      storedAdvancedSettings.macosAccessibilityContextEnabled ?? false,
    groqApiKey: storedAdvancedSettings.groqApiKey || '',
    transcriptionEngineMode:
      storedAdvancedSettings.transcriptionEngineMode ?? 'auto',
    openRouterModel:
      storedAdvancedSettings.openRouterModel ??
      DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL,
    openRouterApiKey: storedAdvancedSettings.openRouterApiKey || '',
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
    setTranscriptionEngineMode: (mode: TranscriptionEngineMode) => {
      set(() => {
        const partialState = { transcriptionEngineMode: mode }
        syncToStore(partialState)
        return partialState
      })
    },
    setOpenRouterModel: (model: string) => {
      set(() => {
        const partialState = { openRouterModel: model }
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
  }
})
