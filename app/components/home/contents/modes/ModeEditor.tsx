import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import { findPreset } from '@/lib/constants/modePresets'
import {
  SettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsNote,
  CONTROL_WIDTH,
} from '@/app/components/ui/settings'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Switch } from '@/app/components/ui/switch'
import { Button } from '@/app/components/ui/button'
import { ChevronLeft } from '@mynaui/icons-react'
import PresetSelect from './PresetSelect'
import LanguageSelect from './LanguageSelect'
import ModelSelect from './ModelSelect'
import ContextToggles from './ContextToggles'
import ExamplesEditor from './ExamplesEditor'
import { modeIcon } from './modeIcons'
import type { ModeLanguage } from '@/lib/constants/modeLanguages'
import MultiShortcutEditor from '@/app/components/ui/multi-shortcut-editor'
import { cn } from '@/lib/utils'

const INSTRUCTIONS_LIMIT = 3500
const ASR_PROMPT_LIMIT = 100

export default function ModeEditor({
  modeId,
  onBack,
}: {
  modeId: string
  onBack: () => void
}) {
  const { modes, update, updateLocal, remove, duplicate } = useModesStore()
  const { groqApiKey, openRouterApiKey } = useAdvancedSettingsStore()
  const { keyboardShortcuts } = useSettingsStore()
  const platform = usePlatform()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [shortcutError, setShortcutError] = useState('')
  // One timer per field (name / instructions / asrPrompt) — a single shared
  // timer meant editing field A then field B inside the debounce window only
  // ever persisted B, silently reverting A on the next load.
  const debounceTimersRef = useRef<
    Partial<Record<string, ReturnType<typeof setTimeout>>>
  >({})
  // The write each timer is waiting to perform, keyed the same way, so it can
  // be flushed instead of dropped (unmount) or raced (applyPreset).
  const pendingWritesRef = useRef<Partial<Record<string, () => void>>>({})

  // Passed to MultiShortcutEditor so a rejected shortcut (duplicate or
  // reserved) shows up as a SettingsNote here, not just in the editor's own
  // inline text — see the note in multi-shortcut-editor.tsx.
  const handleShortcutError = useCallback(
    (message: string) => setShortcutError(message),
    [],
  )

  const mode = modes.find(item => item.id === modeId)

  useEffect(() => {
    return () => {
      // Flush, don't drop: type into a field then click back within the
      // debounce window used to lose the edit outright, since the timer was
      // only ever cleared here, never fired. Refs (not `mode`, which this
      // effect closes over once) so the flush always sees the latest patch.
      for (const timer of Object.values(debounceTimersRef.current)) {
        if (timer) clearTimeout(timer)
      }
      for (const flush of Object.values(pendingWritesRef.current)) {
        flush?.()
      }
      debounceTimersRef.current = {}
      pendingWritesRef.current = {}
    }
  }, [])

  const availableProviders = useMemo(() => {
    const providers = new Set<string>()
    if (groqApiKey) providers.add('groq')
    if (openRouterApiKey) providers.add('openrouter')
    return providers
  }, [groqApiKey, openRouterApiKey])

  useEffect(() => {
    if (!mode) onBack()
  }, [mode, onBack])

  if (!mode) return null

  const Icon = modeIcon(mode.icon)
  const set = (patch: Record<string, unknown>) => void update(mode.id, patch)

  // Free-text fields fire on every keystroke; an IPC round trip plus a
  // SQLite UPDATE per character (up to 3500 of them for instructions) is
  // wasteful. Mirrors AdvancedSettingsContent's 1000 ms debounce: the local
  // store still updates immediately so typing stays responsive, only the
  // persist is delayed. `field` keys the timer so name/instructions/asrPrompt
  // debounce independently — see debounceTimersRef.
  const setDebounced = (field: string, patch: Record<string, unknown>) => {
    updateLocal(mode.id, patch)
    const existing = debounceTimersRef.current[field]
    if (existing) clearTimeout(existing)
    pendingWritesRef.current[field] = () => {
      delete debounceTimersRef.current[field]
      delete pendingWritesRef.current[field]
      void update(mode.id, patch)
    }
    debounceTimersRef.current[field] = setTimeout(() => {
      pendingWritesRef.current[field]?.()
    }, 1000)
  }

  // Resolve every pending debounced write immediately, in the order they were
  // scheduled. Called before any immediate write (applyPreset) so a trailing
  // debounced patch can never land after it and silently undo it.
  const flushDebounced = () => {
    for (const timer of Object.values(debounceTimersRef.current)) {
      if (timer) clearTimeout(timer)
    }
    for (const flush of Object.values(pendingWritesRef.current)) {
      flush?.()
    }
  }

  const applyPreset = (presetKey: string) => {
    const preset = findPreset(presetKey)
    if (!preset) return
    flushDebounced()
    set({
      preset: preset.key,
      icon: preset.icon,
      instructions: preset.instructions,
      language: preset.language,
      voiceModelKey: preset.voiceModelKey,
      textModelKey: preset.textModelKey,
      useLlm: preset.useLlm,
      contextApplication: preset.contextApplication,
      contextClipboard: preset.contextClipboard,
      contextSelection: preset.contextSelection,
      audioSource: preset.audioSource,
      playbackWhenRecording: preset.playbackWhenRecording,
      autoPaste: preset.autoPaste,
      autocapitalize: preset.autocapitalize,
      identifySpeakers: preset.identifySpeakers,
      asrPrompt: preset.asrPrompt,
    })
  }

  return (
    <div className="px-1.5">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <Icon className="size-4 text-[var(--subtle-foreground)]" />
        <Input
          value={mode.name}
          onChange={event => setDebounced('name', { name: event.target.value })}
          className="h-7 max-w-[240px] text-xs"
        />
      </div>

      <SettingsGroup>
        <div className="py-2.5">
          <PresetSelect
            preset={mode.preset}
            instructions={mode.instructions}
            onApply={applyPreset}
          />
        </div>
      </SettingsGroup>

      <SettingsRow
        title="Rewrite the dictation"
        description="Off inserts the raw transcript. Nothing can be invented, and nothing is cleaned up."
      >
        <Switch
          checked={mode.useLlm}
          onCheckedChange={useLlm => set({ useLlm })}
        />
      </SettingsRow>

      {mode.useLlm && (
        <>
          <SettingsCard
            title="Custom instructions"
            description="What this mode turns a dictation into. Keep the Role / Instructions / Critical structure — it is what stops the model from answering instead of formatting."
            action={
              <span className="text-[10px] tabular-nums text-[var(--subtle-foreground)]">
                {mode.instructions.length}/{INSTRUCTIONS_LIMIT}
              </span>
            }
          >
            <Textarea
              value={mode.instructions}
              maxLength={INSTRUCTIONS_LIMIT}
              rows={10}
              placeholder="## Role&#10;You are a text formatting AI…"
              onChange={event =>
                setDebounced('instructions', {
                  instructions: event.target.value,
                })
              }
            />
          </SettingsCard>

          <div className="mb-3">
            <div className="mb-1.5 text-xs font-medium text-foreground">
              Context
            </div>
            <ContextToggles mode={mode} onChange={set} />
          </div>

          <ExamplesEditor modeId={mode.id} />
        </>
      )}

      <SettingsGroup title="Engine">
        <SettingsRow
          title="Language"
          description="Sent to the voice model and imposed on the output. Automatic detects it, at some cost in accuracy."
        >
          <LanguageSelect
            value={mode.language as ModeLanguage}
            onChange={language => set({ language })}
          />
        </SettingsRow>

        <SettingsRow
          title="Voice model"
          description="Transcribes the recording. Long recordings switch to the file path automatically."
        >
          <ModelSelect
            kind="voice"
            value={mode.voiceModelKey}
            availableProviders={availableProviders}
            onChange={voiceModelKey => set({ voiceModelKey })}
          />
        </SettingsRow>

        {mode.useLlm && (
          <SettingsRow
            title="Text model"
            description="Rewrites the transcript following the instructions above."
          >
            <ModelSelect
              kind="text"
              value={mode.textModelKey}
              availableProviders={availableProviders}
              onChange={textModelKey => set({ textModelKey })}
            />
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title="Shortcut">
        <SettingsRow
          title="Dedicated shortcut"
          description="Starts a dictation in this mode, regardless of which mode is currently active."
          align="start"
        >
          <MultiShortcutEditor
            shortcuts={keyboardShortcuts}
            modeId={mode.id}
            onError={handleShortcutError}
          />
        </SettingsRow>
      </SettingsGroup>

      {shortcutError && (
        <SettingsNote tone="error">{shortcutError}</SettingsNote>
      )}

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mb-2 text-xs font-medium text-[var(--subtle-foreground)] hover:text-foreground"
      >
        {showAdvanced ? '▾' : '▸'} Advanced settings
      </button>

      {showAdvanced && (
        <>
          <SettingsGroup title="Insertion">
            <SettingsRow
              title="Auto paste"
              description="Off copies the result to the clipboard and notifies you instead of typing it at the cursor."
            >
              <Switch
                checked={mode.autoPaste}
                onCheckedChange={autoPaste => set({ autoPaste })}
              />
            </SettingsRow>
            <SettingsRow
              title="Autocapitalize insert"
              description="Capitalize the first word when the cursor starts a sentence."
            >
              <Switch
                checked={mode.autocapitalize}
                onCheckedChange={autocapitalize => set({ autocapitalize })}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="Recording">
            <SettingsRow
              title="Audio source"
              description="System audio captures what your speakers play — a Meet or Teams call. Both mixes it with your microphone."
            >
              <select
                value={mode.audioSource}
                onChange={event => set({ audioSource: event.target.value })}
                className={cn(
                  'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
                  CONTROL_WIDTH,
                )}
              >
                <option value="microphone">Microphone</option>
                {/* Disabled, not removed: a mode synced from Windows (or the
                    seeded Meeting preset) can already hold 'system'/'both' on
                    a platform that can't capture them. The option must still
                    render so the select shows what the mode is actually set
                    to, and the user must still be able to reach
                    'microphone' from here — disabling the whole control
                    would trap them with no way back. */}
                <option value="system" disabled={platform !== 'win32'}>
                  System audio
                </option>
                <option value="both" disabled={platform !== 'win32'}>
                  Both
                </option>
              </select>
            </SettingsRow>

            {platform !== undefined && platform !== 'win32' && (
              <SettingsNote>
                Capturing system audio is Windows-only for now — switch to
                Microphone if this mode needs to work here.
              </SettingsNote>
            )}

            <SettingsRow
              title="Playback when recording"
              description="Muting other apps keeps dictations clean — but it would silence a call you are trying to record."
            >
              <select
                value={mode.playbackWhenRecording}
                onChange={event =>
                  set({ playbackWhenRecording: event.target.value })
                }
                className={cn(
                  'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
                  CONTROL_WIDTH,
                )}
              >
                <option value="mute">Mute other apps</option>
                <option value="leave">Leave it playing</option>
              </select>
            </SettingsRow>

            {mode.audioSource !== 'microphone' &&
              mode.playbackWhenRecording === 'mute' && (
                <SettingsNote tone="error">
                  Muting other apps while capturing system audio would record
                  silence. Set playback to “Leave it playing”.
                </SettingsNote>
              )}

            <SettingsRow
              title="Identify speakers"
              description="Separates who said what. Needs a Deepgram key and works best with Nova 3."
            >
              <Switch
                checked={mode.identifySpeakers}
                onCheckedChange={identifySpeakers => set({ identifySpeakers })}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsCard
            title="Transcription priming"
            description="The voice model mimics this text rather than obeying it: write a sample of the style you dictate in. Your dictionary is appended automatically."
            action={
              <span className="text-[10px] tabular-nums text-[var(--subtle-foreground)]">
                {mode.asrPrompt.length}/{ASR_PROMPT_LIMIT}
              </span>
            }
          >
            <Textarea
              value={mode.asrPrompt}
              maxLength={ASR_PROMPT_LIMIT}
              rows={3}
              onChange={event =>
                setDebounced('asrPrompt', { asrPrompt: event.target.value })
              }
            />
          </SettingsCard>

          <SettingsGroup title="Danger zone">
            <SettingsRow title="Duplicate this mode">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void duplicate(mode.id)}
              >
                Duplicate
              </Button>
            </SettingsRow>
            <SettingsRow
              title="Delete this mode"
              description={deleteError || undefined}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const result = await remove(mode.id)
                  if (result.ok) onBack()
                  else setDeleteError(result.error ?? 'Could not delete')
                }}
              >
                Delete
              </Button>
            </SettingsRow>
          </SettingsGroup>

          {deleteError && (
            <SettingsNote tone="error">{deleteError}</SettingsNote>
          )}
        </>
      )}
    </div>
  )
}
