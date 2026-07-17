import { describe, expect, test } from 'bun:test'
import { isTerminalApplication } from './applicationDetection'

describe('isTerminalApplication', () => {
  test('matches classic terminal app names', () => {
    expect(isTerminalApplication('Terminal')).toBe(true)
    expect(isTerminalApplication('iTerm2')).toBe(true)
    expect(isTerminalApplication('Windows Terminal')).toBe(true)
    expect(isTerminalApplication('PowerShell')).toBe(true)
  })

  test('matches Windows process executable names', () => {
    expect(isTerminalApplication('WindowsTerminal')).toBe(true)
    expect(isTerminalApplication('WindowsTerminal.exe')).toBe(true)
    expect(isTerminalApplication('wt.exe')).toBe(true)
    expect(isTerminalApplication('cmd.exe')).toBe(true)
    expect(isTerminalApplication('pwsh.exe')).toBe(true)
    expect(isTerminalApplication('conhost.exe')).toBe(true)
    expect(isTerminalApplication('mintty.exe')).toBe(true)
  })

  test('matches apps embedding a terminal', () => {
    expect(isTerminalApplication('Claude')).toBe(true)
    expect(isTerminalApplication('Claude Code')).toBe(true)
    expect(isTerminalApplication('Cursor')).toBe(true)
    expect(isTerminalApplication('Windsurf')).toBe(true)
    expect(isTerminalApplication('Visual Studio Code')).toBe(true)
  })

  test('matches unknown terminals via name fragments', () => {
    expect(isTerminalApplication('Windows Terminal Preview')).toBe(true)
    expect(isTerminalApplication('SuperTerm')).toBe(true)
    expect(isTerminalApplication('MyConsole')).toBe(true)
  })

  test('does not match regular applications', () => {
    expect(isTerminalApplication('Notepad')).toBe(false)
    expect(isTerminalApplication('Google Chrome')).toBe(false)
    expect(isTerminalApplication('Microsoft Word')).toBe(false)
    expect(isTerminalApplication('Slack')).toBe(false)
    expect(isTerminalApplication('Spotify')).toBe(false)
  })
})
