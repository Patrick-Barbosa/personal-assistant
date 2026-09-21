use serde::{Deserialize, Serialize};

fn default_routine_active() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledRoutine {
    pub id: String,
    pub titulo: String,
    pub cron_expr: String,
    pub prompt: String,
    #[serde(default)]
    pub skill_id: Option<String>,
    #[serde(default = "default_routine_active")]
    pub ativo: bool,
    #[serde(default)]
    pub ultima_execucao: Option<String>,
    pub created_at: String,
}
