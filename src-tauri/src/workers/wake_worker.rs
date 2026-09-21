use crate::services::agent_engine::SharedAgentCore;
use crate::services::greeting_srv::SharedGreetingsManager;
use crate::services::voice_orch::start_wake_word_service;
use std::path::PathBuf;
use tauri::AppHandle;

#[allow(clippy::too_many_arguments)]
pub fn spawn_wake_worker(
    app: AppHandle,
    models_dir: PathBuf,
    agent_core: SharedAgentCore,
    stt: crate::stt::SharedSttClient,
    tts: crate::tts::SharedTtsClient,
    db: crate::db::SharedDatabase,
    wake_service: crate::wake_word::SharedWakeWordService,
    greetings: SharedGreetingsManager,
    thinking: crate::thinking::SharedThinkingAudiosManager,
) {
    start_wake_word_service(
        app,
        models_dir,
        agent_core,
        stt,
        tts,
        db,
        wake_service,
        greetings,
        thinking,
    );
}
