import { Notification } from 'electron'
import { mainWindow } from './app'
import { IPC_EVENTS } from '../types/ipc'

/**
 * Les notifications système de l'app.
 *
 * Le même helper existait en trois exemplaires (`itoSessionManager`,
 * `itoStreamController`, et ici) : trois `try/catch` à garder alignés pour une
 * API qui n'est pas disponible partout — `Notification.isSupported()` est faux
 * sur une session Linux sans démon de notification, et l'appeler quand même
 * lève au lieu de ne rien faire.
 */
export function showNotification(
  title: string,
  body: string,
  options: { onClick?: () => void } = {},
): void {
  try {
    if (!Notification?.isSupported?.()) return
    const notification = new Notification({ title, body })
    if (options.onClick) notification.on('click', options.onClick)
    notification.show()
  } catch (error) {
    console.warn('[notifications] Failed to show notification:', error)
  }
}

/**
 * Ramène la fenêtre principale au premier plan et l'ouvre sur une page.
 *
 * Sert de destination à une notification cliquable : une transcription de
 * fichier peut durer plusieurs minutes, on part faire autre chose, et le clic
 * doit mener au résultat — pas seulement réveiller la fenêtre là où elle était.
 */
export function focusMainWindow(page?: 'home' | 'modes' | 'models'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  if (page && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(IPC_EVENTS.OPEN_PAGE, page)
  }
}
