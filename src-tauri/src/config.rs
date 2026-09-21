use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub vault_path: PathBuf,
    pub obsidian_vault_path: PathBuf,
    pub db_path: PathBuf,
    pub deepseek_api_key: String,
    pub deepseek_base_url: String,
    pub deepseek_model: String,
    pub hotkey: String,
    pub groq_api_key: String,
    pub groq_model: String,
    pub wake_word_models_dir: PathBuf,
    pub plugins_path: PathBuf,
    pub skills_path: PathBuf,
    pub greetings_path: PathBuf,
    pub thinking_audios_path: PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Self {
        // Tenta carregar .env de múltiplos locais candidatos
        let _ = dotenvy::dotenv();
        if let Ok(cwd) = std::env::current_dir() {
            if let Some(parent) = cwd.parent() {
                let p = parent.join(".env");
                if p.exists() {
                    let _ = dotenvy::from_path(&p);
                }
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let p = exe_dir.join(".env");
                if p.exists() {
                    let _ = dotenvy::from_path(&p);
                }
                // também sobe até o pai do exe dir (target/debug -> src-tauri -> copernico-app)
                if let Some(grandparent) = exe_dir.parent().and_then(|p| p.parent()) {
                    let gp = grandparent.join(".env");
                    if gp.exists() {
                        let _ = dotenvy::from_path(&gp);
                    }
                }
            }
        }

        // Localiza a raiz do projeto (nunca aceita src-tauri como raiz para evitar loop de file watcher)
        let mut root = PathBuf::from(".");
        if let Ok(cwd) = std::env::current_dir() {
            if cwd.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
                if let Some(parent) = cwd.parent() {
                    root = parent.to_path_buf();
                }
            } else if cwd.join("src-tauri").exists() && cwd.join("cofres").exists() {
                root = cwd;
            } else if let Some(parent) = cwd.parent() {
                if parent.join("src-tauri").exists() && parent.join("cofres").exists() {
                    root = parent.to_path_buf();
                }
            }
        }
        if !root.join("cofres").exists() {
            if let Ok(exe) = std::env::current_exe() {
                let mut cur = exe.parent();
                while let Some(p) = cur {
                    if p.join("cofres").exists()
                        && (p.join("src-tauri").exists() || p.join("package.json").exists())
                    {
                        root = p.to_path_buf();
                        break;
                    }
                    cur = p.parent();
                }
            }
        }

        println!("[CONFIG] vault root={}", root.display());

        let resolve_path = |val: Option<String>, default_rel: &str| -> PathBuf {
            if let Some(s) = val {
                let p = PathBuf::from(s.trim());
                if p.is_absolute() {
                    p
                } else {
                    root.join(&p)
                }
            } else {
                root.join(default_rel)
            }
        };

        let vault_path = resolve_path(std::env::var("VAULT_PATH").ok(), "cofres/default");
        let obsidian_vault_path =
            resolve_path(std::env::var("OBSIDIAN_VAULT_PATH").ok(), "cofres/obsidian");
        let db_path = resolve_path(std::env::var("DB_PATH").ok(), "cofres/cache.db");

        let deepseek_api_key = std::env::var("DEEPSEEK_API_KEY")
            .unwrap_or_default()
            .trim()
            .to_string();

        let deepseek_base_url = std::env::var("DEEPSEEK_BASE_URL")
            .unwrap_or_else(|_| "https://api.deepseek.com".to_string())
            .trim()
            .to_string();

        let deepseek_model = std::env::var("DEEPSEEK_MODEL")
            .unwrap_or_else(|_| "DeepSeek-V4.1-Flash".to_string())
            .trim()
            .to_string();

        let hotkey = std::env::var("HOTKEY")
            .unwrap_or_else(|_| "ctrl+space".to_string())
            .trim()
            .to_lowercase();

        let groq_api_key = std::env::var("GROQ_API_KEY")
            .unwrap_or_default()
            .trim()
            .to_string();

        let groq_model = std::env::var("GROQ_MODEL")
            .unwrap_or_else(|_| "whisper-large-v3-turbo".to_string())
            .trim()
            .to_string();

        let wake_word_models_dir = resolve_path(
            std::env::var("WAKE_WORD_MODELS_DIR").ok(),
            "motor_wake_word",
        );
        let plugins_path = resolve_path(std::env::var("PLUGINS_PATH").ok(), "plugins");
        let skills_path = resolve_path(std::env::var("SKILLS_PATH").ok(), "skills");
        let greetings_path = resolve_path(std::env::var("GREETINGS_PATH").ok(), "cofres/greetings");
        let thinking_audios_path = resolve_path(
            std::env::var("THINKING_AUDIOS_PATH").ok(),
            "cofres/thinking_audios",
        );

        Self {
            vault_path,
            obsidian_vault_path,
            db_path,
            deepseek_api_key,
            deepseek_base_url,
            deepseek_model,
            hotkey,
            groq_api_key,
            groq_model,
            wake_word_models_dir,
            plugins_path,
            skills_path,
            greetings_path,
            thinking_audios_path,
        }
    }
}

pub type SharedConfig = Arc<AppConfig>;
