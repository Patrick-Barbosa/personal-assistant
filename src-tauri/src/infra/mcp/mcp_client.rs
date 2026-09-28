use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

pub use crate::domain::models::{McpServerConfig, McpToolInfo};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum McpServerStatus {
    Starting,
    Ready,
    Error(String),
    Stopped,
}

struct McpProcessHandle {
    #[allow(dead_code)]
    config: McpServerConfig,
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout_reader: Arc<Mutex<BufReader<ChildStdout>>>,
    req_id: AtomicU64,
}

pub struct McpManager {
    servers: Arc<RwLock<HashMap<String, Arc<McpProcessHandle>>>>,
    statuses: Arc<RwLock<HashMap<String, McpServerStatus>>>,
    tools: Arc<RwLock<Vec<McpToolInfo>>>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            statuses: Arc::new(RwLock::new(HashMap::new())),
            tools: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Spawna e faz o handshake com um servidor MCP
    pub fn start_server(&self, config: McpServerConfig) -> Result<(), String> {
        let server_id = config.id.clone();
        // Validação básica
        if server_id.trim().is_empty()
            || server_id.contains("..")
            || server_id.contains('/')
            || server_id.contains('\\')
            || server_id.starts_with('.')
        {
            return Err(format!("ID de servidor MCP inválido: '{}'", server_id));
        }
        if config.command.trim().is_empty() {
            return Err("Comando do servidor MCP não pode ser vazio".into());
        }
        let forbidden = ["&", "|", ";", "`", "$", ">", "<", "\n", "\r"];
        for pat in forbidden {
            if config.command.contains(pat) || config.args.iter().any(|a| a.contains(pat)) {
                return Err(format!(
                    "Comando MCP contém caractere proibido: '{}' (possível injeção)",
                    pat
                ));
            }
        }
        // Evita vazamento de processo duplicado
        {
            let servers = self.servers.read().unwrap();
            if servers.contains_key(&server_id) {
                drop(servers);
                println!(
                    "[MCP] Servidor '{}' já existe, encerrando anterior antes de reiniciar",
                    server_id
                );
                let _ = self.stop_server(&server_id);
            }
        }
        println!(
            "[MCP] Iniciando servidor MCP '{}' (comando: {})...",
            server_id, config.command
        );

        {
            let mut statuses = self.statuses.write().unwrap();
            statuses.insert(server_id.clone(), McpServerStatus::Starting);
        }

        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        if let Some(ref dir) = config.working_dir {
            if dir.exists() {
                cmd.current_dir(dir);
            } else {
                eprintln!(
                    "[MCP WARN] working_dir não existe, ignorando: {}",
                    dir.display()
                );
            }
        }

        for (k, v) in &config.env {
            cmd.env(k, v);
        }
        // Evita vazamento de segredos para processos filhos não confiáveis
        cmd.env_remove("DEEPSEEK_API_KEY");
        cmd.env_remove("DEEPSEEK_BASE_URL");
        cmd.env_remove("DEEPSEEK_MODEL");
        cmd.env_remove("GROQ_API_KEY");
        cmd.env_remove("GROQ_MODEL");
        cmd.env_remove("GROQ_API_KEY");
        cmd.env_remove("DB_PATH");
        cmd.env_remove("VAULT_PATH");

        let mut child = cmd.spawn().map_err(|e| {
            let msg = format!("Falha ao spawnar processo MCP '{}': {}", server_id, e);
            eprintln!("[MCP ERROR] {}", msg);
            let mut statuses = self.statuses.write().unwrap();
            statuses.insert(server_id.clone(), McpServerStatus::Error(msg.clone()));
            msg
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Falha ao obter stdin do processo MCP".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Falha ao obter stdout do processo MCP".to_string())?;
        let stderr = child.stderr.take();

        // Drena stderr em thread separada para evitar deadlock do pipe
        if let Some(stderr) = stderr {
            let sid = server_id.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    // Limita tamanho do log para evitar spam
                    let truncated = if line.len() > 500 {
                        format!("{}…", &line[..500])
                    } else {
                        line
                    };
                    eprintln!("[MCP:{} stderr] {}", sid, truncated);
                }
            });
        }

        let stdin_arc = Arc::new(Mutex::new(stdin));
        let stdout_arc = Arc::new(Mutex::new(BufReader::new(stdout)));

        let handle = Arc::new(McpProcessHandle {
            config: config.clone(),
            child,
            stdin: stdin_arc,
            stdout_reader: stdout_arc,
            req_id: AtomicU64::new(1),
        });

        // 1. Handshake: initialize
        let init_id = handle.req_id.fetch_add(1, Ordering::SeqCst);
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": init_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "copernico",
                    "version": "0.2.0"
                }
            }
        });

        match Self::send_and_receive(&handle, &init_req, Duration::from_secs(10)) {
            Ok(init_resp) => {
                println!(
                    "[MCP] Servidor '{}' respondeu ao initialize: {:?}",
                    server_id,
                    init_resp.get("result")
                );
            }
            Err(e) => {
                eprintln!("[MCP WARN] Falha no handshake com '{}': {}", server_id, e);
                let mut statuses = self.statuses.write().unwrap();
                statuses.insert(server_id, McpServerStatus::Error(e.clone()));
                return Err(e);
            }
        }

        // 2. Notification: initialized
        let notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let _ = Self::send_notification(&handle, &notif);

        // 3. List tools
        let list_id = handle.req_id.fetch_add(1, Ordering::SeqCst);
        let list_req = json!({
            "jsonrpc": "2.0",
            "id": list_id,
            "method": "tools/list",
            "params": {}
        });

        let mut discovered_tools = Vec::new();
        if let Ok(tools_resp) = Self::send_and_receive(&handle, &list_req, Duration::from_secs(10))
        {
            if let Some(tool_list) = tools_resp
                .get("result")
                .and_then(|r| r.get("tools"))
                .and_then(|t| t.as_array())
            {
                for t in tool_list {
                    if let Some(name) = t.get("name").and_then(|n| n.as_str()) {
                        let desc = t
                            .get("description")
                            .and_then(|d| d.as_str())
                            .map(String::from);
                        let schema = t.get("inputSchema").cloned().unwrap_or(json!({
                            "type": "object",
                            "properties": {}
                        }));

                        discovered_tools.push(McpToolInfo {
                            name: name.to_string(),
                            description: desc,
                            input_schema: schema,
                            server_id: server_id.clone(),
                        });
                    }
                }
            }
        }

        println!(
            "[MCP] Servidor '{}' pronto! {} ferramentas descobertas.",
            server_id,
            discovered_tools.len()
        );

        {
            let mut servers = self.servers.write().unwrap();
            servers.insert(server_id.clone(), handle);
        }
        {
            let mut statuses = self.statuses.write().unwrap();
            statuses.insert(server_id.clone(), McpServerStatus::Ready);
        }
        {
            let mut tools = self.tools.write().unwrap();
            tools.retain(|t| t.server_id != server_id);
            tools.extend(discovered_tools);
        }

        Ok(())
    }

    /// Envia uma requisição JSON-RPC e espera pela resposta síncrona/bloqueante com timeout
    fn send_and_receive(
        handle: &Arc<McpProcessHandle>,
        req: &Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let req_str = serde_json::to_string(req).map_err(|e| e.to_string())?;

        {
            let mut stdin = handle
                .stdin
                .lock()
                .map_err(|_| "Falha ao bloquear stdin".to_string())?;
            writeln!(stdin, "{}", req_str)
                .map_err(|e| format!("Falha ao escrever no stdin: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Falha ao descarregar stdin: {}", e))?;
        }

        let expected_id = req.get("id").cloned();
        let stdout_reader = handle.stdout_reader.clone();

        // Executa leitura bloqueante em thread separada para permitir timeout
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = match stdout_reader.lock() {
                Ok(g) => g,
                Err(_) => {
                    let _ = tx.send(Err("Falha ao bloquear stdout".to_string()));
                    return;
                }
            };
            let mut line = String::new();
            let max_line_len = 1024 * 1024; // 1MB limite para evitar OOM
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        let _ =
                            tx.send(Err("Processo MCP fechou stdout inesperadamente".to_string()));
                        return;
                    }
                    Ok(_) => {
                        if line.len() > max_line_len {
                            let _ = tx.send(Err("Resposta MCP excede limite de 1MB".to_string()));
                            return;
                        }
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                            // Se a mensagem possui id correspondente ao request
                            if let Some(id) = parsed.get("id") {
                                if Some(id) == expected_id.as_ref() {
                                    if let Some(err) = parsed.get("error") {
                                        let _ = tx.send(Err(format!(
                                            "Erro retornado pelo servidor MCP: {}",
                                            err
                                        )));
                                    } else {
                                        let _ = tx.send(Ok(parsed));
                                    }
                                    return;
                                }
                            }
                            // Ignora notificações e respostas com id diferente, continua
                        } else {
                            // Linha não-JSON (ex: log do servidor) é ignorada, mas loga para debug
                            eprintln!(
                                "[MCP] Linha não-JSON ignorada: {}",
                                &trimmed[..trimmed.len().min(200)]
                            );
                            continue;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("Falha ao ler stdout: {}", e)));
                        return;
                    }
                }
            }
        });

        match rx.recv_timeout(timeout) {
            Ok(res) => res,
            Err(_) => Err(format!(
                "Timeout ({}s) aguardando resposta do servidor MCP",
                timeout.as_secs()
            )),
        }
    }

    /// Envia uma notificação JSON-RPC (sem esperar por resposta)
    fn send_notification(handle: &Arc<McpProcessHandle>, notif: &Value) -> Result<(), String> {
        let notif_str = serde_json::to_string(notif).map_err(|e| e.to_string())?;
        let mut stdin = handle
            .stdin
            .lock()
            .map_err(|_| "Falha ao bloquear stdin".to_string())?;
        writeln!(stdin, "{}", notif_str)
            .map_err(|e| format!("Falha ao escrever notificação: {}", e))?;
        let _ = stdin.flush();
        Ok(())
    }

    /// Executa uma ferramenta em um servidor MCP
    pub fn call_tool(&self, tool_name: &str, arguments: Value) -> Result<String, String> {
        Self::validate_tool_name(tool_name)?;
        // Localiza a ferramenta e o servidor correspondente
        let server_id = {
            let tools = self.tools.read().unwrap();
            tools
                .iter()
                .find(|t| t.name == tool_name)
                .map(|t| t.server_id.clone())
                .ok_or_else(|| format!("Ferramenta MCP '{}' não encontrada", tool_name))?
        };

        let handle = {
            let servers = self.servers.read().unwrap();
            servers
                .get(&server_id)
                .cloned()
                .ok_or_else(|| format!("Servidor MCP '{}' não está ativo", server_id))?
        };

        let call_id = handle.req_id.fetch_add(1, Ordering::SeqCst);
        let call_req = json!({
            "jsonrpc": "2.0",
            "id": call_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        });

        let resp = Self::send_and_receive(&handle, &call_req, Duration::from_secs(30))?;

        // Extrai resultado
        if let Some(result) = resp.get("result") {
            if let Some(content_array) = result.get("content").and_then(|c| c.as_array()) {
                let texts: Vec<String> = content_array
                    .iter()
                    .filter_map(|item| {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            item.get("text").and_then(|t| t.as_str()).map(String::from)
                        } else if item.get("type").and_then(|t| t.as_str()) == Some("image") {
                            Some("[Imagem recebida da ferramenta MCP]".to_string())
                        } else {
                            Some(item.to_string())
                        }
                    })
                    .collect();

                let output = texts.join("\n");
                return Ok(json!({
                    "ok": true,
                    "resultado": output,
                    "resumo": format!("Executou ferramenta MCP '{}'.", tool_name)
                })
                .to_string());
            }
            return Ok(result.to_string());
        }

        Err("Resposta do servidor MCP não conteve 'result'".to_string())
    }

    /// Retorna a lista de todas as ferramentas MCP convertidas para OpenAI Tool Format
    pub fn get_tool_definitions(&self) -> Vec<Value> {
        let tools = self.tools.read().unwrap();
        tools
            .iter()
            .map(|t| {
                // Valida e corrige schema: garante que tem "type": "object"
                let mut schema = t.input_schema.clone();
                if schema.get("type").is_none() {
                    if let Some(obj) = schema.as_object_mut() {
                        obj.insert("type".to_string(), json!("object"));
                    } else {
                        schema = json!({"type": "object", "properties": {}});
                    }
                }
                // Garante que properties existe
                if schema.get("properties").is_none() {
                    if let Some(obj) = schema.as_object_mut() {
                        obj.insert("properties".to_string(), json!({}));
                    }
                }
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description.clone().unwrap_or_else(|| format!("Ferramenta MCP do servidor {}", t.server_id)),
                        "parameters": schema
                    }
                })
            })
            .collect()
    }

    /// Lista todos os servidores e seus status atuais
    pub fn get_servers_status(&self) -> Vec<Value> {
        let statuses = self.statuses.read().unwrap();
        let tools = self.tools.read().unwrap();

        statuses
            .iter()
            .map(|(id, status)| {
                let tool_count = tools.iter().filter(|t| &t.server_id == id).count();
                let status_str = match status {
                    McpServerStatus::Starting => "starting",
                    McpServerStatus::Ready => "ready",
                    McpServerStatus::Error(_) => "error",
                    McpServerStatus::Stopped => "stopped",
                };
                let err_msg = match status {
                    McpServerStatus::Error(msg) => Some(msg.clone()),
                    _ => None,
                };
                json!({
                    "id": id,
                    "status": status_str,
                    "tool_count": tool_count,
                    "error": err_msg
                })
            })
            .collect()
    }

    /// Encerra um servidor específico
    pub fn stop_server(&self, id: &str) -> Result<(), String> {
        let handle = {
            let mut servers = self.servers.write().unwrap();
            servers.remove(id)
        };
        if let Some(mut handle) = handle {
            // Arc::try_unwrap para obter Child mutável; se ainda há referências, apenas marca como Stopped
            if let Some(h) = Arc::get_mut(&mut handle) {
                let _ = h.child.kill();
                let _ = h.child.wait();
                println!("[MCP] Servidor '{}' encerrado", id);
            } else {
                // Ainda há handles em uso (handshake em progresso), apenas envia kill via Drop
                println!(
                    "[MCP] Servidor '{}' marcado para encerramento (handles em uso)",
                    id
                );
            }
            {
                let mut statuses = self.statuses.write().unwrap();
                statuses.insert(id.to_string(), McpServerStatus::Stopped);
            }
            {
                let mut tools = self.tools.write().unwrap();
                tools.retain(|t| t.server_id != id);
            }
            Ok(())
        } else {
            Err(format!("Servidor '{}' não encontrado", id))
        }
    }

    /// Encerra todos os servidores
    pub fn stop_all(&self) {
        let ids: Vec<String> = {
            let servers = self.servers.read().unwrap();
            servers.keys().cloned().collect()
        };
        for id in ids {
            let _ = self.stop_server(&id);
        }
    }

    /// Valida se o id de tool é seguro e se o servidor está ativo
    fn validate_tool_name(name: &str) -> Result<(), String> {
        if name.trim().is_empty() || name.contains(' ') || name.contains('/') || name.contains("..")
        {
            return Err(format!("Nome de ferramenta inválido: '{}'", name));
        }
        Ok(())
    }
}

impl Drop for McpProcessHandle {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
