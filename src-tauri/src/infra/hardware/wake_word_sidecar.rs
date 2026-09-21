use serde::Deserialize;
use serde_json::json;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarMessage {
    Ready {
        sample_rate: u32,
        threshold: Option<f32>,
    },
    DebugScores {
        copernico: f32,
        #[serde(default)]
        zefiro: Option<f32>,
        #[serde(default)]
        lich: Option<f32>,
        rms: f32,
        threshold: f32,
    },
    Start {
        score: f32,
    },
    Stop {
        score: f32,
        wav_base64: String,
    },
    Cancel {
        reason: String,
    },
    Error {
        message: String,
    },
}

pub struct WakeWordSidecarProcess {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

impl WakeWordSidecarProcess {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
        }
    }

    pub fn find_binary(models_dir: &Path) -> Option<PathBuf> {
        let direct_exe = models_dir.join("motor_wake_word.exe");
        if direct_exe.exists() {
            return Some(direct_exe);
        }

        let target_release = models_dir
            .join("target")
            .join("release")
            .join("motor_wake_word.exe");
        if target_release.exists() {
            return Some(target_release);
        }

        let target_debug = models_dir
            .join("target")
            .join("debug")
            .join("motor_wake_word.exe");
        if target_debug.exists() {
            return Some(target_debug);
        }

        None
    }

    pub fn spawn(
        &self,
        binary_path: &Path,
        models_dir: &Path,
    ) -> Result<BufReader<std::process::ChildStdout>, std::io::Error> {
        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new(binary_path);
        cmd.arg("--models-dir")
            .arg(models_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::Other, "Failed to capture stdout")
        })?;
        let stdin = child.stdin.take();

        if let Ok(mut lock) = self.stdin.lock() {
            *lock = stdin;
        }
        if let Ok(mut lock) = self.child.lock() {
            *lock = Some(child);
        }

        Ok(BufReader::new(stdout))
    }

    pub fn send_command(&self, cmd_json: &serde_json::Value) {
        if let Ok(mut lock) = self.stdin.lock() {
            if let Some(ref mut stdin) = *lock {
                let _ = writeln!(stdin, "{}", cmd_json);
                let _ = stdin.flush();
            }
        }
    }

    pub fn set_threshold(&self, threshold: f32) {
        self.send_command(&json!({
            "cmd": "set_threshold",
            "threshold": threshold
        }));
    }

    pub fn set_detection_active(&self, active: bool) {
        self.send_command(&json!({
            "cmd": "set_detection_active",
            "active": active
        }));
    }

    pub fn cancel(&self) {
        self.send_command(&json!({
            "cmd": "cancel"
        }));
    }

    pub fn start_followup(&self, timeout_secs: f32) {
        self.send_command(&json!({
            "cmd": "start_followup",
            "timeout_secs": timeout_secs
        }));
    }

    pub fn kill(&self) {
        if let Ok(mut lock) = self.stdin.lock() {
            let _ = lock.take();
        }
        if let Ok(mut lock) = self.child.lock() {
            if let Some(mut child) = lock.take() {
                let _ = child.kill();
            }
        }
    }
}

impl Default for WakeWordSidecarProcess {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WakeWordSidecarProcess {
    fn drop(&mut self) {
        self.kill();
    }
}
