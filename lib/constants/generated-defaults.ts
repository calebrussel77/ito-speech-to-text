/*
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from /shared-constants.js
 * Run 'bun generate:constants' to regenerate
 */

export const DEFAULT_ADVANCED_SETTINGS = {
  // ASR (Automatic Speech Recognition) settings
  asrProvider: 'groq',
  asrModel: 'whisper-large-v3',

  // LLM (Large Language Model) settings
  llmProvider: 'groq',
  llmModel: 'openai/gpt-oss-20b',
  llmTemperature: 0.1,

  // Audio quality thresholds
  noSpeechThreshold: 0.6,
} as const
