import React, { useState, useEffect } from "react";
import { Boxes, Zap, Palette, Check, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { McpServerStatus, ThemeItem } from "../../types";
import { ThemeEngine } from "../../utils/themeEngine";

export const SettingsPluginsTab: React.FC = () => {
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [mcpConfigText, setMcpConfigText] = useState("");
  const [isSavingMcp, setIsSavingMcp] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    api.getMcpServersStatus().then(setMcpServers).catch(() => {});
    api.listThemes().then(setThemes).catch(() => {});
    api.getActiveTheme().then(setActiveTheme).catch(() => {});
    api.getMcpConfig().then(setMcpConfigText).catch(() => {});
  }, []);

  const handleSaveMcpConfig = async () => {
    setIsSavingMcp(true);
    setFeedback(null);
    try {
      await api.saveMcpConfig(mcpConfigText);
      setFeedback("Configuração MCP salva com sucesso!");
      setTimeout(() => setFeedback(null), 2500);
    } catch (err) {
      setFeedback(`Erro no JSON do MCP: ${String(err)}`);
    } finally {
      setIsSavingMcp(false);
    }
  };

  const handleApplyTheme = async (themeId: string) => {
    try {
      const found = themes.find((t) => t.id === themeId);
      if (found && found.css) {
        ThemeEngine.applyTheme(themeId, found.css);
      }
      await api.setActiveTheme(themeId);
      setActiveTheme(themeId);
    } catch (err) {
      console.error("Apply theme error:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Boxes size={16} className="text-amber-400" />
          <span>Extensões, MCP & Temas</span>
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          Gerencie servidores MCP (Model Context Protocol) locais e o motor de temas.
        </p>
      </div>

      {/* MCP Servers List Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
            <Zap size={14} className="text-amber-400" />
            <span>Servidores MCP Ativos</span>
          </span>
          <button
            type="button"
            onClick={() => api.getMcpServersStatus().then(setMcpServers).catch(() => {})}
            className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Atualizar status"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {mcpServers.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-2">Nenhum servidor MCP ativo no momento.</p>
        ) : (
          <div className="space-y-1.5">
            {mcpServers.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] text-xs"
              >
                <div>
                  <span className="font-semibold text-[var(--text-secondary)]">{s.id}</span>
                  <span className="text-[11px] text-[var(--text-muted)] block font-mono mt-0.5">
                    {s.tool_count} ferramentas disponíveis
                  </span>
                </div>
                <span
                  className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                    s.status === "ready"
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                  }`}
                >
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MCP JSON Config Editor Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">Configuração de Servidores MCP (JSON)</span>
          <button
            type="button"
            onClick={handleSaveMcpConfig}
            disabled={isSavingMcp}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSavingMcp ? "Salvando..." : "Salvar Configuração"}
          </button>
        </div>

        <textarea
          rows={7}
          value={mcpConfigText}
          onChange={(e) => setMcpConfigText(e.target.value)}
          placeholder='{\n  "mcpServers": {}\n}'
          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 font-mono text-xs text-[var(--text-secondary)] leading-relaxed outline-none focus:border-amber-500/50 resize-y"
        />

        {feedback && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 pt-1">
            <Check size={13} />
            <span>{feedback}</span>
          </div>
        )}
      </div>

      {/* Themes Card */}
      {themes.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-3">
          <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
            <Palette size={14} className="text-amber-400" />
            <span>Temas Visuais Customizados</span>
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleApplyTheme(t.id)}
                className={`p-2.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                  activeTheme === t.id
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                    : "border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)]"
                }`}
              >
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{t.description || "Tema Copernico"}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
