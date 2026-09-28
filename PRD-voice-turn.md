# PRD — Voice Turn-Taking (`PRD-voice-turn.md`)

Date: 2026-09-27 · Status: ready for build · Owner brief: `handoff.md`
Scope: `src/hooks/useVoiceSession.ts`, debug-line and `heard` wiring in `src/components/VoiceSessionView.tsx`, one new pure module `src/utils/vadGate.ts` (+ tests). No orb visual changes (see `PRD-orb.md`), no `api.ts` contract changes, no `backend/` changes, no `src-tauri/`.

---

## 1. Goals / non-goals

Goals:

1. **Turn 2+ sends exactly like turn 1** on quiet mics (voice RMS ~1.5× room floor): speech arms detection reliably, end-of-speech fires ~1 s after the user stops, the loop proceeds to STT → chat → TTS.
2. **Never stranded:** every listening turn ends by exactly one cause (silence / empty / watchdog / manual) within a bounded time; the `runLoop` always advances.
3. **Deterministic manual overrides** (tap orb, hold button, Space) that win over automation in defined precedence.
4. **Honest diagnostics:** the on-screen debug line proves where every turn stands.

Non-goals:

- No server-side VAD, no chunked/streaming STT, no Whisper `vad_filter` flags (Groq API surface stays as-is).
- No wake-word resurrection, no barge-in (interrupting TTS by voice) — out of scope; user ends speech via Encerrar/exit.
- No orb repaint (companion PRD owns it).

---

## 2. Research summary — why turn 2 stalls, and the principled fix

### 2.1 Quantitative diagnosis of the current gate

Screenshot evidence: `rms 0.006 · piso 0.004 · gravando`, flat meter while talking.

1. **Calibration inflates the floor, then the multiplier finishes the job.** `calibrate()` sets `floor = max(0.004, avg × 1.4)`. A quiet room averaging 0.004 RMS → floor 0.0056. The speech gate `floor × 1.2` → **0.0067 > voice 0.006**: real speech never crosses, `hadVoice` never arms, silence detection never starts. The turn then *correctly* waits for the 7 s empty-turn cutoff — which the user experiences as "records forever". Root cause confirmed: **threshold arithmetic, not a stuck state machine.**
2. **`smoothingTimeConstant = 0.82` is a no-op here.** Verified against MDN (`AnalyserNode.smoothingTimeConstant`): the constant applies to `getByteFrequencyData`/`getFloatFrequencyData` only. Both the VAD RMS and `vizWave` use `getByteTimeDomainData` — unsmoothed raw frames. Consequence: single-frame noise spikes can arm speech, and frame-to-frame RMS jitter (±30% on quiet mics) makes any single-frame threshold flaky in both directions. Fix in JS with an explicit EMA (owned by this PRD for the VAD path; orb path in `PRD-orb.md`).
3. **Single threshold, no hysteresis margin.** `speechTh = floor×1.2`, `silenceTh = floor×1.05`: only 14% apart. With jitter, the gate chatters at the boundary — arming and un-arming within one utterance. A proper VAD separates ON and OFF with a hangover measured in time, not just level.
4. **rAF-only supervision throttles in background tabs.** Silence/watchdog checks live inside the `requestAnimationFrame` tick. A hidden or throttled tab stops rAF while `MediaRecorder` keeps recording → the turn outlives all timeouts until the tab regains focus. Needs an interval backup driving the same decision function.

### 2.2 Chosen approach: dual-gate energy VAD with hangover (not ML VAD)

Rationale: a full ML VAD (Silero, RNNoise, `webrtcvad` port) is unjustified here — Whisper itself is the final arbiter of "was that speech" (empty transcript = no speech), so the client gate only needs to answer *"when did the utterance end"* cheaply and robustly at 60 Hz. A calibrated dual-threshold energy gate with hangover is the standard solution (used by Mumble, Jitsi, and every push-to-talk meter), provided the arithmetic respects low-SNR mics:

