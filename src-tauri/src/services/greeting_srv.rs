use crate::db::Database;
use crate::tts::EdgeTtsClient;
use chrono::{DateTime, Local};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub use crate::domain::models::{GreetingItem, GreetingKind};

pub const TOTAL_GREETINGS: usize = 18;
pub const MIN_GENERIC: usize = 18;
pub const CONTEXTUAL_TTL_HOURS: i64 = 48;

pub struct GreetingsManager {
    dir: PathBuf,
}

pub type SharedGreetingsManager = Arc<GreetingsManager>;

impl GreetingsManager {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn manifest_path(&self) -> PathBuf {
        self.dir.join("manifest.json")
    }

    pub fn load(&self) -> Vec<GreetingItem> {
        let p = self.manifest_path();
        if !p.exists() {
            return Vec::new();
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(list) = serde_json::from_str::<Vec<GreetingItem>>(&content) {
                return list
                    .into_iter()
                    .filter(|g| self.dir.join(&g.file).exists())
                    .collect();
            }
        }
        Vec::new()
    }

    fn save(&self, list: &[GreetingItem]) {
        if let Ok(json) = serde_json::to_string_pretty(list) {
            let _ = std::fs::write(self.manifest_path(), json);
        }
    }

    /// Remove contextuais com mais de 48h (TTL) + arquivos. Retorna quantos removeu.
    pub fn prune_expired(&self) -> usize {
        let mut list = self.load();
        let now = Local::now();
        let before = list.len();
        let mut to_delete_files = Vec::new();
        list.retain(|g| {
            if g.kind != GreetingKind::Contextual {
                return true;
            }
            let created = parse_time(&g.created_at).unwrap_or(now);
            let age_h = (now - created).num_hours();
            if age_h > CONTEXTUAL_TTL_HOURS {
                to_delete_files.push(g.file.clone());
                false
            } else {
                true
            }
        });
        for f in to_delete_files {
            let _ = std::fs::remove_file(self.dir.join(f));
        }
        if list.len() != before {
            self.save(&list);
        }
        before - list.len()
    }
}

fn parse_time(s: &str) -> Option<DateTime<Local>> {
    if let Ok(dt) = s.parse::<DateTime<Local>>() {
        return Some(dt);
    }
    if let Ok(dt) = s.parse::<DateTime<chrono::Utc>>() {
        return Some(dt.with_timezone(&Local));
    }
    None
}

fn user_display_name(db: &Database) -> String {
    db.get_setting("user_name")
        .ok()
        .flatten()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn tts_voice(db: &Database, tts: &EdgeTtsClient) -> String {
    db.get_setting("tts_voice")
        .ok()
        .flatten()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| tts.get_voice())
}

