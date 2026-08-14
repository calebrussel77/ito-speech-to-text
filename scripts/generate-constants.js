#!/usr/bin/env node

/**
 * Script to generate TypeScript constants files from the root shared-constants.js
 * This ensures all parts of the monorepo use the same default values
 */

const fs = require('fs')
const path = require('path')

// Import the shared constants
const { DEFAULT_ADVANCED_SETTINGS } = require('../shared-constants.js')

// Les amorces de prompt et l'indice de langue vivent désormais dans les modes
// côté application (table `modes`) : les émettre encore produirait des défauts
// que plus rien ne lit. Le serveur, lui, les consomme toujours.
const PROMPT_BLOCK = `  asrPrompt: \`${DEFAULT_ADVANCED_SETTINGS.asrPrompt}\`,
  // ISO-639-1 hint passed to Whisper; empty string = auto-detect
  asrLanguage: '${DEFAULT_ADVANCED_SETTINGS.asrLanguage}',
`

const TRANSCRIPTION_BLOCK = `
  // Prompt settings
  transcriptionPrompt: \`${DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt.replace(/`/g, '\\`')}\`,
  editingPrompt: \`${DEFAULT_ADVANCED_SETTINGS.editingPrompt.replace(/`/g, '\\`')}\`,
`

// Template for generated TypeScript files
const generateTSFile = withPrompts => `/*
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from /shared-constants.js
 * Run 'bun generate:constants' to regenerate
 */

export const DEFAULT_ADVANCED_SETTINGS = {
  // ASR (Automatic Speech Recognition) settings
  asrProvider: '${DEFAULT_ADVANCED_SETTINGS.asrProvider}',
  asrModel: '${DEFAULT_ADVANCED_SETTINGS.asrModel}',
${withPrompts ? PROMPT_BLOCK : ''}
  // LLM (Large Language Model) settings
  llmProvider: '${DEFAULT_ADVANCED_SETTINGS.llmProvider}',
  llmModel: '${DEFAULT_ADVANCED_SETTINGS.llmModel}',
  llmTemperature: ${DEFAULT_ADVANCED_SETTINGS.llmTemperature},
${withPrompts ? TRANSCRIPTION_BLOCK : ''}
  // Audio quality thresholds
  noSpeechThreshold: ${DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold},
} as const;
`

// Paths to generate files
const targets = [
  { path: 'lib/constants/generated-defaults.ts', withPrompts: false },
  { path: 'server/src/constants/generated-defaults.ts', withPrompts: true },
]

console.log('🔄 Generating constants files...')

targets.forEach(target => {
  const fullPath = path.join(__dirname, '..', target.path)
  const dir = path.dirname(fullPath)

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write the generated file
  fs.writeFileSync(fullPath, generateTSFile(target.withPrompts))
  console.log(`✅ Generated: ${target.path}`)
})

// Format the generated files using prettier
console.log('🎨 Formatting generated files...')
const { execSync } = require('child_process')

targets.forEach(target => {
  try {
    execSync(`bunx prettier --write "${target.path}"`, { stdio: 'inherit' })
    console.log(`✅ Formatted: ${target.path}`)
  } catch (error) {
    console.warn(`⚠️  Could not format ${target.path}:`, error.message)
  }
})

console.log('🎉 Constants generation complete!')
