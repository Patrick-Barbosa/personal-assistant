use crate::agent::AgentCore;
use crate::db::Database;
use crate::plugin_registry::PluginRegistry;
use chrono::{Datelike, Local, Timelike};
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct SkillRunner {
    agent: Arc<AgentCore>,
    db: Arc<Database>,
    registry: Arc<PluginRegistry>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    is_running: Arc<AtomicBool>,
    last_runs: Arc<RwLock<HashMap<String, chrono::DateTime<Local>>>>,
    running_ids: Arc<RwLock<std::collections::HashSet<String>>>,
    skills_path: Arc<RwLock<Option<std::path::PathBuf>>>,
}

impl SkillRunner {
    pub fn new(agent: Arc<AgentCore>, db: Arc<Database>, registry: Arc<PluginRegistry>) -> Self {
        Self {
            agent,
            db,
            registry,
            app_handle: Arc::new(RwLock::new(None)),
            is_running: Arc::new(AtomicBool::new(false)),
            last_runs: Arc::new(RwLock::new(HashMap::new())),
            running_ids: Arc::new(RwLock::new(std::collections::HashSet::new())),
            skills_path: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_skills_path(&self, path: std::path::PathBuf) {
        if let Ok(mut lock) = self.skills_path.write() {
            *lock = Some(path);
        }
    }

    fn get_skills_path(&self) -> std::path::PathBuf {
        self.skills_path
            .read()
            .ok()
            .and_then(|p| p.clone())
            .unwrap_or_else(|| std::path::PathBuf::from("skills"))
    }

    fn try_acquire_running(&self, id: &str) -> bool {
        if let Ok(mut set) = self.running_ids.write() {
            if set.contains(id) {
                return false;
            }
            set.insert(id.to_string());
            return true;
        }
        false
    }

    fn release_running(&self, id: &str) {
        if let Ok(mut set) = self.running_ids.write() {
            set.remove(id);
        }
    }

    pub fn remove_last_run(&self, id: &str) {
        if let Ok(mut map) = self.last_runs.write() {
            map.remove(id);
        }
        self.release_running(id);
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut app_opt = self.app_handle.write().unwrap();
        *app_opt = Some(handle);
    }

    /// Inicia o scheduler de cron em segundo plano
    pub fn start_scheduler(self: Arc<Self>) {
        if self.is_running.swap(true, Ordering::SeqCst) {
            return;
        }

        std::thread::Builder::new()
            .name("copernico-skill-scheduler".into())
            .spawn(move || {
                println!("[SKILLS] Scheduler de rotinas iniciado em thread desacoplada.");
                let mut last_prune = std::time::Instant::now()
                    .checked_sub(std::time::Duration::from_secs(3600))
                    .unwrap_or_else(std::time::Instant::now);
                while self.is_running.load(Ordering::SeqCst) {
                    let now = Local::now();

                    // Purga 1x/hora: dismissed há +72h (preserva histórico curto, evita lixo eterno).
                    if last_prune.elapsed().as_secs() >= 3600 {
                        match self.db.prune_dismissed_expired() {
                            Ok(n) if n > 0 => println!("[INBOX] Purga automática: {} item(ns) dismissed expirados (>72h) removidos.", n),
                            Ok(_) => {},
                            Err(e) => eprintln!("[INBOX] Falha na purga de dismissed: {}", e),
                        }
                        last_prune = std::time::Instant::now();
                    }

                    // Verifica todas as skills registradas
                    let skills = self.registry.list_skills();
                    for manifest in skills {
                        if !self.registry.is_plugin_enabled(&manifest.plugin.id) {
                            continue;
                        }

                        if let Some(ref skill_cfg) = manifest.skill {
                            if skill_cfg.trigger.trigger_type == "cron" {
                                if let Some(ref cron_expr) = skill_cfg.trigger.cron {
                                    // Verifica se há override personalizado do usuário no SQLite
                                    let override_key = format!("skill_cron_override::{}", manifest.plugin.id);
                                    let effective_cron = self.db
                                        .get_setting(&override_key)
                                        .ok()
                                        .flatten()
                                        .unwrap_or_else(|| cron_expr.clone());

                                    if Self::matches_cron(&effective_cron, &now) {
                                        // Verifica se já rodou no mesmo minuto (inclui ano/mês para corrigir bug mensal)
                                        let mut should_run = false;
                                        {
                                            let mut last_runs = self.last_runs.write().unwrap();
                                            if let Some(last) = last_runs.get(&manifest.plugin.id) {
                                                if last.year() != now.year()
                                                    || last.month() != now.month()
                                                    || last.day() != now.day()
                                                    || last.hour() != now.hour()
                                                    || last.minute() != now.minute()
                                                {
                                                    should_run = true;
                                                    last_runs.insert(manifest.plugin.id.clone(), now);
                                                }
                                            } else {
                                                should_run = true;
                                                last_runs.insert(manifest.plugin.id.clone(), now);
                                            }
                                        }

                                        if should_run {
                                            let runner = self.clone();
                                            let skill_id = manifest.plugin.id.clone();
                                            tauri::async_runtime::spawn(async move {
                                                println!(
                                                    "[SKILLS] Disparando skill agendada: '{}'...",
                                                    skill_id
                                                );
                                                if let Err(e) = runner.run_skill(&skill_id, None).await {
                                                    if e.contains("já está em execução") {
                                                        println!("[SKILLS] Skill '{}' ignorada (sobreposição)", skill_id);
                                                    } else {
                                                        eprintln!("[SKILLS] Erro na skill '{}': {}", skill_id, e);
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // Verifica rotinas agendadas (Scheduled Routines) salvas no SQLite
                    if let Ok(routines) = self.db.list_scheduled_routines() {
                        for routine in routines {
                            if !routine.ativo {
                                continue;
                            }

                            if Self::matches_cron(&routine.cron_expr, &now) {
                                let mut should_run = false;
                                {
                                    let mut last_runs = self.last_runs.write().unwrap();
                                    if let Some(last) = last_runs.get(&routine.id) {
                                        if last.year() != now.year()
                                            || last.month() != now.month()
                                            || last.day() != now.day()
                                            || last.hour() != now.hour()
                                            || last.minute() != now.minute()
                                        {
                                            should_run = true;
                                            last_runs.insert(routine.id.clone(), now);
                                        }
                                    } else {
                                        should_run = true;
                                        last_runs.insert(routine.id.clone(), now);
                                    }
                                }

                                if should_run {
                                    let runner = self.clone();
                                    let r_id = routine.id.clone();
                                    tauri::async_runtime::spawn(async move {
                                        if let Err(e) = runner.run_scheduled_routine(&r_id).await {
                                            eprintln!("[ROUTINE] Erro na rotina '{}': {}", r_id, e);
                                        }
                                    });
                                }
                            }
                        }
                    }

                    std::thread::sleep(Duration::from_secs(15));
                }
            })
            .expect("Falha ao spawnar thread do scheduler de skills");
    }

    /// Executa uma skill sob demanda (gatilho manual ou cron)
    pub async fn run_skill(
        &self,
        skill_id: &str,
        manual_input: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        // Guard contra sobreposição (manual + scheduler)
        if !self.try_acquire_running(skill_id) {
            return Err(format!("Skill '{}' já está em execução", skill_id));
        }
        struct Guard<'a> {
            id: String,
            runner: &'a SkillRunner,
        }
        impl Drop for Guard<'_> {
            fn drop(&mut self) {
                self.runner.release_running(&self.id);
            }
        }
        let _guard = Guard {
            id: skill_id.to_string(),
            runner: self,
        };

        let manifest = self
            .registry
            .get_manifest(skill_id)
            .ok_or_else(|| format!("Skill '{}' não encontrada", skill_id))?;

        if !self.registry.is_plugin_enabled(skill_id) {
            return Err(format!(
                "A skill '{}' está desativada. Ative o plugin nas configurações para utilizá-la.",
                manifest.plugin.name
            ));
        }

        let skill_cfg = manifest
            .skill
            .as_ref()
            .ok_or_else(|| format!("Plugin '{}' não possui configuração de skill", skill_id))?;

        // Carrega configurações customizadas da skill salvas no SQLite
        let custom_config_key = format!("skill_config::{}", skill_id);
        let custom_config: Option<serde_json::Value> = self
            .db
            .get_setting(&custom_config_key)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok());

        let prefix = skill_cfg
            .execution
            .as_ref()
            .map(|e| e.session_prefix.as_str())
            .unwrap_or("🤖 Skill");

        let default_max_iter = skill_cfg
            .execution
            .as_ref()
            .map(|e| e.max_iterations)
            .unwrap_or(8);

        let max_iter = custom_config
            .as_ref()
            .and_then(|c| c.get("max_iterations"))
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(default_max_iter);

        let mut effective_prompt = custom_config
            .as_ref()
            .and_then(|c| c.get("system_prompt"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&skill_cfg.system_prompt)
            .to_string();

        if let Some(custom_goal) = custom_config
            .as_ref()
            .and_then(|c| c.get("custom_goal"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
        {
            effective_prompt.push_str(&format!(
                "\n\n[OBJETIVO ATUAL DEFINIDO PELO USUÁRIO]:\n{}\n",
                custom_goal
            ));
        }

        // Legado thinking-aloud removido (plugins/skills/ deletado). Opções de verbalização
        // agora vivem em rotinas agendadas do SQLite, não em YAML.
        let notify = skill_cfg
            .execution
            .as_ref()
            .map(|e| e.notify_on_complete)
            .unwrap_or(true);

        let now_str = crate::vault::agora_ddmmyy_hm();
        let session_title = format!("{} ({})", prefix, now_str);

        // 1. Cria sessão dedicada no SQLite
        let session = self
            .db
            .create_session(Some(&session_title))
            .map_err(|e| format!("Falha ao criar sessão para skill: {}", e))?;

        // 2. Determina a mensagem de entrada
        let input_text = manual_input
            .or(skill_cfg.input_message.as_deref())
            .unwrap_or("Inicie a execução da sua rotina.");

        println!(
            "[SKILLS] Executando skill '{}' na sessão '{}'...",
            skill_id, session.id
        );

        // 3. Executa o loop agêntico com o prompt customizado e ferramentas da skill
        let allowed_tools = skill_cfg.allowed_tools.as_deref();
        let result = match self
            .agent
            .chat_with_options(
                &session.id,
                input_text,
                "system",
                true, // overlay_visible para respostas ricas em markdown
                Some(&effective_prompt),
                Some(max_iter),
                allowed_tools,
            )
            .await
        {
            Ok(res) => res,
            Err(err) => {
                let err_msg = format!("A execução da rotina foi interrompida: {}", err);
                let _ = self.db.create_inbox_item(
                    Some(&session.id),
                    &format!("⚠️ Erro em {}", manifest.plugin.name),
                    Some("Ocorreu um erro durante a execução da rotina autônoma."),
                    &format!("### ⚠️ Falha na Execução\n\n{}\n\nVocê pode inspecionar o histórico desta sessão diretamente no chat.", err),
                    "error_report",
                    false,
                );
                return Err(err_msg);
            }
        };

        let res_payload = json!({
            "skill_id": skill_id,
            "session_id": session.id,
            "session_title": session_title,
            "resultado": result,
            "timestamp": Local::now().to_rfc3339()
        });

        // 4. Salva automaticamente na Inbox do Agente
        // Legado auto-curadoria/weekly-report removido: tudo cai no genérico.
        let (inbox_title, item_type, requires_decision) =
            (manifest.plugin.name.clone(), "letter".to_string(), false);

        let summary_chars: String = result.chars().take(180).collect();
        let summary = if result.chars().count() > 180 {
            format!("{}…", summary_chars)
        } else {
            summary_chars
        };

        let _ = self.db.create_inbox_item(
            Some(&session.id),
            &inbox_title,
            Some(&summary),
            &result,
            &item_type,
            requires_decision,
        );

        // 5. Notifica o frontend via evento Tauri se configurado
        if let Some(ref app) = *self.app_handle.read().unwrap() {
            let unread_count = self.db.get_unread_inbox_count().unwrap_or(0);
            let _ = app.emit("inbox-updated", json!({ "unread_count": unread_count }));

            if notify {
                let _ = app.emit("skill-completed", &res_payload);
            }
        }

        println!("[SKILLS] Skill '{}' concluída e salva na Inbox!", skill_id);
        Ok(res_payload)
    }

    /// Executa uma rotina agendada (Scheduled Routine) salva no SQLite
    pub async fn run_scheduled_routine(
        &self,
        routine_id: &str,
    ) -> Result<serde_json::Value, String> {
        // Guard contra execuções sobrepostas (manual + scheduler)
        if !self.try_acquire_running(routine_id) {
            return Err(format!("Rotina '{}' já está em execução", routine_id));
        }

        let result = self.run_scheduled_routine_inner(routine_id).await;

        // Sempre libera o guard, mesmo em erro
        self.release_running(routine_id);

        // Em caso de erro, garante que ultima_execucao seja atualizada e inbox de erro seja criado já dentro de inner
        result
    }

    async fn run_scheduled_routine_inner(
        &self,
        routine_id: &str,
    ) -> Result<serde_json::Value, String> {
        let routines = self
            .db
            .list_scheduled_routines()
            .map_err(|e| e.to_string())?;
        let routine = routines
            .into_iter()
            .find(|r| r.id == routine_id)
            .ok_or_else(|| format!("Rotina '{}' não encontrada", routine_id))?;

        println!(
            "[SKILL_RUNNER] Executando rotina agendada: '{}'...",
            routine.titulo
        );

        let now_str = crate::vault::agora_ddmmyy_hm();
        let session_title = format!("🤖 [Rotina] {} ({})", routine.titulo, now_str);
        let session = self
            .db
            .create_session(Some(&session_title))
            .map_err(|e| format!("Falha ao criar sessão para rotina: {}", e))?;

        // Se houver skill associada, tenta carregar as instruções da skill (usa path configurado)
        let skill_prompt = if let Some(ref s_id) = routine.skill_id {
            let mgr = crate::skills::SkillManager::new(self.get_skills_path());
            mgr.get_skill(s_id, &self.db).map(|s| s.prompt_instructions)
        } else {
            None
        };

        let agent_result = self
            .agent
            .chat_with_options(
                &session.id,
                &routine.prompt,
                "system",
                true,
                skill_prompt.as_deref(),
                Some(8),
                None,
            )
            .await;

        let result_str = match agent_result {
            Ok(r) => r,
            Err(e) => {
                let err_msg = format!("Erro ao executar agente na rotina: {}", e);
                eprintln!("[ROUTINE] {}", err_msg);
                // Atualiza última execução mesmo em falha para auditoria
                let rfc_now = Local::now().to_rfc3339();
                let _ = self.db.update_routine_last_run(&routine.id, &rfc_now);
                // Cria inbox de erro para observabilidade (como run_skill faz)
                let _ = self.db.create_inbox_item(
                    Some(&session.id),
                    &format!("⚠️ Erro em {}", routine.titulo),
                    Some("Falha durante execução da rotina agendada"),
                    &format!("### ⚠️ Falha na Rotina\n\n{}\n\nSessão: {}", e, session.id),
                    "error_report",
                    false,
                );
                if let Some(ref app) = *self.app_handle.read().unwrap() {
                    let unread_count = self.db.get_unread_inbox_count().unwrap_or(0);
                    let _ = app.emit("inbox-updated", json!({ "unread_count": unread_count }));
                }
                return Err(err_msg);
            }
        };

        // Atualiza última execução
        let rfc_now = Local::now().to_rfc3339();
        let _ = self.db.update_routine_last_run(&routine.id, &rfc_now);

        let summary_chars: String = result_str.chars().take(180).collect();
        let summary = if result_str.chars().count() > 180 {
            format!("{}…", summary_chars)
        } else {
            summary_chars
        };

        let inbox_title = format!("Relatório: {}", routine.titulo);
        let _ = self.db.create_inbox_item(
            Some(&session.id),
            &inbox_title,
            Some(&summary),
            &result_str,
            "pattern_synthesis",
            false,
        );

        if let Some(ref app) = *self.app_handle.read().unwrap() {
            let unread_count = self.db.get_unread_inbox_count().unwrap_or(0);
            let _ = app.emit("inbox-updated", json!({ "unread_count": unread_count }));
            let _ = app.emit(
                "routine-completed",
                json!({ "routine_id": routine.id, "title": routine.titulo }),
            );
        }

        println!(
            "[SKILL_RUNNER] Rotina '{}' concluída com sucesso!",
            routine.titulo
        );

        Ok(json!({
            "routine_id": routine.id,
            "session_id": session.id,
            "titulo": routine.titulo,
            "resposta": result_str
        }))
    }

    /// Avaliador simples de expressões cron padrão de 5 campos (minuto, hora, dia, mês, dia-da-semana)
    pub fn matches_cron(expr: &str, time: &chrono::DateTime<Local>) -> bool {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.len() != 5 {
            return false;
        }

        let minute = time.minute();
        let hour = time.hour();
        let day = time.day();
        let month = time.month();
        let weekday = time.weekday().num_days_from_sunday(); // 0 = Sunday

        Self::field_matches(parts[0], minute)
            && Self::field_matches(parts[1], hour)
            && Self::field_matches(parts[2], day)
            && Self::field_matches(parts[3], month)
            && Self::field_matches(parts[4], weekday)
    }

    fn field_matches(field: &str, current_val: u32) -> bool {
        let field = field.trim();
        if field == "*" {
            return true;
        }

        // Normaliza alias 7 => 0 para domingo
        let normalize_val = |v: u32| if v == 7 { 0 } else { v };
        let cur = normalize_val(current_val);

        // Lista: trata vírgulas recursivamente (suporta "1,3-5,7" etc.)
        if field.contains(',') {
            for part in field.split(',') {
                if Self::field_matches(part.trim(), cur) {
                    return true;
                }
            }
            return false;
        }

        // Passo com base: "*/5" ou "1-10/2" ou "2/3" (range/step)
        if field.contains('/') {
            let mut split = field.splitn(2, '/');
            let base = split.next().unwrap_or("").trim();
            let step_str = split.next().unwrap_or("").trim();
            if let Ok(step) = step_str.parse::<u32>() {
                if step == 0 {
                    return false;
                }
                if base == "*" || base.is_empty() {
                    return cur % step == 0;
                }
                if base.contains('-') {
                    let mut range_parts = base.splitn(2, '-');
                    let start_str = range_parts.next().unwrap_or("").trim();
                    let end_str = range_parts.next().unwrap_or("").trim();
                    if let (Ok(start), Ok(end)) = (start_str.parse::<u32>(), end_str.parse::<u32>())
                    {
                        let s = normalize_val(start);
                        let e = normalize_val(end);
                        if s <= e {
                            if cur < s || cur > e {
                                return false;
                            }
                            return (cur - s) % step == 0;
                        } else {
                            // Range invertido (ex: 5-1) não suportado, trata como false
                            return false;
                        }
                    }
                } else if let Ok(start) = base.parse::<u32>() {
                    let s = normalize_val(start);
                    if cur < s {
                        return false;
                    }
                    return (cur - s) % step == 0;
                }
            }
            return false;
        }

        // Range: "1-5"
        if field.contains('-') {
            let mut range_parts = field.splitn(2, '-');
            let start_str = range_parts.next().unwrap_or("").trim();
            let end_str = range_parts.next().unwrap_or("").trim();
            if let (Ok(start), Ok(end)) = (start_str.parse::<u32>(), end_str.parse::<u32>()) {
                let s = normalize_val(start);
                let e = normalize_val(end);
                if s <= e {
                    return cur >= s && cur <= e;
                } else {
                    // Para semana, permite wrap como 5-1 (sexta a segunda) mas simplifica para false
                    return false;
                }
            }
            return false;
        }

        // Valor exato (com alias 7)
        if let Ok(val) = field.parse::<u32>() {
            return normalize_val(val) == cur;
        }

        false
    }

    pub fn validate_cron(expr: &str) -> Result<(), String> {
        let parts: Vec<&str> = expr.trim().split_whitespace().collect();
        if parts.len() != 5 {
            return Err(
                "Expressão cron deve conter exatamente 5 campos (min hora dia mês dia_semana)"
                    .into(),
            );
        }
        // Valida cada campo com range de valores e sintaxe
        let ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)];
        for (idx, part) in parts.iter().enumerate() {
            if part.is_empty() {
                return Err(format!("Campo {} vazio", idx + 1));
            }
            // Checa caracteres permitidos
            if !part
                .chars()
                .all(|c| c.is_ascii_digit() || c == '*' || c == ',' || c == '-' || c == '/')
            {
                return Err(format!(
                    "Campo {} contém caracteres inválidos: '{}'",
                    idx + 1,
                    part
                ));
            }
            // Tenta validar cada elemento da lista
            for elem in part.split(',') {
                let elem = elem.trim();
                if elem.is_empty() {
                    return Err(format!("Campo {} tem elemento vazio", idx + 1));
                }
                if elem == "*" {
                    continue;
                }
                // Separa step
                let (base, step_opt) = if elem.contains('/') {
                    let mut sp = elem.splitn(2, '/');
                    (sp.next().unwrap_or(""), Some(sp.next().unwrap_or("")))
                } else {
                    (elem, None)
                };
                if let Some(step_str) = step_opt {
                    let step_str = step_str.trim();
                    if step_str.is_empty()
                        || step_str.parse::<u32>().map(|v| v == 0).unwrap_or(true)
                    {
                        return Err(format!("Passo inválido no campo {}: '{}'", idx + 1, elem));
                    }
                }
                let base = base.trim();
                if base == "*" || base.is_empty() {
                    continue;
                }
                if base.contains('-') {
                    let mut rp = base.splitn(2, '-');
                    let s = rp.next().unwrap_or("").trim();
                    let e = rp.next().unwrap_or("").trim();
                    let s_val: i32 = s
                        .parse()
                        .map_err(|_| format!("Valor inválido '{}' no campo {}", s, idx + 1))?;
                    let e_val: i32 = e
                        .parse()
                        .map_err(|_| format!("Valor inválido '{}' no campo {}", e, idx + 1))?;
                    let (min, max) = ranges[idx];
                    if s_val < min as i32
                        || s_val > max as i32
                        || e_val < min as i32
                        || e_val > max as i32
                    {
                        return Err(format!(
                            "Valores fora do intervalo {}-{} no campo {}: '{}'",
                            min,
                            max,
                            idx + 1,
                            elem
                        ));
                    }
                    if s_val > e_val {
                        return Err(format!("Range invertido no campo {}: '{}'", idx + 1, elem));
                    }
                } else {
                    let v: i32 = base
                        .parse()
                        .map_err(|_| format!("Valor inválido '{}' no campo {}", base, idx + 1))?;
                    let (min, max) = ranges[idx];
                    // Para dia da semana, 7 é alias para 0, permite 0-7
                    if v < min as i32 || v > max as i32 {
                        return Err(format!(
                            "Valor fora do intervalo {}-{} no campo {}: '{}'",
                            min,
                            max,
                            idx + 1,
                            base
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}
