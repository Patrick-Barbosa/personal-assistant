export interface Session {
  id: string;
  title: string;
  titulo?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string | number;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  tokens?: number | null;
  parent_id?: number | null;
  tool_calls?: string | null;
  tool_call_id?: string | null;
}

export interface SendMessageResponse {
  user_message: Message;
  assistant_message: Message;
  updated_session_title?: string | null;
}

export interface SearchResult {
  path: string;
  file_path?: string;
  titulo: string;
  title: string;
  score: number;
  preview?: string;
  vault: "default" | "obsidian";
  categoria?: string | null;
  slug?: string;
}

export interface NoteResponse {
  title: string;
  titulo?: string;
  content: string;
  corpo?: string;
  path?: string;
  frontmatter: Record<string, unknown>;
  vault: string;
  categoria?: string | null;
}

export interface GraphNode {
  id: string;
  title: string;
  vault: string;
  path: string;
  tags: string[];
  category?: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  is_lineage?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface NoteTitleItem {
  title: string;
  vault: string;
  path: string;
}

export interface AttachedNote {
  title: string;
  content: string;
  slug: string;
}

export interface VoiceInfo {
  name: string;
  short_name: string;
  gender: string;
  locale: string;
  friendly_name: string;
}

export interface TtsBenchmarkResult {
  text: string;
  voice: string;
  total_chars: number;
  chunks_count: number;
  time_to_first_audio_ms: number;
  total_synthesis_time_ms: number;
  audio_bytes_len: number;
  chars_per_second: number;
}

export interface PluginItem {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  type: "tool" | "skill" | "provider" | "theme" | "view";
  enabled: boolean;
  folder: string;
}

export interface McpServerStatus {
  id: string;
  status: "starting" | "ready" | "error" | "stopped";
  tool_count: number;
  error?: string | null;
}

export interface SkillManifest {
  plugin: {
    id: string;
    name: string;
    version: string;
    description?: string;
  };
  provides: {
    type: string;
  };
  skill?: {
    trigger: {
      type: "cron" | "event" | "manual";
      cron?: string;
      event?: string;
    };
    system_prompt: string;
    input_message?: string;
    allowed_tools?: string[];
    execution?: {
      max_iterations: number;
      notify_on_complete: boolean;
      session_prefix: string;
    };
  };
  enabled?: boolean;
}

export interface SkillConfigOptions {
  announce_searches?: boolean;
  announce_thoughts?: boolean;
  announce_questions?: boolean;
}

export interface SkillConfigData {
  skill_id: string;
  max_iterations: number;
  system_prompt: string;
  custom_goal: string;
  options?: SkillConfigOptions;
}

export interface ThemeItem {
  id: string;
  name: string;
  description?: string;
  css: string;
  preview?: string;
}

export type InboxItemType =
  | "evolution_proposal"
  | "pattern_synthesis"
  | "contradiction"
  | "loose_ends"
  | "instruction_improvement"
  | "voice_consolidation"
  | "curation_report"
  | "weekly_report"
  | "letter"
  | "kanban_rollover"
  | string;

export interface UserProfile {
  name: string;
  communication_style: string;
  hotkey: string;
  onboarding_completed: boolean;
  custom_instructions?: string;
  date_format?: string;
  deepseek_api_key?: string;
  groq_api_key?: string;
}

export interface ApiKeysConfig {
  deepseek_api_key: string;
  groq_api_key: string;
}

export type InboxItemStatus =
  | "unread"
  | "read"
  | "archived"
  | "pending"
  | "applied"
  | "snoozed"
  | "dismissed";

export interface InboxDiffData {
  original_snippet?: string;
  new_snippet?: string;
  changelog?: string;
}

export interface InboxItem {
  id: string;
  session_id: string | null;
  title: string;
  summary: string | null;
  content: string;
  item_type: InboxItemType;
  status: InboxItemStatus;
  requires_decision: boolean;
  created_at: string;
  target_base_note_slug?: string | null;
  proposed_content?: string | null;
  diff_data?: string | InboxDiffData | null;
  updated_at?: string | null;
  decision_reason?: string | null;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  has_scripts: boolean;
  script_files: string[];
  prompt_instructions: string;
  folder_path: string;
  is_enabled: boolean;
}

export interface ScheduledRoutine {
  id: string;
  titulo: string;
  cron_expr: string;
  prompt: string;
  skill_id?: string | null;
  ativo: boolean;
  ultima_execucao?: string | null;
  created_at: string;
}

// ─── Kanban Semanal ─────────────────────────────────────────

export type WeekStatus = "open" | "closed";

export type TaskColumn = "todo" | "doing" | "done";

export type TaskStatus = "active" | "carried" | "cancelled";

export type TaskKind = "normal" | "habit";

export interface KanbanWeek {
  id: string;
  year: number;
  iso_week: number;
  /** Segunda-feira da semana, `YYYY-MM-DD`. */
  week_start: string;
  /** Domingo da semana, `YYYY-MM-DD`. */
  week_end: string;
  status: WeekStatus;
  created_at: string;
  closed_at?: string | null;
}

export interface KanbanTask {
  id: string;
  week_id: string;
  titulo: string;
  /** Nota principal do editor no vault padrão. Nula para hábitos. */
  note_path?: string | null;
  task_column: TaskColumn;
  status: TaskStatus;
  /** Semana de destino quando `status === "carried"`. */
  carried_to?: string | null;
  position: number;
  task_kind: TaskKind;
  habit_id?: string | null;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KanbanBoard {
  week: KanbanWeek;
  tasks: KanbanTask[];
  /** Vínculos por tarefa (notas relacionadas + entities resolvidas). */
  links: TaskLinks[];
  /** Hábitos ativos junto do quadro (cor dos cards sem N+1 de IPC). */
  habits: Habit[];
}

/** Hábito recorrente: gera task colorida sozinha no dia certo (Fase 4). */
export interface Habit {
  id: string;
  titulo: string;
  /** Cron de 5 campos (`min hora dom mês dow`). */
  cron_expr: string;
  /** Cor CSS hex (`#rrggbb`) do card. */
  cor: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  /** Sequência atual de dias consecutivos com métrica (derivada). */
  streak_atual: number;
}

/** Descritor de coluna do quadro (ordem canônica exibida no Board). */
export interface KanbanColumn {
  id: TaskColumn;
  label: string;
}

// ─── Insights (Fase 5 — agregado pronto no backend) ────────

/** Placar de um hábito no topo da aba Insights. */
export interface StreakCard {
  habit: Habit;
  /** Sequência viva até hoje (pode estar pendente de hoje). */
  streak_atual: number;
  /** Maior sequência já registrada. */
  maior_streak: number;
  /** Já há métrica registrada hoje? */
  feito_hoje: boolean;
}

/** Barra de um dia: conclusão de tarefas + hábitos registrados. */
export interface DayBarPoint {
  date: string;
  /** Percentual 0–100 (arredondado a 1 casa). */
  pct_tarefas: number;
  habitos_registrados: number;
  /** Contagens brutas para o rótulo (ex.: "3/5"). */
  tarefas_feitas: number;
  tarefas_total: number;
}

/** Ponto da tendência entre semanas (fechadas + atual). */
export interface WeekTrendPoint {
  week_id: string;
  /** % de tarefas concluídas na semana (0–100). */
  pct_conclusao: number;
  /** % de tarefas de hábito concluídas na semana (0–100). */
  taxa_habitos: number;
}

/** Ponto da linha "estimado vs realizado" (semana ou mês). */
export interface LineSeriesPoint {
  /** `2026-W39` (semana) ou `2026-09` (mês). */
  periodo: string;
  estimado_tarefas: number;
  realizado_tarefas: number;
  estimado_habitos: number;
  realizado_habitos: number;
}

/** Relatório completo da aba Insights — tudo agregado no backend. */
export interface Insights {
  /** Granularidade das linhas: `semana` ou `mes`. */
  periodo: string;
  streaks: StreakCard[];
  /** Hábitos agendados para hoje (cron casa) e quantos já concluídos. */
  habitos_hoje_total: number;
  habitos_hoje_feitos: number;
  /** % de conclusão da semana aberta (0–100). */
  pct_semana: number;
  /** Últimos 14 dias (ordem cronológica). */
  bars: DayBarPoint[];
  /** Últimas 8 semanas (ordem cronológica). */
  trend: WeekTrendPoint[];
  /** Estimado vs realizado — granularidade de `periodo`. */
  lines: LineSeriesPoint[];
}

/** Fallback vazio (preview no browser sem backend). */
export const Insights = {
  empty(periodo: string): Insights {
    return {
      periodo,
      streaks: [],
      habitos_hoje_total: 0,
      habitos_hoje_feitos: 0,
      pct_semana: 0,
      bars: [],
      trend: [],
      lines: [],
    };
  },
};

// ─── Entities (nota canônica + índice derivado) ─────────────

export type EntitySubtipo = "pessoa" | "projeto" | "lugar" | "livre";

/** Linha do índice derivado `entities_index` — sempre reconstruível. */
export interface EntityItem {
  id: string;
  subtipo: EntitySubtipo;
  titulo: string;
  /** Caminho relativo ao vault padrão (o `.md` nunca é apagado pelo app). */
  note_path: string;
  metadata?: string | null;
  created_at: string;
}

/** Vínculos de uma tarefa: notas relacionadas + entities. */
export interface TaskLinks {
  task_id: string;
  /** Caminhos relativos ao vault padrão (além de `KanbanTask.note_path`). */
  notes: string[];
  entities: EntityItem[];
}

