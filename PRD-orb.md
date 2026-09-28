# PRD — Reactive Voice Orb (`PRD-orb.md`)

Date: 2026-09-27 · Status: ready for build · Owner brief: `handoff.md`
Scope: `src/components/VoiceOrb.tsx`, `src/components/VoiceSessionView.tsx` (stage + aurora only), one new pure util for token parsing. No changes to `useVoiceSession.ts` VAD logic, `src/api.ts`, `backend/`, or `src-tauri/`.

---

## 1. Goals / non-goals

Goals:

1. An audio-reactive presence orb that reads premium on first sight: one core, one light source, one ring, restrained glow, slow ambient motion.
2. 100% Copernico palette: every orb/aurora color derives from CSS variables in `src/styles.css` (dark + light + custom themes via `themeEngine.ts`), zero hardcoded RGB phase colors.
3. Provable no-crop: maximum drawn radius (geometry + line width + blur) is a tested invariant ≤ 0.48 × canvas size at any energy level.
4. 60 fps on desktop with DPR cap, no per-frame `shadowBlur` on animated strokes, `prefers-reduced-motion` fallback.

Non-goals:

- No turn-taking/VAD changes (see `PRD-voice-turn.md`).
- No new windows, overlays, or transparency (repo ban stands).
- No new backend routes, no `api.ts` changes, no new `any` types.
- No 3D, particles, or multi-blob gradients.

---

## 2. Research summary — how to do an audio-reactive orb properly

### 2.1 What makes reference orbs read premium

Surveyed patterns (Siri, Alexa, Gemini Live, ChatGPT Advanced Voice):

- **Single light source.** Siri's blob and ChatGPT's circle both imply one offset highlight (upper-left). The eye reads one light = one object = calm. Multiple competing highlights read as clutter.
- **One core + one ring.** Alexa: a single blue ring. ChatGPT voice: a white disc with one dark perimeter. Gemini Live: one gradient wave, not three stacked ones. Restraint is the signal.
- **Glow is ambient, not neon.** Premium glow is a large, low-alpha radial falloff (peak alpha 0.15–0.30) over a dark ground — never a saturated stroke with a hard `shadowBlur` halo.
- **Motion is slow and decoupled.** Breathing periods of 3–6 s, rotation ≤ ~0.35 rad/s, and rotation phase is independent of audio amplitude (audio drives radius/energy only). Fast rotation coupled to loudness reads anxious.
- **State is carried by hue + one motion accent**, not by geometry swaps. Listening breathes, processing pulses slowly, speaking reacts fast to energy, idle is near-still.

### 2.2 Canvas engineering checklist (applies to the build)

1. **Bounds budget first.** Define `R_MAX = 0.48 × size`. Every layer's worst case — base radius + amplitude + lineWidth/2 + blur spread — must fit. Assert it in a unit test over energy ∈ [0, 1], not by eyeballing.
2. **DPR handling.** `canvas.width = size × dpr`, `dpr = min(2, devicePixelRatio)`, `ctx.setTransform(dpr,0,0,dpr,0,0)` once per frame. Cap DPR at 2: DPR 3 quadruples fill cost for no visible gain on a soft orb.
3. **`ResizeObserver` sizing.** Keep the existing observer in `VoiceSessionView.tsx`, but size the canvas from `min(width, height) minus padding reserve` (see §7) so the stage can never offer a box smaller than the drawn content.
4. **rAF with dt clamp.** `dt = min(50 ms, now − last)`. Prevents energy-spring explosions after tab-switch or TTS stalls.
5. **Energy follower: asymmetric attack/release, not a stiff spring.** Attack fast (~10–14/s) so onsets feel live; release slow (~3–5/s) so decay feels silky. The current spring (`k=70, damping=11`) is overdamped and effectively instant — it transmits every mic jitter to the radius.
6. **Waveform smoothing: manual EMA, not `smoothingTimeConstant`.** Verified via MDN (`AnalyserNode.smoothingTimeConstant`): the constant applies to `getByteFrequencyData`/`getFloatFrequencyData` only. The orb path uses `getByteTimeDomainData`, so the current `smoothingTimeConstant = 0.82` has **zero effect** on either the VAD RMS or `vizWave`. Smooth in JS: per-bin EMA (α ≈ 0.35) plus closed-spline (quadratic midpoint) rendering, which the current code already does — keep the spline, add the EMA.
7. **`shadowBlur` cost.** `shadowBlur` forces an offscreen blur pass per stroke. Three ring passes with `shadowBlur: 22` ≈ the most expensive thing on this canvas. Budget: **zero `shadowBlur` on animated strokes**; pre-render static glow to an offscreen sprite on size/phase change and `drawImage` it (one blit, ~free).
8. **Reduced motion.** `matchMedia("(prefers-reduced-motion: reduce)")`: freeze rotation/breathing/energy reaction; render a static core in the phase token color. Phase changes still crossfade color (opacity-only transition is allowed).