- Calibrate to the room's **median** (robust to coughs/clicks during calibration), no ×1.4 inflation, absolute clamp below.
- **ON gate = min(relative, absolute-delta)**: whichever is more sensitive fires. This is the low-SNR fix — on quiet mics the absolute delta wins; on loud rooms the relative ratio wins.
- **OFF gate = lower threshold + sustained hangover** (time, not level).
- **Frame confirmation counters** both ways (3 frames to arm, hangover ms to release) so spikes and dropouts can't flip the state.
- All decision logic in a **pure, unit-tested function**; the rAF/interval loops only feed it frames and honor its verdict.

### 2.3 Worked arithmetic (quiet mic from the screenshot)

Room median 0.004 → `floor = 0.004` (no inflation; clamp [0.002, 0.06]).
`onTh = min(0.004 × 1.25, 0.004 + 0.002) = min(0.0050, 0.0060) = 0.0050` < voice 0.006 → **arms** (3 consecutive EMA frames above).
`offTh = max(0.004 × 1.08, 0.0025) = 0.0043`; release after 900 ms continuously below → turn sends ~0.9–1.1 s after speech ends.
Old gate on the same mic: `0.0056 × 1.2 = 0.0067` → never arms. The fix is one calibration change + one threshold change, both covered by tests below.

---

## 3. User stories

1. As a soft-spoken user, I talk naturally on turn 2 and the turn sends ~1 s after I stop, exactly like turn 1.
2. As a user in a noisy room, my turn doesn't cut mid-sentence (hangover + floor tracking), nor hang forever (watchdog).
3. As a user whose speech wasn't caught, I see within 3 s that "no voice yet" and know to tap the orb or hold the button.
4. As a user holding the button/Space, auto-stop never steals my turn; release always sends.
5. As the debugging owner, the debug line tells me unambiguously why any turn ended.

---

## 4. Turn-taking state machine

```
 idle → listening → processing → speaking → listening … (loop until stop)
              ↑_______________| (empty transcript / STT fail → back to listening)
 overrides: listening --tap/hold-release--> processing (force send)
            listening --hold-start--> held (auto-stop suspended) --hold-release--> processing
            any --stop/exit--> idle (recorder aborted, loop exits)
```

Transition table (every row is implemented in `runLoop`/`listenOnce` or the VAD tick; every `listening` exit sets `motivo`):

| From | Event | To | Notes |
|------|-------|----|-------|
| `idle` | `start()` (mic granted, calibrated) | `listening` | fresh `MediaRecorder` per turn (`listenOnce`) |
| `listening` | VAD verdict `speech-end` (hadVoice + hangover) | `processing` | motivo `fim: silêncio` |
| `listening` | no arm within `EMPTY_TURN_MS` | `listening` (new turn) | motivo `fim: sem voz`; zero-length/empty blobs skip STT silently |
| `listening` | `elapsed > MAX_TURN_MS` | `processing` | motivo `fim: 25s`; blob sent regardless (Whisper decides) |
| `listening` | tap orb / hold-release / Space-up | `processing` | motivo `fim: manual`; takes precedence over all auto causes |
| `listening` | hold-start / Space-down | `held` (sub-state) | VAD verdicts ignored; elapsed timers keep running (watchdog still applies) |
| `held` | hold-release | `processing` | motivo `fim: manual` |
| `processing` | STT ok, text non-empty | `processing` (chat) → `speaking` | `onUserTurn` → `speakOnce` |
| `processing` | STT error | `listening` | status shows failure string (§7); loop continues |
| `processing` | empty transcript | `listening` | status "Não ouvi nada — fale de novo…"; no error styling (not a failure) |
| `speaking` | playback end / error / 120 s ceiling | `listening` | TTS failure never stalls: `speakOnce` always resolves |
| any | `stop()` / Encerrar / unmount | `idle` | recorder aborted, tracks stopped, ctx closed (existing teardown) |

Loop invariant (existing, keep): **every await in `runLoop` resolves; every stall has a timeout.** This PRD adds: every `listening` exit records `motivo`; `getDebug()` exposes it until the next turn starts.

---

## 5. VAD spec (`src/utils/vadGate.ts` + hook wiring)

### 5.1 New pure module — the only place thresholds live

