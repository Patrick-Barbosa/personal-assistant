# TASK: Replace Transparent Overlay Window with Clean Localhost Web UI & Background Audio Interaction

## 1. Context & Objective
The current desktop architecture relies on a multi-window setup in Tauri (`main` window + frameless transparent `indicator` window) and native Win32 window overlays (`native_overlay.rs`). This introduces unnecessary window management complexity, z-index glitches, and focus stealing issues.

We want to simplify the application architecture by:
1. Removing all transparent overlay windows, indicator sub-windows, and floating HUDs.
2. Unifying the application into a single, beautifully designed, highly functional local web interface running at `http://localhost:1420` (or inside a standard Tauri desktop window with standard decorations).
3. Maintaining **100% of background voice interaction capability** (wake-word listening via sidecar, Groq Whisper STT, Edge-TTS synthesis, and session auto-consolidation). Background interaction must rely entirely on audio cues (sound effects, greetings, TTS response) rather than visual window popups.

---

## 2. Affected Layers & Files

| Layer | File Path | Action | Purpose |
| :--- | :--- | :--- | :--- |
| **Config** | [`src-tauri/tauri.conf.json`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src-tauri/tauri.conf.json) | **MODIFY** | Remove `indicator` window definition; set `main` window to standard non-transparent view with window decorations. |
| **Services** | [`src-tauri/src/services/voice_orch.rs`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src-tauri/src/services/voice_orch.rs) | **MODIFY** | Remove calls to `ensure_indicator_visible`, `hide_indicator`, and `crate::native_overlay::*`. Maintain headless background wake-word loop and audio pipeline. |
| **Infra/Native** | [`src-tauri/src/native_overlay.rs`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src-tauri/src/native_overlay.rs) | **DELETE / STUB** | Remove Win32 transparent overlay window creation code or stub out safely to avoid dead window logic. |
| **Infra/Native** | [`src-tauri/src/infra/native/win32_overlay.rs`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src-tauri/src/infra/native/win32_overlay.rs) | **DELETE / STUB** | Safely deactivate Win32 overlay hooks. |
| **Frontend** | [`src/main.tsx`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src/main.tsx) | **MODIFY** | Remove `isIndicator` URL query parsing (`mode=indicator`) and render `<App />` directly as the root application. |
| **Frontend** | [`src/components/VoiceIndicatorOverlay.tsx`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src/components/VoiceIndicatorOverlay.tsx) | **DELETE** | Remove orphaned indicator UI component. |
| **Frontend** | [`src/App.tsx`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src/App.tsx) | **MODIFY** | Ensure the web UI presents a clean, responsive, consolidated dashboard for chat, vault notes, and voice status without requiring popups. |

---

## 3. Detailed Technical Requirements

### Step 1: Simplify Window Configuration (`tauri.conf.json`) [COMPLETED - Tier 1]
- Remove the window object with `"label": "indicator"`.
- Update `"label": "main"`:
  - Set `"transparent": false`
  - Set `"decorations": true`
  - Set `"alwaysOnTop": false`
  - Set `"width": 1200` and `"height": 800` (or standard desktop dimensions)
  - Retain `"devUrl": "http://localhost:1420"`.

### Step 2: Decouple Voice Orchestration from Visual Overlay (`voice_orch.rs`) [COMPLETED - Tier 1]
- Remove calls to `ensure_indicator_visible(&app)` and `hide_indicator(&app)` in `SidecarMessage::Start`, `SidecarMessage::Stop`, `SidecarMessage::Cancel`, and error handling routines.
- Strip out calls to `crate::native_overlay::set_mode(...)` and `crate::native_overlay::update_audio_rms(...)`.
- **Preserve Background Service Execution**:
  - The background thread `start_wake_word_service` MUST continue running when the application launches.
  - When the wake-word ("Copernico") is detected:
    1. Play audio greeting / chime directly via `greetings.pick_greeting()` / audio player.
    2. Transition into STT transcription (`stt_client.transcribe`).
    3. Stream assistant response via Edge-TTS (`tts_client.speak_text`).
    4. Emit status events (`wake-status-changed`) via Tauri IPC so the main web UI can reflect state when open, but **do not force any window to open, focus, or pop up**.

### Step 3: Frontend Simplification (`src/main.tsx` & `src/`) [COMPLETED - Tier 1]
- Simplify `src/main.tsx` to directly mount `<App />` without window label inspection or `mode=indicator` checks.
- Delete [`src/components/VoiceIndicatorOverlay.tsx`](file:///home/pkpkpk/Documentos/codebase/personal-assistant/src/components/VoiceIndicatorOverlay.tsx).
- In `src/App.tsx` / `src/components/`, ensure the main web UI cleanly displays voice status (e.g., subtle status badge or header indicator) whenever `wake-status-changed` events are received, while allowing the user to interact seamlessly with the web interface.

---

## 4. Invariants & Anti-Patterns (Negative Rules)

- **DO NOT break background voice processing**: The sidecar process and wake word detection loop MUST stay active in the background even if the UI window is minimized or closed to system tray.
- **DO NOT leave panic handlers or `unwrap()` calls**: Ensure Rust error handling in `voice_orch.rs` uses proper `match`, `if let`, or `map_err`.
- **DO NOT leave ghost files**: Completely remove or safely stub `VoiceIndicatorOverlay.tsx` and `native_overlay.rs` references across `lib.rs` and `commands/mod.rs`.
- **DO NOT violate Hexagonal Architecture**: Domain models (`domain/`) must remain pure with zero dependencies on Tauri or I/O types.
- **DO NOT modify the Obsidian Vault**: Markdown files in `cofres/obsidian/` remain strictly read-only unless explicit write routines are called.

---

## 5. Verification & Quality Gates

Run all quality checks from PowerShell before concluding the task:

1. `cargo check --manifest-path src-tauri/Cargo.toml` (0 errors, 0 warnings)
2. `cargo test --manifest-path src-tauri/Cargo.toml --test unit_tests` (all unit tests pass)
3. `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
4. `pnpm test:unit`
5. `pnpm build`
