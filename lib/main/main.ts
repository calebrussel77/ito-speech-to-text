import './env'
import { app, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  createAppWindow,
  createPillWindow,
  mainWindow,
  registerResourcesProtocol,
  startPillPositioner,
  setIsQuitting,
} from './app'
import { initializeLogging } from './logger'
import { registerIPC } from '../window/ipcEvents'
import { registerDevIPC } from '../window/ipcDev'
import { initializeDatabase } from './sqlite/db'
import { setupProtocolHandling, processStartupProtocolUrl } from '../protocol'
import { startKeyListener } from '../media/keyboard'
// Import the grpcClient singleton
import { grpcClient } from '../clients/grpcClient'
import { preventAppNap } from './appNap'
import { syncService } from './syncService'
import { checkAccessibilityPermission } from '../utils/crossPlatform'
import mainStore, { initializeStore } from './store'
import { STORE_KEYS } from '../constants/store-keys'
import { selectedTextReaderService } from '../media/selected-text-reader'
import { macOSAccessibilityContextProvider } from '../media/macOSAccessibilityContextProvider'
import { voiceInputService } from './voiceInputService'
import { itoStreamController } from './itoStreamController'
import { initializeMicrophoneSelection } from '../media/microphoneSetUp'
import { validateStoredTokens, ensureValidTokens } from '../auth/events'
import { Auth0Config, validateAuth0Config } from '../auth/config'
import { createAppTray } from './tray'
import { initializeAutoUpdater } from './autoUpdaterWrapper'
import { teardown } from './teardown'
import { ITO_ENV } from './env'
import {
  syncLoginItemWithStoredSettings,
  wasAutoLaunchedAtLogin,
} from './loginItem'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'res',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

const delay = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const initializeWithRetry = async (
  label: string,
  fn: () => Promise<void>,
  maxAttempts = 3,
): Promise<boolean> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn()
      return true
    } catch (error) {
      console.error(
        `[Startup] Failed to initialize ${label} (attempt ${attempt}/${maxAttempts}).`,
        error,
      )

      if (attempt < maxAttempts) {
        await delay(1000 * attempt)
      }
    }
  }

  return false
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Initialize the database BEFORE logging so KV writes have a schema
  const dbInitialized = await initializeWithRetry(
    'database',
    initializeDatabase,
  )
  if (!dbInitialized) {
    console.error(
      '[Startup] Database initialization failed after retries. Quitting app.',
    )
    app.quit()
    return
  }

  // Initialize KV-backed store and run migrations before anything reads/writes
  const storeInitialized = await initializeWithRetry('store', initializeStore)
  if (!storeInitialized) {
    console.error(
      '[Startup] Store initialization failed after retries. Quitting app.',
    )
    app.quit()
    return
  }

  // Keep OS login-item registration in sync with persisted settings.
  // This also ensures startup arguments are present for hidden auto-launch mode.
  try {
    syncLoginItemWithStoredSettings()
  } catch (error) {
    console.error('[Startup] Failed to sync login item settings.', error)
  }

  // Initialize logging after DB + store so batched log persistence can write
  initializeLogging()

  // Validate Auth0 configuration
  try {
    validateAuth0Config()
  } catch (error) {
    console.error('Auth0 configuration error:', error)
    console.warn(
      'Token refresh will be disabled due to missing Auth0 configuration',
    )
  }

  // Validate stored tokens before using them (will attempt refresh if needed)
  const tokensAreValid = await validateStoredTokens(Auth0Config)

  // If we have valid tokens from a previous session, start the sync service
  if (tokensAreValid) {
    const accessToken = mainStore.get(STORE_KEYS.ACCESS_TOKEN) as
      | string
      | undefined
    if (accessToken) {
      grpcClient.setAuthToken(accessToken)
      syncService.start()
    }
  }

  // Setup protocol handling for deep links
  setupProtocolHandling()

  // Prevent app nap
  preventAppNap()

  // Register the handler for the 'res' protocol now that the app is ready.
  const appId = ITO_ENV === 'prod' ? 'ai.ito.ito' : `ai.ito.ito-${ITO_ENV}`
  registerResourcesProtocol()
  electronApp.setAppUserModelId(appId)

  // IMPORTANT: Register IPC handlers BEFORE creating windows
  // This prevents the renderer from making IPC calls before handlers are ready
  registerIPC()

  if (!app.isPackaged) {
    registerDevIPC()
  }

  // Create windows
  const autoLaunchedAtLogin = wasAutoLaunchedAtLogin()
  createAppWindow({ showOnReady: !autoLaunchedAtLogin })
  createPillWindow()
  startPillPositioner()

  // Handle protocol URL if the app was started by a deep link (Windows first instance)
  processStartupProtocolUrl()

  // --- ADDED: Give the gRPC client a reference to the main window ---
  // This allows it to send transcription results back to the renderer.
  if (mainWindow) {
    grpcClient.setMainWindow(mainWindow)
  }

  if (checkAccessibilityPermission(false)) {
    console.log('Accessibility permissions found, starting key listener.')
    startKeyListener()
  }

  console.log('Microphone access granted, starting audio recorder.')
  voiceInputService.setUpAudioRecorderListeners()

  console.log('Starting selected text reader service.')
  selectedTextReaderService.initialize()

  // Initialize cursor context provider (macOS only for now)
  if (process.platform === 'darwin') {
    console.log('Starting cursor context provider.')
    macOSAccessibilityContextProvider.initialize()
  }

  // Initialize microphone selection to prefer built-in microphone
  await initializeMicrophoneSelection()

  // Warm the native audio stream so the hotkey can record immediately
  voiceInputService.prepareAudioStream()

  // Recover dictations whose transcription failed in a previous run
  setTimeout(() => {
    itoStreamController
      .flushPendingDictations()
      .catch(error =>
        console.warn('[main] Pending dictation recovery failed:', error),
      )
  }, 10_000)

  // Create system tray after audio recorder is initialized and devices are available
  await createAppTray()

  app.on('activate', function () {
    if (mainWindow === null) {
      createAppWindow()
      // Update the gRPC client with the new main window reference
      if (mainWindow) {
        grpcClient.setMainWindow(mainWindow)
      }
    }
  })

  // Handle protocol URL if the app was started by a deep link (Windows first instance)
  processStartupProtocolUrl()

  // Clean up
  app.on('before-quit', () => {
    console.log('App is quitting, cleaning up resources...')
    setIsQuitting(true)
    teardown()
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize auto-updater
  initializeAutoUpdater()

  // Set up periodic token refresh check (every 10 minutes)
  setInterval(
    async () => {
      try {
        await ensureValidTokens(Auth0Config)
      } catch (error) {
        console.error('Periodic token refresh failed:', error)
      }
    },
    10 * 60 * 1000,
  ) // Check every 10 minutes
})

app.on('window-all-closed', () => {
  // We want the app to stay alive
})
