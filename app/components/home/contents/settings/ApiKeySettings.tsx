import { useState } from 'react'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card'
import { Input } from '@/app/components/ui/input'
import { Button } from '@/app/components/ui/button'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'testing' | 'ok' | 'error'
type ApiTestResult = { ok: boolean; message?: string }

interface ApiKeyCardProps {
  title: string
  description: string
  placeholder: string
  consoleLabel: string
  consoleUrl: string
  storedKey: string
  onSave: (key: string) => void
  onTest: (key: string) => Promise<ApiTestResult>
}

function ApiKeyCard({
  title,
  description,
  placeholder,
  consoleLabel,
  consoleUrl,
  storedKey,
  onSave,
  onTest,
}: ApiKeyCardProps) {
  const [localKey, setLocalKey] = useState(storedKey || '')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  const handleSave = () => {
    onSave(localKey.trim())
    setMessage('Saved locally')
    setStatus('idle')
  }

  const handleClear = () => {
    setLocalKey('')
    onSave('')
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
      const result = await onTest(localKey.trim())
      setStatus(result.ok ? 'ok' : 'error')
      setMessage(result.message || (result.ok ? 'Connected' : 'Failed'))
    } catch (error: any) {
      setStatus('error')
      setMessage(error?.message || 'Unable to test key')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button
            variant="link"
            size="sm"
            className="text-xs"
            onClick={e => {
              e.preventDefault()
              window.api['web-open-url'](consoleUrl)
            }}
          >
            {consoleLabel}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Input
          type="password"
          value={localKey}
          placeholder={placeholder}
          onChange={e => setLocalKey(e.target.value)}
        />
        <div className="flex gap-2">
          <Button onClick={handleSave} size="sm">
            Save
          </Button>
          <Button variant="outline" onClick={handleClear} size="sm">
            Clear
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={status === 'testing'}
            size="sm"
          >
            {status === 'testing' ? 'Testing…' : 'Test Connection'}
          </Button>
        </div>
        {message && (
          <p
            className={cn(
              'text-xs',
              status === 'ok' && 'text-[hsl(var(--chart-2))]',
              status === 'error' && 'text-destructive',
              status === 'idle' && 'text-muted-foreground',
              status === 'testing' && 'text-muted-foreground',
            )}
          >
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default function ApiKeySettings() {
  const { groqApiKey, setGroqApiKey, openRouterApiKey, setOpenRouterApiKey } =
    useAdvancedSettingsStore()

  return (
    <>
      <ApiKeyCard
        title="Groq API Key"
        description="Store your Groq API key locally. It never leaves this device."
        placeholder="gsk_..."
        consoleLabel="Open Groq Console"
        consoleUrl="https://console.groq.com/keys"
        storedKey={groqApiKey}
        onSave={setGroqApiKey}
        onTest={key => window.api.testGroqApiKey(key)}
      />
      <ApiKeyCard
        title="OpenRouter API Key"
        description="Used by the precise engine for long dictations. Stored locally only."
        placeholder="sk-or-..."
        consoleLabel="Open OpenRouter Keys"
        consoleUrl="https://openrouter.ai/settings/keys"
        storedKey={openRouterApiKey}
        onSave={setOpenRouterApiKey}
        onTest={key => window.api.testOpenRouterApiKey(key)}
      />
    </>
  )
}
