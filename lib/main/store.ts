import crypto from 'crypto'
import { DEFAULT_ADVANCED_SETTINGS } from '../constants/generated-defaults.js'
import { STORE_KEYS } from '../constants/store-keys'
import { LONG_DICTATION_THRESHOLD_MS } from '../constants/transcription'
import {
  DEFAULT_LONG_VOICE_KEY,
  DEFAULT_SHORT_VOICE_KEY,
  DEFAULT_TEXT_KEY,
  findModelBySlug,
} from '../constants/modelCatalog'
import type { LlmSettings } from '@/app/store/useAdvancedSettingsStore'
import { ItoMode } from '@/app/generated/ito_pb.js'
import { ITO_MODE_SHORTCUT_DEFAULTS } from '../constants/keyboard-defaults.js'
import { KeyName, normalizeLegacyKey } from '../types/keyboard.js'
import { KeyValueStore } from './sqlite/repo'
import * as electron from 'electron'

const safeStorageApi: any = (electron as any).safeStorage

// API keys stored inside advancedSettings that are encrypted at rest via
// safeStorage (persisted as `<field>Encrypted`, decrypted back on load).
const ENCRYPTED_API_KEY_FIELDS = ['groqApiKey', 'openRouterApiKey'] as const

export interface KeyboardShortcutConfig {
  id: string
  keys: KeyName[]
  mode: ItoMode
}

export type InteractionSoundTheme = 'pop' | 'marimba' | 'custom'

interface MainStore {
  navExpanded: boolean
}
interface OnboardingStore {
  onboardingStep: number
  onboardingCompleted: boolean
}

export interface SettingsStore {
  shareAnalytics: boolean
  launchAtLogin: boolean
  showItoBarAlways: boolean
  showAppInDock: boolean
  runInBackground: boolean
  interactionSounds: boolean
  interactionSoundTheme: InteractionSoundTheme
  muteAudioWhenDictating: boolean
  pasteCombo: 'auto' | 'ctrl-v' | 'ctrl-shift-v' | 'shift-insert'
  microphoneDeviceId: string
  microphoneName: string
  isShortcutGloballyEnabled: boolean
  keyboardShortcuts: KeyboardShortcutConfig[]
  firstName: string
  lastName: string
  email: string
}

export interface AuthState {
  id: string
  codeVerifier: string
  codeChallenge: string
  state: string
}

export interface AuthUser {
  id: string
  email?: string
  name?: string
  picture?: string
  provider?: string
  lastSignInAt?: string
}
export interface AuthTokens {
  access_token?: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  expires_at?: number
}

export interface AuthStore {
  user: AuthUser | null
  tokens: AuthTokens | null
  state: AuthState
}

export interface AdvancedSettings {
  llm: LlmSettings
  grammarServiceEnabled: boolean
  macosAccessibilityContextEnabled: boolean
  groqApiKey?: string
  openRouterApiKey?: string
  // Catalogue keys (see lib/constants/modelCatalog.ts), never raw model
  // slugs: the catalogue owns which provider serves a model and how it is
  // routed, so those cannot drift out of sync with the stored choice.
  shortVoiceModelKey?: string
  longVoiceModelKey?: string
  textModelKey?: string
  // Route dictations at or above the threshold to the dedicated long-form
  // engine. Off means Groq transcribes everything.
  longDictationEnabled?: boolean
  longDictationThresholdMs?: number
}

interface AppStore {
  main: MainStore
  onboarding: OnboardingStore
  settings: SettingsStore
  auth: AuthStore
  advancedSettings: AdvancedSettings
  openMic: boolean
  selectedAudioInput: string | null
  interactionSounds: boolean
  userProfile: any | null
  idToken: string | null
  accessToken: string | null
  appliedMigrations: string[]
}

export const createNewAuthState = (): AuthState => {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')
  const id = crypto.randomUUID()
  return { id, codeVerifier, codeChallenge, state }
}

export const getCurrentUserId = (): string | undefined => {
  const user = store.get(STORE_KEYS.USER_PROFILE) as any
  return user?.id
}
export const getAdvancedSettings = (): AdvancedSettings => {
  return store.get(STORE_KEYS.ADVANCED_SETTINGS) as AdvancedSettings
}