fn generic_templates(name: &str) -> Vec<String> {
    let n = name.trim();
    let hi = if n.is_empty() {
        "Oi".to_string()
    } else {
        format!("Oi {}", n)
    };
    let fala = if n.is_empty() {
        "pode falar".to_string()
    } else {
        format!("fala {}", n)
    };
    let nome_ou_vc = if n.is_empty() {
        "você".to_string()
    } else {
        n.to_string()
    };
    vec![
        format!("{}, estou te ouvindo. Do que precisa hoje?", hi),
        format!("{}, pode falar, estou aqui.", capitalize(&fala)),
        format!("{}, estou aqui. O que você precisa?", hi),
        if n.is_empty() {
            "Te ouço. Manda ver.".to_string()
        } else {
            format!("{}, te ouço. Manda ver.", n)
        },
        format!("{}, pronto para ajudar. Por onde começamos?", hi),
        format!(
            "Olá {}, estou te ouvindo com atenção.",
            if n.is_empty() {
                "tudo bem?".to_string()
            } else {
                n.to_string()
            }
        ),
        format!("{}, estou por aqui. O que vamos resolver?", hi),
        format!(
            "Pode falar {}, estou te ouvindo.",
            if n.is_empty() {
                "à vontade".to_string()
            } else {
                n.to_string()
            }
        ),
        format!("{}, fala que eu te escuto. O que precisa?", hi),
        format!("Opa {}, estou na escuta. Manda aí.", nome_ou_vc),
        format!("{}, pronto. O que você quer fazer agora?", hi),
        format!("Diga {}, estou te ouvindo.", nome_ou_vc),
        format!("{}, bora lá. No que posso ajudar?", hi),
        format!("Estou aqui {}. Pode falar sem pressa.", nome_ou_vc),
        format!("{}, te escuto. Qual é a missão de agora?", hi),
        format!("Fala {}, o que vamos fazer juntos hoje?", nome_ou_vc),
        format!("{}, estou ligado e te ouvindo. Qual o plano?", hi),
        format!("Oi {}, conta comigo. O que precisa?", nome_ou_vc),
    ]
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

async fn synthesize_to_file(
    tts: &EdgeTtsClient,
    text: &str,
    voice: &str,
    dest: &Path,
) -> Result<(), String> {
    let bytes = tts
        .synthesize(text, Some(voice))
        .await
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("TTS retornou áudio vazio".into());
    }
    std::fs::write(dest, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

impl GreetingsManager {
    /// Garante o acervo de saudações genéricas no startup (chamado em background).
    /// Só genéricas: completa até 18 variações com o nome do usuário e remove de uma
    /// vez os arquivos contextuais/sugestão legados (era da saudação complexa).
    pub async fn ensure_at_startup(
        &self,
        tts: &EdgeTtsClient,
        db: &Database,
    ) -> Result<String, String> {
        self.prune_expired();
        let mut list = self.load();
        // Migração única: descarta contextuais/sugestões legados (com arquivos).
        let before = list.len();
        let mut legacy_files = Vec::new();
        list.retain(|g| {
            if g.kind != GreetingKind::Generic {
                legacy_files.push(g.file.clone());
                false
            } else {
                true
            }
        });
        for f in legacy_files {
            let _ = std::fs::remove_file(self.dir.join(f));
        }
        if list.len() != before {
            println!(
                "[GREETINGS] Migração: removidas {} saudações legadas (contextual/sugestão).",
                before - list.len()
            );
        }

        let name = user_display_name(db);
        let voice = tts_voice(db, tts);
        let mut g_count = list
            .iter()
            .filter(|g| g.kind == GreetingKind::Generic)
            .count();

        // Completa genéricos até 18
        if g_count < MIN_GENERIC {
            for text in generic_templates(&name) {
                if g_count >= MIN_GENERIC {
                    break;
                }
                if list.iter().any(|g| g.text == text) {
                    continue;
                }
                let id = format!("gen_{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
                let file = format!("{}.mp3", id);
                let dest = self.dir.join(&file);
                match synthesize_to_file(tts, &text, &voice, &dest).await {
                    Ok(_) => {
                        list.push(GreetingItem {
                            id,
                            kind: GreetingKind::Generic,
                            topic: None,
                            text,
                            file,
                            created_at: chrono::Local::now().to_rfc3339(),
                            last_used: None,
                            ref_time: None,
                        });
                        g_count += 1;
                    }
                    Err(e) => {
                        eprintln!("[GREETINGS] Falha ao sintetizar genérico: {}", e);
                        break;
                    }
                }
            }
        }

        self.save(&list);
        Ok(format!(
            "Saudações prontas: total={} (genéricas)",
            list.len()
        ))
    }

    /// Sorteio simples entre genéricas, sem repetir a última. Retorna item + marca uso.
    pub fn pick_greeting(&self, db: &Database) -> Option<GreetingItem> {
        let mut list = self.load();
        if list.is_empty() {
            return None;
        }
        // Só genéricas com arquivo existente
        list.retain(|g| g.kind == GreetingKind::Generic && self.dir.join(&g.file).exists());
        if list.is_empty() {
            return None;
        }
        let now = Local::now();
        let last_id = db
            .get_setting("last_greeting_id")
            .ok()
            .flatten()
            .unwrap_or_default();
        let mut candidates: Vec<GreetingItem> =
            list.into_iter().filter(|g| g.id != last_id).collect();
        if candidates.is_empty() {
            // Só havia 1 e era a última → permite repetir
            candidates = self
                .load()
                .into_iter()
                .filter(|g| g.kind == GreetingKind::Generic)
                .collect();
        }
        if candidates.is_empty() {
            return None;
        }
        // Pseudo-random sem dependência extra
        let idx = (chrono::Local::now().timestamp_millis() as usize) % candidates.len();
        let picked = candidates[idx].clone();

        // Marca uso + salva contexto anti-repetição para o agente
        let mut full = self.load();
        if let Some(entry) = full.iter_mut().find(|g| g.id == picked.id) {
            entry.last_used = Some(now.to_rfc3339());
        }
        self.save(&full);
        let _ = db.set_setting("last_greeting_id", &picked.id);
        let _ = db.set_setting("last_greeting_text", &picked.text);
        let _ = db.set_setting("last_greeting_at", &now.to_rfc3339());

        Some(picked)
    }

    /// Limpeza barata pós-sessão: expira contextuais antigas (legado) e pronto.
    /// Saudações agora são só genéricas; nada é sintetizado aqui.
    pub fn cleanup_after_session(&self) -> String {
        let pruned = self.prune_expired();
        format!("limpeza pós-sessão ok ({} expirada(s) removida(s))", pruned)
    }
}

/// Toca arquivo mp3 local de forma bloqueante (chamar em thread separada).
pub fn play_file_blocking(path: &Path) -> Result<(), String> {
    use rodio::{Decoder, OutputStream, Sink};
    use std::fs::File;
    use std::io::BufReader;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let (_stream, handle) = OutputStream::try_default().map_err(|e| e.to_string())?;
    let sink = Sink::try_new(&handle).map_err(|e| e.to_string())?;
    let source = Decoder::new(BufReader::new(file)).map_err(|e| e.to_string())?;
    sink.append(source);
    sink.sleep_until_end();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generic_templates_pool() {
        let with_name = generic_templates("Patrick");
        assert_eq!(with_name.len(), 18);
        // Todas falam o nome e não têm formatação (TTS puro)
        for t in &with_name {
            assert!(t.contains("Patrick"), "template sem nome: {}", t);
            for forbidden in ["**", "#", "- ", "•", "|", ">", "```"] {
                assert!(
                    !t.contains(forbidden),
                    "formatação em '{}': {}",
                    t,
                    forbidden
                );
            }
        }
        // Sem nome: nenhuma deve conter placeholder vazio/duplo espaço
        for t in generic_templates("") {
            assert!(!t.contains("  "), "espaço duplo em '{}'", t);
        }
        // Variedade real: pelo menos 15 textos distintos
        let unique: std::collections::HashSet<&str> =
            with_name.iter().map(|s| s.as_str()).collect();
        assert!(unique.len() >= 15);
    }
}
