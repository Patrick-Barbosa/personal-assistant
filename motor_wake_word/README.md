# Motores de Inferência Wake-Word (Rust)

Este diretório contém a implementação completa, em **Rust puro** e sem dependências externas de C++ ou Python, dos motores de inferência para as palavras de ativação treinadas (`copernico.onnx` e `lich.onnx`).

O motor utiliza a crate oficial [`livekit-wakeword`](https://crates.io/crates/livekit-wakeword) e sua engine de execução ONNX (`ort-tract`), proporcionando portabilidade total, baixíssima latência e consumo mínimo de CPU.

---

## 🏗️ Arquitetura dos Motores

```
inferencia/
├── Cargo.toml
├── README.md
├── copernico.onnx             # Modelo ONNX ativo
├── lich.onnx                  # Modelo ONNX ativo
└── src/
    ├── lib.rs                 # Ponto de entrada da biblioteca e re-exportações
    ├── error.rs               # Enum de erros (WakeWordError) com thiserror
    ├── engine.rs              # Motor síncrono com janela deslizante (2s) e debouncing
    ├── wav_engine.rs          # Leitor/processador de arquivos .wav (hound)
    ├── mic_engine.rs          # Captura contínua de microfone multiplataforma (cpal)
    ├── worker.rs              # Worker thread desacoplado com canais MPSC
    └── bin/
        ├── cli_wav.rs         # CLI para análise de arquivos WAV
        ├── cli_mic.rs         # CLI para escuta ao vivo pelo microfone
        └── server_template.rs # Template de servidor IPC/Sidecar via JSON Lines (STDIN/STDOUT)
```

---

## 🚀 Como Executar os Motores Imediatamente

### 1. Teste em Arquivo de Áudio (`cli_wav`)

Analisa um arquivo `.wav` gravado, executando streaming em chunks simulados de 100ms e detectando ativações com timestamp:

```bash
# Testa o áudio de exemplo gravado
cargo run --bin cli_wav

# Ou informe qualquer arquivo WAV:
cargo run --bin cli_wav -- ../treinamento/2_coleta_dados/dados/positivos/lich/positivo_0001.wav
```

### 2. Escuta ao Vivo no Microfone (`cli_mic`)

Conecta ao microfone padrão do sistema e escuta em tempo real. Sempre que disser **"Copérnico"** ou **"Lich"**, dispara o alerta:

```bash
cargo run --bin cli_mic
```

### 3. Servidor / Sidecar IPC (`server_template`)

Inicia um processo servidor leve que lê comandos JSON de `STDIN` e emite eventos JSON em `STDOUT`:

```bash
cargo run --bin server_template
```

Exemplo de comandos JSON aceitos:
* `{"cmd": "ping"}` -> Responde: `{"type": "pong"}`
* `{"cmd": "feed_pcm", "samples": [0, 100, -50, ...]}` -> Envia amostras de áudio i16
* `{"cmd": "feed_b64", "data": "<base64_encoded_pcm_bytes>"}` -> Envia áudio em Base64
* `{"cmd": "set_threshold", "threshold": 0.60}` -> Atualiza sensibilidade
* `{"cmd": "status"}` -> Retorna status de execução

Exemplo de evento emitido pelo servidor:
```json
{"type":"detection","keyword":"copernico","score":0.985,"timestamp_ms":1725470000000}
```

---

## 🔌 Guia de Incorporação para Outros Agentes e Projetos

Se você é outro agente ou desenvolvedor construindo um novo projeto (ex: backend Tokio/Axum, aplicativo Tauri/Desktop, microsserviço ou agente autônomo), escolha uma das 3 abordagens abaixo:

### Abordagem A: Como Dependência Rust Direta (Crate Local)

No `Cargo.toml` do seu projeto:

```toml
[dependencies]
inferencia = { path = "../caminho/para/inferencia" }
```

No seu código Rust:

```rust
use inferencia::{WakeWordEngine, EngineConfig};

// 1. Inicializa o motor com os modelos ONNX
let mut engine = WakeWordEngine::new(&["copernico.onnx", "lich.onnx"], 16000)?;

// 2. Alimenta chunks de áudio PCM (ex: 100ms = 1600 amostras i16)
let events = engine.process_audio(&pcm_chunk)?;

for ev in events {
    println!("Wake word ativada: {} (score: {:.2})", ev.keyword, ev.score);
}
```

---

### Abordagem B: Como Worker em Thread Assíncrona (Tokio / Axum / WebSocket)

Use o struct `WakeWordWorker` para não bloquear o runtime assíncrono:

```rust
use inferencia::{WakeWordWorker, EngineConfig};
use std::path::PathBuf;

// Cria o worker em uma thread nativa dedicada
let worker = WakeWordWorker::spawn(
    vec![PathBuf::from("copernico.onnx"), PathBuf::from("lich.onnx")],
    EngineConfig::default()
)?;

// O seu handler de WebSocket / áudio envia chunks sem travar a async thread:
worker.send_audio(pcm_chunk)?;

// Em outro loop ou task, consome os eventos disparados:
if let Some(event) = worker.try_recv_event() {
    println!("Palavra detectada: {}", event.keyword);
}
```

---

### Abordagem C: Como Processo Sidecar (Node.js, Python, Electron, Go)

Basta compilar o binário uma única vez em release:

```bash
cargo build --release --bin server_template
```

O binário final estará em `target/release/server_template.exe`. 
O seu projeto pai só precisa iniciar este executável como um subprocesso filho, escrever linhas JSON no seu `stdin` e ler os eventos no seu `stdout`. Nenhuma ferramenta de Rust precisa estar instalada na máquina de produção depois de compilado.

---

## 🧪 Testes Automatizados

Todos os módulos possuem testes unitários e de integração validando os modelos ONNX:

```bash
cargo test
```