export const defaultValues: AppStore = {
  onboarding: { onboardingStep: 0, onboardingCompleted: false },
  settings: {
    shareAnalytics: true,
    launchAtLogin: true,
    showItoBarAlways: true,
    showAppInDock: true,
    runInBackground: true,
    interactionSounds: false,
    interactionSoundTheme: 'pop',
    muteAudioWhenDictating: true,
    pasteCombo: 'auto',
    microphoneDeviceId: 'default',
    microphoneName: 'Auto-detect',
    isShortcutGloballyEnabled: false,
    keyboardShortcuts: [
      {
        id: crypto.randomUUID(),
        keys: ITO_MODE_SHORTCUT_DEFAULTS[ItoMode.TRANSCRIBE].map(
          normalizeLegacyKey,
        ) as KeyName[],
        mode: ItoMode.TRANSCRIBE,
      },
      {
        id: crypto.randomUUID(),
        keys: ITO_MODE_SHORTCUT_DEFAULTS[ItoMode.EDIT].map(
          normalizeLegacyKey,
        ) as KeyName[],
        mode: ItoMode.EDIT,
      },
    ],
    firstName: '',
    lastName: '',
    email: '',
  },
  main: { navExpanded: true },
  auth: { user: null, tokens: null, state: createNewAuthState() },
  advancedSettings: {
    grammarServiceEnabled: false,
    macosAccessibilityContextEnabled: false,
    llm: {
      asrProvider: DEFAULT_ADVANCED_SETTINGS.asrProvider,
      asrModel: DEFAULT_ADVANCED_SETTINGS.asrModel,
      asrPrompt: DEFAULT_ADVANCED_SETTINGS.asrPrompt,
      asrLanguage: DEFAULT_ADVANCED_SETTINGS.asrLanguage,
      llmProvider: DEFAULT_ADVANCED_SETTINGS.llmProvider,
      llmTemperature: DEFAULT_ADVANCED_SETTINGS.llmTemperature,
      llmModel: DEFAULT_ADVANCED_SETTINGS.llmModel,
      transcriptionPrompt: DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
      editingPrompt: DEFAULT_ADVANCED_SETTINGS.editingPrompt,
      noSpeechThreshold: DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold,
    },
    groqApiKey: '',
    openRouterApiKey: '',
    shortVoiceModelKey: DEFAULT_SHORT_VOICE_KEY,
    longVoiceModelKey: DEFAULT_LONG_VOICE_KEY,
    textModelKey: DEFAULT_TEXT_KEY,
    longDictationEnabled: true,
    longDictationThresholdMs: LONG_DICTATION_THRESHOLD_MS,
  },
  openMic: false,
  selectedAudioInput: null,
  interactionSounds: false,
  userProfile: {
    id: 'self-hosted',
    provider: 'self-hosted',
  },
  idToken: null,
  accessToken: null,
  appliedMigrations: [],
}

// Lightweight store-like interface used for migrations and defaults logic
type StoreLike = {
  get: (path: string) => any
  set: (path: string, value: any) => void
}

// In-memory cache that backs synchronous reads and dot-path writes
const cache: Record<string, any> = {
  [STORE_KEYS.MAIN]: defaultValues.main,
  [STORE_KEYS.ONBOARDING]: defaultValues.onboarding,
  [STORE_KEYS.SETTINGS]: defaultValues.settings,
  [STORE_KEYS.AUTH]: defaultValues.auth,
  [STORE_KEYS.ADVANCED_SETTINGS]: defaultValues.advancedSettings,
  [STORE_KEYS.OPEN_MIC]: defaultValues.openMic,
  [STORE_KEYS.SELECTED_AUDIO_INPUT]: defaultValues.selectedAudioInput,
  [STORE_KEYS.INTERACTION_SOUNDS]: defaultValues.interactionSounds,
  [STORE_KEYS.USER_PROFILE]: defaultValues.userProfile,
  [STORE_KEYS.ID_TOKEN]: defaultValues.idToken,
  [STORE_KEYS.ACCESS_TOKEN]: defaultValues.accessToken,
  appliedMigrations: defaultValues.appliedMigrations,
}

const isObject = (v: any) =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function deepGet(obj: any, pathParts: string[]): any {
  return pathParts.reduce(
    (acc, part) => (acc == null ? undefined : acc[part]),
    obj,
  )
}

function deepSet(obj: any, pathParts: string[], value: any): any {
  if (pathParts.length === 0) return value
  const [head, ...rest] = pathParts
  const target = isObject(obj) ? obj : {}
  return {
    ...target,
    [head]: rest.length === 0 ? value : deepSet(target[head], rest, value),
  }
}

