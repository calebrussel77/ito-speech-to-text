import { createContext, useContext, useEffect, useState } from 'react'
import { Titlebar, TitlebarProps } from './Titlebar'
import { TitlebarContextProvider } from './TitlebarContext'
import { useSettingsStore } from '@/app/store/useSettingsStore'

const WindowContext = createContext<WindowContextProps | undefined>(undefined)

export const WindowContextProvider = ({
  children,
  titlebar,
}: WindowContextProviderProps) => {
  const [initProps, setInitProps] = useState<WindowInitProps | undefined>()
  const { theme } = useSettingsStore()

  const defaultTitlebar: TitlebarProps = {
    title: 'Ito',
    icon: 'appIcon.png',
    titleCentered: false,
  }

  // Merge default titlebar props with user defined props
  titlebar = { ...defaultTitlebar, ...titlebar }

  // Apply theme to document element
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light'
      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  useEffect(() => {
    // Load window init props
    window.api
      .invoke('init-window')
      .then((value: WindowInitProps) => setInitProps(value))

    // Add class to parent element
    const parent = document.querySelector('.window-content')?.parentElement
    if (parent) {
      parent.classList.add('window-frame')
    }
  }, [])

  return (
    <WindowContext.Provider value={{ titlebar, window: initProps! }}>
      <TitlebarContextProvider>
        <Titlebar />
      </TitlebarContextProvider>
      <WindowContent>{children}</WindowContent>
    </WindowContext.Provider>
  )
}

const WindowContent = ({ children }: { children: React.ReactNode }) => {
  return <div className="window-content">{children}</div>
}

export const useWindowContext = () => {
  const context = useContext(WindowContext)
  if (context === undefined) {
    throw new Error(
      'useWindowContext must be used within a WindowContextProvider',
    )
  }
  return context
}

interface WindowContextProps {
  titlebar: TitlebarProps
  readonly window: WindowInitProps
}

interface WindowInitProps {
  width: number
  height: number
  maximizable: boolean
  minimizable: boolean
  platform: string
}

interface WindowContextProviderProps {
  children: React.ReactNode
  titlebar?: TitlebarProps
}
