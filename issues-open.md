# Issues abertas — Copernico

Fonte de verdade para trabalho de agentes. Cada issue tem evidência `arquivo:linha`, impacto no agente e critério de aceite.

## IPC-01 — Contrato IPC triplo manual, sem verificação (CRÍTICO)

### Contexto
Alteração em IPC Tauri exige sincronia manual em 3 pontas, sem compilador pegando erro:

1. `src-tauri/src/commands.rs` — `#[tauri::command] pub async fn ...`
2. `src-tauri/src/lib.rs` — registro em `generate_handler![...]`
3. `src/api.ts` (+ `src/types.ts` se novo tipo) — `invoke("nome", {...})`

`invoke` é stringly-typed + `any`, então `pnpm build` passa com param errado. Só quebra em runtime (`tauri dev`).

### Evidências (verificado por leitura)
- `src-tauri/src/lib.rs:360-362` registra `list_greetings`, `ensure_greetings`, `preview_greeting`, mas `src/api.ts:689-696` só envolve os 2 primeiros. `preview_greeting` sem wrapper — grep em `src/api.ts`, `src/types.ts`, `src/App.tsx`, `src/components/*.tsx` retorna zero uso.
- `src-tauri/src/commands.rs:153-163` `rename_session(session_id, title?, new_title?)` aceita dois nomes; `src/api.ts:88` envia ambos `{ sessionId, title: newTitle, newTitle }` como workaround.
- `src-tauri/src/commands.rs:236-244` `search_notes(query, top_k?)`; `src/api.ts:125` envia `{ query, topK: limit, top_k: limit }` duplicado.
- `src/api.ts` tem 16 ocorrências de `any` (`invoke<any>`, `Promise<any>` em `list_sessions`, `new_session`, `search_notes`, `read_note`, `list_tools`, `run_skill_now`, `trigger_routine_now`, `rename_note`, `consolidate_notes`, `list_greetings`), violando `AGENTS.md §6` item 8.
- Falso positivo descartado: `commands::toggle_overlay_window` em `src-tauri/src/commands.rs:35` é `pub fn` interno, não comando. Só `toggle_overlay` em `commands.rs:127` é `#[tauri::command]`. Qualquer script de check deve olhar só dentro do bloco `generate_handler!`, não todo `commands::*`.

### Impacto no agente
Agente diz "pronto" com `tsc` verde, mas o comando falha no app real. Sem loop de feedback rápido, o erro volta para o humano.

### Proposta (não implementar aqui, só travar)
1. Criar `scripts/check-ipc.ps1`:
   - Lista A: `pub async fn (\w+)` precedido de `#[tauri::command]` em `commands.rs`.
   - Lista B: nomes só dentro de `generate_handler![...]` em `lib.rs`.
   - Lista C: `invoke<.*>\("(\w+)"` em `src/api.ts`.
   - Falha se `A != B` ou se `B - C` fora de allowlist explícita.
   - Fase 2: checar nomes de params (Rust `snake_case` == TS enviado, sem duplicar `topK`/`top_k`).
2. Corrigir só os 3 drifts: adicionar `previewGreeting` + tipo, unificar `rename_session` para 1 param canônico, unificar `search_notes` para só `top_k`.
3. Congelar `any`: proibir novos `invoke<any` (grep no check), sem remover os 16 existentes de uma vez.

### Workflow canônico (arquivado do AGENTS.md §6.1 original)
1. `src-tauri/src/commands.rs`: `#[tauri::command] pub async fn meu_comando(...) -> Result<T, String>` (sempre `map_err(|e| e.to_string())`, nunca `unwrap`/`expect` em rota ou lock).
2. `src-tauri/src/lib.rs`: registrar em `generate_handler![...]`.
3. `src/api.ts` (+ `src/types.ts` se novo tipo): `invoke<T>("meu_comando", { ... })` com params em snake_case igual ao Rust.

### Aceite
- `check-ipc` verde.
- `preview_greeting` chamável do frontend.
- Nenhum `invoke` novo com `any`.
- `pnpm build` + `cargo fmt --check` + `cargo clippy` verdes.

### Referências
- `src-tauri/src/commands.rs:127-163,236-252`
- `src-tauri/src/lib.rs:277-363`
- `src/api.ts:51,75,88,125,149,454-466,653-696`
- `src/types.ts:1-48`
- Workflow canônico de IPC: ver `AGENTS.md §2` item 2 (aponta para esta issue; o passo-a-passo anterior foi arquivado aqui para não duplicar)

## SOL-01 — Sol (indicador de voz) some durante a saudação (CRÍTICO, ABERTO)

> **Status em 14/09/2026: problema PERSISTE após 4 rodadas de investigação + fixes.**
> Este registro é o handoff completo para um especialista humano. Nada aqui foi
> implementado como "tentativa cega" — cada hipótese tem veredito com evidência.

