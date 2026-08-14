import { ipcMain } from 'electron'
import { ModesTable, ModeExamplesTable } from '../main/modes/ModeRepository'
import {
  getActiveModeId,
  setActiveModeId,
  cycleActiveMode,
} from '../main/modes/activeMode'
import { findPreset, MODE_PRESETS } from '../constants/modePresets'
import { getCurrentUserId } from '../main/store'
import { recordingStateNotifier } from '../main/recordingStateNotifier'
import type { Mode } from '../main/sqlite/models'

/**
 * Canaux IPC des modes.
 *
 * Sortis de `ipcEvents.ts`, qui frôle les mille lignes : les modes ont onze
 * canaux à eux seuls et leur logique de création mérite d'être lisible.
 */

const userId = () => getCurrentUserId() || 'self-hosted'

const BLANK = MODE_PRESETS.find(preset => preset.key === 'blank')!

/** Les champs d'un mode qui viennent d'un preset, sans l'identité. */
function fieldsFromPreset(presetKey: string) {
  const preset = findPreset(presetKey) ?? BLANK
  return {
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
  }
}

export function registerModeIpc() {
  ipcMain.handle('modes:get-all', () => ModesTable.findAll(userId()))

  ipcMain.handle(
    'modes:create',
    async (_e, presetKey: string, name: string) => {
      const modes = await ModesTable.findAll(userId())
      return ModesTable.insert({
        userId: userId(),
        name: name.trim() || findPreset(presetKey)?.label || 'New mode',
        sortOrder: modes.length,
        ...fieldsFromPreset(presetKey),
      } as any)
    },
  )

  ipcMain.handle('modes:update', (_e, id: string, patch: Partial<Mode>) =>
    ModesTable.update(id, patch),
  )

  ipcMain.handle('modes:delete', async (_e, id: string) => {
    // Le pipeline résout toujours un mode : n'en laisser aucun le ferait
    // échouer sur chaque dictée.
    if ((await ModesTable.count(userId())) <= 1) {
      return { ok: false, error: 'The last mode cannot be deleted' }
    }
    await ModesTable.softDelete(id)
    if (getActiveModeId() === id) {
      const remaining = await ModesTable.findAll(userId())
      setActiveModeId(remaining[0].id)
    }
    return { ok: true }
  })

  ipcMain.handle('modes:duplicate', async (_e, id: string) => {
    const source = await ModesTable.findById(id)
    if (!source) return null

    const modes = await ModesTable.findAll(userId())
    const copy = await ModesTable.insert({
      userId: userId(),
      name: `${source.name} (copy)`,
      sortOrder: modes.length,
      preset: source.preset,
      icon: source.icon,
      instructions: source.instructions,
      language: source.language,
      voiceModelKey: source.voiceModelKey,
      textModelKey: source.textModelKey,
      useLlm: source.useLlm,
      contextApplication: source.contextApplication,
      contextClipboard: source.contextClipboard,
      contextSelection: source.contextSelection,
      audioSource: source.audioSource,
      playbackWhenRecording: source.playbackWhenRecording,
      autoPaste: source.autoPaste,
      autocapitalize: source.autocapitalize,
      identifySpeakers: source.identifySpeakers,
      asrPrompt: source.asrPrompt,
    } as any)

    for (const example of await ModeExamplesTable.findByMode(id)) {
      await ModeExamplesTable.insert({
        modeId: copy.id,
        spokenInput: example.spokenInput,
        aiOutput: example.aiOutput,
        sortOrder: example.sortOrder,
      })
    }

    return copy
  })

  // Sans cette notification, la pill garderait l'ancien mode après un clic
  // dans la page Modes.
  ipcMain.handle('modes:set-active', async (_e, id: string) => {
    setActiveModeId(id)
    const mode = await ModesTable.findById(id)
    if (mode) recordingStateNotifier.notifyActiveModeChanged(mode)
  })
  ipcMain.handle('modes:get-active', () => getActiveModeId())
  ipcMain.handle('modes:cycle-active', async (_e, direction: 1 | -1 = 1) => {
    const mode = await cycleActiveMode(direction)
    recordingStateNotifier.notifyActiveModeChanged(mode)
    return mode
  })

  ipcMain.handle('modes:examples:get', (_e, modeId: string) =>
    ModeExamplesTable.findByMode(modeId),
  )
  ipcMain.handle(
    'modes:examples:add',
    async (_e, modeId: string, spokenInput: string, aiOutput: string) => {
      const existing = await ModeExamplesTable.findByMode(modeId)
      return ModeExamplesTable.insert({
        modeId,
        spokenInput,
        aiOutput,
        sortOrder: existing.length,
      })
    },
  )
  ipcMain.handle(
    'modes:examples:update',
    (_e, id: string, spokenInput: string, aiOutput: string) =>
      ModeExamplesTable.update(id, spokenInput, aiOutput),
  )
  ipcMain.handle('modes:examples:delete', (_e, id: string) =>
    ModeExamplesTable.softDelete(id),
  )
}
