---
name: ito-transcribe
description: Transcribe audio recordings (calls, meetings, voice memos, a folder of them) into Markdown transcripts, then read them. Use when the user points at .m4a/.mp3/.wav/.ogg/.mp4 files or a folder of recordings and wants their content — a summary, notes, follow-ups, a CRM update, "what did we say in this call".
---

# ito-transcribe

`ito-transcribe` is a command on PATH. It sends recordings to the speech engines configured in the Ito desktop app, writes one Markdown transcript per recording, and prints where they are. Recordings that already have a transcript are skipped, so rerunning on the same folder costs nothing.

## Steps

1. Run it on the folder or files the user named. Prefer the JSON report:

   ```bash
   ito-transcribe "C:\path\to\recordings" --json
   ```

   Progress goes to stderr; stdout is `{"recordings": [{audio, transcript, status, speakers, durationMs, engine, seconds, error}]}`. A 45-minute call takes 2 to 4 minutes. Exit code 1 means at least one recording failed; the report says which and why.

2. Read every `transcript` path whose status is `done` or `skipped`. Each file starts with a header (file, recorded at, duration, speakers, engine) then `## Transcript`: one line per turn, `**[mm:ss] Locuteur 1:** …`, or plain paragraphs for a single voice. Speaker labels are positional; the first turns usually reveal who is who.

3. Do what the user asked with the content. Quote timestamps when you cite a passage.

Done when every recording the user pointed at has a transcript that you have read, or a reported failure you have relayed.

## Options worth knowing

`ito-transcribe --help` lists everything. The ones that change a run:

- `--force` when the user wants a recording transcribed again (for example after changing the model).
- `--model <key>` to pick an engine for this run, e.g. `nova-3` (Deepgram, fastest), `gemini-3-7-flash-openrouter-audio` (default when set in Ito, best on dialogue), `gpt-transcribe-openai`.
- `--language en` when the recording is not in the user's usual language.
- `--out <dir>` to collect transcripts in one folder instead of next to each recording.
- `--no-history` to keep a run out of the Ito app's history.

## Gotchas

- Anything but WAV needs `ffmpeg` on PATH; the error names it when missing.
- API keys come from the Ito app (Settings › Models). If unlocking them fails, `ITO_OPENROUTER_API_KEY`, `ITO_DEEPGRAM_API_KEY`, `ITO_OPENAI_API_KEY` override.
- The transcript's `Recorded` time is the file's modification time, which is the end of the recording.
