import { app } from 'electron'
import store, { SettingsStore } from './store'
import { STORE_KEYS } from '../constants/store-keys'

export const LOGIN_STARTUP_ARG = '--ito-login-startup'

type LoginItemSettingsOptions = Parameters<typeof app.setLoginItemSettings>[0]

export const buildLoginItemSettings = (
  enabled: boolean,
): LoginItemSettingsOptions => {
  const options: LoginItemSettingsOptions = {
    openAtLogin: enabled,
    openAsHidden: enabled && process.platform === 'darwin',
  }

  if (process.platform === 'win32' || process.platform === 'darwin') {
    options.args = enabled ? [LOGIN_STARTUP_ARG] : []
  }

  return options
}

export const syncLoginItemWithStoredSettings = (): void => {
  const settings = store.get(STORE_KEYS.SETTINGS) as SettingsStore | undefined
  const launchAtLogin = settings?.launchAtLogin ?? true
  app.setLoginItemSettings(buildLoginItemSettings(launchAtLogin))
}

export const wasAutoLaunchedAtLogin = (
  args: string[] = process.argv,
): boolean => {
  const lowerArgs = args.map(arg => arg.toLowerCase())
  if (
    lowerArgs.includes(LOGIN_STARTUP_ARG) ||
    lowerArgs.includes('--hidden') ||
    lowerArgs.includes('/background')
  ) {
    return true
  }

  const loginSettings = app.getLoginItemSettings() as {
    wasOpenedAtLogin?: boolean
    wasOpenedAsHidden?: boolean
  }

  return Boolean(
    loginSettings.wasOpenedAtLogin || loginSettings.wasOpenedAsHidden,
  )
}
