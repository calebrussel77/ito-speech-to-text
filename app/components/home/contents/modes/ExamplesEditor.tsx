import { useEffect, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import { SettingsCard, SettingsNote } from '@/app/components/ui/settings'
import type { ModeExampleDto } from '@/app/index'

/**
 * Les exemples few-shot d'un mode.
 *
 * C'est le seul moyen de rattraper un modèle qui *répond* à la dictée au lieu
 * de la reformater : lui montrer une fois la sortie attendue vaut mieux que
 * dix lignes d'instruction supplémentaires. Le chemin le plus court pour en
 * ajouter un est le bouton « Add as example » de l'historique, qui préremplit
 * la moitié gauche avec la dictée qui a échoué.
 */
export default function ExamplesEditor({ modeId }: { modeId: string }) {
  const [examples, setExamples] = useState<ModeExampleDto[]>([])
  const [drafts, setDrafts] = useState<
    Record<string, { spoken: string; ai: string }>
  >({})

  const load = async () => {
    const list = await window.api.modes.examples.get(modeId)
    setExamples(list)
    setDrafts(
      Object.fromEntries(
        list.map(e => [e.id, { spoken: e.spokenInput, ai: e.aiOutput }]),
      ),
    )
  }

  useEffect(() => {
    void load()
  }, [modeId])

  const add = async () => {
    await window.api.modes.examples.add(modeId, '', '')
    await load()
  }

  const save = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    await window.api.modes.examples.update(id, draft.spoken, draft.ai)
  }

  const remove = async (id: string) => {
    await window.api.modes.examples.delete(id)
    await load()
  }

  return (
    <SettingsCard
      title="Examples"
      description="Show the model what a good result looks like. The dictation on the left, the wanted output on the right."
      action={
        <Button variant="outline" size="sm" onClick={() => void add()}>
          Add example
        </Button>
      }
    >
      {examples.length === 0 && (
        <SettingsNote>
          No example yet. If this mode answers your dictation instead of
          formatting it, one example usually fixes it.
        </SettingsNote>
      )}

      <div className="space-y-3">
        {examples.map(example => (
          <div key={example.id} className="grid grid-cols-2 gap-2">
            <Textarea
              rows={3}
              placeholder="What you said"
              value={drafts[example.id]?.spoken ?? ''}
              onChange={event =>
                setDrafts(previous => ({
                  ...previous,
                  [example.id]: {
                    spoken: event.target.value,
                    ai: previous[example.id]?.ai ?? '',
                  },
                }))
              }
              onBlur={() => void save(example.id)}
            />
            <div className="space-y-1">
              <Textarea
                rows={3}
                placeholder="What it should produce"
                value={drafts[example.id]?.ai ?? ''}
                onChange={event =>
                  setDrafts(previous => ({
                    ...previous,
                    [example.id]: {
                      spoken: previous[example.id]?.spoken ?? '',
                      ai: event.target.value,
                    },
                  }))
                }
                onBlur={() => void save(example.id)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void remove(example.id)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
