import { app } from 'electron'
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import store from './store'
import { STORE_KEYS } from '../constants/store-keys'
import type { InteractionSoundTheme } from './store'
import { IPC_EVENTS } from '../types/ipc'
import { getPillWindow, mainWindow } from './app'

const BUNDLED_SOUND_FILES: Record<
  Exclude<InteractionSoundTheme, 'custom'>,
  string
> = {
  pop: 'pop-interaction-complete.wav',
  marimba: 'marimba-interaction-complete.wav',
}

const CUSTOM_SOUND_DIR = path.join(app.getPath('userData'), 'sounds')
const CUSTOM_SOUND_BASENAME = 'custom-interaction-complete'
const CUSTOM_SOUND_EXTENSIONS = ['.wav', '.mp3'] as const
const CUSTOM_SOUND_META_FILE = path.join(
  CUSTOM_SOUND_DIR,
  `${CUSTOM_SOUND_BASENAME}.meta.json`,
)

type SupportedCustomExtension = (typeof CUSTOM_SOUND_EXTENSIONS)[number]

export type InteractionSoundPlayPayload = {
  audioData: Uint8Array
  mimeType: string
  fileName: string
  theme: InteractionSoundTheme
}

type PlaybackResult =
  | { success: true; target: 'main' | 'pill'; payload: InteractionSoundPlayPayload }
  | { success: false; message: string }

const getThemeFromSettings = (): InteractionSoundTheme => {
  const settings = store.get(STORE_KEYS.SETTINGS)
  const theme = settings?.interactionSoundTheme

  if (theme === 'marimba' || theme === 'custom') {
    return theme
  }
  return 'pop'
}

const getBundledSoundPath = (
  theme: Exclude<InteractionSoundTheme, 'custom'>,
) => {
  const fileName = BUNDLED_SOUND_FILES[theme]
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'sounds', fileName)
  }

  return path.resolve(__dirname, '../../resources/sounds', fileName)
}

const findInstalledCustomSound = () => {
  for (const extension of CUSTOM_SOUND_EXTENSIONS) {
    const filePath = path.join(
      CUSTOM_SOUND_DIR,
      `${CUSTOM_SOUND_BASENAME}${extension}`,
    )
    if (fs.existsSync(filePath)) {
      return { path: filePath, extension }
    }
  }

  return null
}

const resolveActiveSoundPath = (): {
  path: string
  theme: InteractionSoundTheme
} => {
  const theme = getThemeFromSettings()

  if (theme === 'custom') {
    const custom = findInstalledCustomSound()
    if (custom) {
      return { path: custom.path, theme }
    }

    console.warn(
      '[soundFeedback] Custom interaction sound not found. Falling back to pop.',
    )
  }

  const fallbackTheme = theme === 'marimba' ? 'marimba' : 'pop'
  return { path: getBundledSoundPath(fallbackTheme), theme: fallbackTheme }
}

const getMimeTypeFromPath = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.mp3') {
    return 'audio/mpeg'
  }
  return 'audio/wav'
}

const readCustomMeta = async () => {
  try {
    const raw = await fsp.readFile(CUSTOM_SOUND_META_FILE, 'utf8')
    return JSON.parse(raw) as { originalFileName?: string }
  } catch {
    return {}
  }
}

const getCustomFileDisplayNameSync = () => {
  const custom = findInstalledCustomSound()
  if (!custom) return null

  try {
    const raw = fs.readFileSync(CUSTOM_SOUND_META_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { originalFileName?: string }
    if (parsed?.originalFileName) {
      return parsed.originalFileName
    }
  } catch {
    // no-op
  }

  return path.basename(custom.path)
}

const buildActivePayload = (): PlaybackResult => {
  const resolved = resolveActiveSoundPath()
  const soundPath = resolved.path
  if (!fs.existsSync(soundPath)) {
    return {
      success: false,
      message: `Sound file not found at ${soundPath}`,
    }
  }

  const bytes = fs.readFileSync(soundPath)
  const payload: InteractionSoundPlayPayload = {
    audioData: Uint8Array.from(bytes),
    mimeType: getMimeTypeFromPath(soundPath),
    fileName: path.basename(soundPath),
    theme: resolved.theme,
  }

  const targetMain = mainWindow
  if (targetMain && !targetMain.isDestroyed()) {
    targetMain.webContents.send(IPC_EVENTS.INTERACTION_SOUND_PLAY, payload)
    return { success: true, target: 'main', payload }
  }

  const targetPill = getPillWindow()
  if (targetPill && !targetPill.isDestroyed()) {
    targetPill.webContents.send(IPC_EVENTS.INTERACTION_SOUND_PLAY, payload)
    return { success: true, target: 'pill', payload }
  }

  return {
    success: false,
    message: 'No renderer window is available to play the interaction sound.',
  }
}

export const getCustomInteractionSoundInfo = () => {
  const custom = findInstalledCustomSound()
  if (!custom) {
    return { exists: false, fileName: null as string | null }
  }

  return {
    exists: true,
    fileName: getCustomFileDisplayNameSync(),
  }
}

export const hasCustomInteractionSound = () => {
  return findInstalledCustomSound() !== null
}

export const installCustomInteractionSound = async (sourcePath: string) => {
  if (!sourcePath || typeof sourcePath !== 'string') {
    return { success: false, message: 'Invalid file path.' }
  }

  const extension = path.extname(sourcePath).toLowerCase()
  if (!CUSTOM_SOUND_EXTENSIONS.includes(extension as SupportedCustomExtension)) {
    return { success: false, message: 'Only .wav and .mp3 files are supported.' }
  }

  if (!fs.existsSync(sourcePath)) {
    return { success: false, message: 'Selected file does not exist.' }
  }

  try {
    await fsp.mkdir(CUSTOM_SOUND_DIR, { recursive: true })

    await Promise.all(
      CUSTOM_SOUND_EXTENSIONS.map(async existingExtension => {
        const existingPath = path.join(
          CUSTOM_SOUND_DIR,
          `${CUSTOM_SOUND_BASENAME}${existingExtension}`,
        )

        try {
          await fsp.unlink(existingPath)
        } catch (error: any) {
          if (error?.code !== 'ENOENT') {
            throw error
          }
        }
      }),
    )

    const targetPath = path.join(
      CUSTOM_SOUND_DIR,
      `${CUSTOM_SOUND_BASENAME}${extension}`,
    )
    await fsp.copyFile(sourcePath, targetPath)

    await fsp.writeFile(
      CUSTOM_SOUND_META_FILE,
      JSON.stringify({ originalFileName: path.basename(sourcePath) }),
      'utf8',
    )

    const meta = await readCustomMeta()

    return {
      success: true,
      path: targetPath,
      fileName: meta.originalFileName || path.basename(sourcePath),
    }
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Unable to install custom sound.',
    }
  }
}

export const playInteractionCompletionSound = () => {
  const result = buildActivePayload()
  if (!result.success) {
    console.warn(`[soundFeedback] ${result.message}`)
  }
}

export const playInteractionCompletionSoundTest = () => {
  const result = buildActivePayload()
  if (!result.success) {
    console.warn(`[soundFeedback] ${result.message}`)
    return result
  }

  return {
    success: true,
    target: result.target,
    fileName: result.payload.fileName,
    mimeType: result.payload.mimeType,
    theme: result.payload.theme,
  }
}
