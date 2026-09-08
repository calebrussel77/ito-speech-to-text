import { plugin } from 'bun'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { SafeStorageLike } from './safeStorage'

/**
 * Ce qu'il faut pour charger le pipeline de transcription d'Ito hors
 * Electron. Deux modules seulement lui manquent :
 *
 * - `electron` : le code de production n'en touche, sur ce chemin, que le
 *   dossier de profil, `safeStorage` pour les clés, et des fenêtres à
 *   prévenir qui n'existent pas ici ;
 * - `./mp3EncoderWorker?nodeWorker` : une syntaxe d'electron-vite qui
 *   fabrique un worker Node à partir d'un fichier ; Bun exécute le TypeScript
 *   du worker tel quel.
 *
 * Même approche que `lib/__tests__/setup.ts`, qui fait tourner ce pipeline
 * dans la suite de tests, ici pour de vrai.
 */
export function installShims(options: {
  userDataDir: string
  safeStorage: SafeStorageLike
  version: string
}) {
  const noop = () => {}
  const paths: Record<string, string> = {
    userData: options.userDataDir,
    appData: path.dirname(options.userDataDir),
    logs: path.join(options.userDataDir, 'logs'),
    temp: path.join(options.userDataDir, 'tmp'),
    home: process.env.USERPROFILE ?? process.env.HOME ?? options.userDataDir,
  }
  fs.mkdirSync(paths.logs, { recursive: true })

  class BrowserWindow {
    webContents = { send: noop, on: noop }
    static getAllWindows() {
      return []
    }
    static getFocusedWindow() {
      return null
    }
    on() {}
    isDestroyed() {
      return true
    }
  }

  const electron = {
    app: {
      getPath: (name: string) => paths[name] ?? options.userDataDir,
      setPath: noop,
      getName: () => 'Ito',
      setName: noop,
      getVersion: () => options.version,
      isPackaged: true,
      quit: noop,
      exit: noop,
      on: noop,
      once: noop,
      whenReady: () => Promise.resolve(),
      isReady: () => true,
      dock: { hide: noop, show: noop },
    },
    BrowserWindow,
    safeStorage: options.safeStorage,
    clipboard: {
      readText: () => '',
      writeText: noop,
      availableFormats: () => [],
    },
    ipcMain: { handle: noop, on: noop, removeHandler: noop },
    Notification: class {
      static isSupported() {
        return false
      }
      show() {}
      on() {}
    },
    shell: { openExternal: async () => {}, showItemInFolder: noop },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({
        workArea: { x: 0, y: 0, width: 0, height: 0 },
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        scaleFactor: 1,
      }),
      on: noop,
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    systemPreferences: {
      isTrustedAccessibilityClient: () => false,
      getMediaAccessStatus: () => 'granted',
    },
    nativeImage: { createFromPath: () => ({}) },
    powerMonitor: { on: noop },
    // Importés par des modules que le chemin fichier entraîne sans les
    // utiliser (menu, tray, protocole de la fenêtre) : un nom suffit.
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: noop },
    Tray: class {
      setToolTip() {}
      setContextMenu() {}
      on() {}
    },
    net: { fetch: globalThis.fetch },
    powerSaveBlocker: { start: () => 0, stop: noop, isStarted: () => false },
    protocol: { registerSchemesAsPrivileged: noop, handle: noop },
    ipcRenderer: { on: noop, send: noop, invoke: async () => undefined },
    contextBridge: { exposeInMainWorld: noop },
  }

  plugin({
    name: 'ito-transcribe-shims',
    setup(build) {
      // Un module virtuel prime sur celui de node_modules ; `onResolve`, lui,
      // n'est pas consulté pour un paquet installé.
      build.module('electron', () => ({
        exports: { ...electron, default: electron },
        loader: 'object',
      }))

      // `icon.png?asset` : electron-vite y met le chemin du fichier.
      build.onLoad({ filter: /\?asset$/ }, args => ({
        exports: { default: args.path.replace(/\?asset$/, '') },
        loader: 'object',
      }))

      // Bun résout `./x?nodeWorker` vers le fichier, requête comprise, puis
      // demande son contenu : c'est là qu'on rend la fabrique de worker.
      build.onLoad({ filter: /\?nodeWorker$/ }, args => {
        const file = args.path.replace(/\?nodeWorker$/, '')
        return {
          exports: {
            default: (workerOptions?: object) =>
              new Worker(file, workerOptions),
          },
          loader: 'object',
        }
      })
    },
  })
}