async function persistTopLevelKey(key: string) {
  try {
    if (key === STORE_KEYS.ADVANCED_SETTINGS) {
      const value = cache[key] || {}
      const toPersist: any = { ...value }
      for (const keyField of ENCRYPTED_API_KEY_FIELDS) {
        if (toPersist[keyField]) {
          try {
            if (safeStorageApi?.isEncryptionAvailable?.()) {
              toPersist[`${keyField}Encrypted`] = safeStorageApi
                .encryptString(toPersist[keyField])
                .toString('base64')
            } else {
              toPersist[`${keyField}Encrypted`] = toPersist[keyField]
            }
          } catch {
            console.warn(`[store] Failed to encrypt ${keyField}, storing as-is`)
            toPersist[`${keyField}Encrypted`] = toPersist[keyField]
          }
        }
        delete toPersist[keyField]
      }
      await KeyValueStore.set(key, JSON.stringify(toPersist))
      return
    }

    await KeyValueStore.set(key, JSON.stringify(cache[key]))
  } catch (err) {
    console.error('[store] Failed to persist key', key, err)
  }
}

export const store: StoreLike & {
  delete: (key: string) => void
} = {
  get: (path: string) => {
    if (!path || typeof path !== 'string') return undefined
    if (path.includes('.')) {
      const [top, ...rest] = path.split('.')
      const topVal = cache[top]
      return deepGet(topVal, rest)
    }
    return cache[path]
  },
  set: (path: string, value: any) => {
    if (!path || typeof path !== 'string') return
    if (path.includes('.')) {
      const [top, ...rest] = path.split('.')
      const current = cache[top]
      cache[top] = deepSet(current, rest, value)
      void persistTopLevelKey(top)
      return
    }
    cache[path] = value
    void persistTopLevelKey(path)
  },
  delete: (key: string) => {
    if (!key || typeof key !== 'string') return
    delete cache[key]
    KeyValueStore.delete(key).catch(err =>
      console.error('[store] Failed to delete key', key, err),
    )
  },
}

type Migration = { id: string; run: (s: StoreLike) => void }

