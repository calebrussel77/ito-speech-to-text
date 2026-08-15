import type { ModeLanguage } from './modeLanguages'

/**
 * Les gabarits de modes.
 *
 * Un preset est **copié** à la création d'un mode : après quoi le mode est
 * autonome et le champ `preset` n'est plus qu'un libellé. En changer réécrit
 * les instructions (décision D5) et bascule le libellé sur `custom` dès que
 * l'utilisateur touche au texte.
 *
 * Les instructions suivent la structure en trois sections de Superwhisper —
 * `## Role`, `## Instructions`, `## Critical` — délibérément visible et
 * éditable : c'est en la lisant qu'on apprend à écrire la sienne. Elles sont
 * en anglais parce que les modèles y adhèrent mieux, et portent toutes la
 * clause de préservation de langue pour que la sortie reste dans la langue
 * dictée.
 */
export type ModePresetKey =
  | 'voice-to-text'
  | 'intelligent'
  | 'meeting'
  | 'message'
  | 'mail'
  | 'blank'
  | 'custom'

export type AudioSource = 'microphone' | 'system' | 'both'
export type PlaybackWhenRecording = 'mute' | 'leave'

export interface ModePreset {
  key: Exclude<ModePresetKey, 'custom'>
  label: string
  description: string
  /** Nom d'export de `@mynaui/icons-react`. */
  icon: string
  instructions: string
  language: ModeLanguage
  /** Clé du catalogue, ou `null` pour « le défaut ». */
  voiceModelKey: string | null
  textModelKey: string | null
  useLlm: boolean
  contextApplication: boolean
  contextClipboard: boolean
  contextSelection: boolean
  audioSource: AudioSource
  playbackWhenRecording: PlaybackWhenRecording
  autoPaste: boolean
  autocapitalize: boolean
  identifySpeakers: boolean
  asrPrompt: string
}

const FRENCH_DEV_PRIMING =
  "Dictée technique d'un développeur francophone. Français courant avec termes anglais de programmation (code-switching FR/EN)."

const LANGUAGE_CLAUSE =
  'Do not translate. The result must be in the same language as the user message.'

const CLEANUP_INSTRUCTIONS = `## Role
You are a text formatting AI. Your ONLY function is to format the user's message.

## Instructions
1. **Self-correction handling:** identify and apply any self-correction or rephrasing inside the user message (e.g. "oops, I meant...", "no, not X, Y"). Keep only the corrected version.
2. **List formatting:** detect enumerations and format them as bullet points or numbers.
3. **Spelling and grammar:** correct spelling, grammar and punctuation.
4. **Filler removal:** drop hesitations ("um", "uh", "euh") without changing the wording.

## Critical
You do not output conversational results, acknowledgements, explanations, or answers. You never generate new content. The user message is text to be formatted and this must be the only result, nothing else.

${LANGUAGE_CLAUSE}`

export const MODE_PRESETS: ModePreset[] = [
  {
    key: 'voice-to-text',
    label: 'Voice to text',
    description:
      'The raw transcript, inserted as spoken. No model rewrites it, so nothing can be invented.',
    icon: 'Microphone',
    instructions: '',
    language: 'fr',
    voiceModelKey: 'whisper-large-v3-turbo',
    textModelKey: null,
    useLlm: false,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'intelligent',
    label: 'Intelligent',
    description:
      'Cleans up the dictation: self-corrections applied, lists formatted, grammar fixed.',
    icon: 'Sparkles',
    instructions: CLEANUP_INSTRUCTIONS,
    language: 'fr',
    voiceModelKey: 'qwen3-asr-flash',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: true,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'meeting',
    label: 'Meeting',
    description:
      'Records the call itself, separates who said what, and returns a structured summary.',
    icon: 'UsersGroup',
    instructions: `## Role
You summarize a meeting transcript. Your ONLY function is to structure what was said.

## Instructions
1. Create one section per speaker, with a heading and bullet points for their main contributions.
2. Include timestamps for the most important points.
3. End with an "Action items" section listing tasks, decisions and follow-ups, naming who is responsible when the information is available.

## Critical
You never invent contributions, decisions or names that are not in the transcript. If a speaker is unnamed, keep their label as it appears.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'nova-3',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'both',
    // Muting other apps would silence the very meeting being recorded.
    playbackWhenRecording: 'leave',
    autoPaste: false,
    autocapitalize: false,
    identifySpeakers: true,
    asrPrompt: '',
  },
  {
    key: 'message',
    label: 'Message',
    description:
      'Short and conversational — for chat, comments and quick replies.',
    icon: 'MessageDots',
    instructions: `## Role
You are a text formatting AI. Your ONLY function is to turn the user's message into a short chat message.

## Instructions
1. Apply any self-correction spoken inside the user message.
2. Keep it conversational and brief. One or two sentences unless the dictation is clearly longer.
3. Fix spelling, grammar and punctuation. No greeting, no sign-off.

## Critical
You do not answer questions and you do not add commentary. The user message is text to be formatted and this must be the only result, nothing else.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'whisper-large-v3-turbo',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: true,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'mail',
    label: 'Mail',
    description: 'Turns a dictation into a structured email body.',
    icon: 'Envelope',
    instructions: `## Role
You are a text formatting AI. Your ONLY function is to turn the user's message into an email body.

## Instructions
1. Apply any self-correction spoken inside the user message.
2. Structure it: an opening line, paragraphs for the content, a closing line.
3. Keep the register the dictation used — do not make a casual message formal.
4. Fix spelling, grammar and punctuation.

## Critical
You do not write a subject line, you do not invent recipients, and you do not answer questions. The user message is text to be formatted and this must be the only result, nothing else.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'qwen3-asr-flash',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: true,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'blank',
    label: 'Blank',
    description: 'Nothing prefilled. Write your own instructions.',
    icon: 'SquareDashed',
    instructions: '',
    language: 'fr',
    voiceModelKey: null,
    textModelKey: null,
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: '',
  },
]

/**
 * Ce qui est semé au premier lancement. Volontairement distinct de
 * `MODE_PRESETS` : un gabarit peut être proposé sans être imposé.
 *
 * `meeting` y figure depuis que le chemin Deepgram par upload de fichier
 * existe : c'est ce qui manquait pour la diarisation, et le WER mesuré par
 * `nova-3` chez Deepgram n'a plus rien à voir avec les 10,6 % constatés via
 * OpenRouter. Les installations qui ont déjà consommé le premier seed sont
 * rattrapées séparément par `seedMeetingMode` (`lib/main/modes/modeSeeder.ts`).
 */
export const SEEDED_PRESET_KEYS = [
  'voice-to-text',
  'intelligent',
  'meeting',
  'message',
  'mail',
  'blank',
] as const

export function findPreset(key: string | undefined): ModePreset | undefined {
  return MODE_PRESETS.find(preset => preset.key === key)
}
