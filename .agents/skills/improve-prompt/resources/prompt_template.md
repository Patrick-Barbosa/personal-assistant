# Task Template: [Feature / Bug Name]

## 1. Context & Objective
- **Current Behavior**: [Describe what happens now]
- **Target Behavior**: [Describe what should happen]
- **Business/Architecture Rationale**: [Why this matters]

## 2. Architecture & Affected Files
| Layer | Path | Action | Role |
| :--- | :--- | :--- | :--- |
| `domain/` | `src-tauri/src/domain/...` | MODIFY/NEW | Pure entities, interfaces, error types |
| `infra/` | `src-tauri/src/infra/...` | MODIFY/NEW | Hardware, DB, FileSystem, Network adapters |
| `services/` | `src-tauri/src/services/...` | MODIFY/NEW | Orchestration and business rules |
| `bridge/` | `src-tauri/src/bridge/...` | MODIFY/NEW | Thin IPC controllers and typed events |
| `frontend` | `src/...` | MODIFY/NEW | React UI, state machines, Canvas |

## 3. Step-by-Step Requirements
1. [Step 1: Type contracts and domain interfaces]
2. [Step 2: Infrastructure adapters and storage migrations]
3. [Step 3: Service business logic and orchestration]
4. [Step 4: Tauri bridge commands and IPC registration]
5. [Step 5: Frontend UI integration]

## 4. Invariants & Anti-Patterns (Negative Rules)
- DO NOT violate Hexagonal Architecture layer boundaries.
- DO NOT use `unwrap()`, `expect()`, or `panic!` in production code paths.
- DO NOT perform direct writes to the user's Obsidian vault without explicit user intent.
- DO NOT break existing Tauri IPC signatures without updating `src/api.ts`.

## 5. Verification Plan
- [ ] `cargo check`
- [ ] `cargo test --test unit_tests`
- [ ] `cargo fmt --check`
- [ ] `pnpm test:unit`
- [ ] `pnpm build`
