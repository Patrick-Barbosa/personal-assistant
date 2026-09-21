# AGENTS.md — AI Infrastructure (`src-tauri/src/infra/ai/`)

Documentação especializada e constituição local para os clientes e adaptadores de Inteligência Artificial do Copernico.

## 1. Escopo e Responsabilidade
Este módulo implementa a comunicação com modelos locais e na nuvem para raciocínio, transcrição, síntese e vetorização:
- `deepseek.rs`: Cliente DeepSeek compatível com OpenAI API (`LlmProvider`), com suporte a tool calling, streaming e geração de títulos.
- `fastembed.rs`: Modelo ONNX local via FastEmbed (`EmbeddingProvider`, 384 dimensões via `ParaphraseMLMiniLML12V2` com fallback para `AllMiniLML6V2`).
- `groq_stt.rs`: Transcrição de voz ultra-rápida via Groq Whisper API (`SttProvider`).
- `edge_tts.rs`: Síntese de voz neural via Microsoft Edge TTS (`TtsProvider`), chunking de fala e reprodução via `rodio`.

## 2. Regras Obrigatórias
1. **Implementação de Contratos de Domínio**:
   - Cada cliente deve implementar rigorosamente as traits definidas em `domain::traits::providers` (`LlmProvider`, `SttProvider`, `TtsProvider`, `EmbeddingProvider`).
2. **FastEmbed (Local CPU)**:
   - Vetores gerados devem ter estritamente 384 dimensões.
   - Execução 100% offline em CPU via ONNX Runtime; trate erros de cache ou download sem travar o processo principal.
3. **DeepSeek (OpenAI-Compatible)**:
   - Deve suportar Tool Calling estruturado (JSON Schema de funções) e streaming de tokens.
   - Respeite rate limits e timeouts com tratamento de `ProviderError::RateLimit` e retries transparentes.
4. **Edge-TTS e Sanitização de Áudio**:
   - **OBRIGATÓRIO**: Qualquer texto enviado para síntese de voz DEVE passar por sanitização via `strip_markdown_for_tts()` antes da sintetização.
   - Símbolos de markdown (`*`, `#`, `_`, ``` ` ```, links `[[...]]`, URLs, tabelas) não podem ser pronunciados em voz alta.

## 3. Anti-padrões
- **NUNCA** introduza frameworks pesados de orquestração de IA (proibido LangChain, LlamaIndex, ChromaDB ou servidores Python paralelos).
- **NUNCA** envie markdown bruto para o motor TTS sem sanitização prévia.
- **NUNCA** ignore erros de rede em chamadas remotas de API (Groq/DeepSeek); mapeie para `ProviderError::Network` ou `ProviderError::Auth`.
- **NUNCA** altere a dimensão do vetor FastEmbed (384 dims) sem atualizar e migrar as tabelas de embedding no SQLite.
