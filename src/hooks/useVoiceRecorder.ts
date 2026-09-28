import { useState, useRef, useEffect } from "react";
import { api } from "../api";
import { cleanTranscript } from "../utils/transcriptCleaner";

const isNative = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Mirrors MANUAL_MAX_SECS in manual_capture.rs — auto-sends before the cap. */
const MANUAL_MAX_SECONDS = 120;

interface UseVoiceRecorderOptions {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (origin: "text" | "voice", textOverride?: string) => void;
  onSetOrigin?: (origin: "text" | "voice") => void;
  onMicStart?: () => void;
  isWakeRecording?: boolean;
  onDiscardWakeRecording?: () => void;
}

export function useVoiceRecorder({
  value,
  onChange,
  onSubmit,
  onSetOrigin,
  onMicStart,
  isWakeRecording,
  onDiscardWakeRecording,
}: UseVoiceRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [sttError, setSttError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discardAudioRef = useRef(false);
  const shouldAutoSubmitRef = useRef(false);
  const sendRecordingRef = useRef(() => {});

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const stopTimerAndStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const showError = (msg: string, timeoutMs = 5000) => {
    setSttError(msg);
    setTimeout(() => setSttError(null), timeoutMs);
  };

  const transcribeAndSubmit = async (
    audioBytes: Uint8Array | number[],
    mimeType: string,
    autoSubmit: boolean
  ) => {
    setIsTranscribing(true);
    try {
      const transcript = await api.transcribeAudio(audioBytes, mimeType);
      const cleaned = cleanTranscript(transcript || "");
      if (cleaned) {
        const newText = value.trim() ? `${value.trim()} ${cleaned}` : cleaned;
        onChange(newText);
        if (onSetOrigin) onSetOrigin("voice");
        if (autoSubmit) onSubmit("voice", newText);
      }
    } catch (err) {
      console.error("Transcription error:", err);
      showError(`Erro na transcrição: ${String(err)}`, 4000);
    } finally {
      setIsTranscribing(false);
      setRecordingSeconds(0);
    }
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => {
        const next = prev + 1;
        if (next >= MANUAL_MAX_SECONDS) {
          sendRecordingRef.current();
        }
        return next;
      });
    }, 1000);
  };

  // ---- Browser path (web preview only; Tauri uses the Rust backend mic) ----
  const startBrowserRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microfone não suportado no ambiente atual.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/wav",
    ];
    const selectedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || "";

    const recorder = selectedMime
      ? new MediaRecorder(stream, { mimeType: selectedMime })
      : new MediaRecorder(stream);

    audioChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      stopTimerAndStream();
      if (discardAudioRef.current) {
        audioChunksRef.current = [];
        setIsTranscribing(false);
        setRecordingSeconds(0);
        discardAudioRef.current = false;
        return;
      }

      const autoSubmit = shouldAutoSubmitRef.current;
      shouldAutoSubmitRef.current = false;

      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      audioChunksRef.current = [];
      const arrayBuffer = await blob.arrayBuffer();
      await transcribeAndSubmit(new Uint8Array(arrayBuffer), blob.type, autoSubmit);
    };

    recorder.start(250);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);
    startTimer();
  };

  const startRecording = async () => {
    api.fadeOutTts(300).catch(() => {});
    if (onMicStart) onMicStart();
    setSttError(null);
    discardAudioRef.current = false;
    shouldAutoSubmitRef.current = false;

    if (isNative()) {
      // Rust backend owns the mic (same cpal device as wake). The
      // start_manual_recording command pauses wake detection, releases the
      // wake stream and opens a dedicated capture — no browser getUserMedia.
      try {
        await api.startManualRecording();
      } catch (err) {
        console.error("Manual recording start error:", err);
        showError(String(err) || "Microfone indisponível.");
        return;
      }
      setIsRecording(true);
      setRecordingSeconds(0);
      startTimer();
      return;
    }

    try {
      await startBrowserRecording();
    } catch (err: unknown) {
      console.error("Microphone access error:", err);
      const errName =
        typeof err === "object" && err !== null && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      const errMsg = err instanceof Error ? err.message : String(err);

      if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
        showError(
          "Permissão do microfone negada. Verifique as configurações de privacidade do sistema/navegador."
        );
      } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
        showError("Nenhum microfone encontrado. Verifique se o dispositivo de áudio está conectado.");
      } else if (errName === "NotReadableError" || errName === "TrackStartError") {
        showError("O microfone está em uso por outra aplicação ou indisponível.");
      } else if (errName === "OverconstrainedError") {
        showError("Configuração do microfone não suportada pelo dispositivo.");
      } else {
        showError(errMsg || "Acesso ao microfone negado ou não encontrado.");
      }
    }
  };

  const stopRecording = () => {
    stopTimerAndStream();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const sendRecording = async () => {
    if (isTranscribing) return;
    discardAudioRef.current = false;
    shouldAutoSubmitRef.current = true;

    if (isNative()) {
      // Backend capture path: stop, transcribe, auto-submit.
      stopTimerAndStream();
      setIsRecording(false);
      const wavBytes = await (async () => {
        try {
          return await api.stopManualRecording(false);
        } catch (err) {
          console.error("Manual recording stop error:", err);
          showError(String(err) || "Falha ao finalizar gravação.");
          return null;
        }
      })();
      if (wavBytes && wavBytes.length > 0) {
        await transcribeAndSubmit(wavBytes, "audio/wav", true);
      } else {
        setRecordingSeconds(0);
      }
      shouldAutoSubmitRef.current = false;
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      stopRecording();
    } else {
      setIsRecording(false);
      stopTimerAndStream();
      setRecordingSeconds(0);
    }
  };
  sendRecordingRef.current = sendRecording;

  const discardRecording = async () => {
    discardAudioRef.current = true;
    shouldAutoSubmitRef.current = false;

    if (isNative()) {
      // Manual capture only — never touches a concurrent wake turn.
      try {
        await api.stopManualRecording(true);
      } catch (err) {
        console.warn("Failed to discard manual recording:", err);
      }
      stopTimerAndStream();
      setRecordingSeconds(0);
      setIsRecording(false);
      return;
    }

    stopTimerAndStream();
    setRecordingSeconds(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    audioChunksRef.current = [];
    setIsRecording(false);
  };

  // NOTE: wake-driven recording is backend-owned (Rust records the turn).
  // The frontend must NOT open the browser mic on `isWakeRecording` — that
  // was the permission-error + fade-spam source. `isWakeRecording` is
  // display-only; cancelling a wake turn goes through onDiscardWakeRecording.

  return {
    isRecording: isRecording || !!isWakeRecording,
    isManualRecording: isRecording,
    isTranscribing,
    recordingSeconds,
    sttError,
    startRecording,
    stopRecording,
    sendRecording,
    discardRecording,
  };
}
