"""VaultManager — Sprint 01: CRUD atômico para cofre Markdown com YAML frontmatter.

Resolução de diretório via pathlib.Path + variável de ambiente VAULT_PATH (.env).
Operações atômicas com try/except e escrita temporária + rename.

Suporte a modo recursivo (recursive=True) para cofres com sub-pastas (ex: Obsidian).
Diretórios ocultos/sistema (.obsidian, .trash, etc.) são ignorados automaticamente.
"""

from __future__ import annotations

import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import frontmatter
from dotenv import load_dotenv

load_dotenv()

# Caractéres proibidos no Windows/Linux + controle
_INVALID_CHARS_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

# Diretórios de sistema do Obsidian e similares ignorados na listagem recursiva
_HIDDEN_DIR_PREFIXES: frozenset[str] = frozenset({
    ".obsidian", ".trash", ".stfolder", ".stfolder.removed",
    ".Android", ".copilot-index", ".thumbcache",
})


def _project_root() -> Path:
    """Retorna a raiz do projeto (2 níveis acima de scripts/funcional/)."""
    return Path(__file__).resolve().parent.parent.parent


def _sanitize_filename(name: str) -> str:
    """Sanitiza string para nome de arquivo seguro."""
    # Remove espaços extremos e substitui caracteres inválidos por "_"
    sanitized: str = _INVALID_CHARS_PATTERN.sub("_", name.strip())
    # Colapsa múltiplos underscores/espaços
    sanitized = re.sub(r"[_\s]+", "_", sanitized)
    # Remove pontos/espaços no final (Windows)
    sanitized = sanitized.strip("._ ")
    if not sanitized:
        sanitized = "sem_titulo"
    # Evita nomes reservados do Windows
    if sanitized.upper() in _RESERVED_NAMES:
        sanitized = f"_{sanitized}"
    # Limite de comprimento (255 - extensão)
    if len(sanitized) > 200:
        sanitized = sanitized[:200]
    return sanitized


