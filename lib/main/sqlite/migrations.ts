export interface Migration {
  id: string
  up: string
  down: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: '20250108120000_add_raw_audio_to_interactions',
    up: 'ALTER TABLE interactions ADD COLUMN raw_audio BLOB;',
    down: 'ALTER TABLE interactions DROP COLUMN raw_audio;',
  },
  {
    id: '20250108130000_add_duration_to_interactions',
    up: 'ALTER TABLE interactions ADD COLUMN duration_ms INTEGER DEFAULT 0;',
    down: 'ALTER TABLE interactions DROP COLUMN duration_ms;',
  },
  {
    id: '20250110120000_add_sample_rate_to_interactions',
    up: 'ALTER TABLE interactions ADD COLUMN sample_rate INTEGER;',
    down: 'ALTER TABLE interactions DROP COLUMN sample_rate;',
  },
  {
    id: '20250111120000_add_raw_audio_id_to_interactions',
    up: 'ALTER TABLE interactions ADD COLUMN raw_audio_id TEXT;',
    down: 'ALTER TABLE interactions DROP COLUMN raw_audio_id;',
  },
  {
    id: '20250923091139_make_dictionary_word_unique',
    up: `
      -- Delete duplicate entries, keeping only the most recent one (highest id)
      DELETE FROM dictionary_items
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM dictionary_items
        WHERE deleted_at IS NULL
        GROUP BY word
      )
      AND deleted_at IS NULL;

      -- Now create the unique index
      CREATE UNIQUE INDEX idx_dictionary_items_word_unique ON dictionary_items(word) WHERE deleted_at IS NULL;
    `,
    down: 'DROP INDEX idx_dictionary_items_word_unique;',
  },
  {
    id: '20251029000000_add_user_metadata_table',
    up: `
      CREATE TABLE user_metadata (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        paid_status TEXT NOT NULL DEFAULT 'FREE',
        free_words_remaining INTEGER,
        pro_trial_start_date TEXT,
        pro_trial_end_date TEXT,
        pro_subscription_start_date TEXT,
        pro_subscription_end_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    down: 'DROP TABLE user_metadata;',
  },
  {
    id: '20260814190000_add_modes_table',
    up: `
      CREATE TABLE modes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        preset TEXT NOT NULL,
        icon TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'fr',
        voice_model_key TEXT,
        text_model_key TEXT,
        use_llm INTEGER NOT NULL DEFAULT 1,
        context_application INTEGER NOT NULL DEFAULT 0,
        context_clipboard INTEGER NOT NULL DEFAULT 0,
        context_selection INTEGER NOT NULL DEFAULT 0,
        audio_source TEXT NOT NULL DEFAULT 'microphone',
        playback_when_recording TEXT NOT NULL DEFAULT 'mute',
        auto_paste INTEGER NOT NULL DEFAULT 1,
        autocapitalize INTEGER NOT NULL DEFAULT 1,
        identify_speakers INTEGER NOT NULL DEFAULT 0,
        asr_prompt TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX idx_modes_user ON modes(user_id) WHERE deleted_at IS NULL;
    `,
    down: 'DROP TABLE modes;',
  },
  {
    id: '20260814190100_add_mode_examples_table',
    up: `
      CREATE TABLE mode_examples (
        id TEXT PRIMARY KEY,
        mode_id TEXT NOT NULL,
        spoken_input TEXT NOT NULL,
        ai_output TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (mode_id) REFERENCES modes (id) ON DELETE CASCADE
      );

      CREATE INDEX idx_mode_examples_mode ON mode_examples(mode_id) WHERE deleted_at IS NULL;
    `,
    down: 'DROP TABLE mode_examples;',
  },
]