```ts
// src/utils/vadGate.ts (all pure, fully unit-tested — no Web Audio imports)
export interface VadConfig {
  onRatio: number;      // 1.25 — speech-on vs floor
  onDelta: number;      // 0.002 — absolute speech-on margin (low-SNR path)
  offRatio: number;     // 1.08 — release level vs floor
  offFloor: number;     // 0.0025 — absolute release clamp
  armFrames: number;    // 3 — consecutive hot frames to arm
  hangoverMs: number;   // 900 — continuous cold time to release
  silenceMs: number;    // = hangoverMs alias for debug naming; keep one field
  minSpeechMs: number;  // 500 — releases before this are ignored (click guard)
  emptyTurnMs: number;  // 5000 — no-arm cutoff (§5.4)
  maxTurnMs: number;    // 25000 — hard watchdog (unchanged)
}
export const DEFAULT_VAD: VadConfig = { …values above… };
export interface VadState { armed: boolean; hotRun: number; lastHotAt: number; startedAt: number; }
export function onThreshold(floor: number, cfg: VadConfig): number;   // min(floor*onRatio, floor+onDelta)
export function offThreshold(floor: number, cfg: VadConfig): number;  // max(floor*offRatio, offFloor)
export type VadVerdict = "continue" | "speech-end" | "empty" | "watchdog";
export function vadUpdate(state: VadState, emaRms: number, floor: number, nowMs: number, cfg: VadConfig): VadVerdict;
```

`vadUpdate` rules: hot = `emaRms > onTh`; `hotRun` counts consecutive hot frames, arm at `armFrames`; once armed, `lastHotAt` refreshes on any frame above `offTh`; verdict `speech-end` when armed && `nowMs − lastHotAt > hangoverMs` && `nowMs − startedAt > minSpeechMs`; `empty` when !armed && elapsed > `emptyTurnMs`; `watchdog` when elapsed > `maxTurnMs` (checked last, lowest priority after manual). Manual override bypasses the function entirely (hook-level, §5.5).

### 5.2 Calibration (hook `calibrate()`)