class VaultManager:
    """Gerenciador atômico do cofre Markdown."""

    def __init__(self, vault_path: Path | str | None = None, recursive: bool = False) -> None:
        """Inicializa garantindo que o diretório do cofre exista.

        Args:
            vault_path: Caminho do cofre. Se None, lê VAULT_PATH do .env
                        ou usa cofres/default relativo à raiz do projeto.
            recursive: Se True, lista/busca .md em sub-pastas (modo Obsidian).
                       Diretórios ocultos/sistema são ignorados.
        """
        if vault_path is not None:
            raw: Path = Path(vault_path)
        else:
            env_path: str | None = os.getenv("VAULT_PATH")
            raw = Path(env_path) if env_path else Path("cofres/default")

        # Resolve relativo à raiz do projeto
        if not raw.is_absolute():
            raw = (_project_root() / raw).resolve()
        else:
            raw = raw.resolve()

        self.vault_path: Path = raw
        self.recursive: bool = recursive
        self._ensure_vault_exists()

    # ------------------------------------------------------------------
    # helpers internos
    # ------------------------------------------------------------------
    def _ensure_vault_exists(self) -> None:
        try:
            self.vault_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise OSError(f"Falha ao criar diretório do cofre '{self.vault_path}': {exc}") from exc

    @staticmethod
    def _is_hidden_path(p: Path) -> bool:
        """Retorna True se algum componente do path for um dir oculto/sistema."""
        return any(
            part.startswith(".") or any(part.startswith(prefix) for prefix in _HIDDEN_DIR_PREFIXES)
            for part in p.parts
        )

    def _iter_md_files(self) -> list[Path]:
        """Lista todos os .md do vault respeitando o modo recursivo e ignorando dirs ocultos."""
        if self.recursive:
            return sorted(
                p for p in self.vault_path.rglob("*.md")
                if not self._is_hidden_path(p.relative_to(self.vault_path))
            )
        return sorted(self.vault_path.glob("*.md"))

    def _resolve_path(self, identifier: str | Path) -> Path:
        """Resolve identifier (caminho, nome de arquivo ou título) para Path absoluto.

        Ordem de resolução:
        1. Se Path absoluto/existe diretamente → retorna.
        2. Se contém separador ou termina com .md → tenta relativo ao vault.
        3. Busca por nome sanitizado exato.
        4. Busca por título (frontmatter) ou stem case-insensitive (para notas Obsidian sem frontmatter).
        """
        p: Path = Path(identifier)

        # Caso 1: caminho absoluto existente
        if p.is_absolute() and p.exists():
            return p

        # Caso 1b: caminho relativo ao vault que existe
        candidate: Path = (self.vault_path / p).resolve()
        if candidate.exists():
            return candidate

        # Caso 2: tentativa com sanitização + .md
        sanitized: str = _sanitize_filename(str(identifier).removesuffix(".md"))
        candidate = (self.vault_path / f"{sanitized}.md").resolve()
        if candidate.exists():
            return candidate

        # Caso 3: busca por título no frontmatter ou stem (varredura — suporta recursivo)
        try:
            target_lower: str = str(identifier).strip().lower()
            for md_file in self._iter_md_files():
                try:
                    post: frontmatter.Post = frontmatter.load(str(md_file))
                    titulo: str = str(post.get("titulo", "")).lower()
                    if titulo == target_lower:
                        return md_file
                    # Fallback: compara pelo stem do arquivo (útil para notas Obsidian sem frontmatter)
                    if md_file.stem.lower() == target_lower:
                        return md_file
                except Exception:
                    continue
        except OSError:
            pass

        # Não encontrado → retorna o candidato sanitizado (para criação/leitura com erro claro)
        return candidate

    def _atomic_write(self, dest: Path, content: str) -> None:
        """Escrita atômica via arquivo temporário + rename."""
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            # Cria temp no mesmo diretório para garantir rename atômico no mesmo FS
            fd: int
            tmp_path: str
            fd, tmp_path = tempfile.mkstemp(dir=str(dest.parent), suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
                    tmp_file.write(content)
                Path(tmp_path).replace(dest)
            except Exception:
                # Limpeza em caso de falha
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass
                raise
        except OSError as exc:
            raise OSError(f"Falha ao escrever arquivo '{dest}': {exc}") from exc

    @staticmethod
    def _now_ids() -> tuple[str, str]:
        """Gera (id YYYYMMDDHHmmss, data ISO)."""
        now: datetime = datetime.now()
        return now.strftime("%Y%m%d%H%M%S"), now.isoformat(timespec="seconds")

    # ------------------------------------------------------------------
    # API pública — nomes em PT-BR (contrato) + aliases EN
    # ------------------------------------------------------------------
    def criar_nota(
        self,
        titulo: str,
        corpo: str,
        tags: list[str] | None = None,
        topicos: list[str] | None = None,
        id_nota: str | None = None,
        data: str | None = None,
    ) -> Path:
        """Cria nova nota Markdown com frontmatter YAML.

        Args:
            titulo: Título descritivo (usado no frontmatter e nome do arquivo).
            corpo: Conteúdo Markdown (pode conter [[links]]).
            tags: Lista de tags temáticas.
            topicos: Entidades/conceitos relevantes.
            id_nota: ID customizado YYYYMMDDHHmmss (auto-gerado se None).
            data: ISO datetime (auto-gerado se None).

        Returns:
            Path do arquivo criado.

        Raises:
            ValueError: se titulo vazio.
            OSError: falha de I/O.
        """
        if not titulo or not titulo.strip():
            raise ValueError("titulo não pode ser vazio.")

        tags = tags or []
        topicos = topicos or []

        gen_id: str
        gen_data: str
        gen_id, gen_data = self._now_ids()
        final_id: str = id_nota or gen_id
        final_data: str = data or gen_data

        # Nome de arquivo sanitizado; evita colisão
        base: str = _sanitize_filename(titulo)
        dest: Path = self.vault_path / f"{base}.md"
        if dest.exists():
            # Adiciona sufixo de id para garantir unicidade
            dest = self.vault_path / f"{base}_{final_id}.md"
            # Se ainda colidir (criação no mesmo segundo), incrementa
            counter: int = 1
            while dest.exists():
                dest = self.vault_path / f"{base}_{final_id}_{counter}.md"
                counter += 1

        post: frontmatter.Post = frontmatter.Post(
            content=corpo,
            titulo=titulo.strip(),
            id=final_id,
            data=final_data,
            tags=tags,
            topicos=topicos,
        )
        try:
            serialized: str = frontmatter.dumps(post)
        except Exception as exc:
            raise ValueError(f"Falha ao serializar frontmatter: {exc}") from exc

        self._atomic_write(dest, serialized)
        return dest

    # alias EN
    def create_note(
        self,
        titulo: str,
        corpo: str,
        tags: list[str] | None = None,
        topicos: list[str] | None = None,
        id_nota: str | None = None,
        data: str | None = None,
    ) -> Path:
        return self.criar_nota(titulo, corpo, tags, topicos, id_nota, data)

    def ler_nota(self, identifier: str | Path) -> tuple[dict[str, Any], str]:
        """Lê nota e retorna (frontmatter dict, corpo Markdown).

        Args:
            identifier: caminho, nome de arquivo ou titulo.

        Raises:
            FileNotFoundError: se não encontrada.
            ValueError: falha ao parsear.
        """
        path: Path = self._resolve_path(identifier)
        if not path.exists():
            raise FileNotFoundError(f"Nota não encontrada: '{identifier}' (tentado: {path})")
        try:
            post: frontmatter.Post = frontmatter.load(str(path))
        except Exception as exc:
            raise ValueError(f"Falha ao ler/parsear nota '{path}': {exc}") from exc
        metadata: dict[str, Any] = dict(post.metadata)
        return metadata, post.content

    def read_note(self, identifier: str | Path) -> tuple[dict[str, Any], str]:
        return self.ler_nota(identifier)

    def atualizar_nota(
        self,
        identifier: str | Path,
        novo_conteudo: str | None = None,
        novo_titulo: str | None = None,
        tags: list[str] | None = None,
        topicos: list[str] | None = None,
        modo: str = "append",
    ) -> Path:
        """Atualiza nota existente.

        Args:
            identifier: caminho, nome de arquivo ou titulo da nota a atualizar.
            novo_conteudo: texto a adicionar/substituir.
            novo_titulo: se informado, atualiza frontmatter titulo.
            tags: se informado, substitui lista de tags.
            topicos: se informado, substitui lista de topicos.
            modo: 'append' (adiciona ao final) ou 'replace' (substitui corpo).

        Returns:
            Path da nota atualizada (pode mudar se titulo alterado e arquivo renomeado? Não renomeia por padrão).

        Raises:
            FileNotFoundError: se não encontrada.
            ValueError: modo inválido.
        """
        if modo not in ("append", "replace"):
            raise ValueError("modo deve ser 'append' ou 'replace'.")

        path: Path = self._resolve_path(identifier)
        if not path.exists():
            raise FileNotFoundError(f"Nota não encontrada para atualização: '{identifier}'")

        try:
            post: frontmatter.Post = frontmatter.load(str(path))
        except Exception as exc:
            raise ValueError(f"Falha ao carregar nota '{path}': {exc}") from exc

        # Atualiza corpo
        if novo_conteudo is not None:
            if modo == "append":
                # Garante separação limpa
                existing: str = post.content.rstrip()
                addition: str = novo_conteudo.strip()
                if existing:
                    post.content = f"{existing}\n\n{addition}\n"
                else:
                    post.content = f"{addition}\n"
            else:
                post.content = novo_conteudo

        # Atualiza metadados
        if novo_titulo is not None:
            if not novo_titulo.strip():
                raise ValueError("novo_titulo não pode ser vazio.")
            post["titulo"] = novo_titulo.strip()
        if tags is not None:
            post["tags"] = tags
        if topicos is not None:
            post["topicos"] = topicos

        try:
            serialized: str = frontmatter.dumps(post)
        except Exception as exc:
            raise ValueError(f"Falha ao serializar nota atualizada: {exc}") from exc

        # Se título mudou e usuário quiser renomear arquivo, não renomeia automaticamente
        # para preservar links; apenas reescreve no mesmo path.
        self._atomic_write(path, serialized)
        return path

    def update_note(
        self,
        identifier: str | Path,
        novo_conteudo: str | None = None,
        novo_titulo: str | None = None,
        tags: list[str] | None = None,
        topicos: list[str] | None = None,
        modo: str = "append",
    ) -> Path:
        return self.atualizar_nota(identifier, novo_conteudo, novo_titulo, tags, topicos, modo)

    def listar_notas(self) -> list[Path]:
        """Lista todos os arquivos .md do cofre ordenados por nome.

        Em modo recursivo, percorre sub-pastas ignorando diretórios ocultos/sistema.
        """
        try:
            files: list[Path] = self._iter_md_files()
        except OSError as exc:
            raise OSError(f"Falha ao listar notas em '{self.vault_path}': {exc}") from exc
        return files

    def list_notes(self) -> list[Path]:
        return self.listar_notas()

    def extrair_frontmatter(self, identifier: str | Path) -> dict[str, Any]:
        """Extrai apenas o frontmatter YAML de uma nota."""
        metadata: dict[str, Any]
        metadata, _ = self.ler_nota(identifier)
        return metadata

    def get_frontmatter(self, identifier: str | Path) -> dict[str, Any]:
        return self.extrair_frontmatter(identifier)

    def deletar_nota(self, identifier: str | Path) -> None:
        """Remove nota do disco."""
        path: Path = self._resolve_path(identifier)
        if not path.exists():
            raise FileNotFoundError(f"Nota não encontrada para deleção: '{identifier}'")
        try:
            path.unlink()
        except OSError as exc:
            raise OSError(f"Falha ao deletar nota '{path}': {exc}") from exc

    def delete_note(self, identifier: str | Path) -> None:
        return self.deletar_nota(identifier)

    # ------------------------------------------------------------------
    # util
    # ------------------------------------------------------------------
    @staticmethod
    def sanitize_filename(name: str) -> str:
        return _sanitize_filename(name)
