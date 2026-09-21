use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub session_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub content: String,
    pub item_type: String,
    pub status: String,
    pub requires_decision: bool,
    pub created_at: String,
    #[serde(default)]
    pub target_base_note_slug: Option<String>,
    #[serde(default)]
    pub proposed_content: Option<String>,
    #[serde(default)]
    pub diff_data: Option<String>,
    /// Carimbo da última transição de status (para retenção de dismissed por 72h).
    /// Preenchido com created_at em linhas legadas.
    #[serde(default)]
    pub updated_at: Option<String>,
    /// Motivo opcional informado pelo usuário ao aprovar/rejeitar (máx 140 chars, trim).
    #[serde(default)]
    pub decision_reason: Option<String>,
}
