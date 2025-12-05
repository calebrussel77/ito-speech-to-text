# Implementation Plan: Fully Local ITO (No Docker/Database Required)

## Goal
Enable all ITO app features to work locally without requiring Docker, PostgreSQL, or MinIO. Users will provide their own Groq API key for transcription.

## User Requirements
- ✅ User provides own Groq API key
- ✅ Store all data locally only (no cloud sync)
- ✅ Don't save audio files (transcripts only)
- ✅ Minimal setup - no Docker, no database containers

## Architecture Change

### Current Flow
```
User → Client → gRPC → Server → Groq API → Server → Client
                                  ↓
                            PostgreSQL/MinIO
```

### Target Flow
```
User → Client → Groq API directly → Client
                       ↓
                  SQLite (local)
```

## Implementation Strategy

### Phase 1: Create Local Transcription Service

#### 1.1 LocalAudioProcessor (NEW)
**File**: `lib/main/transcription/LocalAudioProcessor.ts`

Port audio processing utilities from server to client:
- `concatenateAudioChunks()` - Merge audio buffers
- `createWavHeader()` - Generate WAV headers for Groq API
- `enhancePcm16()` - Audio enhancement (optional, profile performance)
- `prepareAudioForTranscription()` - Complete pipeline

**Source files to port from**:
- `server/src/services/ito/audioUtils.js`
- `server/src/utils/audio.js`
- `server/src/utils/audioProcessing.ts`

#### 1.2 LocalTranscriptionService (NEW)
**File**: `lib/main/transcription/LocalTranscriptionService.ts`

Direct Groq API integration:
```typescript
class LocalTranscriptionService {
  private groqClient: Groq | null

  initialize(apiKey: string): void
  transcribeAudio(audioBuffer: Buffer, options: TranscriptionOptions): Promise<string>
  adjustTranscript(transcript: string, mode: ItoMode, context: ItoContext): Promise<string>
  isAvailable(): boolean
}
```

**Port logic from**:
- `server/src/clients/groqClient.ts` - API calls
- `server/src/prompts/transcription.js` - Prompt creation
- `server/src/clients/errors.js` - Error handling

**Key features**:
- No-speech detection (threshold-based)
- Vocabulary injection for custom dictionary
- Mode-based transcript adjustment (TRANSCRIBE vs EDIT)
- Comprehensive error handling

### Phase 2: Refactor Stream Controller

#### 2.1 Simplify AudioStreamManager
**File**: `lib/main/audio/AudioStreamManager.ts`

**Changes**:
- Remove async generator pattern (no streaming needed)
- Change to simple buffer accumulation
- Add `getAllAudio(): Buffer` method
- Keep metadata tracking (sample rate, duration)

#### 2.2 Refactor ItoStreamController
**File**: `lib/main/itoStreamController.ts`

**Major changes**:
- Replace `startGrpcStream()` with `processLocalTranscription()`
- Remove streaming and config queue logic
- Make transcription synchronous (after recording stops)

**New flow**:
```typescript
async processLocalTranscription() {
  // 1. Get complete audio from AudioStreamManager
  const audioBuffer = this.audioStreamManager.getAllAudio()

  // 2. Process audio to WAV format
  const wavAudio = localAudioProcessor.prepareAudioForTranscription(audioBuffer)

  // 3. Get context and settings
  const context = await contextGrabber.gatherContext(this.currentMode)
  const settings = getAdvancedSettings()

  // 4. Transcribe with Groq
  const transcript = await localTranscriptionService.transcribeAudio(wavAudio, {
    asrModel: settings.llm.asrModel,
    vocabulary: context.vocabularyWords,
    noSpeechThreshold: settings.llm.noSpeechThreshold
  })

  // 5. Adjust if in EDIT mode
  return await localTranscriptionService.adjustTranscript(transcript, mode, context, settings)
}
```

#### 2.3 Update ItoSessionManager
**File**: `lib/main/itoSessionManager.ts`

**Changes**:
- Call `processLocalTranscription()` instead of gRPC
- Update timing event names (remove "SERVER_" prefix)
- Simplify error handling (no ConnectError)
- Keep all UI notifications and text insertion

### Phase 3: Settings & Configuration

#### 3.1 Add Groq API Key Storage
**File**: `lib/main/store.ts`

Add to AdvancedSettings:
```typescript
export interface AdvancedSettings {
  llm: LlmSettings
  grammarServiceEnabled: boolean
  macosAccessibilityContextEnabled: boolean
  groqApiKey?: string  // NEW
}
```

**Security**: Use Electron's `safeStorage` API for encryption

#### 3.2 Create API Key Settings UI
**File**: `app/components/settings/ApiKeySettings.tsx` (NEW)

Components:
- Password input for Groq API key
- "Test Connection" button
- Save/Clear buttons
- Status indicator (connected/disconnected)
- Link to console.groq.com

#### 3.3 Update Settings Panel
**File**: `app/components/settings/AdvancedSettingsPanel.tsx`

