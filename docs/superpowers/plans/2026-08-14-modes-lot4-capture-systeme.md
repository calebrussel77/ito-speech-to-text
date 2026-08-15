# Lot 4 — Capture de l'audio système

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un mode d'enregistrer ce qui sort des haut-parleurs — une réunion Google Meet ou Microsoft Teams — seul ou mélangé au micro, pour que Caleb apparaisse dans son propre compte-rendu.

**Architecture:** cpal 0.16 active le loopback WASAPI de façon transparente quand on ouvre un périphérique de **sortie** comme entrée. Le binaire Rust gagne donc une seconde capture, rééchantillonnée à 16 kHz comme la première, et un mixeur qui somme les deux avec le micro comme horloge maître. Côté TypeScript, `modes.audio_source` pilote la commande envoyée au binaire, et `modes.playback_when_recording` empêche le mute système de vider la fonctionnalité de son sens.

**Tech Stack:** Rust, cpal 0.16 (WASAPI), crossbeam-channel, TypeScript.

**Dépend de :** [lot 1](2026-08-14-modes-lot1-visibilite.md) et [lot 3](2026-08-14-modes-lot3-format-long.md).

## Global Constraints

Voir [le plan directeur](2026-08-14-modes-refonte.md#global-constraints). Spécifiques à ce lot :

- **Windows uniquement** (D10). Sur macOS et Linux, le sélecteur de source est présent mais désactivé, avec la raison affichée.
- **Lints Rust** : `cargo clippy --workspace -- -D warnings` doit rester silencieux. (`native/Cargo.toml` n'active en réalité que `clippy::all`, pas pedantic + nursery — ne pas se fier au CLAUDE.md sur ce point.)
- **Format Rust** : 100 colonnes, fins de ligne Unix (`native/rustfmt.toml`).

## Deux réalités du binaire à connaître avant de commencer

**Le pipeline est en `f32`, pas en `i16`.** Les callbacks cpal poussent des `Vec<f32>`, le rééchantillonnage est un `FftFixedIn<f32>`, et la conversion en `i16` n'a lieu qu'à l'écriture dans `writer_loop`. Tout mixage doit donc se faire en `f32`, en amont.

**Le flux est préparé au démarrage et réutilisé sur la seule clé du nom de périphérique.** `lib/main/main.ts:194` appelle `prepareAudioStream()` au lancement, et `start_recording` (`native/audio-recorder/src/main.rs:229`) réutilise le flux existant dès que `current_device_name == device_name`. La source n'entre pas dans la clé — **une dictée Meeting réutiliserait donc le flux micro préparé au démarrage**, ce qui est exactement le symptôme « réunion muette » que ce lot existe pour éviter. La tâche 4.1 corrige la clé de cache ; ne pas la sauter.

---

### Task 4.1 : Le binaire sait ouvrir un périphérique de sortie en capture

**Files:**
- Modify: `native/audio-recorder/src/main.rs`
- Test: `native/audio-recorder/src/main.rs` (module `#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `enum AudioSource { Microphone, System, Both }` (désérialisée depuis la commande JSON)
  - `fn find_capture_device(host: &cpal::Host, source: DeviceRole, name: Option<String>) -> Result<cpal::Device>`
  - La commande `start_recording` accepte un champ `audio_source` optionnel (`"microphone"` par défaut)

- [ ] **Step 1: Écrire le test qui échoue**

Dans `native/audio-recorder/src/main.rs`, à la fin, ajouter :

```rust
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
        // `main.rs:67` jette silencieusement toute commande dont la
        // désérialisation échoue : sans repli AU NIVEAU DU CHAMP, une valeur
        // inconnue ne dégraderait pas la source, elle perdrait le `start`
        // entier. D'où `deserialize_with` et non un `unwrap_or_default` chez
        // l'appelant.
        let cmd: StartRecording =
            serde_json::from_str(r#"{"audio_source":"quadraphonic"}"#).unwrap();
        assert_eq!(cmd.audio_source, AudioSource::Microphone);
    }

    #[test]
    fn a_missing_source_is_the_microphone() {
        let cmd: StartRecording = serde_json::from_str("{}").unwrap();
        assert_eq!(cmd.audio_source, AudioSource::Microphone);
    }

    #[test]
    fn the_fast_path_key_includes_the_source() {
        // Sans la source dans la clé, une dictée Meeting réutiliserait le flux
        // micro préparé au démarrage et enregistrerait le silence.
        assert!(!can_reuse_stream(
            Some("default"), AudioSource::Microphone,
            Some("default"), AudioSource::Both,
        ));
        assert!(can_reuse_stream(
            Some("default"), AudioSource::Microphone,
            Some("default"), AudioSource::Microphone,
        ));
    }

    #[test]
    fn system_capture_needs_an_output_device() {
        assert!(AudioSource::System.needs_output_device());
        assert!(AudioSource::Both.needs_output_device());
        assert!(!AudioSource::Microphone.needs_output_device());
    }

    #[test]
    fn only_both_needs_the_mixer() {
        assert!(AudioSource::Both.needs_mixer());
        assert!(!AudioSource::System.needs_mixer());
        assert!(!AudioSource::Microphone.needs_mixer());
    }
}
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd native/audio-recorder && cargo test`
Expected: FAIL — `cannot find type AudioSource`

- [ ] **Step 3: Implémenter le type et la sélection de périphérique**

```rust
/// D'où vient l'audio d'un enregistrement.
///
/// `System` s'appuie sur une particularité de cpal sur Windows : ouvrir un
/// périphérique de **sortie** en entrée active le mode loopback WASAPI de
/// façon transparente. Aucune dépendance supplémentaire n'est nécessaire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioSource {
    #[default]
    Microphone,
    System,
    Both,
}

impl AudioSource {
    pub const fn needs_output_device(self) -> bool {
        matches!(self, Self::System | Self::Both)
    }

    pub const fn needs_mixer(self) -> bool {
        matches!(self, Self::Both)
    }
}

/// Le périphérique de sortie par défaut, ouvert en capture.
fn find_loopback_device(host: &cpal::Host) -> Result<cpal::Device> {
    host.default_output_device()
        .ok_or_else(|| anyhow!("[audio-recorder] No output device to capture from"))
}

/// Repli au niveau du champ : une valeur inconnue dégrade la source au lieu de
/// faire échouer la désérialisation, qui perdrait la commande `start` entière.
fn deserialize_audio_source<'de, D>(deserializer: D) -> Result<AudioSource, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    Ok(match raw.as_deref() {
        Some("system") => AudioSource::System,
        Some("both") => AudioSource::Both,
        Some(other) if other != "microphone" => {
            eprintln!("[audio-recorder] Unknown audio source {other:?}, using the microphone");
            AudioSource::Microphone
        }
        _ => AudioSource::Microphone,
    })
}

