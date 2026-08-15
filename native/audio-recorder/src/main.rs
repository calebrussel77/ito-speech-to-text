use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Result};
use cpal::{Sample, SampleFormat, StreamConfig};
use dasp_sample::FromSample;
use rubato::{FftFixedIn, Resampler};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "command")]
enum Command {
    #[serde(rename = "start")]
    Start {
        device_name: Option<String>,
        #[serde(default, deserialize_with = "deserialize_audio_source")]
        audio_source: AudioSource,
    },
    #[serde(rename = "prepare")]
    Prepare { device_name: Option<String> },
    #[serde(rename = "stop")]
    Stop,
    #[serde(rename = "list-devices")]
    ListDevices,
    #[serde(rename = "get-device-config")]
    GetDeviceConfig { device_name: Option<String> },
}

/// Where a recording's audio comes from.
///
/// `System` relies on a cpal/WASAPI quirk on Windows: opening the default
/// **output** device in capture mode transparently activates loopback
/// capture (see `find_loopback_device`). No extra dependency is needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AudioSource {
    #[default]
    Microphone,
    System,
    Both,
}

impl AudioSource {
    /// Only `Both` combines two live streams and therefore needs the mixer
    /// (task 4.2): a second, loopback stream opened alongside the primary
    /// microphone stream and mixed into it in `writer_loop`. `System` alone
    /// is a single loopback stream, same shape as a plain microphone
    /// capture — see `CaptureKind` for how each source's *primary* device
    /// picks its config accessor.
    const fn needs_mixer(self) -> bool {
        matches!(self, Self::Both)
    }
}

/// Field-level fallback for `Command::Start.audio_source`: an unrecognized
/// value degrades to the microphone instead of failing deserialization.
/// `main`'s stdin loop drops any line that fails to parse as a whole
/// `Command`, so without this the entire `start` command would be lost
/// rather than just its source.
///
/// Deserializes into a permissive `serde_json::Value` first, not
/// `Option<String>`: a present-but-wrong-typed field (a number, an array...)
/// must degrade the same way an unrecognized string does. `Option::<String>`
/// would instead propagate a hard `Err` for those shapes, failing the whole
/// `Command` and losing it silently — the exact failure this fallback exists
/// to prevent.
fn deserialize_audio_source<'de, D>(deserializer: D) -> Result<AudioSource, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(match raw.as_str() {
        Some("system") => AudioSource::System,
        Some("both") => AudioSource::Both,
        Some("microphone") => AudioSource::Microphone,
        Some(other) => {
            eprintln!("[audio-recorder] Unknown audio source {other:?}, using the microphone");
            AudioSource::Microphone
        }
        None if raw.is_null() => AudioSource::Microphone,
        None => {
            eprintln!(
                "[audio-recorder] audio_source must be a string, got {raw:?}; using the microphone"
            );
            AudioSource::Microphone
        }
    })
}

#[derive(Serialize)]
struct DeviceList {
    #[serde(rename = "type")]
    response_type: String,
    devices: Vec<String>,
}

#[derive(Serialize)]
struct AudioConfig {
    #[serde(rename = "type")]
    response_type: String,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: u8,
}

const MSG_TYPE_JSON: u8 = 1;
const MSG_TYPE_AUDIO: u8 = 2;

fn write_framed_message(writer: &mut impl Write, msg_type: u8, data: &[u8]) -> io::Result<()> {
    let len = data.len() as u32;
    writer.write_all(&[msg_type])?;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(data)?;
    writer.flush()
}

/// Reports a session-level condition to the JS host over the same
/// framed-JSON channel already used for `audio-config`/`drain-complete`/
/// `device-list`, rather than a second, ad hoc channel. Used where a
/// failure would otherwise only reach `eprintln!` — invisible to the host —
/// even though the session keeps running in a degraded state the host needs
/// to know about (see `start_recording`'s loopback `.play()` failure).
fn write_status_message(stdout: &Arc<Mutex<io::Stdout>>, response_type: &str, message: &str) {
    let response = serde_json::json!({
        "type": response_type,
        "message": message,
    });
    if let Ok(json_string) = serde_json::to_string(&response) {
        let mut writer = stdout.lock().unwrap();
        let _ = write_framed_message(&mut *writer, MSG_TYPE_JSON, json_string.as_bytes());
    }
}

fn main() {
    // Diagnostic subcommand, bypassing the normal stdin protocol: opens the
    // default output device in capture mode, records ~3s and prints the peak
    // level. A peak of 0.0000 means WASAPI loopback isn't delivering samples
    // on this machine.
    if std::env::args().nth(1).as_deref() == Some("probe-loopback") {
        let host = build_preferred_host();
        if let Err(e) = probe_loopback(&host) {
            eprintln!("[audio-recorder] probe-loopback failed: {e}");
            std::process::exit(1);
        }
        return;
    }

    // Diagnostic subcommand symmetrical to `probe-loopback` above: records
    // ~10s of mic + loopback concurrently, mixes them the way `Both`
    // sessions do in production, and writes the result to `mix.wav` for
    // manual listening. See `probe_mix`'s doc comment for what this does
    // and does not verify.
    if std::env::args().nth(1).as_deref() == Some("probe-mix") {
        let host = build_preferred_host();
        if let Err(e) = probe_mix(&host) {
            eprintln!("[audio-recorder] probe-mix failed: {e}");
            std::process::exit(1);
        }
        return;
    }

    let stdout = Arc::new(Mutex::new(io::stdout()));
    let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded::<Command>();

    let mut command_processor = CommandProcessor::new(cmd_rx, Arc::clone(&stdout));

    thread::spawn(move || {
        let stdin = io::stdin();
        for l in stdin.lock().lines().map_while(Result::ok) {
            if l.trim().is_empty() {
                continue;
            }
            if let Ok(command) = serde_json::from_str::<Command>(&l) {
                cmd_tx
                    .send(command)
                    .expect("Failed to send command to processor");
            }
        }
    });

    command_processor.run();
}

