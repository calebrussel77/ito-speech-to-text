import { useState } from 'react'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'

type Status = 'idle' | 'testing' | 'ok' | 'error'

export default function ApiKeySettings() {
  const { groqApiKey, setGroqApiKey } = useAdvancedSettingsStore()
  const [localKey, setLocalKey] = useState(groqApiKey || '')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  const handleSave = () => {
    setGroqApiKey(localKey.trim())
    setMessage('Saved locally')
    setStatus('idle')
  }

  const handleClear = () => {
    setLocalKey('')
    setGroqApiKey('')
    setMessage('Cleared')
    setStatus('idle')
  }

  const handleTest = async () => {
    if (!localKey.trim()) {
      setStatus('error')
      setMessage('Enter an API key first')
      return
    }

    setStatus('testing')
    setMessage('Testing connection...')
    try {
      const result = await window.api.testGroqApiKey(localKey.trim())
      setStatus(result.ok ? 'ok' : 'error')
      setMessage(result.message || (result.ok ? 'Connected' : 'Failed'))
    } catch (error: any) {
      setStatus('error')
      setMessage(error?.message || 'Unable to test key')
    }
  }

  const statusColor =
    status === 'ok'
      ? 'text-green-600'
      : status === 'error'
        ? 'text-red-600'
        : 'text-slate-500'

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white/60 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-md font-medium text-slate-900">API Configuration</h3>
          <p className="text-xs text-slate-500">
            Store your Groq API key locally. It never leaves this device.
          </p>
        </div>
        <a
          href="#"
          className="text-xs text-blue-600 underline"
          onClick={e => {
            e.preventDefault()
            window.api['web-open-url']('https://console.groq.com/keys')
          }}
        >
          Open Groq Console
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <input
          type="password"
          value={localKey}
          placeholder="gsk_..."
          onChange={e => setLocalKey(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2">
          <button
            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            onClick={handleSave}
          >
            Save
          </button>
          <button
            className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200"
            onClick={handleClear}
          >
            Clear
          </button>
          <button
            className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={handleTest}
            disabled={status === 'testing'}
          >
            {status === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
        <p className={`text-xs ${statusColor}`}>
          {message || 'Not connected'}
        </p>
      </div>
    </div>
  )
}