Add new "API Configuration" section with ApiKeySettings component

#### 3.4 First-Run Setup
Update onboarding to include:
1. Request Groq API key
2. Test connection
3. Continue with permissions setup

### Phase 4: Disable Server Dependencies

#### 4.1 Make gRPC Client Optional
**File**: `lib/clients/grpcClient.ts`

Add early returns for self-hosted mode:
```typescript
constructor() {
  this.isLocalMode = getCurrentUserId() === 'self-hosted'
  if (this.isLocalMode) {
    console.log('Running in local mode, gRPC client disabled')
    return
  }
  // ... existing initialization
}
```

#### 4.2 Disable Sync Service
**File**: `lib/main/syncService.ts`

Add early return in `runSync()`:
```typescript
private async runSync() {
  const user = mainStore.get(STORE_KEYS.USER_PROFILE)
  if (user?.id === 'self-hosted') {
    console.log('Self-hosted mode: sync disabled')
    return
  }
  // ... existing logic
}
```

#### 4.3 Update Environment Config
Make `VITE_GRPC_BASE_URL` optional and add local mode flag

### Phase 5: Error Handling

#### 5.1 API Key Validation
- Check format (starts with `gsk_`)
- Test with minimal API call
- Handle rate limiting with clear messages
- Network error recovery

#### 5.2 Audio Quality Checks
- Minimum duration (100ms, already exists)
- Maximum file size (Groq limit: 25MB)
- Sample rate validation

#### 5.3 User-Friendly Error Messages
- Missing API key → Prompt to configure
- Invalid API key → "Invalid key" with setup link
- Rate limit → Show retry timer
- Network error → "Check connection" message

## Critical Files to Modify

### New Files
1. **lib/main/transcription/LocalTranscriptionService.ts** - Core Groq API integration
2. **lib/main/transcription/LocalAudioProcessor.ts** - Audio processing utilities
3. **app/components/settings/ApiKeySettings.tsx** - API key configuration UI

### Major Refactors
4. **lib/main/itoStreamController.ts** - Replace gRPC with local transcription
5. **lib/main/itoSessionManager.ts** - Update session flow

### Minor Updates
6. **lib/main/audio/AudioStreamManager.ts** - Simplify to buffer accumulation
7. **lib/main/store.ts** - Add Groq API key storage
8. **lib/clients/grpcClient.ts** - Make optional for local mode
9. **lib/main/syncService.ts** - Disable for self-hosted users
10. **app/components/settings/AdvancedSettingsPanel.tsx** - Add API key section

## Testing Strategy

### Unit Tests
- LocalAudioProcessor functions
- LocalTranscriptionService API calls
- Error handling scenarios
- Settings persistence

### Integration Tests
- Full transcription flow: record → transcribe → insert
- Mode switching (TRANSCRIBE ↔ EDIT)
- Dictionary word injection
- Context-aware LLM adjustment

### Manual Testing Checklist
- [ ] First-run API key setup
- [ ] Transcription in TRANSCRIBE mode
- [ ] Transcription in EDIT mode
- [ ] Dictionary words recognized
- [ ] Error messages clear
- [ ] Settings persist
- [ ] Performance acceptable (<5s for 10s audio)

## Potential Challenges & Solutions

### Challenge 1: Audio Processing Performance
**Solution**: Profile enhancement logic; make it optional or use native module if needed

### Challenge 2: Groq API Rate Limits
**Solution**: Clear error messages, exponential backoff, document limits

### Challenge 3: API Key Security
**Solution**: Use Electron safeStorage, warn against sharing, support key rotation

### Challenge 4: Migration for Existing Users
**Solution**: SQLite already has all data locally; no migration needed

## Success Criteria

✅ Users can transcribe without Docker/server
✅ User-provided Groq API key works
✅ All data in local SQLite
✅ No audio files saved
✅ Minimal setup required
✅ Transcription latency <5s for 10s audio
✅ UI remains responsive
✅ Same UX as before
✅ All tests passing

## Dependencies

**No new dependencies needed!** All required packages already exist:
- `groq-sdk` - Already in package.json
- `uuid` - Already in package.json
- `dotenv` - Already in package.json

## Estimated Timeline

- Phase 1: Local transcription (4-6 hours)
- Phase 2: Controller refactor (4-6 hours)
- Phase 3: Settings UI (3-4 hours)
- Phase 4: Service cleanup (2-3 hours)
- Phase 5: Error handling (3-4 hours)
- Phase 6: Testing (6-8 hours)

**Total: 22-31 hours**

## Implementation Order

1. Create LocalAudioProcessor (port utilities)
2. Create LocalTranscriptionService (Groq integration)
3. Add Groq API key to settings storage
4. Create API key settings UI
5. Refactor AudioStreamManager (simplify)
6. Refactor ItoStreamController (use local transcription)
7. Update ItoSessionManager (remove gRPC dependencies)
8. Disable sync service for self-hosted
9. Make gRPC client optional
10. Add comprehensive error handling
11. Write tests
12. Manual testing and refinement