/// Le flux préparé n'est réutilisable que si le périphérique **et** la source
/// sont identiques.
const fn can_reuse_stream(
    current_device: Option<&str>,
    current_source: AudioSource,
    wanted_device: Option<&str>,
    wanted_source: AudioSource,
) -> bool {
    matches!((current_device, wanted_device), (Some(a), Some(b)) if str_eq(a, b))
        && current_source as u8 == wanted_source as u8
}
```

> `can_reuse_stream` est écrit en `const fn` avec un `str_eq` local dans le code réel ; la version simple `current_device == wanted_device && current_source == wanted_source` convient tout aussi bien si `const` gêne.

Ajouter le champ à la commande, avec le repli :

```rust
#[derive(Debug, Deserialize)]
pub struct StartRecording {
    pub device_name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_audio_source")]
    pub audio_source: AudioSource,
}
```

et remplacer la condition du fast-path (`main.rs:229`) :

```rust
        if self.active_stream.is_some()
            && can_reuse_stream(
                self.current_device_name.as_deref(),
                self.current_audio_source,
                device_name.as_deref(),
                source,
            )
        {
```

avec un champ `current_audio_source: AudioSource` sur la structure, mis à jour au même endroit que `current_device_name`. `prepare_stream` renseigne `AudioSource::Microphone` — c'est ce qu'il pré-crée.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd native/audio-recorder && cargo test`
Expected: PASS — 5 tests

- [ ] **Step 5: Vérifier le loopback sur la vraie machine**

Ajouter une sous-commande de diagnostic `probe-loopback` qui ouvre le périphérique de sortie par défaut en capture, enregistre 3 secondes et imprime le niveau RMS :

```rust
fn probe_loopback(host: &cpal::Host) -> Result<()> {
    let device = find_loopback_device(host)?;
    let config = device.default_output_config()?;
    eprintln!(
        "[audio-recorder] Loopback device: {} @ {} Hz, {} ch",
        device.name().unwrap_or_default(),
        config.sample_rate().0,
        config.channels()
    );

    let peak = Arc::new(AtomicU32::new(0));
    let peak_for_stream = Arc::clone(&peak);
    let stream = device.build_input_stream(
        &config.clone().into(),
        move |data: &[f32], _: &_| {
            let local = data.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
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
```

```bash
# Lancer une vidéo YouTube, puis :
cd native/audio-recorder && cargo run -- probe-loopback
```

Attendu : un pic clairement supérieur à 0. **Un pic à 0,0000 signifie que le loopback ne fonctionne pas** — arrêter et diagnostiquer avant d'écrire le mixeur, tout le lot en dépend.

- [ ] **Step 6: Commit**

```bash
cd native && cargo fmt && cargo clippy --workspace -- -D warnings
git add native/audio-recorder/src/main.rs
git commit -m "feat(audio): capture the default output device through WASAPI loopback"
```

---

### Task 4.2 : Mixage micro + système

**Files:**
- Modify: `native/audio-recorder/src/main.rs`
- Test: module `#[cfg(test)]`

**Interfaces:**
- Produces: `fn mix_into(primary: &mut [f32], secondary: &[f32])` — somme avec clamp à ±1.0

**Conception :**

Le micro est **l'horloge maître**. Sa cadence décide du nombre d'échantillons produits ; le loopback alimente une file tampon dans laquelle le mixeur puise. Deux périphériques ont deux quartz distincts : sur une heure, ils dérivent de plusieurs centaines de millisecondes. Faire du micro le maître transforme cette dérive en un manque ou un surplus côté loopback, absorbé par la file — un silence de quelques millisecondes ou quelques échantillons abandonnés, imperceptibles — au lieu d'un décalage cumulatif qui désynchroniserait tout l'enregistrement.

**Le mixage a lieu en `f32`, après rééchantillonnage et avant conversion.** C'est le format du pipeline existant ; mixer en `i16` obligerait à convertir deux fois et à écrêter deux fois.

**Chaque source a son propre resampler.** `writer_loop` n'en porte qu'un seul, à un taux fixe — or le micro et le périphérique de sortie tournent rarement au même taux (48 kHz contre 44,1 kHz est banal). La restructuration minimale : chaque capture possède son `FftFixedIn<f32>` vers 16 kHz et pousse des blocs **déjà à 16 kHz** dans son canal ; `writer_loop` ne reçoit donc plus que du 16 kHz et n'a plus à rééchantillonner du tout quand la source est mixée.

> Ce déplacement du rééchantillonnage hors de `writer_loop` est le vrai travail de cette tâche. Le prévoir avant d'écrire `mix_into`, qui est trivial en comparaison.

- [ ] **Step 1: Écrire le test qui échoue**

```rust
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
}
```

> Le dernier test alloue ~460 Mo transitoires. Si c'est trop pour la machine de CI, le réduire à 600 s (10 min) — mais ne pas descendre à 1 s : un test d'une seconde ne prouve rien sur l'accumulation.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd native/audio-recorder && cargo test mixer_tests`
Expected: FAIL — `cannot find function mix_into`

- [ ] **Step 3: Implémenter le mixeur**

```rust
/// Somme le flux secondaire dans le primaire, échantillon par échantillon.
///
/// Le primaire est l'horloge : sa longueur décide de la sortie. Un secondaire
/// plus court laisse sa queue intacte (le loopback a pris du retard), un
/// secondaire plus long est tronqué (il a pris de l'avance). C'est ainsi que
/// la dérive entre deux quartz reste un défaut local et ne devient jamais un
/// décalage cumulatif.
///
/// En `f32`, comme tout le pipeline en amont de l'écriture. Le clamp est
/// indispensable : la conversion `i16` en aval enroulerait sur un dépassement.
pub fn mix_into(primary: &mut [f32], secondary: &[f32]) {
    for (target, source) in primary.iter_mut().zip(secondary.iter()) {
        *target = (*target + *source).clamp(-1.0, 1.0);
    }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd native/audio-recorder && cargo test mixer_tests`
Expected: PASS — 6 tests

- [ ] **Step 5: Câbler le second flux**

Dans `start_capture`, quand `source.needs_output_device()` :

1. Construire un second `build_input_stream` sur `find_loopback_device(host)`, rééchantillonné vers 16 kHz par le même chemin que le micro.
2. Pousser ses blocs mono **déjà rééchantillonnés à 16 kHz** dans une `crossbeam_channel::bounded::<Vec<f32>>(64)` dédiée.
3. Dans le `writer_loop`, avant d'écrire un bloc micro : dépiler du canal loopback de quoi couvrir la longueur du bloc (via `try_recv`, jamais bloquant — attendre le loopback ferait bégayer le micro), concaténer dans un tampon persistant, en prélever `block.len()` échantillons, et appeler `mix_into`.
4. Quand `source == AudioSource::System`, ne pas ouvrir de flux micro du tout : le loopback devient le flux primaire.

Le tampon loopback est plafonné à **2 secondes** (32 000 échantillons) : au-delà, jeter les plus anciens. Un loopback qui prend plus de deux secondes d'avance signale un problème de périphérique, et laisser la file grossir consommerait de la mémoire pendant toute une réunion.

- [ ] **Step 6: Test manuel de bout en bout**

```bash
cd native/audio-recorder
cargo run -- probe-mix   # sous-commande symétrique de probe-loopback, 10 s, écrit mix.wav
```

Lancer une vidéo, parler par-dessus, puis écouter `mix.wav` : les deux sources doivent être audibles, sans écho ni décalage progressif.

- [ ] **Step 7: Commit**

```bash
cd native && cargo fmt && cargo clippy --workspace -- -D warnings && cargo test --workspace
git add native/audio-recorder/src/main.rs
git commit -m "feat(audio): mix microphone and system audio with the mic as clock master"
```

---

### Task 4.3 : Le mode pilote la source et le mute

**Files:**
- Create: `lib/main/audio/audioSourceController.ts`
- Modify: `lib/media/audio.ts` (passer `audioSource` à `startRecording`)
- Modify: `lib/main/voiceInputService.ts:40-45,75-80`
- Modify: `app/components/home/contents/modes/ModeEditor.tsx`
- Test: `lib/main/voiceInputService.test.ts`

**Interfaces:**
- Produces: `voiceInputService.startAudioRecording(mode: Mode)` — la source et la politique de mute viennent du mode

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `lib/main/voiceInputService.test.ts` :

```typescript
  test('a mode that records the system audio never mutes it', async () => {
    // Sans cette règle, le mute couperait exactement la réunion enregistrée.
    mockStoreGet.mockReturnValue({ muteAudioWhenDictating: true })

    await voiceInputService.startAudioRecording({
      audioSource: 'both',
      playbackWhenRecording: 'leave',
    } as any)

    expect(mockMuteSystemAudio).not.toHaveBeenCalled()
  })

  test('a microphone mode still honours the global mute setting', async () => {
    mockStoreGet.mockReturnValue({ muteAudioWhenDictating: true })

    await voiceInputService.startAudioRecording({
      audioSource: 'microphone',
      playbackWhenRecording: 'mute',
    } as any)

    expect(mockMuteSystemAudio).toHaveBeenCalled()
  })

  test('the mode wins over the global setting in both directions', async () => {
    mockStoreGet.mockReturnValue({ muteAudioWhenDictating: false })

    await voiceInputService.startAudioRecording({
      audioSource: 'microphone',
      playbackWhenRecording: 'mute',
    } as any)

    expect(mockMuteSystemAudio).toHaveBeenCalled()
  })

  test('the audio source reaches the recorder without dropping the chosen microphone', async () => {
    mockStoreGet.mockReturnValue({ microphoneDeviceId: 'usb-mic-2' })

    await voiceInputService.startAudioRecording({
      audioSource: 'system',
      playbackWhenRecording: 'leave',
    } as any)

    expect(mockStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        audioSource: 'system',
        deviceId: 'usb-mic-2',
      }),
    )
  })
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/voiceInputService.test.ts`
Expected: FAIL — `startAudioRecording` ne prend pas de mode

- [ ] **Step 3: Implémenter**

Dans `lib/main/voiceInputService.ts` :

```typescript
  public async startAudioRecording(mode: Mode) {
    const settings = store.get(STORE_KEYS.SETTINGS)

    // Le mode décide, le réglage général n'est qu'un défaut : couper le son
    // des autres applications pendant qu'on les enregistre viderait la
    // capture système de tout contenu.
    const shouldMute =
      mode.playbackWhenRecording === 'mute' &&
      mode.audioSource === 'microphone'

    if (shouldMute) {
      console.log('[VoiceInputService] Muting system audio during dictation')
      muteSystemAudio()
      this.mutedForThisSession = true
    } else {
      this.mutedForThisSession = false
    }

    // `deviceId` doit continuer de passer : le micro choisi dans Audio & Mic
    // est un réglage global, que la source du mode ne remplace pas.
    audioRecorderService.startRecording({
      deviceId: settings.microphoneDeviceId,
      audioSource: mode.audioSource,
    })
  }
```

et symétriquement dans l'arrêt : ne démuter que si `this.mutedForThisSession`.

> Le réglage global `settings.muteAudioWhenDictating` reste dans Settings → General : il sert désormais de **valeur par défaut** au champ `playback_when_recording` d'un mode créé ensuite, et non plus de décision au moment de l'enregistrement.

Dans `lib/media/audio.ts`, propager `audioSource` dans la commande JSON envoyée au binaire.

Dans `itoSessionManager.doStartSession`, remplacer `voiceInputService.startAudioRecording()` par `voiceInputService.startAudioRecording(mode)`.

- [ ] **Step 4: Exposer les réglages dans l'éditeur de mode**

Dans le bloc « Advanced settings » de `ModeEditor.tsx`, un nouveau groupe :

```tsx
          <SettingsGroup title="Recording">
            <SettingsRow
              title="Audio source"
              description={
                platform === 'win32'
                  ? 'System audio captures what your speakers play — a Meet or Teams call. Both mixes it with your microphone.'
                  : 'Capturing system audio is Windows-only for now.'
              }
            >
              <select
                value={mode.audioSource}
                disabled={platform !== 'win32'}
                onChange={event => set({ audioSource: event.target.value })}
                className={cn(
                  'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground disabled:opacity-40',
                  CONTROL_WIDTH,
                )}
              >
                <option value="microphone">Microphone</option>
                <option value="system">System audio</option>
                <option value="both">Both</option>
              </select>
            </SettingsRow>

            <SettingsRow
              title="Playback when recording"
              description="Muting other apps keeps dictations clean — but it would silence a call you are trying to record."
            >
              <select
                value={mode.playbackWhenRecording}
                onChange={event =>
                  set({ playbackWhenRecording: event.target.value })
                }
                className={cn(
                  'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
                  CONTROL_WIDTH,
                )}
              >
                <option value="mute">Mute other apps</option>
                <option value="leave">Leave it playing</option>
              </select>
            </SettingsRow>

            {mode.audioSource !== 'microphone' &&
              mode.playbackWhenRecording === 'mute' && (
                <SettingsNote tone="error">
                  Muting other apps while capturing system audio would record
                  silence. Set playback to “Leave it playing”.
                </SettingsNote>
              )}

            <SettingsRow
              title="Identify speakers"
              description="Separates who said what. Needs a Deepgram key and works best with Nova 3."
            >
              <Switch
                checked={mode.identifySpeakers}
                onCheckedChange={identifySpeakers => set({ identifySpeakers })}
              />
            </SettingsRow>
          </SettingsGroup>
```

- [ ] **Step 5: Lancer les tests**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/voiceInputService.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/itoSessionManager.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: PASS, 0 erreur

- [ ] **Step 6: Vérification manuelle sur une vraie réunion**

Run: `bun dev`

1. Ouvrir une réunion Google Meet (ou une vidéo YouTube à défaut).
2. Rendre « Meeting » le mode actif.
3. Enregistrer 2 minutes en parlant par-dessus.
4. Vérifier dans l'historique que le transcript contient **les deux voix**.
5. Vérifier que le son de la réunion **n'a pas été coupé** pendant l'enregistrement.

- [ ] **Step 7: Commit**

```bash
git add lib/main/ lib/media/audio.ts app/components/home/contents/modes/ModeEditor.tsx
git commit -m "feat(modes): audio source and playback policy come from the mode"
```

---

## Vérification du lot 4

```bash
cd native && cargo test --workspace && cargo clippy --workspace -- -D warnings && cd ..
bun test --preload lib/__tests__/setup.ts lib/main/voiceInputService.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```

**Critère de sortie :** une réunion Meet de 2 minutes enregistrée depuis Ito contient les deux interlocuteurs, et le son de la réunion n'a jamais été coupé.
