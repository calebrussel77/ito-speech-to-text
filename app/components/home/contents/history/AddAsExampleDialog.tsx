import { useEffect, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/app/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { SettingsNote, CONTROL_WIDTH } from '@/app/components/ui/settings'

/**
 * Transforme une dictée ratée en exemple.
 *
 * La moitié gauche est le transcript **brut** — c'est ce que le modèle a
 * réellement reçu, et donc ce qu'il faut lui réapprendre à traiter. La moitié
 * droite est préremplie avec le résultat obtenu, à corriger : partir du
 * mauvais résultat demande moins d'effort que partir d'une page blanche.
 */
export default function AddAsExampleDialog({
  rawTranscript,
  currentResult,
  defaultModeId,
  onClose,
}: {
  rawTranscript: string
  currentResult: string
  defaultModeId: string | null
  onClose: () => void
}) {
  const { modes, loaded, load } = useModesStore()
  const [modeId, setModeId] = useState(defaultModeId ?? '')
  const [spoken, setSpoken] = useState(rawTranscript)
  const [output, setOutput] = useState(currentResult)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Un exemple appartient forcément à un mode qui réécrit — les modes
  // « voice to text » n'ont rien à réapprendre.
  const rewritingModes = modes.filter(mode => mode.useLlm)
  const modeStillRewrites = rewritingModes.some(mode => mode.id === modeId)

  // defaultModeId date du moment de la dictée : le mode peut avoir été
  // supprimé (soft delete) ou être passé en « voice to text » depuis. Un id
  // non vide n'est donc pas forcément valide — on retombe sur le premier
  // mode réécrivant dans les deux cas (id vide ou id périmé).
  useEffect(() => {
    if (rewritingModes.length && !modeStillRewrites) {
      setModeId(rewritingModes[0].id)
    }
  }, [rewritingModes, modeStillRewrites])

  // Vrai uniquement quand la dictée avait un mode d'origine et que ce mode
  // a disparu de la liste des modes réécrivants — sert à prévenir
  // l'utilisateur plutôt que de retargeter en silence.
  const originalModeUnavailable =
    loaded &&
    defaultModeId !== null &&
    rewritingModes.length > 0 &&
    !rewritingModes.some(mode => mode.id === defaultModeId)
  const fallbackModeName = rewritingModes.find(mode => mode.id === modeId)?.name

  const canSave = Boolean(modeStillRewrites && spoken.trim() && output.trim())

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(false)
    try {
      await window.api.modes.examples.add(modeId, spoken.trim(), output.trim())
      setSaved(true)
    } catch (error) {
      console.error('Failed to add example:', error)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add as example</DialogTitle>
          <DialogDescription>
            Correct the result on the right. Next time this mode sees a
            dictation like the one on the left, it will know what to produce.
          </DialogDescription>
        </DialogHeader>

        {loaded && rewritingModes.length === 0 ? (
          <SettingsNote>No mode with rewriting enabled yet.</SettingsNote>
        ) : (
          <>
            <Select value={modeId} onValueChange={setModeId} disabled={!loaded}>
              <SelectTrigger className={CONTROL_WIDTH}>
                <SelectValue placeholder="Choose a mode" />
              </SelectTrigger>
              <SelectContent>
                {rewritingModes.map(mode => (
                  <SelectItem key={mode.id} value={mode.id}>
                    {mode.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {originalModeUnavailable && (
              <SettingsNote>
                This dictation&rsquo;s original mode is no longer available for
                rewriting. The example will be added to{' '}
                {fallbackModeName ?? 'the mode below'} instead.
              </SettingsNote>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Textarea
            rows={6}
            value={spoken}
            onChange={event => setSpoken(event.target.value)}
          />
          <Textarea
            rows={6}
            value={output}
            onChange={event => setOutput(event.target.value)}
          />
        </div>

        {saved && <SettingsNote>Example added.</SettingsNote>}
        {saveError && (
          <SettingsNote tone="error">
            Couldn&rsquo;t add the example. Try again.
          </SettingsNote>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {saved ? 'Close' : 'Cancel'}
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saved || saving || !canSave}
          >
            {saved ? 'Added' : saving ? 'Adding…' : 'Add example'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
