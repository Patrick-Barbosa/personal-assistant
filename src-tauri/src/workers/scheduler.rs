use crate::services::skill_runner_srv::SkillRunner;
use std::sync::Arc;
use tauri::AppHandle;

pub fn spawn_scheduler_worker(skill_runner: Arc<SkillRunner>, app_handle: AppHandle) {
    skill_runner.set_app_handle(app_handle);
    skill_runner.start_scheduler();
}