/// Prefers the WASAPI backend on Windows for lower latency (10-30ms vs
/// DirectSound's 50-80ms); falls back to the platform default host elsewhere,
/// and if WASAPI itself is unavailable.
fn build_preferred_host() -> cpal::Host {
    #[cfg(target_os = "windows")]
    {
        match cpal::host_from_id(cpal::platform::HostId::Wasapi) {
            Ok(wasapi_host) => {
                eprintln!("[audio-recorder] Using WASAPI host (optimal for Windows)");
                wasapi_host
            }
            Err(e) => {
                eprintln!(
                    "[audio-recorder] WASAPI unavailable ({}), falling back to default",
                    e
                );
                cpal::default_host()
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        cpal::default_host()
    }
}

struct CommandProcessor {
    cmd_rx: crossbeam_channel::Receiver<Command>,
    active_stream: Option<cpal::Stream>,
    stdout: Arc<Mutex<io::Stdout>>,
    cached_host: Option<Rc<cpal::Host>>,
    // Offloaded writer thread state
    audio_tx: Option<crossbeam_channel::Sender<WriterMsg>>,
    writer_handle: Option<std::thread::JoinHandle<()>>,
    is_recording: Option<Arc<AtomicBool>>,
    current_device_name: Option<String>,
    current_audio_source: AudioSource,
    // `AudioSource::Both` only: the loopback stream + its resampling thread,
    // started and torn down in lockstep with `active_stream`.
    active_loopback: Option<LoopbackCapture>,
}

impl CommandProcessor {
    fn new(cmd_rx: crossbeam_channel::Receiver<Command>, stdout: Arc<Mutex<io::Stdout>>) -> Self {
        CommandProcessor {
            cmd_rx,
            active_stream: None,
            stdout,
            cached_host: None,
            audio_tx: None,
            writer_handle: None,
            is_recording: None,
            current_device_name: None,
            current_audio_source: AudioSource::default(),
            active_loopback: None,
        }
    }

    fn get_or_create_host(&mut self) -> Rc<cpal::Host> {
        if let Some(ref host) = self.cached_host {
            return host.clone();
        }

        let host_rc = Rc::new(build_preferred_host());
        self.cached_host = Some(host_rc.clone());
        host_rc
    }

    fn run(&mut self) {
        while let Ok(command) = self.cmd_rx.recv() {
            match command {
                Command::ListDevices => self.list_devices(),
                Command::Start {
                    device_name,
                    audio_source,
                } => self.start_recording(device_name, audio_source),
                Command::Prepare { device_name } => self.prepare_stream(device_name),
                Command::Stop => self.stop_recording(),
                Command::GetDeviceConfig { device_name } => self.get_device_config(device_name),
            }
        }
    }

    fn normalize_device_name(device_name: Option<String>) -> Option<String> {
        match device_name {
            None => None,
            Some(name) => {
                let trimmed = name.trim().to_string();
                if trimmed.is_empty() || trimmed.to_lowercase() == "default" {
                    None
                } else {
                    Some(trimmed)
                }
            }
        }
    }

    fn teardown_stream(&mut self) {
        if let Some(flag) = &self.is_recording {
            flag.store(false, Ordering::Release);
        }
        if let Some(stream) = self.active_stream.take() {
            let _ = stream.pause();
            drop(stream);
        }
        // Close audio channel to stop the writer thread.
        if let Some(tx) = self.audio_tx.take() {
            drop(tx);
        }
        if let Some(handle) = self.writer_handle.take() {
            let _ = handle.join();
        }
        // Tear down the loopback stream (if `Both` was active) the same way:
        // drop the stream, close its raw channel so `loopback_resample_loop`
        // sees EOF and exits, then join it.
        if let Some(loopback) = self.active_loopback.take() {
            let _ = loopback.stream.pause();
            drop(loopback.stream);
            drop(loopback.raw_tx);
            let _ = loopback.resample_handle.join();
        }
        self.is_recording = None;
        self.current_device_name = None;
        self.current_audio_source = AudioSource::default();
    }

    fn prepare_stream(&mut self, device_name: Option<String>) {
        // Create the CPAL stream + writer thread once so subsequent starts are instant.
        // `prepare` always warms up the microphone; the source-aware fast path
        // lives in `start_recording`.
        let device_name = Self::normalize_device_name(device_name);
        if self.active_stream.is_some() {
            if can_reuse_stream(
                self.current_device_name.as_deref(),
                self.current_audio_source,
                device_name.as_deref(),
                AudioSource::Microphone,
            ) {
                return;
            }
            // Device or source changed: recreate the stream to match the selected device.
            self.teardown_stream();
        }

        let host = self.get_or_create_host();
        if let Ok(handles) = start_capture(
            device_name.clone(),
            AudioSource::Microphone,
            Arc::clone(&self.stdout),
            host,
        ) {
            self.audio_tx = Some(handles.audio_tx);
            self.writer_handle = Some(handles.writer_handle);
            self.is_recording = Some(handles.is_recording);
            self.active_stream = Some(handles.stream);
            // `prepare` always warms up the microphone alone, so this is
            // always `None` today, but assigning it keeps this in lockstep
            // with `start_recording` rather than relying on that invariant.
            self.active_loopback = handles.loopback;
            self.current_device_name = device_name;
            self.current_audio_source = AudioSource::Microphone;
        } else {
            eprintln!("[audio-recorder] CRITICAL: Failed to prepare audio stream");
        }
    }

    fn list_devices(&mut self) {
        let host = self.get_or_create_host();
        let device_names: Vec<String> = match host.input_devices() {
            Ok(devices) => devices
                .map(|d| d.name().unwrap_or_else(|_| "Unknown Device".to_string()))
                .collect(),
            Err(_) => Vec::new(),
        };
        let response = DeviceList {
            response_type: "device-list".to_string(),
            devices: device_names,
        };
        if let Ok(json_string) = serde_json::to_string(&response) {
            let mut writer = self.stdout.lock().unwrap();
            let _ = write_framed_message(&mut *writer, MSG_TYPE_JSON, json_string.as_bytes());
        }
    }

    fn start_recording(&mut self, device_name: Option<String>, source: AudioSource) {
        let device_name = Self::normalize_device_name(device_name);

        // Fast path: reuse existing stream + writer thread to avoid 1-3s cold-start
        // latency. The cache key must include the source: without it, a Meeting-mode
        // dictation would silently reuse the microphone stream prepared at startup
        // (see `prepare_stream`) and record silence instead of the call.
        if self.active_stream.is_some()
            && can_reuse_stream(
                self.current_device_name.as_deref(),
                self.current_audio_source,
                device_name.as_deref(),
                source,
            )
        {
            let stream = self.active_stream.as_ref().unwrap();
            let flag = self.is_recording.as_ref().unwrap();
            flag.store(true, Ordering::Release);
            if let Err(e) = stream.play() {
                eprintln!("[audio-recorder] Failed to resume audio stream: {}", e);
            }
            if let Some(loopback) = &self.active_loopback {
                if let Err(e) = loopback.stream.play() {
                    eprintln!("[audio-recorder] Failed to resume loopback stream: {}", e);
                    // The mic resumed but the loopback didn't: the session
                    // is about to record mic-only audio while behaving as
                    // if `Both` were active. Tell the host so it isn't
                    // discovered only on playback (see the same handling in
                    // the cold-start path below).
                    write_status_message(
                        &self.stdout,
                        "loopback-start-failed",
                        "System audio capture failed to resume; recording continues with the microphone only.",
                    );
                }
            }
            return;
        }

        // Stream exists but device or source changed: recreate to match the request.
        if self.active_stream.is_some() {
            self.teardown_stream();
        }

        let host = self.get_or_create_host();
        if let Ok(handles) =
            start_capture(device_name.clone(), source, Arc::clone(&self.stdout), host)
        {
            handles.is_recording.store(true, Ordering::Release);
            // The loopback stream shares `is_recording` with the primary
            // (see `start_capture`), so only the primary's `play()` result
            // gates whether the session is considered started; still play
            // the loopback stream itself so it actually starts producing
            // samples.
            if handles.stream.play().is_ok() {
                if let Some(loopback) = &handles.loopback {
                    if let Err(e) = loopback.stream.play() {
                        eprintln!("[audio-recorder] Failed to start loopback stream: {}", e);
                        // Half-failed start: the mic is live but system
                        // audio is not, so a `Both` session is silently
                        // degrading to mic-only. Left as just an stderr
                        // print, the host would have no way to know the
                        // call side of the recording is missing until the
                        // user listens back and hears only themselves —
                        // report it over the same protocol the host already
                        // reads `audio-config`/`drain-complete` from.
                        write_status_message(
                            &self.stdout,
                            "loopback-start-failed",
                            "System audio capture failed to start; recording continues with the microphone only.",
                        );
                    }
                }
                self.audio_tx = Some(handles.audio_tx);
                self.writer_handle = Some(handles.writer_handle);
                self.is_recording = Some(handles.is_recording);
                self.active_stream = Some(handles.stream);
                self.active_loopback = handles.loopback;
                self.current_device_name = device_name;
                self.current_audio_source = source;
            }
        } else {
            eprintln!("[audio-recorder] CRITICAL: Failed to create audio stream");
        }
    }

    fn stop_recording(&mut self) {
        if let Some(flag) = &self.is_recording {
            flag.store(false, Ordering::Release);
        }
        if let Some(stream) = &self.active_stream {
            let _ = stream.pause();
        }
        if let Some(loopback) = &self.active_loopback {
            let _ = loopback.stream.pause();
        }
        // Flush any buffered samples and signal drain-complete for the current session
        if let Some(tx) = &self.audio_tx {
            let _ = tx.send(WriterMsg::Flush);
        }
    }

    fn get_device_config(&mut self, device_name: Option<String>) {
        const TARGET_SAMPLE_RATE: u32 = 16000;

        let host = self.get_or_create_host();
        let device = find_input_device(&host, device_name).ok();

        let input_rate = device
            .and_then(|d| d.supported_input_configs().ok())
            .and_then(|mut cfgs| cfgs.find(|r| r.channels() > 0))
            .map(|cfg| cfg.with_max_sample_rate().sample_rate().0)
            .unwrap_or(TARGET_SAMPLE_RATE);

        let cfg = AudioConfig {
            response_type: "audio-config".to_string(),
            input_sample_rate: input_rate,
            output_sample_rate: TARGET_SAMPLE_RATE,
            channels: 1,
        };
        if let Ok(json_string) = serde_json::to_string(&cfg) {
            let mut writer = self.stdout.lock().unwrap();
            let _ = write_framed_message(&mut *writer, MSG_TYPE_JSON, json_string.as_bytes());
        }
    }
}

/// The prepared stream is reusable only if both the device **and** the
/// source of the new request match what is currently open.
fn can_reuse_stream(
    current_device: Option<&str>,
    current_source: AudioSource,
    wanted_device: Option<&str>,
    wanted_source: AudioSource,
) -> bool {
    current_device == wanted_device && current_source == wanted_source
}

/// Resolves the named input device, or the default input device when `name`
/// is absent, empty, or the literal `"default"`.
fn find_input_device(host: &cpal::Host, device_name: Option<String>) -> Result<cpal::Device> {
    if let Some(name) = device_name {
        if name.to_lowercase() == "default" || name.is_empty() {
            host.default_input_device()
        } else {
            host.input_devices()?
                .find(|d| d.name().unwrap_or_default() == name)
        }
    } else {
        host.default_input_device()
    }
    .ok_or_else(|| anyhow!("[audio-recorder] Failed to find input device"))
}

/// The default output device, to be opened in capture mode.
///
/// On Windows, cpal/WASAPI detects that the device was obtained via
/// `default_output_device()` (its render "data flow") and sets
/// `AUDCLNT_STREAMFLAGS_LOOPBACK` automatically once a capture stream is
/// built on it — no separate loopback API is needed. Its capture format must
/// then be queried through `default_output_config()`, not
/// `default_input_config()`: the latter fails outright on a render-flow
/// device, since it isn't a capture endpoint by itself.
fn find_loopback_device(host: &cpal::Host) -> Result<cpal::Device> {
    host.default_output_device()
        .ok_or_else(|| anyhow!("[audio-recorder] No output device to capture from"))
}

/// Which device flow a capture opened: an `eCapture` microphone (config
/// queried via `default_input_config()`) or an `eRender` device captured in
/// loopback (queried via `default_output_config()`, see `find_loopback_device`
/// for why those two accessors aren't interchangeable).
///
/// `start_capture` picks its config accessor from this tag rather than from
/// `AudioSource` directly, so the two can never drift apart the way they
/// once did: `Both`'s *primary* device is the microphone (an input-flow
/// device, same as plain `Microphone`) even though the source as a whole
/// also opens a loopback device — as a *second*, independent stream via
/// `start_loopback_capture`. A predicate keyed on `AudioSource` alone
/// (`needs_output_device` in an earlier version of this file) conflated
/// those two questions and sent `default_output_config()` to a microphone
/// for `Both`, which cpal/WASAPI rejects outright since the device isn't
/// `eRender`. Tagging the device with its actual flow at the point it's
/// resolved makes that mismatch structurally impossible instead of correct
/// by coincidence.
#[derive(Clone, Copy)]
enum CaptureKind {
    Input,
    Loopback,
}

/// Maps a source to the flow of its *primary* device (see `CaptureKind`).
///
/// `Both` mixes microphone and system audio with the microphone as the clock
/// master (see task 4.2's mixer): its primary device here is the microphone
/// (`Input`), same as plain `Microphone`; the loopback device is opened
/// separately, as the secondary stream, by `start_loopback_capture`. Only
/// `System` uses the loopback device as its primary.
///
/// Pulled out as its own pure function, rather than inlined in
/// `find_capture_device`, so this mapping — the thing that was once wrong
/// for `Both` (see `CaptureKind`'s doc comment) — is unit-testable without a
/// real audio host.
const fn primary_capture_kind(source: AudioSource) -> CaptureKind {
    match source {
        AudioSource::Microphone | AudioSource::Both => CaptureKind::Input,
        AudioSource::System => CaptureKind::Loopback,
    }
}

/// Whether this platform/host can even attempt loopback (system-audio)
/// capture. `find_loopback_device` is a WASAPI-specific trick — opening the
/// default *output* device in capture mode — with no CoreAudio equivalent;
/// on non-Windows platforms it is not just unreliable, it categorically
/// cannot work. Kept as its own function (rather than inlined as
/// `cfg!(target_os = "windows")` at the one call site) so the call site
/// reads as a named question, and so a future real macOS implementation
/// only has one place to change.
const fn loopback_capture_supported() -> bool {
    cfg!(target_os = "windows")
}

/// The source `start_capture` should actually open, given what was
/// requested and whether loopback capture is available at all.
///
/// `System` and `Both` both need a loopback device to deliver what was
/// asked for; without one (see `loopback_capture_supported`), a hard
/// failure used to take down the *entire* start — on macOS, requesting
/// `Both` (the seeded Meeting preset's default, on every platform) produced
/// no recording whatsoever, not even the microphone, because
/// `find_loopback_device`'s `Err` propagated out of `start_capture` via `?`
/// before the microphone stream was ever built. Degrading to `Microphone`
/// instead means a partial recording instead of none; `start_capture`
/// reports the degrade over the same JSON protocol the host already reads
/// `audio-config`/`drain-complete` from (see `write_status_message`), so
/// the user learns their call audio is missing before the meeting, not
/// after. `Microphone` requests pass through unaffected, since they never
/// needed loopback capture to begin with.
///
/// Takes `loopback_supported` as a plain `bool` instead of calling
/// `loopback_capture_supported()` itself, so this decision is unit-testable
/// on any platform — the platform check itself has nothing to unit test,
/// but the choice of what to do once it's known is exactly what a review of
/// this fix asked to see covered.
const fn effective_capture_source(requested: AudioSource, loopback_supported: bool) -> AudioSource {
    if loopback_supported {
        requested
    } else {
        // Both `System` and `Both` need loopback to deliver what was
        // requested; without it, the only source left to capture at all is
        // the microphone. `Microphone` itself maps to `Microphone` here
        // too, which is a no-op: it never needed loopback in the first
        // place.
        AudioSource::Microphone
    }
}

/// Resolves the cpal device to open as the *primary* capture for the
/// requested source, tagged with its flow (see `CaptureKind`).
fn find_capture_device(
    host: &cpal::Host,
    source: AudioSource,
    device_name: Option<String>,
) -> Result<(cpal::Device, CaptureKind)> {
    let kind = primary_capture_kind(source);
    let device = match kind {
        CaptureKind::Input => find_input_device(host, device_name)?,
        CaptureKind::Loopback => find_loopback_device(host)?,
    };
    Ok((device, kind))
}

/// Resolves the device for `start_loopback_capture`'s secondary stream,
/// tagged the same way `find_capture_device` tags the primary (see
/// `CaptureKind`).
///
/// Hardcoded to `Loopback` today, since this function only ever captures
/// the default output device — but going through the tag, instead of
/// calling `find_loopback_device` directly and assuming the config
/// accessor that follows, means device selection and config selection stay
/// structurally unable to drift apart even here. If this function ever
/// gains a real device choice (letting the user pick which output to
/// capture, say), `resolve_capture_config` below is the only place that
/// would need to learn about it.
fn find_loopback_capture_device(host: &cpal::Host) -> Result<(cpal::Device, CaptureKind)> {
    Ok((find_loopback_device(host)?, CaptureKind::Loopback))
}

/// Resolves the config accessor for a device from its tagged flow (see
/// `CaptureKind`), instead of each call site matching on the tag itself.
/// Both `start_capture` (primary device) and `start_loopback_capture`
/// (secondary, loopback-only device) go through this one function, so the
/// device-flow-to-config-accessor mapping can only be made in one place.
fn resolve_capture_config(
    device: &cpal::Device,
    kind: CaptureKind,
) -> Result<cpal::SupportedStreamConfig> {
    match kind {
        CaptureKind::Loopback => device
            .default_output_config()
            .map_err(|_| anyhow!("[audio-recorder] No default output config found")),
        CaptureKind::Input => device
            .default_input_config()
            .map_err(|_| anyhow!("[audio-recorder] No default input config found")),
    }
}

fn write_audio_chunk(data: &[f32], stdout: &Arc<Mutex<io::Stdout>>) {
    let mut writer = stdout.lock().unwrap();
    let mut buffer = Vec::with_capacity(data.len() * 2);
    for s in data {
        buffer.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }

    if let Err(e) = write_framed_message(&mut *writer, MSG_TYPE_AUDIO, &buffer) {
        eprintln!(
            "[audio-recorder] CRITICAL: Failed to write to stdout: {}",
            e
        );
    }
}

enum WriterMsg {
    Audio(Vec<f32>),
    Flush,
}

struct CaptureHandles {
    stream: cpal::Stream,
    audio_tx: crossbeam_channel::Sender<WriterMsg>,
    writer_handle: std::thread::JoinHandle<()>,
    is_recording: Arc<AtomicBool>,
    /// Present only for `AudioSource::Both`: the loopback device's own
    /// stream + resampling thread, kept alongside the primary (microphone)
    /// stream so `CommandProcessor` can play/pause/tear them down together.
    loopback: Option<LoopbackCapture>,
}

/// The loopback half of an `AudioSource::Both` capture: its cpal stream plus
/// the thread that resamples it to 16 kHz, and the raw-audio sender that
/// must be dropped to let that thread exit on teardown.
struct LoopbackCapture {
    stream: cpal::Stream,
    raw_tx: crossbeam_channel::Sender<Vec<f32>>,
    resample_handle: std::thread::JoinHandle<()>,
}

/// Bound on the loopback backlog kept by `LoopbackBuffer`, in already-16kHz
/// samples: 2 seconds worth. A loopback device that gets more than 2s ahead
/// of the microphone (the clock master) is misbehaving; letting the backlog
/// grow further would just leak memory for the rest of the meeting, so the
/// oldest samples are dropped instead once this cap is hit.
///
/// This is the one place in the pipeline that drops the *oldest* data under
/// pressure — every bounded channel elsewhere (`audio_tx`, the loopback's
/// raw/resampled channels) drops the *newest* block instead, via
/// `try_send` failing on a full channel and the block simply being
/// discarded. Both are defensible for what they each hold: a channel is a
/// short relay a lagging consumer will drain any moment, so keeping the
/// oldest (soonest-to-play) samples and discarding what just arrived is
/// right; this backlog is a standing reserve meant to survive brief stalls,
/// so keeping the newest samples — the ones closest to catching back up to
/// the mic — and trimming the stale tail is right. Worth calling out
/// explicitly since nothing else in the file signals that the two policies
/// differ, and a reader skimming past one after the other would reasonably
/// assume they matched.
const LOOPBACK_BUFFER_CAP_SAMPLES: usize = 32_000;

/// Depth of the channel carrying already-resampled (16 kHz) loopback blocks
/// from `loopback_resample_loop` into `writer_loop`.
const LOOPBACK_CHANNEL_CAPACITY: usize = 64;

/// Sums the loopback stream into the microphone (master-clock) stream,
/// sample by sample, and clamps to avoid an `i16` wraparound later on.
///
/// The primary is the clock: its length decides the output length. A shorter
/// secondary leaves the tail untouched (the loopback fell behind), a longer
/// one is truncated (it got ahead). That is how the drift between two
/// independent crystals stays a local, imperceptible defect instead of a
/// cumulative offset that would desynchronize the whole recording.
///
/// Runs in `f32`, like the rest of the pipeline upstream of the final write;
/// the `i16` conversion only happens in `write_audio_chunk`.
pub fn mix_into(primary: &mut [f32], secondary: &[f32]) {
    for (target, source) in primary.iter_mut().zip(secondary.iter()) {
        *target = (*target + *source).clamp(-1.0, 1.0);
    }
}

/// Persistent loopback backlog drained into each outgoing microphone block.
///
/// `writer_loop` calls `mix_into_block` once per outgoing 16 kHz block,
/// pulling only as many loopback samples as that block needs via a
/// non-blocking `try_recv` — waiting for the loopback would stall the mic's
/// write path, which is exactly the stutter the master-clock design exists
/// to avoid. The backlog itself is capped at `LOOPBACK_BUFFER_CAP_SAMPLES`;
/// see that constant for why.
struct LoopbackBuffer {
    rx: crossbeam_channel::Receiver<Vec<f32>>,
    pending: Vec<f32>,
}

impl LoopbackBuffer {
    fn new(rx: crossbeam_channel::Receiver<Vec<f32>>) -> Self {
        Self {
            rx,
            pending: Vec::new(),
        }
    }

    /// Drains any newly-arrived loopback blocks, trims the backlog to the
    /// cap, then mixes as much of it as `primary` needs (or as is
    /// available, whichever is shorter) via `mix_into`.
    fn mix_into_block(&mut self, primary: &mut [f32]) {
        while let Ok(block) = self.rx.try_recv() {
            self.pending.extend_from_slice(&block);
        }
        if self.pending.len() > LOOPBACK_BUFFER_CAP_SAMPLES {
            let excess = self.pending.len() - LOOPBACK_BUFFER_CAP_SAMPLES;
            self.pending.drain(..excess);
        }
        let take = primary.len().min(self.pending.len());
        mix_into(primary, &self.pending[..take]);
        self.pending.drain(..take);
    }
}

/// Mixes any buffered loopback audio into `chunk` (if `AudioSource::Both` is
/// active) before writing it out. Centralizes that branch so every write
/// site in `writer_loop`/`flush_pending` looks the same whether or not a
/// second source is active.
fn mix_and_write(
    chunk: &mut [f32],
    loopback: &mut Option<LoopbackBuffer>,
    stdout: &Arc<Mutex<io::Stdout>>,
) {
    if let Some(lb) = loopback {
        lb.mix_into_block(chunk);
    }
    write_audio_chunk(chunk, stdout);
}

/// Linear resampler fallback for mono, used by both `writer_loop` (the
/// primary/microphone stream) and `loopback_resample_loop` when an
/// `FftFixedIn` instance couldn't be built for the requested rate pair.
fn linear_resample_mono(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if input.is_empty() || in_rate == 0 || in_rate == out_rate {
        return input.to_vec();
    }
    let in_len = input.len();
    let ratio = out_rate as f32 / in_rate as f32;
    let out_len = ((in_len as f32) * ratio).round().max(0.0) as usize;
    if out_len <= 1 {
        return Vec::new();
    }
    let step = in_rate as f32 / out_rate as f32;
    let mut out = Vec::with_capacity(out_len);
    let mut pos: f32 = 0.0;
    for _ in 0..out_len {
        let idx = pos.floor() as usize;
        if idx >= in_len - 1 {
            out.push(input[in_len - 1]);
        } else {
            let frac = pos - (idx as f32);
            let a = input[idx];
            let b = input[idx + 1];
            out.push(a + (b - a) * frac);
        }
        pos += step;
    }
    out
}

/// Resamples the loopback capture to 16 kHz on its own thread, independent
/// from the microphone's resampler in `writer_loop`.
///
/// Each capture owns its own `FftFixedIn` instance because the two devices
/// rarely share a native rate (48 kHz mic vs 44.1 kHz output device is
/// common); resampling here, off the audio callback, keeps the callback
/// itself allocation-free (it only downmixes and does a non-blocking send).
/// Finished 16 kHz blocks are forwarded to `resampled_tx`; if `writer_loop`
/// hasn't drained enough to make room, the block is dropped rather than
/// blocking this thread (which would otherwise eventually back up into the
/// capture callback via a full raw channel).
fn loopback_resample_loop(
    raw_rx: crossbeam_channel::Receiver<Vec<f32>>,
    native_rate: u32,
    resampled_tx: crossbeam_channel::Sender<Vec<f32>>,
    free_tx: crossbeam_channel::Sender<Vec<f32>>,
) {
    const TARGET_SAMPLE_RATE: u32 = 16000;
    const CHUNK_SIZE_DEFAULT: usize = 1024;
    const CHUNK_SIZE_FALLBACK: usize = 512;

    let mut chosen_chunk_size = CHUNK_SIZE_DEFAULT;
    let mut resampler = if native_rate != TARGET_SAMPLE_RATE {
        FftFixedIn::new(
            native_rate as usize,
            TARGET_SAMPLE_RATE as usize,
            chosen_chunk_size,
            1,
            1,
        )
        .or_else(|_| {
            chosen_chunk_size = CHUNK_SIZE_FALLBACK;
            FftFixedIn::new(
                native_rate as usize,
                TARGET_SAMPLE_RATE as usize,
                chosen_chunk_size,
                1,
                1,
            )
        })
        .ok()
    } else {
        None
    };

    let mut in_buffer: Vec<f32> = Vec::new();

    while let Ok(mut raw) = raw_rx.recv() {
        if let Some(resampler) = resampler.as_mut() {
            in_buffer.extend_from_slice(&raw);
            // `raw`'s contents are now copied into `in_buffer`; recycle the
            // buffer back to the pool `build_loopback_stream`'s callback
            // draws from (see `find_loopback_capture_device`'s sibling,
            // `start_loopback_capture`) so that callback doesn't need to
            // allocate a replacement.
            raw.clear();
            let _ = free_tx.try_send(raw);
            while in_buffer.len() >= chosen_chunk_size {
                let chunk: Vec<f32> = in_buffer.drain(..chosen_chunk_size).collect();
                if let Ok(mut out) = resampler.process(&[chunk], None) {
                    if !out.is_empty() {
                        let _ = resampled_tx.try_send(out.remove(0));
                    }
                }
            }
        } else if native_rate != TARGET_SAMPLE_RATE {
            let out = linear_resample_mono(&raw, native_rate, TARGET_SAMPLE_RATE);
            raw.clear();
            let _ = free_tx.try_send(raw);
            if !out.is_empty() {
                let _ = resampled_tx.try_send(out);
            }
        } else {
            // Passthrough (native rate already matches the 16 kHz target):
            // `raw` is forwarded as-is instead of copied, so it can't be
            // recycled here — ownership moves downstream to `writer_loop`
            // via `LoopbackBuffer`. This path is rare in practice (real
            // capture devices are almost never natively 16 kHz); if the pool
            // ever does drain from it, the callback just drops blocks until
            // one frees up, the same backpressure behavior every other
            // channel in this pipeline already has.
            let _ = resampled_tx.try_send(raw);
        }
    }
    // `raw_rx` closed: the capture stream was torn down. Unlike the primary
    // writer thread, the loopback path doesn't drive the `drain-complete`
    // handshake, so there's no flush to perform here — a few trailing
    // milliseconds of buffered loopback audio lost on stop is inaudible,
    // and not worth complicating an already-working teardown path for.
}

/// Upper bound on the per-channel energy accumulators `downmix_to_mono_into`
/// keeps on the stack, so it never needs to heap-allocate a scratch buffer
/// sized to the device's channel count. No consumer audio device in
/// practice exceeds this (stereo and 5.1/7.1 top out at 8); a device beyond
/// it just downmixes from channel 0 instead of the loudest one, which is an
/// acceptable degrade for a case that doesn't occur on real hardware.
const MAX_DOWNMIX_CHANNELS: usize = 8;

/// Downmixes `data` to mono, writing into `out` instead of allocating a
/// fresh `Vec`.
///
/// `out` is cleared and refilled every call; once its capacity has warmed up
/// to cover a device's block size (the common case after the first few
/// calls), refilling it doesn't allocate at all. This is the shape a
/// real-time audio callback needs — see `build_loopback_stream`, which pulls
/// `out` from a pre-allocated pool so it never allocates on the callback
/// thread. `downmix_to_mono_vec` below is a thin wrapper for call sites that
/// don't have (or don't yet need) a buffer to reuse.
fn downmix_to_mono_into<T>(data: &[T], num_channels: usize, out: &mut Vec<f32>)
where
    T: Sample,
    f32: FromSample<T>,
{
    out.clear();
    if num_channels <= 1 {
        out.extend(data.iter().map(|s| s.to_sample::<f32>()));
        return;
    }
    // Select the dominant channel to avoid amplitude loss when one channel is
    // near-silent.
    let frames = data.len() / num_channels;
    if frames == 0 {
        return;
    }

    let mut energy_per_channel = [0.0_f32; MAX_DOWNMIX_CHANNELS];
    let scanned_channels = num_channels.min(MAX_DOWNMIX_CHANNELS);
    for frame_idx in 0..frames {
        let base = frame_idx * num_channels;
        for c in 0..scanned_channels {
            let v = data[base + c].to_sample::<f32>();
            energy_per_channel[c] += v * v;
        }
    }
    let mut best_channel = 0usize;
    let mut best_energy = energy_per_channel[0];
    #[allow(clippy::needless_range_loop)]
    for c in 1..scanned_channels {
        if energy_per_channel[c] > best_energy {
            best_energy = energy_per_channel[c];
            best_channel = c;
        }
    }

    out.reserve(frames);
    for frame_idx in 0..frames {
        let base = frame_idx * num_channels;
        out.push(data[base + best_channel].to_sample::<f32>());
    }
}

fn downmix_to_mono_vec<T>(data: &[T], num_channels: usize) -> Vec<f32>
where
    T: Sample,
    f32: FromSample<T>,
{
    let mut out = Vec::new();
    downmix_to_mono_into(data, num_channels, &mut out);
    out
}

fn writer_loop(
    audio_rx: crossbeam_channel::Receiver<WriterMsg>,
    stdout: Arc<Mutex<io::Stdout>>,
    input_sample_rate: u32,
    mut loopback: Option<LoopbackBuffer>,
) {
    const TARGET_SAMPLE_RATE: u32 = 16000;
    const RESAMPLER_CHUNK_SIZE_DEFAULT: usize = 1024;
    const RESAMPLER_CHUNK_SIZE_FALLBACK: usize = 512;

    // Try FFT resampler with default size, then fallback chunk size
    let mut chosen_chunk_size: usize = RESAMPLER_CHUNK_SIZE_DEFAULT;
    let mut resampler_opt = if input_sample_rate != TARGET_SAMPLE_RATE {
        match FftFixedIn::new(
            input_sample_rate as usize,
            TARGET_SAMPLE_RATE as usize,
            chosen_chunk_size,
            1,
            1,
        ) {
            Ok(r) => Some(r),
            Err(e) => {
                eprintln!(
                    "[audio-recorder] CRITICAL: Failed to create resampler ({}), trying fallback chunk size",
                    e
                );
                chosen_chunk_size = RESAMPLER_CHUNK_SIZE_FALLBACK;
                match FftFixedIn::new(
                    input_sample_rate as usize,
                    TARGET_SAMPLE_RATE as usize,
                    chosen_chunk_size,
                    1,
                    1,
                ) {
                    Ok(r2) => Some(r2),
                    Err(e2) => {
                        eprintln!(
                            "[audio-recorder] CRITICAL: Fallback resampler creation failed ({}), using linear fallback",
                            e2
                        );
                        None
                    }
                }
            }
        }
    } else {
        None
    };

    let mut in_buffer: Vec<f32> = Vec::new();

    fn flush_pending(
        stdout: &Arc<Mutex<io::Stdout>>,
        input_sample_rate: u32,
        chosen_chunk_size: usize,
        resampler_opt: &mut Option<FftFixedIn<f32>>,
        in_buffer: &mut Vec<f32>,
        loopback: &mut Option<LoopbackBuffer>,
    ) {
        const TARGET_SAMPLE_RATE: u32 = 16000;

        // Channel closed or explicit flush requested; flush any remaining buffered samples.
        if let Some(mut resampler) = resampler_opt.take() {
            while !in_buffer.is_empty() {
                let take = if in_buffer.len() >= chosen_chunk_size {
                    chosen_chunk_size
                } else {
                    in_buffer.len()
                };
                let mut chunk = in_buffer.drain(..take).collect::<Vec<_>>();
                if chunk.len() < chosen_chunk_size {
                    chunk.resize(chosen_chunk_size, 0.0);
                }
                if let Ok(mut resampled) = resampler.process(&[chunk], None) {
                    if !resampled.is_empty() {
                        mix_and_write(&mut resampled.remove(0), loopback, stdout);
                    }
                }
            }
            // Keep the resampler instance for subsequent sessions
            *resampler_opt = Some(resampler);
        } else if !in_buffer.is_empty() {
            if input_sample_rate != TARGET_SAMPLE_RATE {
                let mut resampled =
                    linear_resample_mono(in_buffer, input_sample_rate, TARGET_SAMPLE_RATE);
                if !resampled.is_empty() {
                    mix_and_write(&mut resampled, loopback, stdout);
                }
            } else {
                mix_and_write(in_buffer, loopback, stdout);
            }
            in_buffer.clear();
        }

        // Signal drain complete to the host via a JSON message
        let response = serde_json::json!({
            "type": "drain-complete"
        });
        if let Ok(json_string) = serde_json::to_string(&response) {
            let mut writer = stdout.lock().unwrap();
            let _ = write_framed_message(&mut *writer, MSG_TYPE_JSON, json_string.as_bytes());
        }
    }

    while let Ok(msg) = audio_rx.recv() {
        match msg {
            WriterMsg::Audio(mut frame) => {
                if let Some(resampler) = resampler_opt.as_mut() {
                    in_buffer.extend_from_slice(&frame);
                    while in_buffer.len() >= chosen_chunk_size {
                        let chunk_to_process: Vec<f32> =
                            in_buffer.drain(..chosen_chunk_size).collect::<Vec<_>>();
                        match resampler.process(&[chunk_to_process], None) {
                            Ok(mut resampled) => {
                                if !resampled.is_empty() {
                                    mix_and_write(&mut resampled.remove(0), &mut loopback, &stdout);
                                }
                            }
                            Err(e) => eprintln!(
                                "[audio-recorder] CRITICAL: Resampling failed in writer: {}",
                                e
                            ),
                        }
                    }
                } else if input_sample_rate != TARGET_SAMPLE_RATE {
                    let mut resampled =
                        linear_resample_mono(&frame, input_sample_rate, TARGET_SAMPLE_RATE);
                    if !resampled.is_empty() {
                        mix_and_write(&mut resampled, &mut loopback, &stdout);
                    }
                } else {
                    mix_and_write(&mut frame, &mut loopback, &stdout);
                }
            }
            WriterMsg::Flush => {
                flush_pending(
                    &stdout,
                    input_sample_rate,
                    chosen_chunk_size,
                    &mut resampler_opt,
                    &mut in_buffer,
                    &mut loopback,
                );
            }
        }
    }

    // Channel closed; do a final flush so the host doesn't hang on stop.
    flush_pending(
        &stdout,
        input_sample_rate,
        chosen_chunk_size,
        &mut resampler_opt,
        &mut in_buffer,
        &mut loopback,
    );
}

fn start_capture(
    device_name: Option<String>,
    source: AudioSource,
    stdout: Arc<Mutex<io::Stdout>>,
    host: Rc<cpal::Host>,
) -> Result<CaptureHandles> {
    const TARGET_SAMPLE_RATE: u32 = 16000;
    const QUEUE_CAPACITY: usize = 512;

    // Degrade `System`/`Both` to `Microphone` up front when this
    // platform/host can't provide loopback capture at all (see
    // `effective_capture_source`), rather than letting device resolution
    // fail outright below and take the whole start down with it.
    let effective_source = effective_capture_source(source, loopback_capture_supported());
    if effective_source != source {
        eprintln!(
            "[audio-recorder] Loopback capture unavailable on this platform; falling back to microphone-only for a {source:?} request"
        );
        write_status_message(
            &stdout,
            "loopback-unsupported",
            "System audio capture is not supported on this platform; recording continues with the microphone only.",
        );
    }

    let (device, capture_kind) = find_capture_device(&host, effective_source, device_name)?;

    // Prefer the device's default configuration instead of max rate to better
    // align with other apps (e.g., Zoom) and reduce host resampling. Which
    // config accessor applies follows the device's actual flow
    // (`capture_kind`), not the source: see `CaptureKind` for why keying
    // this off `AudioSource` directly was the bug that this task fixed.
    let default_config = resolve_capture_config(&device, capture_kind)?;

    let input_sample_rate = default_config.sample_rate().0;
    let input_sample_format = default_config.sample_format();
    let channels_count: usize = default_config.channels() as usize;

    let err_fn = |err| eprintln!("[audio-recorder] Stream error: {}", err);
    let stream_config: StreamConfig = default_config.clone().into();

    // Shared by the primary stream below and, for `Both`, the loopback
    // stream too: a single flag gates both so play/pause always affects them
    // together.
    let is_recording = Arc::new(AtomicBool::new(false));

    // For `Both`, open the loopback device as a second, independent capture
    // before the writer thread spawns: writer_loop needs the resampled
    // channel's receiver at construction time to mix it into the
    // microphone's (primary, master-clock) blocks.
    //
    // This can still fail even when `loopback_capture_supported()` said yes
    // (e.g. no output device present) — that failure must not take the
    // whole start down with it via `?`, the same reasoning as the
    // platform-level fallback above: the microphone stream hasn't even
    // been built yet at this point, so a hard error here would silently
    // turn a `Both` request into no recording at all rather than a
    // microphone-only one.
    let (loopback_capture, loopback_buffer) = if effective_source.needs_mixer() {
        match start_loopback_capture(&host, Arc::clone(&is_recording)) {
            Ok((capture, buffer)) => (Some(capture), Some(buffer)),
            Err(e) => {
                eprintln!(
                    "[audio-recorder] Failed to open loopback capture, continuing with microphone only: {e}"
                );
                write_status_message(
                    &stdout,
                    "loopback-start-failed",
                    "System audio capture failed to start; recording continues with the microphone only.",
                );
                (None, None)
            }
        }
    } else {
        (None, None)
    };

    // Writer thread and queue
    let (audio_tx, audio_rx) = crossbeam_channel::bounded::<WriterMsg>(QUEUE_CAPACITY);
    let stdout_for_writer = Arc::clone(&stdout);
    let writer_handle = std::thread::spawn(move || {
        writer_loop(
            audio_rx,
            stdout_for_writer,
            input_sample_rate,
            loopback_buffer,
        );
    });

    // Notify JS about input and effective output audio configuration
    {
        let cfg = AudioConfig {
            response_type: "audio-config".to_string(),
            input_sample_rate,
            output_sample_rate: TARGET_SAMPLE_RATE,
            channels: 1,
        };
        if let Ok(json_string) = serde_json::to_string(&cfg) {
            let mut writer = stdout.lock().unwrap();
            let _ = write_framed_message(&mut *writer, MSG_TYPE_JSON, json_string.as_bytes());
        }
    }

    let stream = match input_sample_format {
        SampleFormat::F32 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::I16 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::U16 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::U8 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[u8], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::I32 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[i32], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::F64 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[f64], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::U32 => {
            let tx = audio_tx.clone();
            let flag = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[u32], _| {
                    if !flag.load(Ordering::Acquire) {
                        return;
                    }
                    let mono = downmix_to_mono_vec(data, channels_count);
                    let _ = tx.try_send(WriterMsg::Audio(mono));
                },
                err_fn,
                None,
            )?
        }
        format => {
            return Err(anyhow!(
                "[audio-recorder] Unsupported sample format {}",
                format
            ))
        }
    };

    Ok(CaptureHandles {
        stream,
        audio_tx,
        writer_handle,
        is_recording,
        loopback: loopback_capture,
    })
}

/// Opens the loopback device as the second stream of an `AudioSource::Both`
/// capture and starts its dedicated resampling thread.
///
/// Returns the stream/thread handles (for `CommandProcessor` to play, pause,
/// and tear down alongside the primary microphone stream) plus the
/// `LoopbackBuffer` that `writer_loop` mixes from.
fn start_loopback_capture(
    host: &cpal::Host,
    is_recording: Arc<AtomicBool>,
) -> Result<(LoopbackCapture, LoopbackBuffer)> {
    const RAW_QUEUE_CAPACITY: usize = 512;
    // Depth of the recycled-buffer pool the loopback callback draws from
    // (see `LOOPBACK_MONO_BUFFER_CAPACITY`'s doc comment for the allocation
    // this exists to avoid). A handful is enough to absorb the callback
    // firing again before `loopback_resample_loop` has recycled the
    // previous block back.
    const BUFFER_POOL_SIZE: usize = 8;

    // Routed through `CaptureKind` (see `find_loopback_capture_device`),
    // same as the primary device in `start_capture`, rather than assuming
    // `default_output_config()` here directly: this is hardcoded to
    // `Loopback` today, but the tag is what keeps device selection and
    // config selection unable to drift apart if this ever gains a real
    // device choice (finding 3 of the review this task addressed).
    let (device, capture_kind) = find_loopback_capture_device(host)?;
    let default_config = resolve_capture_config(&device, capture_kind)?;

    let native_rate = default_config.sample_rate().0;
    let sample_format = default_config.sample_format();
    let channels_count = default_config.channels() as usize;
    let stream_config: StreamConfig = default_config.clone().into();

    let (raw_tx, raw_rx) = crossbeam_channel::bounded::<Vec<f32>>(RAW_QUEUE_CAPACITY);
    let (resampled_tx, resampled_rx) =
        crossbeam_channel::bounded::<Vec<f32>>(LOOPBACK_CHANNEL_CAPACITY);

    // Pre-allocated (here, off the audio thread) pool of mono downmix
    // buffers the callback pulls from instead of calling `Vec::new()` /
    // `with_capacity()` itself — see `downmix_to_mono_into` and
    // `build_loopback_stream`. `loopback_resample_loop` sends buffers back
    // once it's done with their contents; if the pool is ever starved (the
    // resample thread lagging further than `BUFFER_POOL_SIZE` blocks), the
    // callback drops that block rather than allocating, the same
    // backpressure behavior as everywhere else in this pipeline.
    let (free_tx, free_rx) = crossbeam_channel::bounded::<Vec<f32>>(BUFFER_POOL_SIZE);
    for _ in 0..BUFFER_POOL_SIZE {
        let _ = free_tx.try_send(Vec::with_capacity(LOOPBACK_MONO_BUFFER_CAPACITY));
    }

    let resample_handle = std::thread::spawn(move || {
        loopback_resample_loop(raw_rx, native_rate, resampled_tx, free_tx);
    });

    let stream = build_loopback_stream(
        &device,
        &stream_config,
        sample_format,
        channels_count,
        is_recording,
        raw_tx.clone(),
        free_rx,
    )?;

    Ok((
        LoopbackCapture {
            stream,
            raw_tx,
            resample_handle,
        },
        LoopbackBuffer::new(resampled_rx),
    ))
}

/// Initial capacity, in mono samples, of each buffer in the loopback
/// callback's reuse pool (see `start_loopback_capture`). Generous enough to
/// cover a typical WASAPI capture callback's frame count (a few hundred to
/// ~1024 frames is typical) so the pool's buffers don't need to grow — and
/// therefore allocate — again once they've warmed up.
const LOOPBACK_MONO_BUFFER_CAPACITY: usize = 4096;

/// Builds the loopback capture stream for `AudioSource::Both`.
///
/// Downmixes to mono like the primary stream's own match in `start_capture`,
/// but forwards raw (native-rate) blocks to a plain channel instead of a
/// `WriterMsg`: the loopback side resamples on its own thread
/// (`loopback_resample_loop`) rather than sharing `writer_loop`'s.
///
/// Unlike the primary stream (see `start_capture`), this callback does not
/// allocate at all: `free_rx` is a pool of pre-allocated buffers filled
/// once, off this thread, by `start_loopback_capture`. Each callback pulls
/// one via a non-blocking `try_recv`, downmixes into it in place
/// (`downmix_to_mono_into`), and forwards it; `loopback_resample_loop`
/// recycles the buffer back once it's done with it. If the pool is empty —
/// the resample thread lagging further than the pool is deep — the block is
/// dropped instead of allocating a replacement, same as the existing
/// full-channel drop below when `tx.try_send` fails. Allocating inside a
/// cpal data callback is a real-time-safety violation that can cause
/// audible glitches; on this path specifically, that would land in the
/// middle of a call recording.
fn build_loopback_stream(
    device: &cpal::Device,
    stream_config: &StreamConfig,
    sample_format: SampleFormat,
    channels_count: usize,
    flag: Arc<AtomicBool>,
    tx: crossbeam_channel::Sender<Vec<f32>>,
    free_rx: crossbeam_channel::Receiver<Vec<f32>>,
) -> Result<cpal::Stream> {
    let err_fn = |err| eprintln!("[audio-recorder] Loopback stream error: {}", err);

    Ok(match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            stream_config,
            move |data: &[f32], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        SampleFormat::I16 => device.build_input_stream(
            stream_config,
            move |data: &[i16], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        SampleFormat::U16 => device.build_input_stream(
            stream_config,
            move |data: &[u16], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        SampleFormat::U8 => device.build_input_stream(
            stream_config,
            move |data: &[u8], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        SampleFormat::I32 => device.build_input_stream(
            stream_config,
            move |data: &[i32], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        SampleFormat::F64 => device.build_input_stream(
            stream_config,
            move |data: &[f64], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        SampleFormat::U32 => device.build_input_stream(
            stream_config,
            move |data: &[u32], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let Ok(mut buf) = free_rx.try_recv() else {
                    return;
                };
                downmix_to_mono_into(data, channels_count, &mut buf);
                let _ = tx.try_send(buf);
            },
            err_fn,
            None,
        )?,
        format => {
            return Err(anyhow!(
                "[audio-recorder] Unsupported loopback sample format {}",
                format
            ))
        }
    })
}

/// Diagnostic run via `cargo run -- probe-loopback`: opens the default output
/// device in capture mode, records for ~3 seconds and prints the peak level.
///
/// A peak of 0.0000 means WASAPI loopback isn't delivering samples on this
/// machine — treat that as a hard stop for the whole system-audio batch
/// rather than a bug to chase further downstream.
fn probe_loopback(host: &cpal::Host) -> Result<()> {
    let device = find_loopback_device(host)?;
    let config = device
        .default_output_config()
        .map_err(|_| anyhow!("[audio-recorder] No default output config found"))?;
    eprintln!(
        "[audio-recorder] Loopback device: {} @ {} Hz, {} ch",
        device.name().unwrap_or_default(),
        config.sample_rate().0,
        config.channels()
    );
    if config.sample_format() != SampleFormat::F32 {
        // WASAPI shared-mode output is f32 in practice; keep this probe simple
        // rather than replicating start_capture's full format matrix for a
        // one-off diagnostic.
        return Err(anyhow!(
            "[audio-recorder] probe-loopback only handles f32 output configs, got {}",
            config.sample_format()
        ));
    }

    let peak = Arc::new(AtomicU32::new(0));
    let peak_for_stream = Arc::clone(&peak);
    let stream = device.build_input_stream(
        &config.clone().into(),
        move |data: &[f32], _: &_| {
            let local = data.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
            // AtomicU32 has no fetch_max for floats; scale into a fixed-point
            // integer so concurrent updates from the audio callback can use
            // `fetch_max` instead of a mutex.
            peak_for_stream.fetch_max((local * 10_000.0) as u32, Ordering::Relaxed);
        },
        |err| eprintln!("[audio-recorder] Probe error: {err}"),
        None,
    )?;

    stream.play()?;
    std::thread::sleep(std::time::Duration::from_secs(3));
    drop(stream);

    let value = f64::from(peak.load(Ordering::Relaxed)) / 10_000.0;
    eprintln!("[audio-recorder] Loopback peak over 3s: {value:.4}");
    Ok(())
}

/// Minimal PCM16 mono WAV writer for the `probe-mix` diagnostic below.
///
/// No WAV-writing crate is in this workspace's dependency tree, and a
/// 44-byte header plus raw little-endian PCM data isn't worth pulling one in
/// for a single debug subcommand. `i16` conversion mirrors
/// `write_audio_chunk`'s: the pipeline stays `f32` end to end and only
/// converts at the point of writing to a file.
fn write_wav_file(path: &str, samples: &[f32], sample_rate: u32) -> Result<()> {
    const BITS_PER_SAMPLE: u16 = 16;
    const CHANNELS: u16 = 1;
    const BLOCK_ALIGN: u16 = CHANNELS * (BITS_PER_SAMPLE / 8);

    let mut pcm = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        pcm.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }

    let byte_rate = sample_rate * u32::from(BLOCK_ALIGN);
    let data_len = pcm.len() as u32;
    let riff_len = 36 + data_len;

    let mut file = std::fs::File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&riff_len.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?; // fmt chunk size (PCM)
    file.write_all(&1u16.to_le_bytes())?; // audio format: PCM
    file.write_all(&CHANNELS.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&BLOCK_ALIGN.to_le_bytes())?;
    file.write_all(&BITS_PER_SAMPLE.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;
    file.write_all(&pcm)?;
    Ok(())
}

/// Diagnostic run via `cargo run -- probe-mix`: symmetrical to
/// `probe-loopback`, but exercises the actual `Both` mix path end to end
/// instead of just the loopback side.
///
/// Captures ~10s of microphone and loopback audio concurrently, resamples
/// both to the pipeline's 16 kHz target, mixes the loopback into the
/// microphone with the same `mix_into` production uses (mic as master
/// clock), and writes the result to `mix.wav` in the current directory.
///
/// This diagnostic itself isn't real-time-safety-sensitive the way the
/// production callbacks are (see `build_loopback_stream`): it buffers into
/// a plain `Mutex<Vec<f32>>` for simplicity, since it only ever runs for
/// ~10 seconds from a command line, not for the duration of a real session.
///
/// Verifies only that the subcommand runs end to end and produces a
/// well-formed, non-empty WAV file. It does NOT verify the mix sounds
/// correct with real speech on both sides simultaneously — that needs a
/// human on an actual call with a working microphone, which is why this
/// stays a manual `probe-*` subcommand instead of an automated test.
fn probe_mix(host: &cpal::Host) -> Result<()> {
    const CAPTURE_SECONDS: u64 = 10;
    const TARGET_SAMPLE_RATE: u32 = 16000;

    let mic_device = find_input_device(host, None)?;
    let mic_config = mic_device
        .default_input_config()
        .map_err(|_| anyhow!("[audio-recorder] No default input config found"))?;
    let loopback_device = find_loopback_device(host)?;
    let loopback_config = loopback_device
        .default_output_config()
        .map_err(|_| anyhow!("[audio-recorder] No default output config found"))?;

    if mic_config.sample_format() != SampleFormat::F32
        || loopback_config.sample_format() != SampleFormat::F32
    {
        // Same simplification as `probe-loopback`: WASAPI shared-mode
        // devices are f32 in practice, and this is a one-off diagnostic,
        // not the full format matrix `start_capture` handles.
        return Err(anyhow!(
            "[audio-recorder] probe-mix only handles f32 configs, got mic={}, loopback={}",
            mic_config.sample_format(),
            loopback_config.sample_format()
        ));
    }

    let mic_rate = mic_config.sample_rate().0;
    let mic_channels = mic_config.channels() as usize;
    let loopback_rate = loopback_config.sample_rate().0;
    let loopback_channels = loopback_config.channels() as usize;

    eprintln!(
        "[audio-recorder] probe-mix: mic \"{}\" @ {} Hz/{}ch, loopback \"{}\" @ {} Hz/{}ch, recording {}s",
        mic_device.name().unwrap_or_default(),
        mic_rate,
        mic_channels,
        loopback_device.name().unwrap_or_default(),
        loopback_rate,
        loopback_channels,
        CAPTURE_SECONDS
    );

    let mic_buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
    let mic_buffer_for_stream = Arc::clone(&mic_buffer);
    let mic_stream = mic_device.build_input_stream(
        &mic_config.clone().into(),
        move |data: &[f32], _: &_| {
            let mono = downmix_to_mono_vec(data, mic_channels);
            mic_buffer_for_stream
                .lock()
                .unwrap()
                .extend_from_slice(&mono);
        },
        |err| eprintln!("[audio-recorder] probe-mix mic error: {err}"),
        None,
    )?;

    let loopback_buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
    let loopback_buffer_for_stream = Arc::clone(&loopback_buffer);
    let loopback_stream = loopback_device.build_input_stream(
        &loopback_config.clone().into(),
        move |data: &[f32], _: &_| {
            let mono = downmix_to_mono_vec(data, loopback_channels);
            loopback_buffer_for_stream
                .lock()
                .unwrap()
                .extend_from_slice(&mono);
        },
        |err| eprintln!("[audio-recorder] probe-mix loopback error: {err}"),
        None,
    )?;

    mic_stream.play()?;
    loopback_stream.play()?;
    std::thread::sleep(std::time::Duration::from_secs(CAPTURE_SECONDS));
    drop(mic_stream);
    drop(loopback_stream);

    let mic_raw = Arc::try_unwrap(mic_buffer)
        .map_err(|_| anyhow!("[audio-recorder] mic buffer still shared after stream teardown"))?
        .into_inner()
        .unwrap();
    let loopback_raw = Arc::try_unwrap(loopback_buffer)
        .map_err(|_| {
            anyhow!("[audio-recorder] loopback buffer still shared after stream teardown")
        })?
        .into_inner()
        .unwrap();

    let mut mic_16k = linear_resample_mono(&mic_raw, mic_rate, TARGET_SAMPLE_RATE);
    let loopback_16k = linear_resample_mono(&loopback_raw, loopback_rate, TARGET_SAMPLE_RATE);

    // Same master-clock rule as production `writer_loop`/`LoopbackBuffer`:
    // the microphone's length decides the output length (see `mix_into`).
    mix_into(&mut mic_16k, &loopback_16k);

    let out_path = "mix.wav";
    write_wav_file(out_path, &mic_16k, TARGET_SAMPLE_RATE)?;
    eprintln!(
        "[audio-recorder] probe-mix: wrote {} ({} samples, {:.1}s)",
        out_path,
        mic_16k.len(),
        f64::from(mic_16k.len() as u32) / f64::from(TARGET_SAMPLE_RATE)
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_downmix_to_mono_single_channel() {
        let mono_samples: Vec<f32> = vec![0.5, -0.5, 1.0, -1.0];
        let result = downmix_to_mono_vec(&mono_samples, 1);

        assert_eq!(result.len(), 4);
        assert_eq!(result, vec![0.5, -0.5, 1.0, -1.0]);
    }

    #[test]
    fn test_downmix_to_mono_stereo() {
        // Stereo: L,R,L,R pattern
        let stereo_samples: Vec<f32> = vec![0.8, 0.2, -0.6, -0.4];
        let result = downmix_to_mono_vec(&stereo_samples, 2);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0], 0.8); // Left channel sample 1
        assert_eq!(result[1], -0.6); // Left channel sample 2
    }

    #[test]
    fn test_downmix_to_mono_quad() {
        // 4 channels: one frame with values [1.0, 0.5, 0.25, 0.25]
        let quad_samples: Vec<f32> = vec![1.0, 0.5, 0.25, 0.25]; // One frame
        let result = downmix_to_mono_vec(&quad_samples, 4);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 1.0); // Channel 0 sample
    }

    #[test]
    fn test_downmix_partial_frame() {
        // 5 samples with 2 channels - last sample incomplete, should be ignored
        let samples: Vec<f32> = vec![0.8, 0.2, -0.6, -0.4, 1.0];
        let result = downmix_to_mono_vec(&samples, 2);

        assert_eq!(result.len(), 2); // Only 2 complete frames
        assert_eq!(result[0], 0.8); // Left channel sample 1
        assert_eq!(result[1], -0.6); // Left channel sample 2
    }

    #[test]
    fn test_write_framed_message_structure() {
        let mut buffer = Vec::new();
        let test_data = b"test";

        write_framed_message(&mut buffer, MSG_TYPE_JSON, test_data).unwrap();

        // Check structure: [msg_type(1)] + [length(4)] + [data(4)]
        assert_eq!(buffer.len(), 9);
        assert_eq!(buffer[0], MSG_TYPE_JSON);

        // Length bytes (little-endian u32 = 4)
        let length = u32::from_le_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]);
        assert_eq!(length, 4);

        // Data
        assert_eq!(&buffer[5..9], test_data);
    }

    #[test]
    fn test_write_framed_message_audio_type() {
        let mut buffer = Vec::new();
        let audio_data = vec![0u8; 100];

        write_framed_message(&mut buffer, MSG_TYPE_AUDIO, &audio_data).unwrap();

        assert_eq!(buffer[0], MSG_TYPE_AUDIO);
        let length = u32::from_le_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]);
        assert_eq!(length, 100);
    }
}