- Window 1200 ms (up from 900 — one extra room cycle for stability), collect RMS frames.
- `floor = clamp(median(samples), 0.002, 0.06)`. Median, not mean×1.4: robust to a door slam mid-calibration; no inflation (the ON gate's own margins own sensitivity now).
- `avg < 0.0005` → keep existing "Nenhum sinal do microfone" warning, plus set floor 0.002 (fail-open sensitive rather than fail-closed deaf).
- `heard` resets per turn (existing).

### 5.3 Per-frame path (hook rAF tick + interval backup)

1. Read `getByteTimeDomainData`, compute raw RMS (existing `rmsOf`, unchanged).
2. `ema += (raw − ema) × 0.35` (new; replaces reliance on the no-op analyser smoothing — **leave `smoothingTimeConstant` at default 0.8**, it only affects frequency data; add a code comment citing this so nobody "tunes" it again).
3. Floor tracking: only when NOT armed and `raw < offTh`: `floor += (raw − floor) × 0.002` (halved from 0.004 — slower drift can't chase quiet speech upward mid-utterance; armed state freezes the floor).
4. Feed `ema` to `vadUpdate`; on non-`continue` verdict call the existing `stopRecorder()` and set `motivo`.
5. Drive orb `level`/`vizWave` from `ema` (same value the gate uses — meter and gate can never disagree again). `vizWave` keeps its downsampling; add the same α=0.35 per-bin EMA (orb PRD renders it).
6. **Interval backup:** `setInterval(500 ms)` calls the identical update with the latest frame (or forces a fresh `getByteTimeDomainData` read). Covers hidden-tab rAF throttle; verdicts and `motivo` identical. Cleared on stop/unmount alongside rAF.

### 5.4 Timeouts

| Timer | Value | Rationale |
|-------|-------|-----------|
| `hangoverMs` / `SILENCE_MS` | 900 ms | standard end-of-utterance hangover; shorter than 1000 ms so turns feel snappy, long enough for mid-sentence pauses |
| `MIN_SPEECH_MS` | 500 ms | click/pop guard (was 600; 500 with 3-frame arming is strictly safer) |
| `EMPTY_TURN_MS` | 5000 ms | was 7000 — 7 s of dead air reads as "frozen". At 3 s without arming, show the nudge (§7) so the last 2 s are explained |
| `MAX_TURN_MS` | 25000 ms | unchanged hard ceiling; motivo `fim: 25s` |

### 5.5 Manual affordances and precedence

Precedence (highest first): `stop`/exit > hold-release/tap/Space-up (`fim: manual`) > watchdog > speech-end > empty. While `held`, VAD verdicts are computed but ignored (keeps `lastHotAt` fresh so release-after-speech ends instantly); watchdog still fires under hold (a 25 s held turn is a stuck finger, send it). Tap orb during `processing`/`speaking`: no-op (unchanged). `forceSend` on an un-armed turn sends anyway — Whisper returns empty, loop continues (fail-open, never strand).

### 5.6 What explicitly does NOT change

`MediaRecorder` lifecycle per turn, mime fallback list, `transcribeBlob` → `api.transcribeAudio`, `speakOnce` (fetch `/api/tts` directly — pre-existing exception to the `api.ts` rule, out of scope), badge sync via `useVoiceStore`, `runLoop` structure. No backend changes: Whisper remains the final speech arbiter.

---

## 6. Failure modes & recovery

| Mode | Detection | Recovery (all automatic except denied-mic) |
|------|-----------|---------------------------------------------|
| Mic denied / no `getUserMedia` | `start()` catch | existing `fatalError` string; view shows it with mic-check guidance (§7). No loop starts. |
| No signal (`avg < 0.0005`) | calibration | warning status + fail-open floor 0.002; loop still runs (a wrong "deaf" is worse than a sensitive gate). |
| STT error (network/Groq) | `transcribeBlob` throw | status `Falha na transcrição (…). Fale de novo…`; back to `listening`. 3 consecutive STT failures → status adds "verifique a conexão/GROQ_API_KEY" (counter, reset on success). |
| Empty transcript (silence/whispered too soft) | `!text` | status `Não ouvi nada — fale de novo…`; back to `listening`. Not styled as error. |
| TTS error | `speakOnce` catch | logged; caption keeps assistant text (readable in transcript); straight to `listening`. |
| Tab hidden/throttled | `document.visibilitychange` | interval backup (§5.3.6) keeps verdicts live; on visible again, rAF resumes seamlessly (shared pure state). |
| Recorder `onerror` / zero-byte blob | existing handlers | resolve/skip → next `listening` turn (unchanged). |

---

## 7. UX copy (pt-BR — exact strings)

| Situation | String | Location |
|-----------|--------|----------|
| Calibrating | `Calibrando microfone…` | statusText (unchanged) |
| Listening, no arm yet (< 3 s) | `Sua vez — fale naturalmente…` | statusText (unchanged) |
| Listening, 3 s no arm | `Ainda não ouvi sua voz — fale ou segure o botão…` | new nudge status (reverts on arm) |
| Armed | `Ouvindo você` (chip) + caption unchanged | `heard` chip (unchanged) |
| Sending | `Enviando…` | (unchanged) |
| Thinking | `Pensando…` | (unchanged) |
| STT fail | `Falha na transcrição ({curto}). Fale de novo…` | (unchanged) + escalation suffix after 3× |
| Empty | `Não ouvi nada — fale de novo…` | new (replaces silent skip) |
| TTS fail (caption only) | transcript remains; no new string | — |
| No signal | `Nenhum sinal do microfone — confira a entrada de áudio do sistema.` | (unchanged) |
| Hint row | `Solte para enviar • Espaço também funciona • Toque no orbe para enviar na hora` | (unchanged) |

---

## 8. Diagnostics contract (debug line)

Keep the one-line format, extend with gate internals. New format:

```
{fase} · rms {raw} · ema {ema} · piso {floor} · on {onTh} · {gravando|—} · t+{s}s[ · {motivo}]
```

- `fase`: `listening|processing|speaking|idle` — proves loop position.
- `rms`: raw frame RMS — proves the mic delivers signal at all.
- `ema`: smoothed value the gate actually decides on — proves smoothing isn't eating speech (`ema ≈ rms` expected; divergence = bug).
- `piso`: live floor — proves calibration/tracking (should sit ≈ room, never chase speech upward mid-turn).
- `on`: effective ON threshold — proves the gate arithmetic; **the turn-2 test is "speak and watch ema cross on"**.
- `t+{s}s`: seconds since turn start — proves timeouts are approaching (empty ≤ 5 s, watchdog 25 s).
- `motivo`: sticky last-stop cause (`fim: silêncio|sem voz|25s|manual`) — proves every exit had exactly one cause.
- Update at 4 Hz (existing interval). `aria-hidden` (diagnostic).

`getDebug()` return type stays `string`; fields appended, never reordered (owner screenshots stay comparable).

---

## 9. Verification

1. `pnpm build` green; `pnpm test:unit` green **including new `vadGate.test.ts`**:
   - ON gate: floor 0.004 → `onThreshold` 0.0050; stream [0.004 ×10, 0.0062 ×3, …] arms on the 3rd hot frame.
   - No-arm: stream pinned at 0.0045 → verdict `empty` only after `emptyTurnMs`, never `speech-end`.
   - Hangover: armed stream dropping to 0.003 → `speech-end` only after 900 ms cold; a mid-pause blip above `offTh` resets the clock.
   - Spike rejection: single 0.05 frame ×1–2 surrounded by floor → never arms.
   - Watchdog: pinned-hot stream (user reading aloud 30 s) → `watchdog` at 25 s, not before.
   - Threshold ordering invariant: `offThreshold < onThreshold` for floor ∈ [0.002, 0.06].
2. `python3 backend/smoke_test.py` green (backend untouched — sanity).
3. **Multi-turn manual script** (owner runs, `http://localhost:1420`, quiet/natural voice, debug line visible):
   - [ ] T1 normal voice → auto-sends ≤ ~1.5 s after stopping; reply plays.
   - [ ] T2 quiet voice (the failing case) → `ema` crosses `on` on the debug line, `heard` chip appears, auto-sends ≤ ~1.5 s after stopping.
   - [ ] T3 started while previous TTS still audible in room → turn still ends (hangover absorbs echo or watchdog caps it); no strand.
   - [ ] Silent 6 s turn → `fim: sem voz` at t+5 s, new turn begins, nudge string seen at ~t+3 s.
   - [ ] Mid-sentence 1 s pause → turn does NOT cut; ends ~0.9 s after the real stop.
   - [ ] Hold-button turn + Space turn + tap-orb turn → all send with `fim: manual`.
   - [ ] Denied-mic path (block permission in devtools) → fatalError guidance, no hung spinner.
   - [ ] All `motivo` values observed at least once across the session (`silêncio`, `sem voz`, `manual`).

---

## 10. Acceptance criteria

1. `vadGate.ts` exists, pure, zero Web-Audio imports; `vadGate.test.ts` passes all cases in §9.1.
2. No threshold literals remain in `useVoiceSession.ts` — all flow through `DEFAULT_VAD`/`vadUpdate` (grep `1\.2|1\.05|7000` in the hook returns nothing).
3. Quiet-voice T2/T3 auto-send like T1 (manual script §9.3, owner-signed).
4. No turn exceeds its bound: silence ≤ hangover + 1 s rAF/interval slack; empty ≤ 6 s; any turn ≤ 26 s (watchdog + slack). Provable from `t+` + `motivo` in a screen recording.
5. `smoothingTimeConstant` no longer set above default in the hook (grep returns nothing); EMA comment cites MDN time-domain behavior.
6. `pnpm build`, `pnpm test:unit`, `backend/smoke_test.py` green. No new `any`; no `api.ts`/backend/`src-tauri` diffs.

---

## 11. Open questions (non-blocking)

1. Should `EMPTY_TURN_MS` drop further (3 s) once the nudge proves itself? Recommendation: ship 5 s, decide from real stuck-reports (debug `motivo` makes this measurable).
2. Barge-in (voice interrupts TTS) is the natural next feature — needs echo-cancellation-grade echo rejection first. Recommendation: explicit non-goal for this PRD.
3. Should the nudge at 3 s also pulse the hold button? Recommendation: no motion; copy only (orb PRD owns animation restraint).
