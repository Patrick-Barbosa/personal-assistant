use std::path::PathBuf;

/// Events emitted by domain/service operations.
/// These are internal domain events — the bridge layer translates them
/// into Tauri events for the frontend.

#[derive(Debug, Clone)]
pub enum VaultEvent {
    NoteCreated {
        path: PathBuf,
        title: String,
    },
    NoteUpdated {
        path: PathBuf,
        title: String,
    },
    NoteDeleted {
        path: PathBuf,
        title: String,
    },
    NoteRenamed {
        old_path: PathBuf,
        new_path: PathBuf,
        old_title: String,
        new_title: String,
    },
    VaultsReindexed {
        vault_count: usize,
        note_count: usize,
    },
}

#[derive(Debug, Clone)]
pub enum SessionEvent {
    Created { id: String, titulo: String },
    Renamed { id: String, titulo: String },
    Deleted { id: String },
}

#[derive(Debug, Clone)]
pub enum VoiceEvent {
    StatusChanged {
        status: String,
        prompt: Option<String>,
    },
    FollowupChime,
}

#[derive(Debug, Clone)]
pub enum InboxEvent {
    Updated { unread_count: Option<i64> },
}
