# Handoff — Voice-Mode Visual + Turn-Taking Research Agent

Date: 2026-09-27
Status: open, uncommitted work in tree
Owner request: prior implementation of the two voice-mode tasks is bad; research properly and write PRDs.

## 1. Mission for the research agent

You are a visual/UX research agent. Do not rewrite `VoiceOrb.tsx` or `useVoiceSession.ts` yet.

Deliver:
1. A researched answer to "how to do an audio-reactive voice orb properly" (web, Canvas 2D, React).
2. Two PRDs:
   - `PRD-orb.md`: reactive orb / voice presence visual, fully inside Copernico palette.
   - `PRD-voice-turn.md`: AI voice-mode turn-taking (talk → hear loop) that works on quiet mics and never strands turn 2+.

Write the PRDs as new files next to this handoff. Keep this file as the brief.

## 2. Product context

- Copernico: local-first desktop/web second brain. Web mode is the default: Python stdlib backend at `http://127.0.0.1:8000` + Vite at `:1420`.
- `src-tauri/` is frozen, read-only. New work goes in `backend/*.py` and `src/`.
- Voice session replaces wake word. Entry: phone button in `AppHeader`. View: `src/components/VoiceSessionView.tsx` — left = reactive stage, right = live chat transcript with working agent tools (`/api/chat` pipeline).
- Voice engine: `src/hooks/useVoiceSession.ts` — explicit async loop `runLoop`: record (`MediaRecorder`) → transcribe (`/api/stt`, Groq Whisper) → respond (`/api/chat`, DeepSeek) → speak (`/api/tts`, edge-tts). Auto-play response, badge sync.
- Backend has no auto-reload; restart after every `backend/*.py` change. Vite hot-reloads frontend.
- Never combine `pkill -f "[b]ackend.server"` with a plain `backend.server` invocation in one shell command — pkill matches its own cmdline and suicides. Kill and start in separate calls.
- No desktop browser is connected to the agent session; the user opens `http://localhost:1420` manually. The on-screen debug line (`fase · rms · piso · gravando · motivo`) is the primary remote diagnostic.

## 3. Copernico palette (must-use tokens)

Source of truth: `src/styles.css` + `src/utils/themeEngine.ts`. Custom themes override via CSS variables; the orb must use variables, not hardcoded neon.

Dark (default):
- `--bg-app: #09090b`, `--bg-card: #18181b`, `--bg-input: #121215`, `--bg-elevated: #27272a`
- `--border-subtle: #27272a`, `--bg-hover: rgba(255,255,255,0.06)`
- `--text-primary: #f4f4f5`, `--text-secondary: #d4d4d8`, `--text-muted: #a1a1aa`
- `--accent: #f59e0b`, `--accent-hover: #d97706`, `--text-accent: #fcd34d`
- `--state-success: #34d399`, `--text-success: #6ee7b7`
- `--text-info: #7dd3fc`, `--text-warning: #fdba74`, `--text-danger: #fca5a5`
- `--focus-ring: rgba(245,158,11,0.58)`

Light:
- `--bg-app: #f4f4f5`, `--bg-card: #ffffff`, `--accent: #d97706`, `--text-accent: #92400e`, plus matching muted/border tokens in `styles.css`.

Current voice colors are off-palette and part of the complaint:
- `VoiceOrb.tsx` uses raw RGB amber `[252,211,77]`, cyan `[103,232,249]`, emerald `[110,231,183]`, zinc `[161,161,170]`.
- `VoiceSessionView.tsx` `AURORA` uses Tailwind `amber-500/orange-800`, `cyan-500/indigo-800`, `emerald-500/teal-800`.
- Requirement: remap phases to Copernico tokens. Suggested direction (validate in research): listening → `--accent` / `--text-accent`; processing → `--text-info`; speaking → `--text-success`; idle → `--text-muted`. Aurora blobs must derive from the same tokens with low opacity, not Tailwind brights.

Motion constraints (repo convention): transform/opacity/canvas only; ease-out (`[0.23,1,0.32,1]`, 120–350ms); respect `prefers-reduced-motion`; no transparent windows or overlays.

## 4. Failure history (what "bad" means)

1. Three orb iterations rejected by the user: "ball is cropped and still really ugly".
   - Crop cause: fixed 320px canvas inside a `flex-1 min-h-0` container with `overflow-hidden` parent; halo/ring drawn past canvas edge. A `ResizeObserver` sizing pass (`orbSize`, 160–340px) was added in `VoiceSessionView.tsx` — verify it is sufficient.
   - Aesthetic cause: stacked conic/radial blobs + triple ring passes read as muddy neon, not premium.
2. Second turn stalls. Screenshot evidence: debug line `listening · rms 0.006 · piso 0.004 · gravando`, mic meter nearly flat while the user talks. Turn 1 sends (often via tap/hold); turn 2 records forever and never sends to the model.
   - Root hypothesis: voice (~0.006 rms) sits ~1.5x above the noise floor (~0.004); historic speech thresholds (`floor × 1.9`, then `× 1.5`) never armed `hadVoice`, so silence detection never started. Current gate: `speechTh = max(floor*1.2, 0.002)`, `silenceTh = max(floor*1.05, 0.002)`, `SILENCE_MS 1000`, `MIN_SPEECH_MS 600`, empty-turn cutoff `EMPTY_TURN_MS 7000`, hard watchdog `MAX_TURN_MS 25000`, analyser `smoothingTimeConstant 0.82`.
   - Research must confirm or replace this gate with a principled VAD approach for low-SNR mics.