const migrations: Migration[] = [
  {
    id: '2026-03-05-interaction-sound-theme-default',
    run: s => {
      const settings = (s.get(STORE_KEYS.SETTINGS) ||
        {}) as Partial<SettingsStore>
      const currentTheme = settings.interactionSoundTheme
      if (
        currentTheme !== 'pop' &&
        currentTheme !== 'marimba' &&
        currentTheme !== 'custom'
      ) {
        s.set('settings.interactionSoundTheme', 'pop')
      }
    },
  },
  {
    id: '2025-08-15-keyboard-shortcut-rename',
    run: s => {
      const settings: any = s.get('settings') || {}
      const legacy = settings.keyboardShortcut
      const hasLegacy = Array.isArray(legacy) && legacy.length > 0
      const hasNew =
        Array.isArray(settings.keyboardShortcuts) &&
        settings.keyboardShortcuts.length > 0

      if (!hasNew && hasLegacy) {
        s.set('settings.keyboardShortcuts', [
          {
            id: crypto.randomUUID(),
            keys: legacy,
            mode: ItoMode.TRANSCRIBE,
          },
        ])
      }
      if ('keyboardShortcut' in settings) {
        delete settings.keyboardShortcut
        s.set('settings', settings)
      }
    },
  },
  {
    id: '2025-12-05-llm-model-migration',
    run: s => {
      const advanced: any = s.get(STORE_KEYS.ADVANCED_SETTINGS) || {}
      const model = advanced.llm?.llmModel
      if (model === 'llama3-8b-8192' || model === 'openai/gpt-oss-120b') {
        advanced.llm = {
          ...advanced.llm,
          llmModel: 'llama-3.1-8b-instant',
        }
        s.set(STORE_KEYS.ADVANCED_SETTINGS, advanced)
      }
    },
  },
  {
    id: '2026-08-14-groq-llama-shutdown',
    run: s => {
      // Groq shuts down llama-3.1-8b-instant and llama-3.3-70b-versatile on
      // 2026-08-16. Both were reachable defaults, so an install that never
      // touched the setting would start failing every EDIT dictation. Point
      // them at the replacements Groq itself recommends.
      const advanced: any = s.get(STORE_KEYS.ADVANCED_SETTINGS) || {}
      const replacements: Record<string, string> = {
        'llama3-8b-8192': 'openai/gpt-oss-20b',
        'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
      }
      const next = replacements[advanced.llm?.llmModel]
      if (next) {
        advanced.llm = { ...advanced.llm, llmModel: next }
        s.set(STORE_KEYS.ADVANCED_SETTINGS, advanced)
      }
    },
  },
  {
    // Must run after the Groq shutdown migration above: it reads llmModel, and
    // reading it before the dead ids were rewritten would drop the user onto
    // the default instead of onto their model's replacement.
    id: '2026-08-14-model-catalog-keys',
    run: s => {
      // Model choices move from raw slugs typed by hand to keys into the
      // curated catalogue, and the three-way engine mode collapses to a
      // toggle. Translate rather than reset: a stored slug that still exists
      // in the catalogue keeps the user's choice.
      const advanced: any = s.get(STORE_KEYS.ADVANCED_SETTINGS) || {}

      if (advanced.longDictationEnabled === undefined) {
        // 'openrouter' forced the precise engine on every dictation. Mapping
        // it to the toggle's on state keeps OpenRouter for long dictations and
        // hands short ones back to Groq — faster and far cheaper, never worse.
        advanced.longDictationEnabled =
          advanced.transcriptionEngineMode !== 'groq'
      }
      advanced.longDictationThresholdMs ??= LONG_DICTATION_THRESHOLD_MS

      advanced.shortVoiceModelKey ??=
        findModelBySlug('voice', advanced.llm?.asrModel, 'groq')?.key ??
        DEFAULT_SHORT_VOICE_KEY
      advanced.longVoiceModelKey ??=
        findModelBySlug('voice', advanced.openRouterModel, 'openrouter')?.key ??
        DEFAULT_LONG_VOICE_KEY
      // The local pipeline has always sent LLM calls to Groq, whatever
      // llmProvider said, so Groq is the right side of the lookup for the
      // models the catalogue lists twice.
      advanced.textModelKey ??=
        findModelBySlug('text', advanced.llm?.llmModel, 'groq')?.key ??
        DEFAULT_TEXT_KEY

      delete advanced.transcriptionEngineMode
      delete advanced.openRouterModel
      s.set(STORE_KEYS.ADVANCED_SETTINGS, advanced)
    },
  },
  {
    id: '2026-08-14-whisper-turbo-default',
    run: s => {
      // Benchmarked on Caleb's own dictations: whisper-large-v3 degenerates
      // into repeating its own prompt and inventing text — 8.9% word error on
      // 79s, 82.9% on 149s, and already wrong at 40s. whisper-large-v3-turbo
      // scores 1.6% on the same 79s clip while being faster and 3x cheaper.
      // v3 was only ever a default, never a choice anyone made on evidence, so
      // move installs off it.
      const advanced: any = s.get(STORE_KEYS.ADVANCED_SETTINGS) || {}
      if (advanced.shortVoiceModelKey === 'whisper-large-v3') {
        advanced.shortVoiceModelKey = 'whisper-large-v3-turbo'
        s.set(STORE_KEYS.ADVANCED_SETTINGS, advanced)
      }
    },
  },
  {
    id: '2026-07-26-mute-audio-when-dictating-default-on',
    run: s => {
      // Muting other audio while dictating is now on by default: it removes
      // the main source of distraction during recording (and, on Windows,
      // stops other apps' audio from bleeding into the mic). Existing
      // installs predate the Windows implementation, so their stored `false`
      // is a platform limitation, not a user choice — flip it once.
      s.set('settings.muteAudioWhenDictating', true)
    },
  },
  {
    id: '2025-12-11-self-hosted-user-profile',
    run: s => {
      // Ensure userProfile exists with self-hosted user for local-only mode
      // This fixes the issue where notes/dictionary were saved but not retrieved
      const userProfile = s.get(STORE_KEYS.USER_PROFILE)
      if (!userProfile || !userProfile.id) {
        s.set(STORE_KEYS.USER_PROFILE, {
          id: 'self-hosted',
          provider: 'self-hosted',
        })
        console.log('[migrations] Initialized self-hosted user profile')
      }
    },
  },
]

// ---------- Migration runner ----------
function runMigrations(s: StoreLike, allMigrations: Migration[]) {
  const applied = new Set(s.get('appliedMigrations') || [])
  for (const m of allMigrations) {
    if (!applied.has(m.id)) {
      console.log(`[migrations] Running: ${m.id}`)
      try {
        m.run(s)
        applied.add(m.id)
      } catch (err) {
        console.error(`[migrations] Failed: ${m.id}`, err)
      }
    }
  }
  s.set('appliedMigrations', Array.from(applied))
}

