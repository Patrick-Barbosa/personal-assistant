import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { api } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AgentConfig({ open, onClose }: Props) {
  const [persona, setPersona] = useState("");
  const [behavior, setBehavior] = useState("");
  const [aboutMe, setAboutMe] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    api
      .getAgent()
      .then((c) => {
        setPersona(c.persona);
        setBehavior(c.behavior);
        setAboutMe(c.about_me ?? "");
        setTemperature(c.temperature);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open ]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.saveAgent({ persona, behavior, about_me: aboutMe, temperature });
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-[#141414]/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 max-h-[90vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-[16px] border border-[#d9d9d9] bg-[#ffffff] p-5 outline-none">
          <Dialog.Title className="text-base font-bold text-[#141414]">Configurar IA</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-[#141414]/50">
            Persona, sobre você, comportamento e criatividade do Tiba. Vale para as próximas respostas.
          </Dialog.Description>
          {loading ? (
            <p className="py-6 text-center text-sm text-[#141414]/50">Carregando…</p>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="flim-nav mb-1 block text-[#141414]/60">PERSONA — QUEM É O TIBA</span>
                <textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  rows={3}
                  placeholder="Ex: assistente direto e bem-humorado, fala como um amigo…"
                  className="w-full rounded-[8px] border border-[#141414]/25 bg-[#ffffff] px-3 py-2 text-sm text-[#141414] outline-none placeholder:text-[#141414]/40 focus:border-[#141414]"
                />
              </label>
              <label className="block">
                <span className="flim-nav mb-1 block text-[#141414]/60">SOBRE MIM — QUEM É VOCÊ</span>
                <textarea
                  value={aboutMe}
                  onChange={(e) => setAboutMe(e.target.value)}
                  rows={3}
                  placeholder="Ex: trabalho com design, rotina corrida, prefiro treinar de manhã…"
                  className="w-full rounded-[8px] border border-[#141414]/25 bg-[#ffffff] px-3 py-2 text-sm text-[#141414] outline-none placeholder:text-[#141414]/40 focus:border-[#141414]"
                />
              </label>
              <label className="block">
                <span className="flim-nav mb-1 block text-[#141414]/60">COMPORTAMENTO — REGRAS</span>
                <textarea
                  value={behavior}
                  onChange={(e) => setBehavior(e.target.value)}
                  rows={3}
                  placeholder="Ex: respostas curtas, sempre confirma antes de mover tarefa…"
                  className="w-full rounded-[8px] border border-[#141414]/25 bg-[#ffffff] px-3 py-2 text-sm text-[#141414] outline-none placeholder:text-[#141414]/40 focus:border-[#141414]"
                />
              </label>
              <div>
                <span className="flim-nav mb-1 flex items-center justify-between text-[#141414]/60">
                  <span>TEMPERATURA — CRIATIVIDADE</span>
                  <span className="text-[#141414]">{temperature.toFixed(1)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  aria-label="Temperatura da IA"
                  className="w-full accent-[#141414]"
                />
                <p className="mt-1 text-xs text-[#141414]/50">0 = direto e consistente · 2 = solto e criativo</p>
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="flim-nav rounded-[8px] border border-[#d9d9d9] px-4 py-2 text-[#141414]">
              Fechar
            </Dialog.Close>
            <button
              onClick={save}
              disabled={loading || saving}
              className="flim-nav rounded-[8px] bg-[#141414] px-4 py-2 text-[#ffffff] transition-colors hover:bg-[#2a2a2a] disabled:opacity-40"
            >
              {saving ? "…" : "Salvar"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
