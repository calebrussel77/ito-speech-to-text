import { useState } from 'react'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card'
import { Input } from '@/app/components/ui/input'
import { Button } from '@/app/components/ui/button'
import { cn } from '@/lib/utils'

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle>API Configuration</CardTitle>
            <CardDescription>
              Store your Groq API key locally. It never leaves this device.
            </CardDescription>
          </div>
          <Button
            variant="link"
            size="sm"
            className="text-xs"
            onClick={e => {
              e.preventDefault()
              window.api['web-open-url']('https://console.groq.com/keys')
            }}
          >
            Open Groq Console
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Input
          type="password"
          value={localKey}
          placeholder="gsk_..."
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