### 1. Sintoma (relato do usuário, 3 afirmações literais)

1. "chamo copernico, sol aparece" — sol nasce **pequeno e âmbar**.
2. "quando o áudio de saudação começa ele some" — some **durante** a saudação (~3,5s).
3. "quando eu começo a falar, o sol aparece novamente" — **voz do usuário restaura**.
4. Badge "Falando..." **nunca aparece** (resposta direta; refere-se às rodadas antigas).
5. Overlay principal (`main` 960×640) **fechado** em todas as reproduções. Runner: `start_copernico.bat` (= `pnpm tauri dev`).

### 2. O que está PROVADO (backend exonerado)

Em **todas** as rodadas (`logs/copernico.log` 13/09 20:14, 14/09 13:22 e `logs/copernico.prev.log`),
o ciclo Rust é perfeito, com timings medidos:

- `Start (score 0.95–1.00, followup_esperado=false)` → `[SOL] show indicator (start-greeting)`
- Saudação toca **inteira** (`Saudação concluída (~3.3s–3.8s)`)
- `[SOL] show indicator (greeting-done)`
- `[SOL] hide indicator` **só** ~17s depois, via `Cancel: 17 segundos de silêncio contínuo`
- **Ausências decisivas em todas as rodadas**: nenhum `Stop`, nenhum `Parada 'zefiro'`,
  nenhum `Prompt vazio pós-eco`, nenhuma `Transcrição bruta`, nenhum `turn-abort`.
- Rodada instrumentada (14/09 13:36, com `[SOL-FRONT]`): o frontend registrou
  `idle→speaking` + 3× `speaking→speaking` — ou seja, **o evento `speaking` chega e é
  aplicado** (2 emits backend × 2 listeners duplicados; ver §4 item 2).

### 3. Hipóteses testadas, com veredito

| # | Hipótese | Veredito |
|---|----------|----------|
| H1 | Falso-positivo do modelo zefiro no áudio da saudação → `Stop` → STT do eco → `strip_greeting_echo` esvazia → `hide` no caminho prompt-vazio (`wake_word.rs` ~l.660) | **REFUTADA** — nenhum `Stop` em 3 rodadas de log |
| H2 | `tts.fade_out_and_stop(250)` do `Start` mata a saudação | **REFUTADA** — saudação usa `OutputStream`+`Sink` próprios (`greetings.rs:315-326`); TTS usa `current_sink` próprio (`tts.rs:209`). Log mostra saudação tocando até o fim |
| H3 | `cancel_wake_recording` / `toggle_overlay_window` escondem a janela | **REFUTADO** — descarte exige overlay aberto (`App.tsx:742-747`, `InputBar.tsx:534-570`); overlay estava fechado; `toggle` preserva indicador com `voice_active=true` (`commands.rs:106-118`) |
| H4 | Evento `speaking` perdido (emit-com-janela-oculta / remount dev) | **REFUTADA na forma original** — `[SOL-FRONT]` prova entrega+aplicação após o re-emit. Parcialmente válida **historicamente** (antes do re-emit o badge nunca aparecia) |
| H5 | Z-order/foco: `show()` sem `set_always_on_top`/`set_focus` (só `show()+unminimize()`) vs `main` com `set_focus()` | **ABERTA** — nunca testada de frente; indicator em `(2*scale,2*scale)`, 154×154, ambas `alwaysOnTop` (`tauri.conf.json:28-40`) |
| H6 | **Camuflagem: sol branco (`speaking`, fixo 0.45) sobre fundo claro = invisível** | **HIPÓTESE Nº1** — explica "some quando o áudio começa" (troca âmbar→branco) e "volta quando falo" (âmbar do `recording`/RMS). Scrim adicionado em `SunBackground.tsx` mas **não validado** (usuário reportou "continua sumindo" depois) |
| H7 | Remount mid-greeting zerando estado para `idle` (sequência `attached→detached→attached` + `first rms (status=idle)` observada) | **HIPÓTESE Nº2, NÃO DESCARTADA** — atribuição mais provável é sequência StrictMode do **startup** (dev) com intercalação stdout/stderr embaralhando a ordem no log; mas remount real no meio da saudação não foi excluído com certeza |

### 4. Bugs REAIS encontrados e corrigidos no caminho (não eram a causa-raiz)

