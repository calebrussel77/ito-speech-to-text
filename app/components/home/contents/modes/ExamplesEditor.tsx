import { useCallback, useEffect, useState } from 'react'
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
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const list = await window.api.modes.examples.get(modeId)
      setExamples(list)
      // On garde le brouillon déjà en mémoire pour tout id connu au lieu de
      // l'écraser avec la valeur serveur : ça règle à la fois le cas d'une
      // ligne encore en cours de frappe ailleurs (elle n'a jamais été
      // touchée ici) et celui d'un save() qui perd la course contre ce
      // load() (la ligne en vol garde son brouillon au lieu de revenir en
      // arrière). Seuls les ids nouveaux ou disparus sont réconciliés.
      setDrafts(previous =>
        Object.fromEntries(
          list.map(e => [
            e.id,
            previous[e.id] ?? { spoken: e.spokenInput, ai: e.aiOutput },
          ]),
        ),
      )
    } catch (err) {
      console.error('Failed to load examples', err)
      setError('Could not load the examples.')
    }
  }, [modeId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    setError('')
    try {
      await window.api.modes.examples.add(modeId, '', '')
    } catch (err) {
      console.error('Failed to add an example', err)
      setError('Could not add the example.')
      return
    }
    // load() reports its own failure independently (it sets its own error
    // message and never throws) — folding it into the try above would name
    // a reload hiccup "Could not add the example", pushing the user to
    // retry and insert the same example twice.
    await load()
  }

  const save = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    setError('')
    try {
      await window.api.modes.examples.update(id, draft.spoken, draft.ai)
    } catch (err) {
      console.error('Failed to save an example', err)
      setError('Could not save this example. Your edit may be lost.')
    }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      await window.api.modes.examples.delete(id)
    } catch (err) {
      console.error('Failed to remove an example', err)
      setError('Could not remove the example.')
      return
    }
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
      {error && <SettingsNote tone="error">{error}</SettingsNote>}

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
