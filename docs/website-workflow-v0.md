# Website Workflow v0 — Personal Assistant (locked, no code)

Source: workflow discussion 2026-09-28. Focus: IA + flows only.

## 1. Purpose
Solo weekly operating system: talk to notes with AI, track daily habits, plan week with AI, write task notes in .md, review metrics on Sunday.

## 2. Locked decisions
1. Notes: small notes, 1 .md note inside each task. Plus daily quick notes in Hoje.
2. Habits: max 10. Mixed binary (did / not did) + numeric (e.g. 20min, 5 pages).
3. Week planning: AI creates tasks to backlog only, user moves to days manually. Text + AI + confirm for v0. Voice = v2 (out of current web-only stack).
4. Metrics: standard defaults now, user-configurable targets later.

## 3. Sitemap (v0)
- /Hoje (new, daily entry)
- /Chat (exists, evolve to talk-to-notes)
- /Semana (exists Quadro todo/doing/done, evolve to week planner)
- Task detail (overlay, not new page: title + day label + .md note + linked habit)
- /Métricas (new, weekly review)

No separate /Notas page for v0. No 7 day-columns for v0.

## 4. Page inventory
- Hoje: today's habits checklist, today's doing tasks, quick note input + AI assist.
- Chat: sessions list (exists), chat grounded in notes + tasks + habits.
- Semana: todo = backlog (AI fills here), doing = this week, done = done. Day label inside card (Seg-Dom). Drag to move.
- Task detail: .md note, day label, optional habit link.
- Métricas: habit % per habit + overall, streaks, tasks done/created/carried, notes count, AI weekly summary.

## 5. Hierarchy
Hoje (daily) -> Semana (weekly) -> Métricas (review) -> next Semana.
Chat crosses all. Task detail is child of Semana/Hoje.

## 6. Key journeys
- Daily (2 min): Hoje -> check habits -> see doing -> quick note.
- Talk to notes: Chat -> ask about past notes/tasks/habits.
- Weekly plan: Semana -> "plan my week" -> AI proposes backlog in todo -> user confirms -> user drags to week.
- Weekly review: Métricas -> see misses -> feeds next plan.

## 7. Metrics defaults (v0 standard)
- Per habit: completion % (done days / 7), current streak.
- Overall: avg habit %, habits fully done count.
- Tasks: created, completed, carried over, completion %.
- Notes: notes written count.
- AI summary: 3 bullets (wins, misses, focus next week).
- Configurable later: habit target/week, week start day, numeric goals.

## 8. Linking plan
- Task <-> its .md note (1:1).
- Habit <-> Hoje (check) + Métricas (score).
- Chat -> reads Hoje/Semana/notes/habits.
- Métricas -> "use in next plan" action.

## 9. Risks / open for v1
- Voice planning requested, deferred to v2.
- Day labels may not scale if >20 tasks/week -> revisit 7-column layout then.
- Numeric habits need unit definition per habit (min, pages, count).

## 10. UI stack (locked, matches `AGENTS.md` Stack)
Styling: Flim tokens in `docs/design.md` (Canvas `#f5f5f5`, Ink `#141414`, radii 8/16/160, no shadows). All libs unstyled/headless, themed by us.
- Hoje: `@base-ui/react` Checkbox/Switch/Slider (habits binary + numeric), `date-fns` (today/Seg-Dom).
- Semana: `@dnd-kit/core` + `sortable` + `utilities` (drag todo/doing/done), `@base-ui/react` Dialog (Task detail), `date-fns` (day labels, week start).
- Task detail: `react-markdown` + `remark-gfm` (render .md, edit via native textarea), `diff` for v0 inline AI suggestion diff, `@git-diff-view/react` + `@git-diff-view/file` in Unified mode when notes get long (Aceitar/Descartar antes de salvar).
- Métricas: `recharts` (Bar % por hábito, Line streak/evolução), colors `#141414` / `#30a81d` / `#fecc33` / `#ff8400`, grid `#d9d9d9`.
- Global: `lucide-react` icons (thin-stroke `#141414`), `logo.png` as app mark.
- Not used: shadcn chart (is recharts wrapper, copy-paste overhead), MUI/AntD/Chakra (break Flim).
