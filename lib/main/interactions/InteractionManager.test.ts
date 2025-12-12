// @ts-nocheck
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { InteractionManager } from './InteractionManager'
import { STORE_KEYS } from '../../constants/store-keys'

const mockUpsert = mock(() => Promise.resolve())
mock.module('../sqlite/repo', () => ({
  InteractionsTable: {
    upsert: mockUpsert,
  },
}))

const mockMainStore = {
  get: mock(() => ({ id: 'test-user-123' })),
}
mock.module('../store', () => ({
  default: mockMainStore,
}))

mock.module('../timing/TimingCollector', () => ({
  timingCollector: {
    clearInteraction: mock(),
  },
}))

mock.module('electron-log', () => ({
  default: {
    info: mock(),
    warn: mock(),
    error: mock(),
  },
}))

describe('InteractionManager', () => {
  let interactionManager: InteractionManager

  beforeEach(() => {
    interactionManager = new InteractionManager()
    mockUpsert.mockClear()
    mockMainStore.get.mockClear()
    mockMainStore.get.mockReturnValue({ id: 'test-user-123' })
  })

  describe('Interaction Lifecycle', () => {
    test('should start interaction and generate ID', () => {
      const id = interactionManager.initialize()

      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
      expect(interactionManager.getCurrentInteractionId()).toBe(id)
    })

    test('should track start time', () => {
      const beforeStart = Date.now()
      interactionManager.initialize()
      const afterStart = Date.now()

      const startTime = interactionManager.getInteractionStartTime()
      expect(startTime).toBeGreaterThanOrEqual(beforeStart)
      expect(startTime).toBeLessThanOrEqual(afterStart)
    })

    test('should clear current interaction', () => {
      interactionManager.initialize()
      expect(interactionManager.getCurrentInteractionId()).not.toBeNull()

      interactionManager.clearCurrentInteraction()
      expect(interactionManager.getCurrentInteractionId()).toBeNull()
      expect(interactionManager.getInteractionStartTime()).toBeNull()
    })

    test('should generate unique IDs for different interactions', () => {
      const id1 = interactionManager.initialize()
      interactionManager.clearCurrentInteraction()
      const id2 = interactionManager.initialize()

      expect(id1).not.toBe(id2)
    })
  })

  describe('Interaction Creation', () => {
    test('should create interaction with all data', async () => {
      const transcript = 'Hello world'
      const audioBuffer = Buffer.from('audio-data')
      const sampleRate = 16000

      interactionManager.initialize()
      await interactionManager.createInteraction(
        transcript,
        audioBuffer,
        sampleRate,
      )

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.id).toBe(interactionManager.getCurrentInteractionId())
      expect(interactionData.user_id).toBe('test-user-123')
      expect(interactionData.title).toBe(transcript)
      expect(interactionData.raw_audio).toBeNull()
      expect(interactionData.sample_rate).toBe(sampleRate)
      expect(interactionData.duration_ms).toBeGreaterThanOrEqual(0)
      expect(interactionData.asr_output?.transcript).toBe(transcript)
      expect(interactionData.asr_output?.totalAudioBytes).toBe(audioBuffer.length)
    })

    test('should skip creation when no current interaction ID', async () => {
      // Don't start interaction
      await interactionManager.createInteraction(
        'test',
        Buffer.from('audio'),
        16000,
      )

      expect(mockUpsert).not.toHaveBeenCalled()
    })

    test('should skip creation when no user ID', async () => {
      mockMainStore.get.mockReturnValue(null)

      interactionManager.initialize()
      await interactionManager.createInteraction(
        'test',
        Buffer.from('audio'),
        16000,
      )

      expect(mockMainStore.get).toHaveBeenCalledWith(STORE_KEYS.USER_PROFILE)
      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.user_id).toBe('self-hosted')
    })
  })

  describe('Title Generation', () => {
    test('should use transcript as title for short transcripts', async () => {
      const transcript = 'Short message'
      interactionManager.initialize()
      await interactionManager.createInteraction(
        transcript,
        Buffer.from('audio'),
        16000,
      )

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.title).toBe(transcript)
    })

    test('should truncate long transcripts at 50 characters', async () => {
      const longTranscript =
        'This is a very long transcript that should be truncated because it exceeds fifty characters'

      interactionManager.initialize()
      await interactionManager.createInteraction(
        longTranscript,
        Buffer.from('audio'),
        16000,
      )

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.title).toBe(
        'This is a very long transcript that should be trun...',
      )
      expect(interactionData.title.length).toBe(53)
    })

    test('should use fallback title for empty transcript', async () => {
      interactionManager.initialize()
      await interactionManager.createInteraction(
        '',
        Buffer.from('audio'),
        16000,
      )

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.title).toBe('Voice interaction')
    })
  })

  describe('Duration Calculation', () => {
    test('should calculate duration from start time', async () => {
      interactionManager.initialize()

      // Wait a bit to ensure measurable duration
      await new Promise(resolve => setTimeout(resolve, 10))

      await interactionManager.createInteraction(
        'test',
        Buffer.from('audio'),
        16000,
      )

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.duration_ms).toBeGreaterThan(0)
      expect(interactionData.duration_ms).toBeLessThan(1000) // Should be reasonable
    })

    test('should handle missing start time', async () => {
      // Manually set interaction ID without using initialize
      const manager = new InteractionManager()
      ;(manager as any).currentInteractionId = 'test-id'
      ;(manager as any).interactionStartTime = null

      await manager.createInteraction('test', Buffer.from('audio'), 16000)

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.duration_ms).toBe(0)
    })
  })

  describe('Audio Buffer Handling', () => {
    test('should include audio buffer when not empty', async () => {
      const audioBuffer = Buffer.from('audio-data')

      interactionManager.initialize()
      await interactionManager.createInteraction('test', audioBuffer, 16000)

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      // We intentionally do not persist audio in local-only mode.
      expect(interactionData.raw_audio).toBeNull()
      expect(interactionData.asr_output?.totalAudioBytes).toBe(audioBuffer.length)
    })

    test('should set null for empty audio buffer', async () => {
      const emptyBuffer = Buffer.alloc(0)

      interactionManager.initialize()
      await interactionManager.createInteraction('test', emptyBuffer, 16000)

      expect(mockUpsert).toHaveBeenCalled()
      const interactionData = mockUpsert.mock.calls[0][0] as any
      expect(interactionData.raw_audio).toBeNull()
      expect(interactionData.asr_output?.totalAudioBytes).toBe(0)
    })
  })

  describe('Error Handling', () => {
    test('should handle database insertion errors gracefully', async () => {
      mockUpsert.mockRejectedValueOnce(new Error('Database error'))

      interactionManager.initialize()

      // Should not throw - errors should be caught and logged
      await expect(
        interactionManager.createInteraction(
          'test',
          Buffer.from('audio'),
          16000,
        ),
      ).resolves.toBeUndefined()
    })
  })
})
// @ts-nocheck