function ensureDefaultsDeep<T = unknown>(
  s: StoreLike,
  defaults: T,
  basePath = '',
  exclude: Set<string> = new Set(['appliedMigrations']), // skip internal/meta keys
) {
  const isObj = (v: any) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)

  for (const [key, defaultValue] of Object.entries(defaults as any)) {
    if (exclude.has(key)) continue

    const path = basePath ? `${basePath}.${key}` : key
    const currentValue = s.get(path)

    // Primitives or arrays: set only if truly missing/undefined
    if (!isObj(defaultValue)) {
      if (currentValue === undefined) s.set(path, defaultValue)
      continue
    }

    // Objects:
    if (currentValue === undefined || !isObj(currentValue)) {
      // If missing or wrong shape, seed the whole object from defaults
      s.set(path, defaultValue)
    } else {
      // Recurse to fill only missing leaves
      ensureDefaultsDeep(s, defaultValue, path, exclude)
    }
  }
}

// Load cached values from SQLite and migrate from legacy electron-store if needed
export async function initializeStore() {
  // 1) Load from SQLite KV for known top-level keys
  const topLevelKeys: string[] = [
    STORE_KEYS.MAIN,
    STORE_KEYS.ONBOARDING,
    STORE_KEYS.SETTINGS,
    STORE_KEYS.AUTH,
    STORE_KEYS.ADVANCED_SETTINGS,
    STORE_KEYS.OPEN_MIC,
    STORE_KEYS.SELECTED_AUDIO_INPUT,
    STORE_KEYS.INTERACTION_SOUNDS,
    STORE_KEYS.USER_PROFILE,
    STORE_KEYS.ID_TOKEN,
    STORE_KEYS.ACCESS_TOKEN,
    'appliedMigrations',
  ]

  for (const key of topLevelKeys) {
    try {
      const str = await KeyValueStore.get(key)
      if (str !== undefined) {
        try {
          cache[key] = JSON.parse(str)
        } catch {
          cache[key] = str
        }

        if (key === STORE_KEYS.ADVANCED_SETTINGS) {
          const stored = cache[key] as any
          const restored: any = { ...stored }
          for (const keyField of ENCRYPTED_API_KEY_FIELDS) {
            let decrypted = ''
            const encrypted = stored?.[`${keyField}Encrypted`]
            if (encrypted) {
              try {
                if (safeStorageApi?.isEncryptionAvailable?.()) {
                  decrypted = safeStorageApi.decryptString(
                    Buffer.from(encrypted, 'base64'),
                  )
                } else {
                  decrypted = encrypted
                }
              } catch (err) {
                console.warn(`[store] Failed to decrypt ${keyField}`, err)
              }
            }
            restored[keyField] = decrypted || stored?.[keyField] || ''
            delete restored[`${keyField}Encrypted`]
          }
          cache[key] = restored
        }
      }
    } catch (err) {
      console.error('[store] Failed loading key from SQLite', key, err)
    }
  }

  // 2) One-time migration from electron-store → SQLite (backwards compatibility)
  try {
    const migrated = await KeyValueStore.get('migration:electron_store_v1_done')
    if (migrated !== 'true') {
      try {
        const { default: LegacyStore } = await import('electron-store')
        const legacy = new LegacyStore<AppStore>({ defaults: defaultValues })
        const migrateKeys = [
          STORE_KEYS.MAIN,
          STORE_KEYS.ONBOARDING,
          STORE_KEYS.SETTINGS,
          STORE_KEYS.AUTH,
          STORE_KEYS.ADVANCED_SETTINGS,
          STORE_KEYS.OPEN_MIC,
          STORE_KEYS.SELECTED_AUDIO_INPUT,
          STORE_KEYS.INTERACTION_SOUNDS,
          STORE_KEYS.USER_PROFILE,
          STORE_KEYS.ID_TOKEN,
          STORE_KEYS.ACCESS_TOKEN,
          'appliedMigrations',
        ]
        for (const key of migrateKeys) {
          try {
            const fromLegacy = legacy.get(key as any)
            if (fromLegacy !== undefined) {
              // If cache value equals default and legacy has a differing value, prefer legacy
              cache[key] = fromLegacy
              await KeyValueStore.set(key, JSON.stringify(fromLegacy))
            }
          } catch (err) {
            console.warn('[store] Legacy migration read failed for', key, err)
          }
        }
        await KeyValueStore.set('migration:electron_store_v1_done', 'true')
      } catch (err) {
        console.warn(
          '[store] Legacy electron-store not available, skipping migration',
          err,
        )
      }
    }
  } catch (err) {
    console.error('[store] Failed checking migration marker', err)
  }

  // 3) Ensure defaults are present for any missing values
  ensureDefaultsDeep(store, defaultValues)

  // 4) Run migrations (idempotent) unless tests explicitly skip
  if (process.env.NODE_ENV !== 'test') {
    runMigrations(store, migrations)
  }
}

export default store
