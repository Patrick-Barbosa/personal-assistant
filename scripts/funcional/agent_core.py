"""AgentCore — Sprint 03: Motor agêntico com Tool Calling + Groq STT.

DeepSeek (openai SDK) com loop de ferramentas e transcrição via Groq Whisper.
Respeita AGENT_RULES: import raiz, type hints, pathlib+env, sem frameworks pesados.
"""

from __future__ import annotations

import json
import os
import tempfile
import warnings
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv

from scripts.funcional.indexer import MultiVaultIndexer, ObsidianIndexer, VaultIndexer
from scripts.funcional.vault import VaultManager

warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    message=r"The model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2.*",
)

load_dotenv()


_SYSTEM_PROMPT: str = """Você é o Second Brain — assistente pessoal local do usuário.

Você tem acesso a DOIS cofres de conhecimento:
1. **Cofre padrão** (cofres/default) — gravável. Notas criadas/editadas pelo agente ficam aqui.
2. **Cofre Obsidian** (cofres/obsidian) — somente leitura. Contém todo o conhecimento pessoal do usuário: diário, gastronomia, projetos, listas, livros, filmes, reflexões, etc.

Regras de decisão (RN01):
- Consulta/pergunta sobre cofre: use buscar_notas e/ou ler_nota, responda diretamente no chat SEM criar arquivos.
  - Os resultados trazem um campo "vault": "obsidian" ou "default". Cite a fonte (titulo + vault + score).
- Criação: quando usuário pede explicitamente para salvar/registrar/anotar, use salvar_nota (grava APENAS no cofre padrão).
- Atualização: quando pede para adicionar/editar nota existente, use atualizar_nota (somente cofre padrão).
- Conversa geral: dialoge livremente mantendo contexto.
- SEMPRE priorize resposta direta; só escreva em disco se intenção for explícita de registrar/modificar.
- Escreva em pt-BR, seja conciso e cite fonte quando usar notas (titulo + vault + score).
- NUNCA tente criar ou editar notas no cofre Obsidian — ele é somente leitura.
"""


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _env_or_default(key: str, default: str) -> str:
    val: str | None = os.getenv(key)
    return val.strip() if val and val.strip() else default


