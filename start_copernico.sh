#!/usr/bin/env bash

# Navega para o diretório do script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Garante que pnpm e cargo estejam no PATH mesmo em subshells não-interativos
export PATH="$HOME/.local/share/pnpm/bin:$HOME/.local/share/pnpm:$HOME/.cargo/bin:$PATH"

# Carrega o ambiente Rust do usuário se existir
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

# Cria diretório de logs e faz rotação do log anterior
mkdir -p "$DIR/logs"
if [ -f "$DIR/logs/copernico.log" ]; then
    mv -f "$DIR/logs/copernico.log" "$DIR/logs/copernico.prev.log" 2>/dev/null || true
fi

LOG_FILE="$DIR/logs/copernico.log"

echo "===================================================================="
echo "                  COPERNICO — SECOND BRAIN (LINUX)"
echo "           Sistema Desktop de Alta Performance (Local-First)"
echo "===================================================================="
echo ""

# 1. Verifica se o Rust/Cargo está instalado
if ! command -v cargo &> /dev/null; then
    echo " [!] ERRO: O compilador Rust (cargo) não foi encontrado no sistema!"
    echo ""
    echo "     O Tauri precisa do Rust para compilar o backend nativo do Copernico."
    echo "     Para instalar o Rust e as bibliotecas do sistema Linux, execute:"
    echo ""
    echo "     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    echo "     source \"\$HOME/.cargo/env\""
    echo ""
    echo "     sudo apt update && sudo apt install -y build-essential libssl-dev \\"
    echo "         libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \\"
    echo "         libwebkit2gtk-4.1-dev libasound2-dev pkg-config"
    echo ""
    echo "===================================================================="
    exit 1
fi

# 2. Verifica se a versão do Node.js é >= 20
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d'.' -f1)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 20 ]; then
    echo " [!] ERRO: Sua versão do Node.js ($(node -v 2>/dev/null || echo 'não encontrada')) é incompatível!"
    echo ""
    echo "     O Vite, Tailwind v4 e Rolldown exigem Node.js 20+ (recomendado Node 22 LTS)."
    echo "     Para atualizar o Node.js para a versão 22 LTS no Ubuntu/Zorin OS, execute:"
    echo ""
    echo "     curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "     sudo apt install -y nodejs"
    echo ""
    echo "===================================================================="
    exit 1
fi

# 3. Verifica se as bibliotecas de sistema C/GTK/WebKit necessárias para o Tauri existem
if ! command -v pkg-config &> /dev/null || ! pkg-config --exists openssl; then
    echo " [!] ERRO: Dependências nativas do Linux para o Tauri não foram encontradas!"
    echo ""
    echo "     O Tauri 2 precisa das bibliotecas de desenvolvimento do WebKitGTK, GTK3, ALSA e OpenSSL."
    echo "     Para instalá-las no Ubuntu/Zorin OS, execute no seu terminal:"
    echo ""
    echo "     sudo apt update && sudo apt install -y pkg-config libssl-dev \\"
    echo "         libgtk-3-dev libwebkit2gtk-4.1-dev libasound2-dev \\"
    echo "         libayatana-appindicator3-dev librsvg2-dev"
    echo ""
    echo "===================================================================="
    exit 1
fi

# 2. Cria .env a partir de .env.example se não existir
if [ ! -f "$DIR/.env" ] && [ -f "$DIR/.env.example" ]; then
    echo " [i] Arquivo .env não encontrado. Criando cópia a partir de .env.example..."
    cp "$DIR/.env.example" "$DIR/.env"
fi

echo " [*] STATUS:           Compilando e iniciando ambiente..."
echo " [*] ATALHO GLOBAL:    Ctrl + Espaço (Overlay)"
echo " [*] ARQUITETURA:      Tauri 2 + Rust + React 19 + shadcn/ui"
echo " [*] LOGS:             Gravando em logs/copernico.log"
echo " [*] PARA VER LOGS:    tail -f logs/copernico.log"
echo "===================================================================="
echo ""

# Se estiver em sessão Wayland, configura flags do WebKitGTK para estabilidade
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo " [i] Sessão Wayland detectada. Ativando renderização de alta compatibilidade..."
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
fi

# Executa o aplicativo gravando saída nos logs
pnpm tauri dev > "$LOG_FILE" 2>&1 &
PID=$!
echo " [*] Copernico rodando com PID $PID."
echo " [Dica] Pressione Ctrl+C para encerrar ou feche a janela."

wait $PID
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo " [!] O Copernico encerrou com código de erro $EXIT_CODE."
    echo "     Últimas linhas do log ($LOG_FILE):"
    echo "--------------------------------------------------------------------"
    tail -n 15 "$LOG_FILE"
    echo "--------------------------------------------------------------------"
fi

exit $EXIT_CODE
