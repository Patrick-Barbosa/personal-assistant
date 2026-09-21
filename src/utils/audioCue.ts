// Web Audio API sintetizador de chimes acústicos modernos e sofisticados (estilo glass chime / marimba suave)
// Sem arquivos externos, zero latência, com filtragem passa-baixa para remover qualquer tom metálico.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Cria uma cadeia de áudio com filtro passa-baixa aveludado para eliminar asperezas.
 */
function createWarmVoice(ctx: AudioContext, cutoff = 1400) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, ctx.currentTime);
  filter.Q.setValueAtTime(1.2, ctx.currentTime);
  filter.connect(ctx.destination);
  return filter;
}

/**
 * Toca swell aéreo curto e suave para início de escuta ("Copernico").
 * Agora encurtado para 0.65s e com ganho bem menor para não estourar.
 */
export function playListeningChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const filter = createWarmVoice(ctx, 1100);

    const dur = 0.65;
    const attack = 0.18;

    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(340, now);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(0.28 * 0.32, now + attack * 0.6);
    g1.gain.linearRampToValueAtTime(0.55 * 0.32, now + attack);
    g1.gain.linearRampToValueAtTime(0.42 * 0.32, now + 0.52);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc1.connect(g1);
    g1.connect(filter);
    osc1.start(now);
    osc1.stop(now + dur);

    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(540, now);
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(0.18 * 0.28, now + attack * 0.7);
    g2.gain.linearRampToValueAtTime(0.28 * 0.28, now + attack + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc2.connect(g2);
    g2.connect(filter);
    osc2.start(now);
    osc2.stop(now + dur);
  } catch (err) {
    console.warn("Falha ao tocar chime de escuta:", err);
  }
}

/**
 * Toca chime sutil e aveludado de nota de convite (E5) para indicar a vez do usuário no follow-up pós-TTS.
 */
export function playFollowUpChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const filter = createWarmVoice(ctx, 1300);

    // Nota principal suave (E5 = 659.25 Hz) com sutil harmônico (B5 = 987.77 Hz)
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);

    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(0.065, now + 0.03);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    osc1.connect(g1);
    g1.connect(filter);
    osc1.start(now);
    osc1.stop(now + 0.38);

    // Segundo harmônico delicado
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(987.77, now + 0.03);

    g2.gain.setValueAtTime(0.0001, now + 0.03);
    g2.gain.linearRampToValueAtTime(0.03, now + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc2.connect(g2);
    g2.connect(filter);
    osc2.start(now + 0.03);
    osc2.stop(now + 0.35);
  } catch (err) {
    console.warn("Falha ao tocar chime de follow-up:", err);
  }
}

/**
 * Toca resolução descendente elegante (G5 -> E5 -> C5) para repouso ou encerramento de turno.
 */
export function playEndChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const filter = createWarmVoice(ctx, 1400);

    const notes = [
      { freq: 783.99, time: 0.00, dur: 0.30, gain: 0.065 }, // G5
      { freq: 659.25, time: 0.07, dur: 0.32, gain: 0.060 }, // E5
      { freq: 523.25, time: 0.14, dur: 0.45, gain: 0.070 }, // C5
    ];

    notes.forEach(({ freq, time, dur, gain }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + time);

      g.gain.setValueAtTime(0.0001, now + time);
      g.gain.linearRampToValueAtTime(gain, now + time + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

      osc.connect(g);
      g.connect(filter);

      osc.start(now + time);
      osc.stop(now + time + dur);
    });
  } catch (err) {
    console.warn("Falha ao tocar chime de encerramento:", err);
  }
}

// Aliases retrocompatíveis
export const playStartCue = playListeningChime;
export const playStopCue = playEndChime;