class AgentCore:
    """Orquestra DeepSeek Tool Calling + ferramentas locais + Groq STT."""

    def __init__(
        self,
        vault: VaultManager | None = None,
        indexer: MultiVaultIndexer | VaultIndexer | None = None,
        deepseek_api_key: str | None = None,
        deepseek_base_url: str | None = None,
        deepseek_model: str | None = None,
        groq_api_key: str | None = None,
        groq_model: str | None = None,
        system_prompt: str | None = None,
    ) -> None:
        """Inicializa AgentCore.

        Args:
            vault: VaultManager do cofre padrão ou None (cria via VAULT_PATH).
            indexer: MultiVaultIndexer ou VaultIndexer; se None cria MultiVaultIndexer
                     (busca automática em cofre padrão + Obsidian).
            deepseek_api_key: Se None lê DEEPSEEK_API_KEY.
            deepseek_base_url: Se None lê DEEPSEEK_BASE_URL.
            deepseek_model: Se None lê DEEPSEEK_MODEL.
            groq_api_key: Se None lê GROQ_API_KEY.
            groq_model: Se None lê GROQ_MODEL.
            system_prompt: Prompt sistema customizado.
        """
        self.vault: VaultManager = vault or VaultManager()

        # MultiVaultIndexer une cofre padrão + Obsidian em uma única busca
        if indexer is not None:
            self.indexer: MultiVaultIndexer | VaultIndexer = indexer
        else:
            default_indexer: VaultIndexer = VaultIndexer(vault=self.vault)
            obsidian_indexer: ObsidianIndexer = ObsidianIndexer(
                db_path=default_indexer.db_path
            )
            self.indexer = MultiVaultIndexer(
                default_indexer=default_indexer,
                obsidian_indexer=obsidian_indexer,
            )

        # Vault Obsidian para resolução de paths no ler_nota
        self._obsidian_vault: VaultManager | None = (
            self.indexer.obsidian_vault
            if isinstance(self.indexer, MultiVaultIndexer)
            else None
        )

        self.deepseek_api_key: str = (deepseek_api_key or os.getenv("DEEPSEEK_API_KEY") or "").strip()
        self.deepseek_base_url: str = (deepseek_base_url or _env_or_default("DEEPSEEK_BASE_URL", "https://api.deepseek.com")).strip()
        self.deepseek_model: str = (deepseek_model or _env_or_default("DEEPSEEK_MODEL", "deepseek-chat")).strip()
        self.groq_api_key: str = (groq_api_key or os.getenv("GROQ_API_KEY") or "").strip()
        self.groq_model: str = (groq_model or _env_or_default("GROQ_MODEL", "whisper-large-v3-turbo")).strip()
        self.system_prompt: str = system_prompt or _SYSTEM_PROMPT

        self._openai_client: Any | None = None
        self._groq_client: Any | None = None
        # Histórico leve para sprint 03 (sessions completas na sprint 04)
        self.history: list[dict[str, Any]] = [{"role": "system", "content": self.system_prompt}]


    # ------------------------------------------------------------------
    # Clients (lazy, facilita mock)
    # ------------------------------------------------------------------
    def _get_openai_client(self) -> Any:
        if self._openai_client is not None:
            return self._openai_client
        if not self.deepseek_api_key or self.deepseek_api_key in ("sk-placeholder", "sk-xxx", ""):
            raise RuntimeError("DEEPSEEK_API_KEY não configurada. Defina no .env.")
        try:
            from openai import OpenAI

            client: Any = OpenAI(api_key=self.deepseek_api_key, base_url=self.deepseek_base_url, timeout=30)
            self._openai_client = client
            return client
        except Exception as exc:
            raise RuntimeError(f"Falha ao criar cliente OpenAI/DeepSeek: {exc}") from exc

    def _get_groq_client(self) -> Any:
        if self._groq_client is not None:
            return self._groq_client
        if not self.groq_api_key or self.groq_api_key in ("gsk_placeholder", "gsk_xxx", ""):
            raise RuntimeError("GROQ_API_KEY não configurada. Defina no .env.")
        try:
            from groq import Groq

            # Timeout 20s para não travar UI em “transcrevendo…”
            client: Any = Groq(api_key=self.groq_api_key, timeout=20)
            self._groq_client = client
            return client
        except Exception as exc:
            raise RuntimeError(f"Falha ao criar cliente Groq: {exc}") from exc

    # ------------------------------------------------------------------
    # Tools definitions (OpenAI spec)
    # ------------------------------------------------------------------
    @staticmethod
    def _tool_definitions() -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "buscar_notas",
                    "description": "Busca semântica no cofre Markdown. Use para responder perguntas sobre conteúdo já salvo. Retorna notas mais similares com score.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Pergunta ou termos de busca em pt-BR"},
                            "top_k": {"type": "integer", "description": "Quantidade de notas (1-10)", "default": 5},
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "ler_nota",
                    "description": "Lê conteúdo completo + frontmatter de uma nota por título ou caminho. Use após buscar_notas para detalhar.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "identifier": {"type": "string", "description": "Título, nome do arquivo ou caminho da nota"},
                        },
                        "required": ["identifier"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "salvar_nota",
                    "description": "Cria nova nota Markdown no cofre. SÓ use quando usuário pedir explicitamente para salvar/registrar/anotar. Gera YAML frontmatter automaticamente.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "titulo": {"type": "string", "description": "Título descritivo da nota"},
                            "corpo": {"type": "string", "description": "Conteúdo Markdown, pode conter [[links]]"},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags temáticas"},
                            "topicos": {"type": "array", "items": {"type": "string"}, "description": "Entidades/conceitos relevantes"},
                        },
                        "required": ["titulo", "corpo"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "atualizar_nota",
                    "description": "Atualiza nota existente (append ou replace). SÓ use quando usuário pedir para adicionar/editar nota já salva.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "identifier": {"type": "string", "description": "Título ou caminho da nota a atualizar"},
                            "novo_conteudo": {"type": "string", "description": "Texto a adicionar/substituir"},
                            "modo": {"type": "string", "enum": ["append", "replace"], "description": "append=adiciona ao final, replace=substitui"},
                        },
                        "required": ["identifier", "novo_conteudo"],
                    },
                },
            },
        ]

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------
    def _execute_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Executa ferramenta local e retorna string JSON para o modelo."""
        try:
            if name == "buscar_notas":
                query: str = str(arguments.get("query", "")).strip()
                top_k: int = int(arguments.get("top_k", 5))
                # Garante índice atualizado antes de buscar
                try:
                    self.indexer.reindexar_tudo(force=False)
                except Exception:
                    pass
                results: list[dict[str, Any]] = self.indexer.buscar_notas(query, top_k=top_k)
                # Serializa leve sem Path objects — inclui vault de origem
                payload: list[dict[str, Any]] = []
                for r in results:
                    payload.append(
                        {
                            "titulo": r["titulo"],
                            "path": str(r["path"]),
                            "score": round(float(r["score"]), 4),
                            "preview": r["preview"],
                            "vault": r.get("vault", "default"),
                            "categoria": r.get("categoria", ""),
                        }
                    )
                return json.dumps({"resultados": payload}, ensure_ascii=False)

            elif name == "ler_nota":
                identifier: str = str(arguments.get("identifier", "")).strip()
                meta: dict[str, Any]
                corpo: str
                # Roteia para o vault correto: tenta Obsidian primeiro se disponível
                resolved_path: Path | None = None
                if self._obsidian_vault is not None:
                    try:
                        candidate: Path = self._obsidian_vault._resolve_path(identifier)  # type: ignore[attr-defined]
                        if candidate.exists():
                            meta, corpo = self._obsidian_vault.ler_nota(candidate)
                            resolved_path = candidate
                    except Exception:
                        pass
                if resolved_path is None:
                    # Fallback: vault padrão
                    meta, corpo = self.vault.ler_nota(identifier)
                    resolved_path = self.vault._resolve_path(identifier)  # type: ignore[attr-defined]
                return json.dumps(
                    {"frontmatter": meta, "corpo": corpo[:4000], "path": str(resolved_path)},
                    ensure_ascii=False,
                )

            elif name == "salvar_nota":
                titulo: str = str(arguments.get("titulo", "")).strip()
                corpo: str = str(arguments.get("corpo", "")).strip()
                tags: list[str] = list(arguments.get("tags", []) or [])
                topicos: list[str] = list(arguments.get("topicos", []) or [])
                if not titulo or not corpo:
                    return json.dumps({"erro": "titulo e corpo obrigatórios"})
                try:
                    path: Path = self.vault.criar_nota(titulo=titulo, corpo=corpo, tags=tags, topicos=topicos)
                    # Reindexa nota nova no indexer padrão
                    try:
                        default_idx = (
                            self.indexer.default_indexer
                            if isinstance(self.indexer, MultiVaultIndexer)
                            else self.indexer
                        )
                        default_idx.indexar_nota(path)
                    except Exception:
                        pass
                    return json.dumps({"ok": True, "path": str(path), "titulo": titulo}, ensure_ascii=False)
                except (ValueError, OSError) as exc:
                    return json.dumps({"erro": str(exc)}, ensure_ascii=False)

            elif name == "atualizar_nota":
                identifier: str = str(arguments.get("identifier", "")).strip()
                novo: str = str(arguments.get("novo_conteudo", "")).strip()
                modo: str = str(arguments.get("modo", "append")).strip()
                if modo not in ("append", "replace"):
                    modo = "append"
                try:
                    path: Path = self.vault.atualizar_nota(identifier, novo_conteudo=novo, modo=modo)  # type: ignore[arg-type]
                    try:
                        default_idx = (
                            self.indexer.default_indexer
                            if isinstance(self.indexer, MultiVaultIndexer)
                            else self.indexer
                        )
                        default_idx.indexar_nota(path)
                    except Exception:
                        pass
                    return json.dumps({"ok": True, "path": str(path), "modo": modo}, ensure_ascii=False)
                except (FileNotFoundError, ValueError, OSError) as exc:
                    return json.dumps({"erro": str(exc)}, ensure_ascii=False)

            else:
                return json.dumps({"erro": f"ferramenta desconhecida: {name}"})

        except Exception as exc:
            return json.dumps({"erro": f"falha ao executar {name}: {exc}"}, ensure_ascii=False)

    # ------------------------------------------------------------------
    # Chat loop principal
    # ------------------------------------------------------------------
    def chat(self, user_input: str, history: list[dict[str, Any]] | None = None) -> str:
        """Envia mensagem do usuário ao modelo com tool loop.

        Args:
            user_input: Texto digitado ou transcrito via voz.
            history: Histórico opcional (se None usa self.history).

        Returns:
            Resposta final do assistente.
        """
        if not user_input or not user_input.strip():
            raise ValueError("user_input não pode ser vazio.")

        msgs: list[dict[str, Any]] = history if history is not None else self.history
        # Garante system no início
        if not msgs or msgs[0].get("role") != "system":
            msgs = [{"role": "system", "content": self.system_prompt}] + list(msgs)

        msgs.append({"role": "user", "content": user_input.strip()})

        client: Any = self._get_openai_client()
        tools: list[dict[str, Any]] = self._tool_definitions()
        max_iters: int = 6

        for _ in range(max_iters):
            try:
                print(f"[DEEPSEEK] chamada {self.deepseek_model} iter {_ + 1}/{max_iters} msgs={len(msgs)}")
                resp: Any = client.chat.completions.create(
                    model=self.deepseek_model,
                    messages=msgs,
                    tools=tools,
                    tool_choice="auto",
                    temperature=0.3,
                )
            except Exception as exc:
                raise RuntimeError(f"Falha na chamada DeepSeek: {exc}") from exc

            msg: Any = resp.choices[0].message
            # Caso com tool_calls
            tool_calls: Any = getattr(msg, "tool_calls", None)
            if tool_calls:
                # Adiciona assistant com tool_calls ao histórico
                msgs.append(
                    {
                        "role": "assistant",
                        "content": msg.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                            }
                            for tc in tool_calls
                        ],
                    }
                )
                # Executa cada tool e adiciona resultado
                for tc in tool_calls:
                    name: str = tc.function.name
                    try:
                        args: dict[str, Any] = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result: str = self._execute_tool(name, args)
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                # Continua loop para modelo consolidar
                continue
            else:
                # Resposta final
                final: str = msg.content or ""
                msgs.append({"role": "assistant", "content": final})
                # Atualiza histórico interno se usado
                if history is None:
                    self.history = msgs
                return final

        # Se esgotar iterações sem resposta final
        raise RuntimeError("Loop de ferramentas excedeu limite sem resposta final.")

    def reset_history(self) -> None:
        """Limpa histórico mantendo apenas system prompt."""
        self.history = [{"role": "system", "content": self.system_prompt}]

    # ------------------------------------------------------------------
    # Voz — Groq Whisper
    # ------------------------------------------------------------------
    def transcrever_arquivo(self, audio_path: str | Path) -> str:
        """Transcreve arquivo de áudio via Groq Whisper.

        Args:
            audio_path: Caminho para wav/mp3/m4a

        Returns:
            Texto transcrito.
        """
        p: Path = Path(audio_path)
        if not p.exists():
            raise FileNotFoundError(f"Arquivo de áudio não encontrado: {p}")
        client: Any = self._get_groq_client()
        try:
            # Diagnóstico útil quando fica “transcrevendo…” eternamente
            size: int = p.stat().st_size
            print(f"[GROQ] enviando {p.name} ({size} bytes) modelo={self.groq_model}")
            with open(p, "rb") as f:
                tx: Any = client.audio.transcriptions.create(
                    file=(p.name, f),
                    model=self.groq_model,
                    response_format="text",
                    language="pt",
                )
            # SDK pode retornar str ou objeto com .text
            if isinstance(tx, str):
                return tx.strip()
            # Tenta extrair texto
            text: str | None = getattr(tx, "text", None)
            if text is not None:
                return str(text).strip()
            return str(tx).strip()
        except Exception as exc:
            raise RuntimeError(f"Falha na transcrição Groq: {exc}") from exc

    def transcrever_audio(self, audio_path: str | Path) -> str:
        return self.transcrever_arquivo(audio_path)

    def gravar_e_transcrever(self, duration: float = 5.0, samplerate: int = 16000) -> str:
        """Grava do microfone por `duration` segundos e transcreve via Groq.

        Requer sounddevice + numpy. Grava em RAM e envia temp wav.
        """
        try:
            import sounddevice as sd
        except ImportError as exc:
            raise RuntimeError("sounddevice não instalado. Rode: pip install sounddevice") from exc

        try:
            print(f"  ● Gravando {duration:.1f}s... fale agora!")
            audio: np.ndarray = sd.rec(
                int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16"
            )
            sd.wait()
            print("  ○ Gravação finalizada, transcrevendo...")
        except Exception as exc:
            raise RuntimeError(f"Falha ao gravar áudio: {exc}") from exc

        # Salva wav temporário
        try:
            import wave

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_path: Path = Path(tmp.name)
                with wave.open(str(tmp_path), "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)  # int16
                    wf.setframerate(samplerate)
                    wf.writeframes(audio.tobytes())
            try:
                text: str = self.transcrever_arquivo(tmp_path)
                return text
            finally:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass
        except Exception as exc:
            raise RuntimeError(f"Falha ao preparar/transcrever áudio: {exc}") from exc

    def iniciar_gravacao_continua(self, samplerate: int = 16000) -> tuple[Any, int]:
        """Inicia gravação contínua do microfone (sem duração fixa).

        Returns:
            Tupla (stop_callback, samplerate) onde stop_callback() retorna
            o array de áudio gravado como np.ndarray int16.
        """
        try:
            import sounddevice as sd
        except ImportError as exc:
            raise RuntimeError("sounddevice não instalado. Rode: pip install sounddevice") from exc

        buffer: list[np.ndarray] = []

        def callback(indata: np.ndarray, frames: int, time_info: Any, status: Any) -> None:
            buffer.append(indata.copy())

        stream = sd.InputStream(
            samplerate=samplerate, channels=1, dtype="int16", callback=callback
        )
        stream.start()
        print("  ● Gravando... fale agora!")

        def stop() -> np.ndarray:
            stream.stop()
            stream.close()
            print("  ○ Gravação finalizada, transcrevendo...")
            if not buffer:
                return np.array([], dtype="int16")
            return np.concatenate(buffer, axis=0).flatten()

        return stop, samplerate

    def transcrever_audio_gravado(self, audio: np.ndarray, samplerate: int = 16000) -> str:
        """Transcreve array de áudio (int16) via Groq Whisper."""
        if audio.size == 0:
            return ""
        try:
            import wave

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_path: Path = Path(tmp.name)
                with wave.open(str(tmp_path), "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)  # int16
                    wf.setframerate(samplerate)
                    wf.writeframes(audio.tobytes())
            try:
                text: str = self.transcrever_arquivo(tmp_path)
                return text
            finally:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass
        except Exception as exc:
            raise RuntimeError(f"Falha ao preparar/transcrever áudio: {exc}") from exc
