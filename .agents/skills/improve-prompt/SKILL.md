---
name: improve-prompt
description: >-
  Use this skill whenever the user has an idea, feature request, task, or bug
  and asks for help creating, refining, improving, or structuring a prompt before
  development. Guides the agent to clarify ambiguities, evaluate architectural
  trade-offs, map edge cases, and produce an unambiguous, production-ready specification.
---

# Antigravity Skill: Prompt & Requirement Refiner (`improve-prompt`)

This skill equips Antigravity to act as an expert **Tech Lead, Prompt Engineer, and Requirements Architect** for the Copernico repository.

When activated, the agent **must not** start writing code immediately. Instead, it guides the user through a rapid, high-leverage clarification loop, identifies architectural edge cases, and synthesizes a production-grade **Master Specification / Prompt**.

---

## Operational Workflow

### Phase 1: Context & Domain Triage
Before asking questions or proposing solutions, inspect the codebase context:
1. **Identify the affected layers** (Hexagonal Architecture):
   - `domain/` (`models/`, `traits/`, `errors.rs`, `events.rs` — zero I/O, zero external framework dependencies).
   - `infra/` (`sqlite/`, `ai/`, `fs/`, `hardware/`, `mcp/`, `native/`).
   - `services/` (Business rules, ReAct loop, `vault_srv`, `voice_orch`, `consolidation_srv`).
   - `bridge/` (Tauri commands in `commands/`, typed emitters in `emitter.rs`).
   - `workers/` (Background threads: scheduler, wake listener, indexer).
   - `src/` (React 19, Tailwind v4, state machines, Canvas/SVG).
2. **Review constitutional constraints** in [`AGENTS.md`](file:///c:/Users/pk/Documents/codebase/personal-assistant/AGENTS.md):
   - Windows-first (PowerShell, `PathBuf`, reserved Win32 filenames).
   - Obsidian vault is **strictly read-only** for autonomous writes without user consent.
   - Zero regressions in IPC (check `issues-open.md` before altering routes).
   - Zero `unwrap()`, `expect()`, or `panic!` in production paths.

---

### Phase 2: Socratic Clarification (Max 2–3 Questions)
Never overwhelm the user with exhaustive questionnaires. Identify the top 2 or 3 critical architectural forks or ambiguous requirements, and ask targeted multiple-choice questions:
- **State & Mutability**: Should the change modify state in-place, create a new record, or keep an immutable audit log?
- **Concurrency & Lifecycle**: Does this run synchronously on the main thread, or as an async task/worker in the background?
- **Degradation & Offline**: How should the feature behave when a provider (DeepSeek, Groq Whisper, Win32 microphone) is unavailable or fails?

Format options with clear labels (A, B, C) and indicate the **(Recommended)** approach based on the repository's design principles.

---

### Phase 3: Negative Constraints (What NOT to Do)
Prevent common agent failure modes by proactively enumerating strict negative boundaries:
- **No Layer Leaks**: Do not put SQL queries in `bridge/commands/` or import Tauri in `domain/`.
- **No Ghost Files**: Do not leave orphaned files, duplicate versions, or untracked temporary artifacts.
- **No Uncontrolled Blocking**: Do not block the Tauri main thread or Tokio async runtime with CPU-heavy loops.
- **No Breaking IPC Contracts**: If modifying an existing Tauri command signature, simultaneously update `src/api.ts` and verify frontend usages.

---

### Phase 4: Master Prompt Synthesis
Once requirements and edge cases are agreed upon, generate a clean, self-contained, copy-pasteable **Master Prompt** formatted as follows:

```markdown
# TASK: [Descriptive Feature or Fix Name]

## 1. Context & Objective
[Concise explanation of the current behavior, why the change is needed, and the end state]

## 2. Affected Layers & Files
| Layer | File Path | Action | Responsibility |
| :--- | :--- | :--- | :--- |
| `domain/` | `src-tauri/src/domain/...` | MODIFY / NEW | ... |
| `infra/` | `src-tauri/src/infra/...` | MODIFY / NEW | ... |
| `services/` | `src-tauri/src/services/...` | MODIFY / NEW | ... |
| `bridge/` | `src-tauri/src/bridge/...` | MODIFY / NEW | ... |
| `frontend` | `src/...` | MODIFY / NEW | ... |

## 3. Detailed Technical Requirements
[Numbered, precise implementation steps, function signatures, data flows, and state handling]

## 4. Invariants & Anti-Patterns (Negative Rules)
- DO NOT ...
- DO NOT ...

## 5. Verification & Quality Gates
1. `cargo check` (0 errors, 0 warnings)
2. `cargo test --test unit_tests` (ensure all 55+ unit tests pass)
3. `cargo fmt --check`
4. `pnpm test:unit`
5. `pnpm build`
```

---

## When to Activate This Skill
Activate this skill automatically when the user:
- Asks for help creating or structuring a prompt.
- Expresses a vague feature request or idea that has multiple architectural trade-offs.
- Mentions "ajude a criar um prompt", "refine essa tarefa", "melhore meu prompt", or similar phrases.