### 2.3 Why the current orb fails (defect list)

| # | Defect | Evidence | Direction |
|---|--------|----------|-----------|
| D1 | **Halo clips the canvas (the "cropped ball").** `R = 0.235w × (1 + 0.14·energy) × breathe(≤1.015)` → max ≈ 0.272w; halo radius = 2R ≈ **0.544w > 0.5w**. The code comment claims `2.0·R < 0.5·w`; the arithmetic disproves it. At high energy the halo hard-clips at the canvas edge. | `VoiceOrb.tsx:92,98` | Cap halo at 0.46w (reduce halo factor to ≤1.7 or shrink core; see §4). |
| D2 | **Glow ring also clips.** Ring base 0.37w + amp up to 0.0625w = 0.4325w, plus glow-pass `shadowBlur: 22px` (≈0.069w at 320px) ≈ **0.50w** — kisses the edge exactly when energy peaks. | `VoiceOrb.tsx:136-137,161` | Ring max ≤ 0.40w including line width; blur budget counted, not wished. |
| D3 | **Off-palette neon.** Hardcoded `[252,211,77] / [103,232,249] / [110,231,183]` plus Tailwind `amber-500/cyan-500/emerald-500` aurora. Fully saturated strokes on near-black read cheap next to Copernico's desaturated zinc/amber system. | `VoiceOrb.tsx:8-13`, `VoiceSessionView.tsx:17-22` | Remap to tokens (§4.1); desaturate by mixing toward neutral. |
| D4 | **Three competing light models.** White-hot radial body + offset specular + glow stroke + main stroke + inner echo stroke = five highlights fighting. No single light source. | `VoiceOrb.tsx:107-163` | One body gradient, one specular, one ring. Delete the echo pass. |
| D5 | **Rotation coupled to energy** (`0.12 + energy·0.5` rad/s, up to 0.62 rad/s ≈ full turn in 10 s) makes loud moments spin visibly faster — anxious, not alive. | `VoiceOrb.tsx:76` | Constant slow rotation 0.15–0.25 rad/s, independent of energy. |
| D6 | **Energy spring transmits jitter.** Overdamped stiff spring + unsmoothed `vizWave` (see §2.2.6) = trembling edge. | `VoiceOrb.tsx:74-75`, `useVoiceSession.ts:113-121` | Asymmetric follower + per-bin EMA (§5). |

### 2.4 Visual directions (all inside Copernico tokens)

**Direction A — "Single Ember" (recommended).** One glass core in the phase token, one thin waveform ring, one pre-rendered halo. Light source fixed upper-left. Aurora: two large blobs in the same phase token at 8–12% opacity. Calm, premium, cheapest to render. Matches Siri/ChatGPT-voice grammar most closely.

