use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

pub fn emit_wake_session_deleted(app: &AppHandle, session_id: &str) -> Result<(), tauri::Error> {
    #[derive(Clone, Serialize)]
    struct WakeSessionDeletedPayload {
        #[serde(rename = "sessionId")]
        session_id: String,
    }
    app.emit(
        "wake-session-deleted",
        WakeSessionDeletedPayload {
            session_id: session_id.to_string(),
        },
    )
}

pub fn emit_wake_followup_chime(app: &AppHandle) -> Result<(), tauri::Error> {
    app.emit("wake-play-followup-chime", ())
}

/// Quadro Kanban (semanas, tarefas ou hábitos) mudou de estado.
///
/// `motivo` é um código estável (`task_created`, `task_moved`, `week_closed`,
/// `habits_synced`, ...) — nunca texto livre exibido ao usuário.
pub fn emit_kanban_changed(
    app: &AppHandle,
    week_id: &str,
    motivo: &str,
) -> Result<(), tauri::Error> {
    #[derive(Clone, Serialize)]
    struct KanbanChangedPayload {
        week_id: String,
        motivo: String,
    }
    app.emit(
        "kanban-changed",
        KanbanChangedPayload {
            week_id: week_id.to_string(),
            motivo: motivo.to_string(),
        },
    )
}