## 5. Current implementation snapshot (read before writing PRDs)

- `src/components/VoiceOrb.tsx` (182 lines): canvas orb, DPR-aware, spring energy, phase color lerp, halo + glass body + specular + 3 ring passes (glow/main/echo), quadratic closed curve through 128 pts from `waveRef` (96 samples). Props: `levelRef`, `waveRef`, `phase`, `onTap`, `size`.
- `src/hooks/useVoiceSession.ts` (437 lines): `runLoop`, `listenOnce`, `transcribeBlob`, `speakOnce`, `calibrate` (900ms room floor), adaptive floor update `floor += (raw-floor)*0.004` when quiet, `forceSend` (tap orb), `holdStart/holdEnd` (button + Space), `getDebug()`.
- `src/components/VoiceSessionView.tsx` (319 lines): stage layout, `ResizeObserver` → `orbSize`, captions, `MicMeter`, hold-to-talk button, debug line, transcript column.
- `src/api.ts`: fetch-first backend client, TTS playback, `getBackendUrl()`.
- `backend/voice.py`, `backend/server.py` (~40 routes), `backend/agent.py` (DeepSeek tool loop).
- Frontend rules (`src/AGENTS.md`): strict typing, no new `any`, all backend calls via `api.ts`, keep `pnpm test:unit` green, never recreate transparent-window overlays.

## 6. Task A — orb visual research (how to do it properly)

Research and document:
1. Reference patterns: Siri / Alexa / Gemini Live / ChatGPT voice — what makes their presence orbs read premium (single light source, one core, one ring, restrained glow, slow rotation, breathing).
2. Canvas engineering checklist: bounds math (max drawn radius < 0.5 × size including glow + shadowBlur), DPR handling, `ResizeObserver` sizing, rAF with dt clamp, energy follower tuning (attack/release), waveform smoothing (analyser `smoothingTimeConstant` vs manual EMA vs spline smoothing), `shadowBlur` cost vs pre-rendered glow, reduced-motion fallback.
3. Why the current orb fails: name the specific defects (palette, light model, ring count, glow values, rotation speed, cropping) with before/after direction.
4. Propose 2–3 concrete visual directions inside Copernico tokens, with per-direction: layer stack, gradient stops, ring geometry, motion spec, and phase mapping. Recommend one.

## 7. Task B — PRD: `PRD-orb.md`

Write a build-ready PRD containing: goals / non-goals, user stories, visual spec (layers, tokens, sizes as fractions of canvas, glow/blur budgets), motion spec (springs, rotation, breathing, phase lerp durations, reduced-motion), states (idle/listening/processing/speaking, `heard` indicator), layout contract (stage sizing, min/max, no-crop guarantee, small-viewport behavior), accessibility (tap-to-send target, labels, keyboard), performance (60fps budget, DPR cap), verification (build, unit tests, manual checklist with screenshot positions), acceptance criteria.

## 8. Task C — PRD: `PRD-voice-turn.md`

Write a build-ready PRD containing: goals / non-goals, turn-taking state machine (idle → listening → processing → speaking → listening, plus hold/tap overrides), VAD spec (calibration, adaptive floor, speech/silence thresholds with rationale for low-SNR mics, hangover, empty-turn and watchdog timeouts, hold-to-talk suspension), failure modes (denied mic, STT error, TTS error, empty transcript, tab throttle) with recovery per mode, UX copy (pt-BR strings used in the view), diagnostics contract (keep/extend the debug line; what each field proves), manual interaction affordances (tap orb, hold button, Space) and when each wins, verification (backend smoke, `pnpm build`, `pnpm test:unit`, multi-turn test script: 3 consecutive turns incl. quiet voice), acceptance criteria (turn 2 and 3 send like turn 1; never stuck > N seconds).

## 9. Rules for the research agent

- Read `AGENTS.md`, `src/AGENTS.md`, and the files in section 5 before writing.
- Do not modify the Obsidian vault (`cofres/obsidian/`); it is read-only.
- Do not touch `src-tauri/`.
- No placeholders or mock-only code in PRDs; every acceptance criterion must be testable.
- Keep new `any` types out of any proposed API; route backend calls through `api.ts`.
- Open questions go in a dedicated PRD section; do not block the recommendation on them.

## 10. Suggested starting references

- MDN: `AnalyserNode`, `getByteTimeDomainData`, "Visualizations with Web Audio API" (smoothing, fftSize trade-offs).
- Siri / Apple voice UI, Gemini Live, ChatGPT advanced voice mode: single-core + single-ring language, slow ambient motion.
- Web-audio circular visualizer practice: closed-spline rings, energy followers, rotation decoupled from audio.