**Direction B — "Ring of Attention".** No filled core: a single luminous ring (2–3 px) on a dark disc, energy modulating ring radius/brightness only. Striking and unmistakably "listening device" (Alexa grammar), but reads empty in `idle` and needs a separate idle treatment.

**Direction C — "Breathing Coin".** Solid matte disc in phase token with soft inner shading, no waveform ring; audio drives scale (±6%) and halo alpha only. Simplest and most robust, but loses the "I hear frequencies" aliveness that justifies a live ring.

**Recommendation: Direction A.** It keeps the current component's architecture (core + ring + halo, `levelRef`/`waveRef` props unchanged), fixes every defect in §2.3 by subtraction, and degrades gracefully to reduced-motion (static ember).

---

## 3. User stories

1. As a user opening a voice session, I see a calm amber ember breathing slowly, so I know the mic is live without being shouted at.
2. As a user speaking, I see the ring respond to my voice within ~100 ms, so I trust I'm being heard (pairs with the `heard` indicator and mic meter).
3. As a user hearing the answer, I see the orb shift to green and move with the AI voice, so I know who's talking.
4. As a light-theme user, I see the same orb readable on a light ground (tokens, not neon), so voice mode doesn't look broken outside dark mode.
5. As a `prefers-reduced-motion` user, I see a still orb that only changes color by phase, so the feature stays usable.

---

## 4. Visual spec (Direction A, "Single Ember")

### 4.1 Phase → token mapping (resolved live via `getComputedStyle`, never hardcoded)

