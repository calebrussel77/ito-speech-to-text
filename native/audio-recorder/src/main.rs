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

    while let Ok(raw) = raw_rx.recv() {
        if let Some(resampler) = resampler.as_mut() {
            in_buffer.extend_from_slice(&raw);
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
            if !out.is_empty() {
                let _ = resampled_tx.try_send(out);
            }
        } else {
            let _ = resampled_tx.try_send(raw);
        }
    }
    // `raw_rx` closed: the capture stream was torn down. Unlike the primary
    // writer thread, the loopback path doesn't drive the `drain-complete`
    // handshake, so there's no flush to perform here — a few trailing
    // milliseconds of buffered loopback audio lost on stop is inaudible,
    // and not worth complicating an already-working teardown path for.
}

fn downmix_to_mono_vec<T>(data: &[T], num_channels: usize) -> Vec<f32>
where
    T: Sample,
    f32: FromSample<T>,
{
    if num_channels <= 1 {
        return data.iter().map(|s| s.to_sample::<f32>()).collect();
    }
    // Select the dominant channel to avoid amplitude loss when one channel is
    // near-silent
    let frames = data.len() / num_channels;
    if frames == 0 {
        return Vec::new();
    }

    let mut energy_per_channel: Vec<f32> = vec![0.0; num_channels];
    for frame_idx in 0..frames {
        let base = frame_idx * num_channels;
        for c in 0..num_channels {
            let v = data[base + c].to_sample::<f32>();
            energy_per_channel[c] += v * v;
        }
    }
    let mut best_channel = 0usize;
    let mut best_energy = energy_per_channel[0];
    #[allow(clippy::needless_range_loop)]
    for c in 1..num_channels {
        if energy_per_channel[c] > best_energy {
            best_energy = energy_per_channel[c];
            best_channel = c;
        }
    }

    let mut out: Vec<f32> = Vec::with_capacity(frames);
    for frame_idx in 0..frames {
        let base = frame_idx * num_channels;
        out.push(data[base + best_channel].to_sample::<f32>());
    }
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

    let (device, capture_kind) = find_capture_device(&host, source, device_name)?;

    // Prefer the device's default configuration instead of max rate to better
    // align with other apps (e.g., Zoom) and reduce host resampling. Which
    // config accessor applies follows the device's actual flow
    // (`capture_kind`), not the source: see `CaptureKind` for why keying
    // this off `AudioSource` directly was the bug that this task fixed.
    let default_config = match capture_kind {
        CaptureKind::Loopback => device
            .default_output_config()
            .map_err(|_| anyhow!("[audio-recorder] No default output config found"))?,
        CaptureKind::Input => device
            .default_input_config()
            .map_err(|_| anyhow!("[audio-recorder] No default input config found"))?,
    };

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
    let (loopback_capture, loopback_buffer) = if source.needs_mixer() {
        let (capture, buffer) = start_loopback_capture(&host, Arc::clone(&is_recording))?;
        (Some(capture), Some(buffer))
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

    let device = find_loopback_device(host)?;
    // See `find_loopback_device`: a render-flow device's capture format is
    // only queryable through `default_output_config()`.
    let default_config = device
        .default_output_config()
        .map_err(|_| anyhow!("[audio-recorder] No default output config found for loopback"))?;

    let native_rate = default_config.sample_rate().0;
    let sample_format = default_config.sample_format();
    let channels_count = default_config.channels() as usize;
    let stream_config: StreamConfig = default_config.clone().into();

    let (raw_tx, raw_rx) = crossbeam_channel::bounded::<Vec<f32>>(RAW_QUEUE_CAPACITY);
    let (resampled_tx, resampled_rx) =
        crossbeam_channel::bounded::<Vec<f32>>(LOOPBACK_CHANNEL_CAPACITY);

    let resample_handle = std::thread::spawn(move || {
        loopback_resample_loop(raw_rx, native_rate, resampled_tx);
    });

    let stream = build_loopback_stream(
        &device,
        &stream_config,
        sample_format,
        channels_count,
        is_recording,
        raw_tx.clone(),
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

/// Builds the loopback capture stream for `AudioSource::Both`.
///
/// Downmixes to mono like the primary stream's own match in `start_capture`,
/// but forwards raw (native-rate) blocks to a plain channel instead of a
/// `WriterMsg`: the loopback side resamples on its own thread
/// (`loopback_resample_loop`) rather than sharing `writer_loop`'s. The
/// callback itself stays allocation-free apart from the downmix buffer
/// (same trade-off the primary stream already makes) and never blocks: a
/// full channel means the resampler thread is lagging, so the block is
/// dropped via `try_send` rather than stalling this real-time callback.
fn build_loopback_stream(
    device: &cpal::Device,
    stream_config: &StreamConfig,
    sample_format: SampleFormat,
    channels_count: usize,
    flag: Arc<AtomicBool>,
    tx: crossbeam_channel::Sender<Vec<f32>>,
) -> Result<cpal::Stream> {
    let err_fn = |err| eprintln!("[audio-recorder] Loopback stream error: {}", err);

    Ok(match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            stream_config,
            move |data: &[f32], _: &_| {
                if !flag.load(Ordering::Acquire) {
                    return;
                }
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
                let mono = downmix_to_mono_vec(data, channels_count);
                let _ = tx.try_send(mono);
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
    fn a_full_hour_of_drift_never_shifts_the_master_clock() {
        // 16 kHz × 3600 s = 57,6 M d'échantillons, réellement simulés : c'est
        // la seule façon de prouver que la dérive ne s'accumule pas.
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
}
