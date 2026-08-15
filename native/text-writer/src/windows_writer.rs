#[cfg(target_os = "windows")]
use clipboard_win::{formats, get_clipboard, set_clipboard};
use enigo::{Enigo, Key, Keyboard, Settings};
use std::env;
use std::thread;
use std::time::Duration;
use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_INSERT, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

fn paste_ctrl_v(enigo: &mut Enigo) -> Result<(), String> {
    // Ctrl + V (default Windows paste)
    enigo
        .key(Key::Control, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Ctrl: {}", e))?;
    enigo
        .key(Key::Unicode('v'), enigo::Direction::Press)
        .map_err(|e| format!("Failed to press V: {}", e))?;
    thread::sleep(Duration::from_millis(20));
    enigo
        .key(Key::Unicode('v'), enigo::Direction::Release)
        .map_err(|e| format!("Failed to release V: {}", e))?;
    enigo
        .key(Key::Control, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Ctrl: {}", e))?;
    Ok(())
}

fn paste_ctrl_shift_v(enigo: &mut Enigo) -> Result<(), String> {
    // Ctrl + Shift + V (e.g., mintty / Git Bash)
    enigo
        .key(Key::Control, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Ctrl: {}", e))?;
    enigo
        .key(Key::Shift, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press Shift: {}", e))?;
    enigo
        .key(Key::Unicode('v'), enigo::Direction::Press)
        .map_err(|e| format!("Failed to press V: {}", e))?;
    thread::sleep(Duration::from_millis(20));
    enigo
        .key(Key::Unicode('v'), enigo::Direction::Release)
        .map_err(|e| format!("Failed to release V: {}", e))?;
    enigo
        .key(Key::Shift, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Shift: {}", e))?;
    enigo
        .key(Key::Control, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release Ctrl: {}", e))?;
    Ok(())
}

fn paste_shift_insert(_enigo: &mut Enigo) -> Result<(), String> {
    // Shift + Insert via SendInput (enigo doesn't expose Insert)
    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_SHIFT,
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_INSERT,
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_INSERT,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_SHIFT,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];

        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent == 0 {
            return Err("Failed to send Shift+Insert".to_string());
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum PasteCombo {
    Auto,
    CtrlV,
    CtrlShiftV,
    ShiftInsert,
}

fn parse_combo(env_val: &str) -> PasteCombo {
    match env_val {
        "ctrl-shift-v" | "control-shift-v" => PasteCombo::CtrlShiftV,
        "shift-insert" | "shift+insert" => PasteCombo::ShiftInsert,
        "ctrl-v" | "control-v" => PasteCombo::CtrlV,
        _ => PasteCombo::Auto,
    }
}

fn paste_with_combo(enigo: &mut Enigo, combo: PasteCombo) -> Result<(), String> {
    match combo {
        PasteCombo::CtrlShiftV => paste_ctrl_shift_v(enigo),
        PasteCombo::ShiftInsert => paste_shift_insert(enigo),
        PasteCombo::CtrlV | PasteCombo::Auto => paste_ctrl_v(enigo),
    }
}

fn get_foreground_process_name() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        // Need query rights; include TERMINATE just to satisfy some policies that require additional access.
        let handle = match OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            false,
            pid,
        ) {
            Ok(h) => h,
            Err(_) => return None,
        };
        let mut buf: [u16; MAX_PATH as usize] = [0; MAX_PATH as usize];
        let len = K32GetModuleBaseNameW(handle, None, &mut buf);
        let _ = CloseHandle(handle);
        if len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]).to_lowercase())
    }
}

fn detect_combo_from_foreground() -> PasteCombo {
    if let Some(name) = get_foreground_process_name() {
        if name.contains("mintty") || name.contains("git-bash") {
            return PasteCombo::CtrlShiftV;
        }
        if name.contains("wt.exe")
            || name.contains("windowsterminal")
            || name.contains("windows terminal")
        {
            return PasteCombo::CtrlShiftV;
        }
        if name.contains("conhost") || name.contains("bash.exe") || name.contains("bash") {
            return PasteCombo::CtrlShiftV;
        }
        if name.contains("powershell") || name.contains("pwsh") || name.contains("cmd.exe") {
            return PasteCombo::ShiftInsert;
        }
    }
    PasteCombo::CtrlV
}

/// Type text on Windows using clipboard paste approach
/// This mimics the macOS implementation to avoid character-by-character typing
/// issues
pub fn type_text_windows(text: &str, _char_delay: u64) -> Result<(), String> {
    // Set our text to clipboard
    set_clipboard(formats::Unicode, text)
        .map_err(|e| format!("Failed to set clipboard: {:?}", e))?;

    // Verify clipboard was actually set by reading it back
    let mut attempts = 0;
    loop {
        match get_clipboard::<String, _>(formats::Unicode) {
            Ok(content) if content == text => break,
            _ => {
                attempts += 1;
                if attempts > 50 {
                    return Err("Failed to verify clipboard content was set".to_string());
                }
                thread::sleep(Duration::from_millis(2));
            }
        }
    }

    // Initialize enigo for keyboard simulation
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to initialize enigo: {}", e))?;

    // Allow overriding the paste combo for terminals like Git Bash (mintty)
    let paste_combo = env::var("ITO_PASTE_COMBO")
        .unwrap_or_else(|_| "".to_string())
        .to_lowercase();
    let parsed_combo = parse_combo(paste_combo.as_str());
    let combo_to_use = if matches!(parsed_combo, PasteCombo::Auto) {
        detect_combo_from_foreground()
    } else {
        parsed_combo
    };

    paste_with_combo(&mut enigo, combo_to_use)?;

    // The transcript deliberately stays in the clipboard (no restore of the
    // previous contents): if the paste landed on a window without a text
    // field — the user moved away during a long transcription — the dictation
    // remains one Ctrl+V away instead of being lost. This also removes the
    // 1s settle delay the restore needed.

    Ok(())
}
