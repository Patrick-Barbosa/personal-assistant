use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub fn emit_overlay_toggled(app: &AppHandle, visible: bool) -> Result<(), tauri::Error> {
    app.emit("overlay-toggled", visible)
}

pub fn emit_inbox_updated(app: &AppHandle, unread_count: Option<i64>) -> Result<(), tauri::Error> {
    #[derive(Clone, Serialize)]
    struct InboxPayload {
        unread_count: Option<i64>,
    }
    app.emit("inbox-updated", InboxPayload { unread_count })
}

pub fn emit_wake_status_changed(
    app: &AppHandle,
    status: &str,
    prompt: Option<String>,
) -> Result<(), tauri::Error> {
    #[derive(Clone, Serialize)]
    struct WakeStatusPayload {
        status: String,
        prompt: Option<String>,
    }
    app.emit(
        "wake-status-changed",
        WakeStatusPayload {
            status: status.to_string(),
            prompt,
        },
    )
}

pub fn emit_session_renamed(app: &AppHandle, id: &str, title: &str) -> Result<(), tauri::Error> {
    #[derive(Clone, Serialize)]
    struct RenamedPayload {
        id: String,
        title: String,
    }
    app.emit(
        "session-renamed",
        RenamedPayload {
            id: id.to_string(),
            title: title.to_string(),
        },
    )
}

pub fn emit_shortcut_conflict(app: &AppHandle, msg: &str) -> Result<(), tauri::Error> {
    app.emit("shortcut-conflict", msg)
}

pub fn emit_wake_followup_chime(app: &AppHandle) -> Result<(), tauri::Error> {
    app.emit("wake-play-followup-chime", ())
}

pub fn emit_wake_debug_scores(
    app: &AppHandle,
    copernico: f32,
    zefiro: Option<f32>,
    lich: Option<f32>,
    rms: f32,
    threshold: f32,
) -> Result<(), tauri::Error> {
    #[derive(Clone, Serialize)]
    struct DebugScoresPayload {
        copernico: f32,
        zefiro: Option<f32>,
        lich: Option<f32>,
        rms: f32,
        threshold: f32,
    }
    app.emit(
        "wake-debug-scores",
        DebugScoresPayload {
            copernico,
            zefiro,
            lich,
            rms,
            threshold,
        },
    )
}