1. **Ordem emit→show** (`wake_word.rs`, branch `Start` ~l.400-410): `speaking` era emitido com a janela oculta. Corrigido para show→emit + **re-emit** no início da thread da saudação; mesma ordem aplicada em `greeting-done` e `start-followup`. `[SOL-FRONT]` confirmou entrega.
2. **Listeners em duplicata** (`VoiceIndicatorOverlay.tsx`): StrictMode + cleanup assíncrono → 1º set nunca removido; cada emit disparava 2× (chimes duplos, logs duplos — prova: 4 linhas para 2 emits). Corrigido com guarda `cancelled` após cada `await` + detach imediato.
3. **Flash do `<App/>` na janela do indicador em dev** (`main.tsx`): sem `?mode=indicator` no devUrl, caía no fallback assíncrono. `Root` agora tri-estado com render nulo até resolver.
4. **Arquitetura do sol** (refatoração aprovada): `src/voice/sunMachine.ts` (função pura, única fonte de verdade) + `SunBackground.tsx` desacoplado (glow/sombra/respiração, sem conhecer eventos) + `CopernicoSun.tsx` só arte+pétalas + `VoiceIndicatorOverlay.tsx` orquestrador fino + `vitest` (11 testes) + piso 0.15 em `recording` + badge "Ouvindo..." + logs `[SOL]` com flag `localStorage.debugSun`.

### 5. Estado atual do código (mapa para o especialista)

- Voz backend: `src-tauri/src/wake_word.rs` — `Start` (~l.380-445), `Stop` (~l.500-560), `Cancel` (~l.447-500), prompt-vazio (~l.655-670). Diagnóstico: `last_start_at`/`greeting_playing` + `note_start`/`elapsed_since_start`/`set,is_greeting_playing` (~l.25-30, ~l.94-118) — **só logs**.
- Sidecar: `motor_wake_word/src/bin/sidecar.rs` — `Recording` só sai via zefiro ou 17s silêncio (l.365-417); `FollowupListening` emite `Start{1.0}` em voz (l.419-489). Nenhum texto das 18 saudações contém "zefiro" (`greetings.rs:142-167`).
- Frontend sol: `src/voice/sunMachine.ts` (contrato), `src/voice/SunBackground.tsx` (ambiente + scrim), `src/components/icons/CopernicoSun.tsx` (arte), `src/components/VoiceIndicatorOverlay.tsx` (orquestra + `reportSunDebug`), `src/main.tsx` (Root tri-estado).
- **Instrumentação temporária A REMOVER após o aceite**: comando `report_sun_debug` (`commands.rs` + registro em `lib.rs:303` + `api.ts:reportSunDebug`), forward em `solDebug`, campos de diagnóstico do item acima. Não virar permanente sem decisão.
- Reprodução: `start_copernico.bat` → dizer "copernico" → observar os ~3,5s da saudação. Logs: `logs/copernico.log` (backend `[SOL]`/`[WAKE WORD]` + frontend `[SOL-FRONT]`). `Get-Content logs\copernico.log -Wait -Tail 30` para tempo real.

### 6. Perguntas em aberto (responder nesta ordem)

1. Na rodada pós-fix, o badge **"Falando..."** apareceu durante a saudação? (Se SIM, estado perfeito → causa é 100% visual/janela. Se NÃO, H7 ganha força.)
2. O que está atrás da janela do indicador (papel de parede claro/escuro)? Some também com fone de ouvido ou sobre fundo escuro? (Testa H6.)
3. Some no app **instalado** (prod, `index.html?mode=indicator`) ou só no `tauri dev`? (Se só dev → mount/fallback/HMR/WebView2-dev; se ambos → render/janela.)
4. Com DevTools na janela `indicator`: qual `status` do React durante a saudação? A webview recarrega (`navigation`) em algum momento do ciclo?
5. `show()` numa janela já visível tem efeito colateral no WebView2 (repaint/composição da janela transparente)?

### 7. Sugestões de onde olhar primeiro (não exaustivo)

- Composição de janela transparente no WebView2/Windows ao redor de `show()`+`unminimize()` com áudio tocando; comparar `set_focus()`/`set_always_on_top()` no indicator como no `main`.
- Se H6 se confirmar: trocar o `speaking` para tom com contraste garantido (âmbar intenso em vez de branco puro) ou backplate opaco; testar com papéis de parede claro/escuro.
- Se H7 se confirmar: descobrir o gatilho do remount (HMR? `isIndicator` flipando? crash+reload silencioso da webview? — notar `Failed to unregister class Chrome_WidgetWin_0` visto em `copernico.prev.log:100`).
- Manter `pnpm test:unit` (vitest, 11 testes da máquina) verde em qualquer mudança de comportamento do sol.

### 8. Aceite
- Dizer "copernico" → sol grande/branco + badge "Falando..." **estáveis durante toda a saudação**, em dev e prod, independente do papel de parede, sem regressão (follow-up 10s, cancel 17s, descarte via overlay, chimes simples).
- Instrumentação temporária removida (ou posta atrás de flag permanente com decisão explícita).
- `pnpm build` + `pnpm test:unit` + `cargo test --test unit_tests` + `cargo clippy` verdes (`cargo fmt --check` tem drift pré-existente fora do escopo — ver histórico).
