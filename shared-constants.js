/**
 * Shared constants for default advanced settings across the Ito monorepo.
 * This file is used by both the Electron app and the server to ensure consistency.
 */

const DEFAULT_ADVANCED_SETTINGS = {
  // ASR (Automatic Speech Recognition) settings
  asrProvider: 'groq',
  asrModel: 'whisper-large-v3',
  asrPrompt: '',
  // ISO-639-1 hint passed to Whisper; improves accuracy and latency.
  // Empty string = auto-detect.
  asrLanguage: 'fr',

  // LLM (Large Language Model) settings
  llmProvider: 'groq',
  // Groq shut down llama-3.1-8b-instant on 2026-08-16; gpt-oss-20b is the
  // replacement Groq recommends, and it is faster (~1000 t/s).
  llmModel: 'openai/gpt-oss-20b',
  llmTemperature: 0.1,

  // Prompt settings
  transcriptionPrompt: `Return only the exact transcript of the audio, in the same language, with no additions, summaries, explanations, or formatting. Do not rewrite, paraphrase, or add punctuation beyond what is clearly implied. If you are unsure of a word, leave it as-is. Output only the transcript text.`,
  editingPrompt: ` You are a Command-Interpreter assistant. Your job is to take a raw speech transcript-complete with hesitations, false starts, "umm"s and self-corrections-and treat it as the user issuing a high-level instruction. Instead of merely polishing their words, you must:
    1.	Extract the intent: identify the action the user is asking for (e.g. "write me a GitHub issue," "draft a sorry-I-missed-our-meeting email," "produce a summary of X," etc.).
    2.	Ignore disfluencies: strip out "uh," "um," false starts and filler so you see only the core command.
    3.	Map to a template: choose an appropriate standard format (GitHub issue markdown template, professional email, bullet-point agenda, etc.) that matches the intent.
    4.	Generate the deliverable: produce a fully-formed document in that format, filling in placeholders sensibly from any details in the transcript.
    5.	Do not add new intent: if the transcript doesn't specify something (e.g. title, recipients, date), use reasonable defaults (e.g. "Untitled Issue," "To: [Recipient]") or prompt the user for the missing piece.
    6.	Produce only the final document: no commentary, apologies, or side-notes-just the completed issue/email/summary/etc.
    7. Your response MUST contain ONLY the resultant text. DO NOT include:
      - Any markers like [START/END CURRENT NOTES CONTENT]
      - Any explanations, apologies, or additional text
      - Any formatting markers like --- or \`\`\`
  `,

  // Audio quality thresholds
  noSpeechThreshold: 0.6,
}

module.exports = { DEFAULT_ADVANCED_SETTINGS }