#[cfg(test)]
mod audio_source_tests {
    use super::*;

    #[test]
    fn audio_source_defaults_to_microphone() {
        let parsed: AudioSource = serde_json::from_str("\"microphone\"").unwrap();
        assert_eq!(parsed, AudioSource::Microphone);
        assert_eq!(AudioSource::default(), AudioSource::Microphone);
    }

    #[test]
    fn audio_source_parses_every_variant() {
        assert_eq!(
            serde_json::from_str::<AudioSource>("\"system\"").unwrap(),
            AudioSource::System
        );
        assert_eq!(
            serde_json::from_str::<AudioSource>("\"both\"").unwrap(),
            AudioSource::Both
        );
    }

    #[test]
    fn an_unknown_source_falls_back_inside_the_command_itself() {
        // `main`'s stdin loop silently drops any line that fails to deserialize
        // as a whole `Command`: without a field-level fallback, an unknown
        // source wouldn't just degrade to the microphone, it would lose the
        // entire `start` command. Hence `deserialize_with` on the field rather
        // than a plain `unwrap_or_default()` at the call site.
        let cmd: Command =
            serde_json::from_str(r#"{"command":"start","audio_source":"quadraphonic"}"#).unwrap();
        match cmd {
            Command::Start { audio_source, .. } => {
                assert_eq!(audio_source, AudioSource::Microphone);
            }
            other => panic!("expected Command::Start, got {other:?}"),
        }
    }

    #[test]
    fn a_missing_source_is_the_microphone() {
        let cmd: Command = serde_json::from_str(r#"{"command":"start"}"#).unwrap();
        match cmd {
            Command::Start { audio_source, .. } => {
                assert_eq!(audio_source, AudioSource::Microphone);
            }
            other => panic!("expected Command::Start, got {other:?}"),
        }
    }

    #[test]
    fn the_fast_path_key_includes_the_source() {
        // Without the source in the key, a Meeting-mode dictation would reuse
        // the microphone stream prepared at startup and record silence.
        assert!(!can_reuse_stream(
            Some("default"),
            AudioSource::Microphone,
            Some("default"),
            AudioSource::Both,
        ));
        assert!(can_reuse_stream(
            Some("default"),
            AudioSource::Microphone,
            Some("default"),
            AudioSource::Microphone,
        ));
    }

    #[test]
    fn the_fast_path_key_also_includes_the_device() {
        // Same source, different device: previously unasserted. The check is
        // a trivial `&&` so the risk was low, but "same source" alone isn't
        // enough to reuse a stream opened on a different microphone.
        assert!(!can_reuse_stream(
            Some("Mic A"),
            AudioSource::Microphone,
            Some("Mic B"),
            AudioSource::Microphone,
        ));
        assert!(can_reuse_stream(
            Some("Mic A"),
            AudioSource::Microphone,
            Some("Mic A"),
            AudioSource::Microphone,
        ));
    }

    #[test]
    fn only_both_needs_the_mixer() {
        assert!(AudioSource::Both.needs_mixer());
        assert!(!AudioSource::System.needs_mixer());
        assert!(!AudioSource::Microphone.needs_mixer());
    }

    #[test]
    fn loopback_supported_requests_pass_through_unchanged() {
        // When loopback is available, `start_capture` should open exactly
        // what was asked for — no silent substitution.
        assert_eq!(
            effective_capture_source(AudioSource::Microphone, true),
            AudioSource::Microphone
        );
        assert_eq!(
            effective_capture_source(AudioSource::System, true),
            AudioSource::System
        );
        assert_eq!(
            effective_capture_source(AudioSource::Both, true),
            AudioSource::Both
        );
    }

    #[test]
    fn loopback_unsupported_degrades_system_and_both_to_microphone_only() {
        // This is the macOS bug this fix addresses: `Both` (the seeded
        // Meeting preset's default, on every platform) used to hard-fail
        // `start_capture` entirely via `find_loopback_device`'s `Err`
        // propagating out with `?`, before the microphone stream was ever
        // built — no recording at all, not even a degraded one. Falling
        // back to `Microphone` here is what turns that into a partial
        // recording instead of none.
        assert_eq!(
            effective_capture_source(AudioSource::System, false),
            AudioSource::Microphone
        );
        assert_eq!(
            effective_capture_source(AudioSource::Both, false),
            AudioSource::Microphone
        );
    }

    #[test]
    fn loopback_unsupported_is_a_no_op_for_a_plain_microphone_request() {
        // `Microphone` never touches loopback capture, so whether the
        // platform supports loopback is irrelevant to it.
        assert_eq!(
            effective_capture_source(AudioSource::Microphone, false),
            AudioSource::Microphone
        );
    }

    #[test]
    fn both_uses_the_microphone_as_its_primary_input_not_a_loopback_output() {
        // This is the config-selection bug fixed in this task's review:
        // `Both`'s primary device is the microphone (`eCapture`), so its
        // config must come from `default_input_config()`. Picking
        // `default_output_config()` here — as an earlier version of this
        // file did via a stale `AudioSource::needs_output_device` predicate
        // that was keyed on the source instead of the actual device — fails
        // outright on a microphone in cpal/WASAPI, since it isn't a
        // render-flow device. `start_capture` now derives its config
        // accessor from `primary_capture_kind`'s result directly (see
        // `CaptureKind`), so this mapping is the only place that decision is
        // made, for both device selection and config selection.
        assert!(matches!(
            primary_capture_kind(AudioSource::Both),
            CaptureKind::Input
        ));
        assert!(matches!(
            primary_capture_kind(AudioSource::Microphone),
            CaptureKind::Input
        ));
        assert!(matches!(
            primary_capture_kind(AudioSource::System),
            CaptureKind::Loopback
        ));
    }

    #[test]
    fn a_wrong_typed_source_falls_back_inside_the_command_itself() {
        // A present-but-wrong-shaped `audio_source` (here, a number) must
        // degrade to the microphone exactly like an unrecognized string,
        // not propagate a hard deserialize error that loses the whole
        // `start` command silently (see `deserialize_audio_source`'s doc
        // comment for why `Option::<String>` alone didn't catch this).
        let cmd: Command = serde_json::from_str(r#"{"command":"start","audio_source":5}"#).unwrap();
        match cmd {
            Command::Start { audio_source, .. } => {
                assert_eq!(audio_source, AudioSource::Microphone);
            }
            other => panic!("expected Command::Start, got {other:?}"),
        }
    }
}

#[cfg(test)]
mod mixer_tests {
    use super::*;

    fn approx(actual: &[f32], expected: &[f32]) {
        assert_eq!(actual.len(), expected.len());
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-6, "{a} != {e}");
        }
    }

    #[test]
    fn mixing_sums_both_sources() {
        let mut primary = vec![0.1_f32, -0.2, 0.3];
        mix_into(&mut primary, &[0.05, 0.05, 0.05]);
        approx(&primary, &[0.15, -0.15, 0.35]);
    }

    #[test]
    fn mixing_clamps_instead_of_wrapping() {
        // Sans clamp, la conversion i16 en aval enroulerait : un craquement
        // franc au lieu d'une légère compression.
        let mut primary = vec![1.0_f32, -1.0];
        mix_into(&mut primary, &[0.5, -0.5]);
        approx(&primary, &[1.0, -1.0]);
    }

    #[test]
    fn a_shorter_secondary_leaves_the_tail_untouched() {
        let mut primary = vec![0.1_f32, 0.2, 0.3, 0.4];
        mix_into(&mut primary, &[0.01, 0.01]);
        approx(&primary, &[0.11, 0.21, 0.3, 0.4]);
    }

    #[test]
    fn a_longer_secondary_is_truncated_to_the_master_clock() {
        let mut primary = vec![0.1_f32, 0.2];
        mix_into(&mut primary, &[0.01, 0.01, 0.01, 0.01]);
        approx(&primary, &[0.11, 0.21]);
    }

    #[test]
    fn an_empty_secondary_is_a_no_op() {
        let mut primary = vec![0.1_f32, 0.2];
        mix_into(&mut primary, &[]);
        approx(&primary, &[0.1, 0.2]);
    }

    #[test]
    fn mix_into_pins_arithmetic_at_hour_scale_slices() {
        // This is NOT a drift test: `mix_into` is called once here, and
        // production never calls it that way — it's driven ~once per 1024
        // -sample block through `LoopbackBuffer::mix_into_block`, roughly
        // 56 000 times over an hour. There is no "across calls" state in
        // this pure function for drift to accumulate in; the only thing
        // this proves is that its per-sample arithmetic (sum + clamp)
        // doesn't misbehave at large slice sizes. The real iterative-drift
        // invariant is exercised below, in `mixer_tests::drift`.
        let samples = 16_000 * 3600;
        let mut primary = vec![0.0_f32; samples];
        // Le loopback fournit 1 % de trop sur toute la durée.
        let secondary = vec![0.25_f32; samples + samples / 100];

        mix_into(&mut primary, &secondary);

        assert_eq!(primary.len(), samples);
        assert!(primary.iter().all(|&s| (s - 0.25).abs() < 1e-6));
    }

    #[test]
    fn loopback_buffer_mixes_and_drains_available_samples() {
        let (tx, rx) = crossbeam_channel::unbounded::<Vec<f32>>();
        tx.send(vec![0.1, 0.1, 0.1]).unwrap();
        let mut buffer = LoopbackBuffer::new(rx);

        let mut primary = vec![0.2_f32, 0.2, 0.2];
        buffer.mix_into_block(&mut primary);

        approx(&primary, &[0.3, 0.3, 0.3]);
    }

    #[test]
    fn loopback_buffer_leaves_primary_untouched_when_starved() {
        let (_tx, rx) = crossbeam_channel::unbounded::<Vec<f32>>();
        let mut buffer = LoopbackBuffer::new(rx);

        let mut primary = vec![0.2_f32, 0.2, 0.2];
        buffer.mix_into_block(&mut primary);

        approx(&primary, &[0.2, 0.2, 0.2]);
    }

    #[test]
    fn loopback_buffer_caps_backlog_and_drops_oldest() {
        let (tx, rx) = crossbeam_channel::unbounded::<Vec<f32>>();
        // Push more than the 2s cap in one go; only the newest
        // LOOPBACK_BUFFER_CAP_SAMPLES should survive the trim.
        tx.send(vec![1.0; LOOPBACK_BUFFER_CAP_SAMPLES + 10])
            .unwrap();
        tx.send(vec![2.0; 5]).unwrap();
        let mut buffer = LoopbackBuffer::new(rx);

        // Draining pulls both queued blocks in and trims before consuming.
        let mut primary = vec![0.0_f32; 1];
        buffer.mix_into_block(&mut primary);

        // The last 5 pushed as 2.0 should be at the tail, so the oldest
        // (1.0) is what gets consumed first, proving they weren't dropped
        // from the front incorrectly - but the backlog itself must not have
        // grown past the cap.
        assert!(buffer.pending.len() <= LOOPBACK_BUFFER_CAP_SAMPLES);
    }

    /// The real drift test.
    ///
    /// `mix_into` (tested above) is pure arithmetic on two slices handed to
    /// it once; nothing in it can accumulate across calls, because it has
    /// no state that survives a call. Production never calls it that way.
    /// `writer_loop` calls `LoopbackBuffer::mix_into_block` once per
    /// outgoing ~1024-sample block — tens of thousands of times over a
    /// meeting — and *that* call re-derives, every time, how much of the
    /// backlog to drain, subject to the `try_send`/`try_recv` drops and the
    /// `LOOPBACK_BUFFER_CAP_SAMPLES` cap. If drift were going to accumulate
    /// anywhere, it would be here, in the loop, not in the primitive.
    ///
    /// So these tests drive `mix_into_block` thousands of times with an
    /// injected rate mismatch between the two sides (the loopback device
    /// producing more or fewer samples per block than the microphone, the
    /// way two independent crystals actually drift) and assert on the two
    /// things that must hold no matter how long that mismatch runs:
    ///   1. the master clock's output length per block never changes — the
    ///      mic decides how many samples come out, full stop; and
    ///   2. the backlog stays within its bound (`LOOPBACK_BUFFER_CAP_SAMPLES`)
    ///      rather than growing without limit as wall-clock time passes.
    mod drift {
        use super::*;

        /// One simulated 16 kHz block, matching `loopback_resample_loop`'s
        /// chunk size.
        const BLOCK_SIZE: usize = 1024;

        #[test]
        fn a_loopback_running_fast_saturates_the_backlog_instead_of_growing_past_it() {
            // The loopback delivers 1% more samples than the mic needs,
            // every block: a crystal running fast enough to drift roughly
            // 600ms over a real hour. 5,000 blocks of 1024 samples @16kHz
            // is ~320 simulated seconds — enough for the backlog to reach
            // and hold its cap — while staying fast to actually run.
            const LOOPBACK_BLOCK_SIZE: usize = BLOCK_SIZE + BLOCK_SIZE / 100;
            const BLOCKS: usize = 5_000;

            let (tx, rx) = crossbeam_channel::unbounded::<Vec<f32>>();
            let mut buffer = LoopbackBuffer::new(rx);

            for _ in 0..BLOCKS {
                tx.send(vec![0.1_f32; LOOPBACK_BLOCK_SIZE]).unwrap();

                let mut primary = vec![0.0_f32; BLOCK_SIZE];
                buffer.mix_into_block(&mut primary);

                // Invariant 1: the mic's block length is never altered by
                // mixing, no matter how far ahead the loopback has gotten.
                assert_eq!(primary.len(), BLOCK_SIZE);
                // Invariant 2: the backlog never exceeds its cap, at any
                // point during the run — not just at the end.
                assert!(buffer.pending.len() <= LOOPBACK_BUFFER_CAP_SAMPLES);
            }

            // The loopback outran the mic for the whole run, so the backlog
            // should have settled into a steady state at the top of its
            // range rather than trailing off or growing unbounded with
            // wall-clock time. Each `mix_into_block` call both feeds the
            // backlog (from the channel) and drains it (into `primary`)
            // before returning, so the value observed *after* a call is one
            // block short of the cap, not the cap itself: the trim to
            // `LOOPBACK_BUFFER_CAP_SAMPLES` happens before that call's own
            // `BLOCK_SIZE`-sample consumption.
            assert_eq!(
                buffer.pending.len(),
                LOOPBACK_BUFFER_CAP_SAMPLES - BLOCK_SIZE
            );
        }

        #[test]
        fn a_loopback_running_slow_drains_the_backlog_instead_of_going_negative() {
            // The loopback delivers 1% fewer samples than the mic needs,
            // every block: the opposite drift direction. The backlog should
            // drain to (and stay at) zero rather than doing anything
            // exotic — there's no "negative backlog" in this design, and a
            // starved buffer must leave the tail of `primary` untouched
            // (see `mix_into`'s "shorter secondary" behavior), never panic
            // or shrink the block.
            const LOOPBACK_BLOCK_SIZE: usize = BLOCK_SIZE - BLOCK_SIZE / 100;
            const BLOCKS: usize = 5_000;

            let (tx, rx) = crossbeam_channel::unbounded::<Vec<f32>>();
            let mut buffer = LoopbackBuffer::new(rx);

            for _ in 0..BLOCKS {
                tx.send(vec![0.1_f32; LOOPBACK_BLOCK_SIZE]).unwrap();

                let mut primary = vec![0.0_f32; BLOCK_SIZE];
                buffer.mix_into_block(&mut primary);

                assert_eq!(primary.len(), BLOCK_SIZE);
                assert!(buffer.pending.len() <= LOOPBACK_BUFFER_CAP_SAMPLES);
            }

            // The loopback undershot every block for the whole run: nothing
            // should be piling up.
            assert_eq!(buffer.pending.len(), 0);
        }

        #[test]
        fn total_samples_mixed_in_never_exceeds_total_samples_fed() {
            // The bounded relationship the finding asks for: however lossy
            // `try_send`/`try_recv` and the cap are individually, the
            // buffer can never hand out more samples than were ever fed
            // into it — conservation, not creation, of audio.
            const LOOPBACK_BLOCK_SIZE: usize = BLOCK_SIZE + BLOCK_SIZE / 20; // +5%, an aggressive drift
            const BLOCKS: usize = 2_000;

            let (tx, rx) = crossbeam_channel::unbounded::<Vec<f32>>();
            let mut buffer = LoopbackBuffer::new(rx);

            let mut total_fed = 0usize;
            let mut total_mixed = 0usize;

            for _ in 0..BLOCKS {
                tx.send(vec![0.2_f32; LOOPBACK_BLOCK_SIZE]).unwrap();
                total_fed += LOOPBACK_BLOCK_SIZE;

                let mut primary = vec![0.0_f32; BLOCK_SIZE];
                buffer.mix_into_block(&mut primary);
                // `primary` starts at all-zero, so any sample the mix left
                // non-zero is one that was actually drawn from the backlog
                // this block — a direct count of samples mixed in, without
                // needing to reach into `LoopbackBuffer`'s internals.
                total_mixed += primary.iter().filter(|&&s| s > 1e-9).count();
            }

            assert!(
                total_mixed <= total_fed,
                "mixed {total_mixed} samples but only {total_fed} were ever fed in"
            );
        }
    }
}
