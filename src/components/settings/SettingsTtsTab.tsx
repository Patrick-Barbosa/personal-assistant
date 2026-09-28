import React, { useState, useEffect } from "react";
import { Volume2, Play, Square, Loader2, Check } from "lucide-react";
import { api } from "../../api";
import { VoiceInfo } from "../../types";

export const SettingsTtsTab: React.FC = () => {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("pt-BR-ThalitaNeural");
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    api
      .getTtsVoices()
      .then((v: VoiceInfo[]) => {
        setVoices(v);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));

    api
      .getCurrentTtsVoice()
      .then((v: string) => {
        if (v) setSelectedVoice(v);
      })
      .catch(() => {});
  }, []);

  const handleSelectVoice = async (voiceShortName: string) => {
    setSelectedVoice(voiceShortName);
    try {
      await api.setTtsVoice(voiceShortName);
      setFeedback("Voz configurada!");
      setTimeout(() => setFeedback(null), 2500);
    } catch {
      setFeedback("Erro ao salvar voz.");
    }
  };

  const handleTestVoice = async () => {
    if (isPlaying) {
      await api.stopTts().catch(() => {});
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    try {
      await api.testTtsVoice(selectedVoice);
    } catch (err) {
      console.error("Test voice error:", err);
    } finally {
      setIsPlaying(false);
    }
  };

  const ptVoices = voices.filter((v) => v.locale.startsWith("pt"));
  const otherVoices = voices.filter((v) => !v.locale.startsWith("pt"));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Volume2 size={16} className="text-amber-400" />
          <span>Síntese de Voz Neural (Edge-TTS)</span>
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
          O Copernico reproduz respostas faladas usando vozes neurais de alta fidelidade da Microsoft.
        </p>
      </div>

      {/* Voice Selection Card */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Voz Padrão do Assistente</span>
          <button
            type="button"
            onClick={handleTestVoice}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-all cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Square size={13} />
                <span>Interromper</span>
              </>
            ) : (
              <>
                <Play size={13} />
                <span>Testar Voz</span>
              </>
            )}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)] justify-center">
            <Loader2 size={15} className="animate-spin text-amber-400" />
            <span>Carregando catálogo de vozes neurais...</span>
          </div>
        ) : (
          <select
            value={selectedVoice}
            onChange={(e) => handleSelectVoice(e.target.value)}
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-amber-500/50 cursor-pointer"
          >
            <optgroup label="Português (Brasil)">
              {ptVoices.map((v) => (
                <option key={v.short_name} value={v.short_name}>
                  {v.friendly_name || v.short_name} ({v.gender})
                </option>
              ))}
            </optgroup>
            <optgroup label="Outros Idiomas">
              {otherVoices.slice(0, 15).map((v) => (
                <option key={v.short_name} value={v.short_name}>
                  {v.friendly_name || v.short_name} ({v.locale})
                </option>
              ))}
            </optgroup>
          </select>
        )}

        {feedback && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Check size={13} />
            <span>{feedback}</span>
          </div>
        )}
      </div>
    </div>
  );
};
