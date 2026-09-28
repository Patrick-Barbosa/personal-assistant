import { useCallback, useEffect, useRef, useState } from "react";
import { api, getBackendUrl } from "../api";
import { cleanTranscript } from "../utils/transcriptCleaner";
import {
  DEFAULT_VAD,
  newVadState,
  offThreshold,
  onThreshold,
  vadUpdate,
} from "../utils/vadGate";
import type { VadState } from "../utils/vadGate";
import { useVoiceStore } from "../stores/voice-store";

export type VoicePhase = "idle" | "listening" | "processing" | "speaking";

/** Calibration window measuring the room's noise floor. */
const CALIBRATE_MS = 1200;
/** Nudge shown when no speech arms within this long. */
const NUDGE_MS = 3000;
/** Per-bin smoothing shared by the VAD meter and the orb ring. */
const EMA_ALPHA = 0.35;

interface UseVoiceSessionOptions {
  /** Sends the transcript through chat; resolves with the assistant reply (or null). */
  onUserTurn: (text: string) => Promise<string | null>;
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
}

function rmsOf(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/**
 * Continuous talk → hear loop for the voice session view.
 * One explicit async machine (`runLoop`) owns every transition, so a turn
 * can never strand the session: every await resolves, every stall has a
 * timeout, and `getDebug()` exposes the live state for diagnosis.
 *
 * End-of-turn decisions live in the pure `vadGate` module; this hook only
 * feeds it smoothed frames from rAF (plus an interval backup for throttled
 * tabs) and honors its verdicts.
 */
export function useVoiceSession({ onUserTurn, onSpeakStart, onSpeakEnd }: UseVoiceSessionOptions) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [statusText, setStatusText] = useState("Preparando microfone…");
  const [fatalError, setFatalError] = useState<string | null>(null);
  /** True once real speech (not noise) is heard in the current turn. */
  const [heard, setHeard] = useState(false);

  /** Smoothed 0..1 level driving the orb (user mic or AI voice). */
  const level = useRef(0);
  /** Downsampled waveform (-1..1) driving the orb's ring. */
  const vizWave = useRef<Float32Array>(new Float32Array(96));

  const phaseRef = useRef<VoicePhase>("idle");
  const stoppedRef = useRef(true);
  const onUserTurnRef = useRef(onUserTurn);
  onUserTurnRef.current = onUserTurn;
  const onSpeakStartRef = useRef(onSpeakStart);
  onSpeakStartRef.current = onSpeakStart;
  const onSpeakEndRef = useRef(onSpeakEnd);
  onSpeakEndRef.current = onSpeakEnd;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const aiAnalyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const rafRef = useRef(0);
  const intervalRef = useRef(0);
  const bufRef = useRef<Uint8Array>(new Uint8Array(2048));
  const waveTmpRef = useRef<Float32Array>(new Float32Array(96));
  const turnStartedAtRef = useRef(0);
  const recorderActiveRef = useRef(false);
  /** While true (hold-to-talk), auto-stop is suspended; release sends. */
  const manualHoldRef = useRef(false);
  /** Room noise floor; thresholds derive from it continuously. */
  const noiseRef = useRef({ floor: 0.004 });
  /** Smoothed RMS the gate decides on (meter and gate share it). */
  const emaRef = useRef(0);
  /** Per-turn VAD decision state. */
  const vadRef = useRef<VadState | null>(null);
  const nudgedRef = useRef(false);
  const sttFailsRef = useRef(0);
  const aiAudioRef = useRef<HTMLAudioElement | null>(null);
  const turnResolveRef = useRef<((blob: Blob | null) => void) | null>(null);
  // Debug snapshot (mutated in the frame loop, read by getDebug).
  const dbgRef = useRef({ rms: 0, ema: 0, stop: "" });

  const setPhaseBoth = (p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
    const setWake = useVoiceStore.getState().setWakeStatus;
    if (p === "listening") {
      setWake("listening");
      setStatusText("Sua vez — fale naturalmente…");
    } else if (p === "processing") {
      setWake("processing");
      setStatusText("Pensando…");
    } else if (p === "speaking") {
      setWake("speaking");
      setStatusText("Copernico falando…");
    } else {
      setWake("idle");
    }
  };

  const stopRecorder = () => {
    recorderActiveRef.current = false;
    try {
      recorderRef.current?.stop();
    } catch {
      /* noop */
    }
  };

  // Feeds one frame through smoothing + VAD; shared by rAF and the backup interval.
  const processFrame = (raw: number, wave: Float32Array | null, now: number) => {
    const ema = emaRef.current + (raw - emaRef.current) * EMA_ALPHA;
    emaRef.current = ema;
    if (wave) {
      const vw = vizWave.current;
      for (let i = 0; i < vw.length; i++) {
        const v = i < wave.length ? wave[i] : 0;
        vw[i] += (v - vw[i]) * EMA_ALPHA;
      }
    }
    const vad = vadRef.current;
    if (vad && phaseRef.current === "listening" && recorderActiveRef.current) {
      const nz = noiseRef.current;
      // The floor follows the room only while unarmed and quiet, so it can
      // never chase live speech upward mid-utterance.
      if (!vad.armed && raw < offThreshold(nz.floor)) {
        nz.floor += (raw - nz.floor) * 0.002;
      }
      const wasArmed = vad.armed;
      const verdict = vadUpdate(vad, ema, nz.floor, now);
      if (!wasArmed && vad.armed) {
        setHeard(true);
        if (nudgedRef.current) {
          nudgedRef.current = false;
          setStatusText("Sua vez — fale naturalmente…");
        }
      }
      if (manualHoldRef.current) {
        // Held turns ignore automation, except the hard watchdog.
        if (verdict === "watchdog") {
          dbgRef.current.stop = "fim: 25s";
          stopRecorder();
        }
      } else if (verdict === "speech-end") {
        dbgRef.current.stop = "fim: silêncio";
        stopRecorder();
      } else if (verdict === "empty") {
        dbgRef.current.stop = "fim: sem voz";
        stopRecorder();
      } else if (verdict === "watchdog") {
        dbgRef.current.stop = "fim: 25s";
        stopRecorder();
      } else if (!vad.armed && !nudgedRef.current && now - vad.startedAt > NUDGE_MS) {
        nudgedRef.current = true;
        setStatusText("Ainda não ouvi sua voz — fale ou segure o botão…");
      }
    }
    dbgRef.current.rms = raw;
    dbgRef.current.ema = ema;
    const target = Math.min(1, ema * 5.5);
    level.current = Math.max(target, level.current * 0.86);
  };

  // Live level loop: reads whichever analyser is active for the phase.
  // Backup interval below replays the same decisions for throttled tabs.
  useEffect(() => {
    const downsample = (buf: Uint8Array, out: Float32Array) => {
      const step = buf.length / out.length;
      for (let i = 0; i < out.length; i++) {
        let s = 0;
        const a = Math.floor(i * step);
        const b = Math.floor((i + 1) * step);
        for (let j = a; j < b; j++) s += (buf[j] - 128) / 128;
        out[i] = s / Math.max(1, b - a);
      }
    };
    const tick = () => {
      const analyser = phaseRef.current === "speaking" ? aiAnalyserRef.current : micAnalyserRef.current;
      if (analyser && (phaseRef.current === "listening" || phaseRef.current === "speaking")) {
        const buf = bufRef.current;
        analyser.getByteTimeDomainData(buf);
        downsample(buf, waveTmpRef.current);
        processFrame(rmsOf(buf), waveTmpRef.current, performance.now());
      } else {
        level.current *= 0.86;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    intervalRef.current = window.setInterval(() => {
      if (stoppedRef.current) return;
      const analyser = phaseRef.current === "speaking" ? aiAnalyserRef.current : micAnalyserRef.current;
      if (!analyser) return;
      if (phaseRef.current !== "listening" && phaseRef.current !== "speaking") return;
      const buf = bufRef.current;
      try {
        analyser.getByteTimeDomainData(buf);
      } catch {
        return;
      }
      const tmp = new Float32Array(96);
      downsample(buf, tmp);
      processFrame(rmsOf(buf), tmp, performance.now());
    }, 500);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Records one turn; resolves with the audio (or null when aborted). */
  const listenOnce = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (stoppedRef.current || !streamRef.current) return resolve(null);
      try {
        const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/wav"];
        const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
        const rec =
          mime
            ? new MediaRecorder(streamRef.current, { mimeType: mime })
            : new MediaRecorder(streamRef.current);
        mimeRef.current = rec.mimeType || "audio/webm";
        chunksRef.current = [];
        turnResolveRef.current = resolve;
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onerror = () => {
          recorderActiveRef.current = false;
          turnResolveRef.current = null;
          resolve(null);
        };
        rec.onstop = () => {
          recorderActiveRef.current = false;
          turnResolveRef.current = null;
          const blob = new Blob(chunksRef.current, { type: mimeRef.current });
          chunksRef.current = [];
          resolve(stoppedRef.current ? null : blob);
        };
        recorderRef.current = rec;
        const now = performance.now();
        turnStartedAtRef.current = now;
        vadRef.current = newVadState(now);
        nudgedRef.current = false;
        dbgRef.current.stop = "";
        setHeard(false);
        recorderActiveRef.current = true;
        rec.start(250);
        setPhaseBoth("listening");
      } catch (err) {
        console.error("Voice session listen error:", err);
        setFatalError(err instanceof Error ? err.message : String(err));
        resolve(null);
      }
    });
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob): Promise<string> => {
    const ab = await blob.arrayBuffer();
    return cleanTranscript(await api.transcribeAudio(new Uint8Array(ab), blob.type));
  }, []);

  /** Speaks AI text; always resolves (playback failure never stalls the loop). */
  const speakOnce = useCallback(async (text: string): Promise<void> => {
    if (stoppedRef.current) return;
    setPhaseBoth("speaking");
    onSpeakStartRef.current?.();
    try {
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 45000);
      let buf: ArrayBuffer;
      try {
        const r = await fetch(`${getBackendUrl()}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`TTS ${r.status}`);
        buf = await r.arrayBuffer();
      } finally {
        window.clearTimeout(timeout);
      }
      if (stoppedRef.current) return;
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      aiAudioRef.current = audio;
      const ctx = ctxRef.current;
      if (ctx) {
        try {
          const src = ctx.createMediaElementSource(audio);
          const an = ctx.createAnalyser();
          an.fftSize = 2048;
          src.connect(an);
          an.connect(ctx.destination);
          aiAnalyserRef.current = an;
        } catch {
          aiAnalyserRef.current = null;
        }
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          URL.revokeObjectURL(url);
          try {
            aiAnalyserRef.current?.disconnect();
          } catch {
            /* noop */
          }
          aiAnalyserRef.current = null;
          if (aiAudioRef.current === audio) aiAudioRef.current = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        window.setTimeout(done, 120000); // absolute playback ceiling
        void audio.play().catch(done);
      });
    } catch (err) {
      console.error("Voice session TTS error:", err);
    } finally {
      onSpeakEndRef.current?.();
    }
  }, []);

  /** The loop: every await resolves, every stall has a timeout. */
  const runLoop = useCallback(async () => {
    while (!stoppedRef.current) {
      const blob = await listenOnce();
      if (stoppedRef.current) break;
      if (!blob || blob.size === 0) continue;
      setPhaseBoth("processing");
      let text = "";
      try {
        text = await transcribeBlob(blob);
      } catch (err) {
        console.error("Voice session STT error:", err);
        sttFailsRef.current += 1;
        const suffix = sttFailsRef.current >= 3 ? " Verifique a conexão/GROQ_API_KEY." : "";
        if (!stoppedRef.current) {
          setStatusText(`Falha na transcrição (${String(err).slice(0, 80)}). Fale de novo…${suffix}`);
        }
        continue;
      }
      if (stoppedRef.current) break;
      if (!text) {
        sttFailsRef.current = 0;
        if (!stoppedRef.current) setStatusText("Não ouvi nada — fale de novo…");
        continue;
      }
      sttFailsRef.current = 0;
      let reply: string | null = null;
      try {
        reply = await onUserTurnRef.current(text);
      } catch (err) {
        console.error("Voice session turn error:", err);
      }
      if (stoppedRef.current) break;
      if (reply && reply.trim()) await speakOnce(reply);
    }
  }, [listenOnce, transcribeBlob, speakOnce]);

  /** Measures the room's noise floor so thresholds fit any mic/gain. */
  const calibrate = useCallback(async () => {
    setStatusText("Calibrando microfone…");
    const samples: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        if (stoppedRef.current) return resolve();
        const an = micAnalyserRef.current;
        if (an) {
          an.getByteTimeDomainData(bufRef.current);
          samples.push(rmsOf(bufRef.current));
        }
        if (performance.now() - t0 < CALIBRATE_MS) requestAnimationFrame(sample);
        else resolve();
      };
      sample();
    });
    if (stoppedRef.current || samples.length === 0) return;
    // Median resists door slams mid-calibration; the gate owns sensitivity.
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (avg < 0.0005) {
      setStatusText("Nenhum sinal do microfone — confira a entrada de áudio do sistema.");
      noiseRef.current = { floor: 0.002 };
      return;
    }
    noiseRef.current = { floor: Math.min(0.06, Math.max(0.002, median)) };
  }, []);

  const start = useCallback(async () => {
    stoppedRef.current = false;
    setFatalError(null);
    sttFailsRef.current = 0;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microfone não suportado neste navegador.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stoppedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio não suportado.");
      const ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      // Analyser smoothing intentionally left at default: per MDN it shapes
      // only frequency-domain reads, while this session uses time-domain
      // data plus an explicit JS EMA.
      src.connect(an);
      micAnalyserRef.current = an;
      await calibrate();
      void runLoop();
    } catch (err) {
      console.error("Voice session start error:", err);
      setFatalError(err instanceof Error ? err.message : String(err));
      setPhaseBoth("idle");
      stoppedRef.current = true;
    }
  }, [calibrate, runLoop]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    turnResolveRef.current?.(null);
    turnResolveRef.current = null;
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(intervalRef.current);
    stopRecorder();
    recorderRef.current = null;
    if (aiAudioRef.current) {
      try {
        aiAudioRef.current.pause();
      } catch {
        /* noop */
      }
      aiAudioRef.current = null;
    }
    aiAnalyserRef.current = null;
    micAnalyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    level.current = 0;
    emaRef.current = 0;
    vadRef.current = null;
    nudgedRef.current = false;
    manualHoldRef.current = false;
    useVoiceStore.getState().setWakeStatus("idle");
    setPhaseBoth("idle");
  }, []);

  useEffect(() => stop, [stop]);

  /** Manual override: tapping the orb ends the turn immediately. */
  const forceSend = useCallback(() => {
    if (stoppedRef.current) return;
    if (phaseRef.current === "listening" && recorderActiveRef.current) {
      manualHoldRef.current = false;
      dbgRef.current.stop = "fim: manual";
      setStatusText("Enviando…");
      stopRecorder();
    }
  }, []);

  /** Hold-to-talk: press suspends auto-stop, release sends. Deterministic. */
  const holdStart = useCallback(() => {
    if (stoppedRef.current || phaseRef.current !== "listening") return;
    manualHoldRef.current = true;
    setStatusText("Gravando — solte para enviar…");
  }, []);

  const holdEnd = useCallback(() => {
    if (!manualHoldRef.current) return;
    forceSend();
  }, [forceSend]);

  /** One-line live snapshot for the on-screen diagnostic. */
  const getDebug = useCallback(() => {
    const d = dbgRef.current;
    const rec = recorderActiveRef.current ? "gravando" : "—";
    const on = onThreshold(noiseRef.current.floor, DEFAULT_VAD);
    const t = recorderActiveRef.current
      ? Math.max(0, (performance.now() - turnStartedAtRef.current) / 1000)
      : 0;
    return `${phaseRef.current} · rms ${d.rms.toFixed(3)} · ema ${d.ema.toFixed(3)} · piso ${noiseRef.current.floor.toFixed(3)} · on ${on.toFixed(3)} · ${rec} · t+${t.toFixed(0)}s${d.stop ? ` · ${d.stop}` : ""}`;
  }, []);

  return { phase, statusText, fatalError, heard, level, vizWave, start, stop, forceSend, holdStart, holdEnd, getDebug };
}
