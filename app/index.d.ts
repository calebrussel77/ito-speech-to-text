/// <reference types="electron-vite/node" />

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.jpg' {
  const content: string
  export default content
}

declare module '*.jpeg' {
  const content: string
  export default content
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.webm' {
  const content: string
  export default content
}

declare module '*.web' {
  const content: string
  export default content
}

// Augment the Window interface
declare global {
  interface Window {
    api: IpcApi
  }
}

export interface IpcApi {
  generateNewAuthState: () => Promise<any>
  invoke: (channel: string, ...args: any[]) => Promise<any>
  on: (
    channel: string,
    listener: (event: any, ...args: any[]) => void,
  ) => () => void // Returns a cleanup function
  send: (channel: string, ...args: any[]) => void
  getNativeAudioDevices: () => Promise<any>
  notifyLoginSuccess: (
    profile: any,
    idToken: string,
    accessToken: string,
  ) => void
  deleteUserData: () => Promise<void>
  interactions: {
    getAll: () => Promise<any[]>
    getById: (id: string) => Promise<any>
    delete: (id: string) => Promise<void>
    clearAll: () => Promise<void>
  }
  pendingDictations: {
    count: () => Promise<number>
    retry: () => Promise<number>
  }
  testGroqApiKey: (apiKey: string) => Promise<ApiTestResult>
  testOpenRouterApiKey: (apiKey: string) => Promise<ApiTestResult>
  testDeepgramApiKey: (apiKey: string) => Promise<ApiTestResult>
  /** Null unless the record describes the key currently stored. */
  getOpenRouterFailure: () => Promise<OpenRouterFailureRecord | null>
  modes: {
    getAll: () => Promise<ModeDto[]>
    create: (preset: string, name: string) => Promise<ModeDto>
    update: (id: string, patch: Partial<ModeDto>) => Promise<void>
    delete: (id: string) => Promise<{ ok: boolean; error?: string }>
    duplicate: (id: string) => Promise<ModeDto | null>
    setActive: (id: string) => Promise<void>
    getActive: () => Promise<string | undefined>
    examples: {
      get: (modeId: string) => Promise<ModeExampleDto[]>
      add: (
        modeId: string,
        spokenInput: string,
        aiOutput: string,
      ) => Promise<ModeExampleDto>
      update: (
        id: string,
        spokenInput: string,
        aiOutput: string,
      ) => Promise<void>
      delete: (id: string) => Promise<void>
    }
  }
}

export interface ApiTestResult {
  ok: boolean
  message?: string
}

export interface OpenRouterFailureRecord {
  code: string
  message: string
  model: string
  at: string
}

export type {
  Mode as ModeDto,
  ModeExample as ModeExampleDto,
} from '../lib/main/sqlite/models'
