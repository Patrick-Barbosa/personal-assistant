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
  | string;

export interface UserProfile {
  name: string;
  communication_style: string;
  hotkey: string;
  onboarding_completed: boolean;
  custom_instructions?: string;
  date_format?: string;
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

