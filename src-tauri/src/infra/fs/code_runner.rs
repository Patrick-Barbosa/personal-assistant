use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use tempfile::NamedTempFile;

fn get_python_binary() -> &'static str {
    if Command::new("python").arg("--version").output().is_ok() {
        "python"
    } else {
        "python3"
    }
}

/// Executa um script Python associado a uma skill instalada
pub fn execute_skill_script(
    skills_dir: &Path,
    skill_id: &str,
    script_name: &str,
    args: &[String],
) -> Result<String, String> {
    // Validação defensiva contra Path Traversal
    if skill_id.contains("..")
        || script_name.contains("..")
        || skill_id.contains('/')
        || skill_id.contains('\\')
    {
        return Err(
            "Identificador de skill ou script inválido (Path Traversal não permitido)".into(),
        );
    }

    let skill_folder = skills_dir.join(skill_id);
    if !skill_folder.exists() {
        return Err(format!(
            "Skill '{}' não encontrada em {:?}",
            skill_id, skills_dir
        ));
    }

    // Tenta primeiro em scripts/<script_name>, depois na raiz da skill <script_name>
    let mut script_path = skill_folder.join("scripts").join(script_name);
    if !script_path.exists() {
        script_path = skill_folder.join(script_name);
    }

    if !script_path.exists() {
        return Err(format!(
            "Script '{}' não encontrado na skill '{}'",
            script_name, skill_id
        ));
    }

    println!(
        "[CODE_RUNNER] Executando script: {:?} com {} argumentos...",
        script_path,
        args.len()
    );

    let py_bin = get_python_binary();
    let mut cmd = Command::new(py_bin);
    cmd.arg(&script_path);
    for arg in args {
        cmd.arg(arg);
    }

    cmd.current_dir(&skill_folder);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Falha ao invocar Python: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "Falha na execução do script (código {}):\nSTDOUT: {}\nSTDERR: {}",
            output.status.code().unwrap_or(-1),
            stdout.trim(),
            stderr.trim()
        ));
    }

    Ok(stdout)
}

/// Executa um trecho dinâmico de código Python no sistema
pub fn execute_python_code(code: &str) -> Result<String, String> {
    let clean_code = code.trim();
    if clean_code.is_empty() {
        return Err("Código Python não pode ser vazio".into());
    }

    // Cria arquivo temporário
    let mut temp_file =
        NamedTempFile::new().map_err(|e| format!("Falha ao criar arquivo temporário: {}", e))?;

    // Assegura encoding UTF-8 no topo do script
    let full_script = format!(
        "# -*- coding: utf-8 -*-\nimport sys\nif sys.platform == 'win32':\n    try:\n        sys.stdout.reconfigure(encoding='utf-8')\n        sys.stderr.reconfigure(encoding='utf-8')\n    except Exception:\n        pass\n\n{}\n",
        clean_code
    );

    temp_file
        .write_all(full_script.as_bytes())
        .map_err(|e| format!("Falha ao escrever código temporário: {}", e))?;
    let temp_path = temp_file.path().to_path_buf();

    println!(
        "[CODE_RUNNER] Executando trecho Python dinâmico ({:?})...",
        temp_path
    );

    let py_bin = get_python_binary();
    let mut cmd = Command::new(py_bin);
    cmd.arg(&temp_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Falha ao executar Python: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "Erro de execução Python (código {}):\n{}",
            output.status.code().unwrap_or(-1),
            if !stderr.trim().is_empty() {
                stderr.trim()
            } else {
                stdout.trim()
            }
        ));
    }

    Ok(stdout)
}