| Phase | Core token | Ring/light token | Meaning |
|-------|-----------|------------------|---------|
| `listening` | `--accent` (#f59e0b dark / #d97706 light) | `--text-accent` | your turn — on-brand amber |
| `processing` | `--text-info` | `--text-info` | thinking — cool signal |
| `speaking` | `--text-success` | `--text-success` | Copernico talking — green |
| `idle` | `--text-muted` | `--text-muted` | ended — recedes |

New pure util `src/utils/cssVarRgb.ts`: `cssVarRgb(name: string): RGB` — reads `getComputedStyle(document.documentElement)`, parses `#rgb/#rrggbb`, falls back to the dark-theme value from `styles.css` when unparseable. Pure, unit-tested (see §10). Canvas subscribes to no theme events: re-resolve tokens on each phase change and on `size` change (cheap, non-animated frames only).

### 4.2 Layer stack (back to front, all radii as fractions of `size = w`)

1. **Ground.** Transparent canvas over the stage background (`bg-[#0a0a0f]` dark; light theme: `var(--bg-card)` — replace the hardcoded `bg-[#0a0a0f]` in `VoiceSessionView.tsx:180` with a token so light mode isn't a black hole).
2. **Halo (pre-rendered sprite).** Offscreen canvas, radial gradient token → transparent, radius **0.46w**, peak alpha 0.20 + 0.25·energy (alpha is dynamic at blit time via `globalAlpha`; the sprite itself is static per phase/size). No `shadowBlur` anywhere.
3. **Core.** Circle radius `R = 0.215w × (1 + 0.10·energy) × breathe`. Fill: radial gradient, focal point offset (−0.32R, −0.36R): stop 0 `#ffffff` (dark) / token-mix-90% (light, avoid blowout) → 0.25 token-light → 0.70 token → 1.0 token-dark (token mixed 40% toward `#0a0a0f` dark / toward `#3f3f46` light). Single light source, fixed direction.
4. **Specular.** One ellipse at (−0.34R, −0.40R), radius 0.28R, white alpha 0.55 → 0. Static position (rotates with nothing).
5. **Ring (single pass).** Closed quadratic-midpoint spline through 96 downsampled bins (keep current technique, add per-bin EMA α=0.35 before render). Base radius **0.335w**, amplitude **0.045w × (0.3 + 0.9·energy)** → worst case 0.335 + 0.054 = **0.389w**; lineWidth 1.5px (≈0.005w); total ≤ 0.40w. Stroke: token-light at alpha 0.85, no shadow. Delete glow pass and echo pass.
6. **Bounds proof.** 0.46w (halo) < 0.48w budget; ring 0.40w; core ≤ 0.24w. Worst-case drawn pixel ≤ 0.46w. Invariant `maxDrawnRadius(size, energy=1) ≤ 0.48·size` enforced by unit test on the exported pure geometry function `orbGeometry(size, energy)` (new, in the util or a `VoiceOrb.geometry.ts` module).

### 4.3 Aurora (stage background, `VoiceSessionView.tsx`)

Replace the `AURORA` Tailwind map with token washes: two absolutely-positioned divs using `background: var(--phase-token)` with `opacity: 0.10 / 0.08` and `blur-3xl`, `transition: background-color 700ms`. Same phase→token map as §4.1. On light theme the same opacities hold (tokens are darker there by design). Keep the bottom scrim but tokenize: `to-black/60` → `color-mix(in srgb, var(--bg-app) 60%, transparent)`.

### 4.4 Sizes

Orb canvas `size` ∈ [160, 340] from the existing `ResizeObserver` (keep, with the §7 padding fix). All geometry scales linearly — no breakpoint-specific art.

---

## 5. Motion spec

| Element | Spec | Notes |
|---------|------|-------|
| Energy follower | attack rate 12/s, release rate 4/s (`energy += (target−energy)·min(1, rate·dt)`, rate picked by sign) | replaces stiff spring; silky decay |
| Rotation | constant **0.2 rad/s**, energy-independent | full turn ≈ 31 s; imperceptible hurry |
| Breathing | scale 1 ± 0.015, period 4.2 s (`sin(now/1337)`) | barely-there; disabled under reduced-motion |
| Phase color lerp | 450 ms ease-out to resolved token RGB | matches repo 120–350 ms convention loosely; 450 ms chosen so hue shifts read as transitions, not flashes |
| `heard` indicator | existing `Ear` chip, unchanged | owned by turn PRD timing |
| Reduced motion | rotation = 0, breathe = 1, energy frozen at 0.25 baseline; color lerp kept | static ember per §2.2.8 |

Ring waveform: per-bin EMA (α 0.35) applied to a local copy each frame; rotation offset added at render (decoupled from audio). dt clamped to 50 ms.

---

## 6. States

- `idle`: muted token, static-ish (breathing only), halo alpha floor 0.10. Caption "Encerrada".
- `listening`: amber, breathing + reactive. `heard` chip ("ouvindo você") appears once VAD arms (timing in `PRD-voice-turn.md`).
- `processing`: info-blue, slow pulse (halo alpha oscillates 0.12–0.22, 1.6 s period) — distinct from breathing so "thinking" is recognizable without motion.
- `speaking`: green, ring driven by TTS analyser energy (existing `aiAnalyserRef` path, unchanged).

Tap orb = `forceSend` (unchanged wiring, see turn PRD for precedence).

---

## 7. Layout contract (no-crop guarantee)

1. Keep the `ResizeObserver` in `VoiceSessionView.tsx:151-161`; change the formula to reserve the halo margin explicitly: `next = clamp(160, 340, floor(min(w, h) − 16))` and **fail safe**: if `min(w,h) < 176`, render at 160 centered (never 0, never overflow).
2. Stage column keeps `min-w-[320px] w-[42%]`; the orb wrapper keeps `flex-1 min-h-0 min-w-0 items-center justify-center` with `overflow: visible` on the wrapper (the *outer* column keeps `overflow-hidden`; the canvas itself never draws past 0.48w, so nothing clips either way — defense in depth).
3. Small viewports (< 900 px wide): stage stacks above transcript (column layout, stage `min-h-[300px]`); orb re-sizes via the same observer. No separate art.
4. Light theme: stage background tokenized (§4.3.1); caption/meter text already tokenized — verify contrast of `text-amber-300` meter bar and `Ear` chip in light mode, remap to `--text-accent` if washed out.

---

## 8. Accessibility

- Canvas keeps `role="button"`, `aria-label="Enviar turno de voz agora"`, `title`. Add `tabIndex={0}` + `onKeyDown` (Enter/Space → `onTap`, `preventDefault` for Space to avoid scroll) — keyboard parity with the hold button.
- Visible focus: `:focus-visible` outline already global via `styles.css:114` — ensure canvas shows it (add `rounded-full` so the outline follows the shape).
- Captions + debug line wrapped in `aria-live="polite"` (captions) — debug line `aria-hidden` (diagnostic, not content).
- Tap target: whole orb (≥160 px) — exceeds 44 px minimum trivially.
- Reduced-motion path (§5) is the motion accessibility story; no autoplay concerns (all motion user-initiated by entering voice mode).

---

## 9. Performance

- DPR cap 2 (keep). No `shadowBlur` in the frame loop. One static halo sprite per (size, phase); `drawImage` per frame. Per-frame cost target: < 3 ms JS on desktop integrated graphics (measure with devtools frame graph, note in PR).
- `vizWave` length 96 (keep); ring samples 96 (drop N=128 → 96 to match bins 1:1, removes modulo indexing).
- Canvas element count unchanged (1). Aurora stays CSS-only (compositor-friendly opacity/background transitions).

---

## 10. Verification

1. `pnpm build` (tsc + vite) green.
2. `pnpm test:unit` green, including **new tests**:
   - `cssVarRgb.test.ts`: parses `#f59e0b`, `#fff`, falls back on garbage (jsdom `getComputedStyle` stub).
   - `orbGeometry.test.ts`: for size ∈ {160, 240, 340} × energy ∈ {0, 0.5, 1}: `maxDrawnRadius ≤ 0.48·size`; ring radius ≤ 0.40·size; halo ≤ 0.46·size.
3. `python3 backend/smoke_test.py` — untouched backend, must stay green (sanity).
4. Manual checklist (user opens `http://localhost:1420`, screenshots at each step):
   - [ ] Dark: idle / listening (speaking, mid-sentence) / processing / speaking — orb fully inside stage, ≥4 px margin between halo edge and canvas edge at max energy (shout once to peak it).
   - [ ] Light theme: same four phases readable, no black stage block, ring visible.
   - [ ] 900 px-narrow window: stage stacks, orb ≥160 px, no crop, no horizontal scroll.
   - [ ] `prefers-reduced-motion` emulated (devtools rendering tab): orb static, phase colors still transition.
   - [ ] Devtools performance: 5 s trace while speaking — no frame over 8 ms JS attributable to the orb.

---

## 11. Acceptance criteria

1. Zero hardcoded voice RGB in `src/` (grep `252, 211, 77|103, 232, 249|110, 231, 183` and `amber-500|cyan-500|emerald-500` in voice files returns nothing).
2. Geometry invariant test passes (§10.2); halo/ring Radii from §4.2 implemented exactly.
3. Single ring pass, zero `shadowBlur` in the rAF loop (grep `shadowBlur` in `VoiceOrb.tsx` returns nothing).
4. Rotation constant 0.2 rad/s ± 0.05, energy-independent (code inspection).
5. All four manual phase screenshots attached to the PR with halo margins visible; light-theme screenshots included.
6. `pnpm build`, `pnpm test:unit`, `backend/smoke_test.py` green.

---

## 12. Open questions (non-blocking)

1. Should `processing` reuse the listening halo sprite tinted blue, or hide the halo while thinking? Recommendation: keep, pulse alpha (spec'd above); revisit if user finds it busy.
2. Custom themes can define violent tokens — should the orb clamp saturation? Recommendation: no; theme author owns it.
3. Is the 450 ms phase lerp too slow next to the 250 ms caption fade? Recommendation: ship, adjust together if flagged.
