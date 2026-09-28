import { invoke } from "@tauri-apps/api/core";
import { useVoiceStore } from "./stores/voice-store";
import {
  Message,
  NoteResponse,
  SearchResult,
  SendMessageResponse,
  Session,
  VoiceInfo,
  PluginItem,
  McpServerStatus,
  SkillManifest,
  ThemeItem,
  InboxItem,
  TtsBenchmarkResult,
  UserProfile,
  SkillInfo,
  ScheduledRoutine,
  ApiKeysConfig,
  KanbanBoard,
  KanbanTask,
  TaskLinks,
  EntityItem,
  Habit,
  Insights,
} from "./types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- Web backend (browser mode: `pnpm dev` + `python3 -m backend.server`) ---
const BACKEND_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BACKEND_URL) ||
  "http://127.0.0.1:8000";

let backendOk: boolean | null = null;

/** Base URL of the Python web backend (override with VITE_BACKEND_URL). */
export function getBackendUrl(): string {
  return BACKEND_URL;
}

async function webActive(): Promise<boolean> {
  if (isTauri()) return false;
  if (backendOk !== null) return backendOk;
  try {
    const r = await fetch(`${BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    backendOk = r.ok;
  } catch {
    backendOk = false;
  }
  return backendOk;
}

async function wGet<T>(path: string): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`);
  if (!r.ok) throw new Error(`backend ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

async function wSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`backend ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

// Browser TTS playback (replaces Rust rodio side).
let currentAudio: HTMLAudioElement | null = null;
function stopWebAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* noop */
    }
    currentAudio = null;
  }
  try {
    if (useVoiceStore.getState().wakeStatus === "speaking") {
      useVoiceStore.getState().setWakeStatus("idle");
    }
  } catch {
    /* noop */
  }
}

// Fallback mock data for web browser preview during frontend dev
let mockSessions: Session[] = [
  {
    id: "mock-1",
    title: "Notas e Arquitetura",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
let mockMessages: Record<string, Message[]> = {
  "mock-1": [
    {
      id: "m-1",
      session_id: "mock-1",
      role: "assistant",
      content: "Olá! Sou o **Copernico**, seu assistente de segundo cérebro. Como posso te ajudar hoje?",
      created_at: new Date().toISOString(),
    },
  ],
};

export const api = {
  async showMainWindow(): Promise<boolean> {
    if (!isTauri()) return false;
    return await invoke<boolean>("show_main_window");
  },

  async listSessions(): Promise<Session[]> {
    if (await webActive()) {
      const raw = await wGet<any[]>("/api/sessions");
      return raw.map((s) => ({ ...s, title: s.title || s.titulo || "Conversa" }));
    }
    if (!isTauri()) return [...mockSessions];
    const raw = await invoke<any[]>("list_sessions");
    return raw.map((s) => ({
      ...s,
      title: s.title || s.titulo || "Conversa",
    }));
  },

  async getMessages(sessionId: string): Promise<Message[]> {
    if (await webActive()) return await wGet<Message[]>(`/api/sessions/${sessionId}/messages`);
    if (!isTauri()) return mockMessages[sessionId] || [];
    return await invoke<Message[]>("get_messages", { sessionId });
  },

  async newSession(title?: string): Promise<Session> {
    if (await webActive()) {
      const raw = await wSend<any>("POST", "/api/sessions", { title });
      return { ...raw, title: raw.title || raw.titulo || "Nova Conversa" };
    }
    if (!isTauri()) {
      const newS: Session = {
        id: `mock-${Date.now()}`,
        title: title || "Nova Conversa",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockSessions.unshift(newS);
      mockMessages[newS.id] = [];
      return newS;
    }
    const raw = await invoke<any>("new_session", { title });
    return {
      ...raw,
      title: raw.title || raw.titulo || "Nova Conversa",
    };
  },

  async renameSession(sessionId: string, newTitle: string): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", `/api/sessions/${sessionId}`, { title: newTitle });
      return;
    }
    if (!isTauri()) {
      const s = mockSessions.find((item) => item.id === sessionId);
      if (s) s.title = newTitle;
      return;
    }
    return await invoke<void>("rename_session", { sessionId, title: newTitle, newTitle });
  },

  async deleteSession(sessionId: string): Promise<void> {
    if (await webActive()) {
      await wSend("DELETE", `/api/sessions/${sessionId}`);
      return;
    }
    if (!isTauri()) {
      mockSessions = mockSessions.filter((item) => item.id !== sessionId);
      delete mockMessages[sessionId];
      return;
    }
    return await invoke<void>("delete_session", { sessionId });
  },

  async sendMessage(sessionId: string, content: string, origin = "text"): Promise<SendMessageResponse> {
    if (await webActive()) {
      return await wSend<SendMessageResponse>("POST", "/api/chat", { session_id: sessionId, content, origin });
    }
    if (!isTauri()) {
      const uMsg: Message = {
        id: `m-u-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      const aMsg: Message = {
        id: `m-a-${Date.now()}`,
        session_id: sessionId,
        role: "assistant",
        content: `Resposta simulada para: "${content}"\n\n*(Executando em modo de prévia web. No app Tauri nativo, o DeepSeek com Tool Calling e RAG nos cofres responderá.)*`,
        created_at: new Date().toISOString(),
      };
      if (!mockMessages[sessionId]) mockMessages[sessionId] = [];
      mockMessages[sessionId].push(uMsg, aMsg);
      return { user_message: uMsg, assistant_message: aMsg };
    }
    return await invoke<SendMessageResponse>("send_message", { sessionId, content, origin });
  },

  async searchNotes(query: string, limit = 8): Promise<SearchResult[]> {
    if (await webActive()) {
      return await wGet<SearchResult[]>(`/api/notes/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    }
    if (!isTauri()) return [];
    const raw = await invoke<any[]>("search_notes", { query, topK: limit, top_k: limit });
    return raw.map((r) => ({
      ...r,
      path: r.path || r.file_path || "",
      file_path: r.path || r.file_path || "",
      title: r.title || r.titulo || "Sem título",
      titulo: r.titulo || r.title || "Sem título",
      score: typeof r.score === "number" ? r.score : 0,
      preview: r.preview || "",
      vault: r.vault || "default",
      categoria: r.categoria,
    }));
  },

  async readNote(identifier: string): Promise<NoteResponse> {
    if (await webActive()) {
      return await wGet<NoteResponse>(`/api/note?identifier=${encodeURIComponent(identifier)}`);
    }
    if (!isTauri()) {
      return {
        title: identifier,
        titulo: identifier,
        content: `# ${identifier}\n\nConteúdo simulado da nota para testes em ambiente web.`,
        frontmatter: { titulo: identifier },
        vault: "default",
      };
    }
    const n = await invoke<any>("read_note", { identifier });
    return {
      ...n,
      title: n.title || n.titulo || identifier,
      titulo: n.titulo || n.title || identifier,
      content: n.content || n.corpo || "",
      corpo: n.content || n.corpo || "",
      frontmatter: n.frontmatter || {},
      vault: n.vault || "default",
      categoria: n.categoria,
    };
  },

  async getNotesGraph(): Promise<import("./types").GraphData> {
    if (await webActive()) return await wGet<import("./types").GraphData>("/api/graph");
    if (!isTauri()) {
      return {
        nodes: [
          { id: "Nota 1", title: "Nota 1", vault: "default", path: "/default/Nota 1.md", tags: ["ia"] },
          { id: "Nota 2", title: "Nota 2", vault: "obsidian", path: "/obsidian/Nota 2.md", tags: ["trabalho"] },
        ],
        links: [{ source: "Nota 1", target: "Nota 2" }],
      };
    }
    return await invoke<import("./types").GraphData>("get_notes_graph");
  },

  async reindexVaults(): Promise<void> {
    if (await webActive()) return;
    if (!isTauri()) return;
    await invoke<void>("reindex_vaults");
  },

  async listNoteTitles(): Promise<import("./types").NoteTitleItem[]> {
    if (await webActive()) return await wGet<import("./types").NoteTitleItem[]>("/api/notes/titles");
    if (!isTauri()) {
      return [
        { title: "Arquitetura do Copernico", vault: "default", path: "/default/Arquitetura.md" },
        { title: "Albion Online Guia", vault: "obsidian", path: "/obsidian/Albion.md" },
        { title: "Notas de Reunião", vault: "default", path: "/default/Reuniao.md" },
      ];
    }
    return await invoke<import("./types").NoteTitleItem[]>("list_note_titles");
  },

  async getSystemPrompt(): Promise<string> {
    if (await webActive()) {
      const p = await wGet<Record<string, string | null>>("/api/prompts");
      return p.system_prompt || "Você é o Copernico (Second Brain) — assistente pessoal local do usuário.";
    }
    if (!isTauri()) {
      return "Você é o Copernico (Second Brain) — assistente pessoal local do usuário.";
    }
    return await invoke<string>("get_system_prompt");
  },

  async setSystemPrompt(prompt: string): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", "/api/prompts", { system_prompt: prompt });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("set_system_prompt", { prompt });
  },

  async resetSystemPrompt(): Promise<string> {
    const d = "Você é o Copernico (Second Brain) — assistente pessoal local do usuário.";
    if (await webActive()) {
      await wSend("PATCH", "/api/prompts", { system_prompt: d });
      return d;
    }
    if (!isTauri()) {
      return d;
    }
    return await invoke<string>("reset_system_prompt");
  },

  async getVoiceSystemPrompt(): Promise<string> {
    if (await webActive()) {
      const p = await wGet<Record<string, string | null>>("/api/prompts");
      return p.voice_system_prompt || "Você é o Copernico respondendo por voz. Seja conciso, direto e sem markdown.";
    }
    if (!isTauri()) {
      return "Você é o Copernico respondendo por voz. Seja conciso, direto e sem markdown.";
    }
    return await invoke<string>("get_voice_system_prompt");
  },

  async setVoiceSystemPrompt(prompt: string): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", "/api/prompts", { voice_system_prompt: prompt });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("set_voice_system_prompt", { prompt });
  },

  async resetVoiceSystemPrompt(): Promise<string> {
    const d = "Você é o Copernico respondendo por voz. Seja conciso, direto e sem markdown.";
    if (await webActive()) {
      await wSend("PATCH", "/api/prompts", { voice_system_prompt: d });
      return d;
    }
    if (!isTauri()) {
      return d;
    }
    return await invoke<string>("reset_voice_system_prompt");
  },

  async syncActiveSession(_sessionId: string | null): Promise<void> {
    if (await webActive()) return;
    if (!isTauri()) return;
    await invoke<void>("set_active_session_id", { sessionId: _sessionId });
  },

  async openBrainFolder(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("open_brain_folder");
  },

  async transcribeAudio(audioBytes: Uint8Array | number[], mimeType?: string): Promise<string> {
    if (await webActive()) {
      const bytes = audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes);
      const r = await fetch(`${BACKEND_URL}/api/stt`, {
        method: "POST",
        headers: { "Content-Type": mimeType || "audio/webm" },
        body: bytes as unknown as BodyInit,
      });
      if (!r.ok) throw new Error(`STT ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as { text: string };
      return j.text;
    }
    if (!isTauri()) {
      return "Transcrição simulada: teste de voz com Whisper.";
    }
    const bytesArray = audioBytes instanceof Uint8Array ? Array.from(audioBytes) : audioBytes;
    return await invoke<string>("transcribe_audio", {
      audioBytes: bytesArray,
      mimeType: mimeType || "audio/webm",
    });
  },

  async getWakeWordThreshold(): Promise<number> {
    if (await webActive()) return 0.5;
    if (!isTauri()) return 0.50;
    try {
      return await invoke<number>("get_wake_word_threshold");
    } catch {
      return 0.50;
    }
  },

  async setWakeWordThreshold(_threshold: number): Promise<void> {
    if (await webActive()) return;
    if (!isTauri()) return;
    try {
      await invoke<void>("set_wake_word_threshold", { threshold: _threshold });
    } catch (e) {
      console.warn("setWakeWordThreshold error:", e);
    }
  },

  async setWakeDetectionActive(_active: boolean): Promise<void> {
    if (await webActive()) return;
    if (!isTauri()) return;
    try {
      await invoke<void>("set_wake_detection_active", { active: _active });
    } catch (e) {
      console.warn("setWakeDetectionActive error:", e);
    }
  },

  async setWakeMicEnabled(_enabled: boolean): Promise<void> {
    if (await webActive()) return;
    if (!isTauri()) return;
    try {
      await invoke<void>("set_wake_mic_enabled", { enabled: _enabled });
    } catch (e) {
      console.warn("setWakeMicEnabled error:", e);
    }
  },

  async cancelWakeRecording(): Promise<void> {
    if (await webActive()) return;
    if (!isTauri()) return;
    try {
      await invoke<void>("cancel_wake_recording");
    } catch (e) {
      console.warn("cancelWakeRecording error:", e);
    }
  },

  async startManualRecording(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("start_manual_recording");
  },

  async stopManualRecording(discard: boolean): Promise<number[] | null> {
    if (!isTauri()) return null;
    return await invoke<number[] | null>("stop_manual_recording", { discard });
  },

  async deleteMessage(messageId: number | string): Promise<boolean> {
    if (await webActive()) {
      await wSend("DELETE", `/api/messages/${messageId}`);
      return true;
    }
    if (!isTauri()) {
      for (const sid in mockMessages) {
        mockMessages[sid] = mockMessages[sid].filter((m) => String(m.id) !== String(messageId));
      }
      return true;
    }
    const numId = typeof messageId === "string" ? parseInt(messageId, 10) : messageId;
    return await invoke<boolean>("delete_message", { messageId: numId });
  },

  async timeTravelEdit(
    sessionId: string,
    messageId: number | string,
    newContent: string,
    origin = "text"
  ): Promise<SendMessageResponse> {
    if (await webActive()) {
      await wSend("POST", "/api/chat/time-travel", {
        session_id: sessionId,
        message_id: typeof messageId === "string" ? parseInt(messageId, 10) : messageId,
        newContent,
        origin,
      });
      const msgs = await this.getMessages(sessionId);
      const users = msgs.filter((m) => m.role === "user");
      const assistants = msgs.filter((m) => m.role === "assistant");
      return {
        user_message: users[users.length - 1],
        assistant_message: assistants[assistants.length - 1],
      };
    }
    if (!isTauri()) {
      const msgs = mockMessages[sessionId] || [];
      const idx = msgs.findIndex((m) => String(m.id) === String(messageId));
      if (idx >= 0) {
        mockMessages[sessionId] = msgs.slice(0, idx);
      }
      return this.sendMessage(sessionId, newContent, origin);
    }
    const numId = typeof messageId === "string" ? parseInt(messageId, 10) : messageId;
    return await invoke<SendMessageResponse>("time_travel_edit", {
      sessionId,
      messageId: numId,
      newContent,
      origin,
    });
  },

  async getTtsVoices(): Promise<VoiceInfo[]> {
    if (await webActive()) return await wGet<VoiceInfo[]>("/api/tts/voices");
    if (!isTauri()) {
      return [
        {
          name: "Microsoft Server Speech Text to Speech Voice (pt-BR, ThalitaNeural)",
          short_name: "pt-BR-ThalitaNeural",
          gender: "Female",
          locale: "pt-BR",
          friendly_name: "Thalita (Expressiva e Ágil)",
        },
        {
          name: "Microsoft Server Speech Text to Speech Voice (pt-BR, FranciscaNeural)",
          short_name: "pt-BR-FranciscaNeural",
          gender: "Female",
          locale: "pt-BR",
          friendly_name: "Francisca (Acolhedora e Natural)",
        },
        {
          name: "Microsoft Server Speech Text to Speech Voice (pt-BR, AntonioNeural)",
          short_name: "pt-BR-AntonioNeural",
          gender: "Male",
          locale: "pt-BR",
          friendly_name: "Antônio (Calmo e Confiante)",
        },
      ];
    }
    return await invoke<VoiceInfo[]>("get_tts_voices");
  },

  async getCurrentTtsVoice(): Promise<string> {
    if (await webActive()) {
      const p = await wGet<Record<string, string | null>>("/api/prompts");
      return p.tts_voice || "pt-BR-ThalitaNeural";
    }
    if (!isTauri()) return "pt-BR-ThalitaNeural";
    return await invoke<string>("get_current_tts_voice");
  },

  async setTtsVoice(voice: string): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", "/api/prompts", { tts_voice: voice });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("set_tts_voice", { voice });
  },

  async testTtsVoice(voice?: string): Promise<void> {
    if (await webActive()) {
      await this.speakText("Olá! Esta é a minha voz.", voice);
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("test_tts_voice", { voice });
  },

  async speakText(text: string, voice?: string): Promise<void> {
    if (await webActive()) {
      stopWebAudio();
      const r = await fetch(`${BACKEND_URL}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
      const buf = await r.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      currentAudio = new Audio(url);
      try {
        useVoiceStore.getState().setWakeStatus("speaking");
      } catch {
        /* noop */
      }
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        try {
          useVoiceStore.getState().setWakeStatus("idle");
        } catch {
          /* noop */
        }
      };
      await currentAudio.play();
      return;
    }
    if (!isTauri()) {
      console.log("[Mock TTS] Falando:", text);
      return;
    }
    await invoke<void>("speak_text", { text, voice });
  },

  async stopTts(): Promise<void> {
    if (await webActive()) {
      stopWebAudio();
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("stop_tts");
  },

  async fadeOutTts(durationMs = 250): Promise<void> {
    if (await webActive()) {
      stopWebAudio();
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("fade_out_tts", { durationMs });
  },

  async benchmarkTts(text?: string, voice?: string): Promise<TtsBenchmarkResult> {
    if (await webActive()) {
      const t0 = performance.now();
      const r = await fetch(`${BACKEND_URL}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text || "Texto de benchmark", voice }),
      });
      if (!r.ok) throw new Error(`TTS ${r.status}`);
      const buf = await r.arrayBuffer();
      const ms = performance.now() - t0;
      return {
        text: text || "Texto de benchmark",
        voice: voice || "pt-BR-ThalitaNeural",
        total_chars: (text || "").length,
        chunks_count: 1,
        time_to_first_audio_ms: Math.round(ms),
        total_synthesis_time_ms: Math.round(ms),
        audio_bytes_len: buf.byteLength,
        chars_per_second: (text || "").length / (ms / 1000 || 1),
      };
    }
    if (!isTauri()) {
      return {
        text: text || "Texto simulado para teste de TTS",
        voice: voice || "pt-BR-ThalitaNeural",
        total_chars: 40,
        chunks_count: 1,
        time_to_first_audio_ms: 280,
        total_synthesis_time_ms: 280,
        audio_bytes_len: 12400,
        chars_per_second: 142.8,
      };
    }
    return await invoke<TtsBenchmarkResult>("benchmark_tts", { text, voice });
  },

  // --- Plugins, Ferramentas, MCP e Skills ---

  async listPlugins(): Promise<PluginItem[]> {
    if (!isTauri()) return [];
    return await invoke<PluginItem[]>("list_plugins");
  },

  async reloadPlugins(): Promise<PluginItem[]> {
    if (!isTauri()) return [];
    return await invoke<PluginItem[]>("reload_plugins");
  },

  async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("toggle_plugin", { pluginId, enabled });
  },

  async getSkillConfig(skillId: string): Promise<import("./types").SkillConfigData> {
    if (!isTauri()) {
      return {
        skill_id: skillId,
        max_iterations: 8,
        system_prompt: "",
        custom_goal: "",
        options: {
          announce_searches: true,
          announce_thoughts: true,
          announce_questions: true,
        },
      };
    }
    return await invoke<import("./types").SkillConfigData>("get_skill_config", { skillId });
  },

  async saveSkillConfig(skillId: string, config: import("./types").SkillConfigData): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("save_skill_config", { skillId, config });
  },

  async resetSkillConfig(skillId: string): Promise<import("./types").SkillConfigData> {
    if (!isTauri()) {
      return {
        skill_id: skillId,
        max_iterations: 8,
        system_prompt: "",
        custom_goal: "",
        options: {
          announce_searches: true,
          announce_thoughts: true,
          announce_questions: true,
        },
      };
    }
    return await invoke<import("./types").SkillConfigData>("reset_skill_config", { skillId });
  },

  async listTools(): Promise<any> {
    if (!isTauri()) return [];
    return await invoke<any>("list_tools");
  },

  async getMcpServersStatus(): Promise<McpServerStatus[]> {
    if (!isTauri()) return [];
    return await invoke<McpServerStatus[]>("get_mcp_servers_status");
  },

  async runSkillNow(skillId: string, manualInput?: string): Promise<any> {
    if (!isTauri()) return { mock: true };
    return await invoke<any>("run_skill_now", { skillId, manualInput });
  },

  async listThemes(): Promise<ThemeItem[]> {
    if (!isTauri()) return [];
    return await invoke<ThemeItem[]>("list_themes");
  },

  async getActiveTheme(): Promise<string | null> {
    if (!isTauri()) return null;
    return await invoke<string | null>("get_active_theme");
  },

  async setActiveTheme(themeId: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("set_active_theme", { themeId });
  },

  // --- Inbox & Cartas do Agente ---

  async listInboxItems(): Promise<InboxItem[]> {
    if (await webActive()) return await wGet<InboxItem[]>("/api/inbox");
    if (!isTauri()) return [];
    return await invoke<InboxItem[]>("list_inbox_items");
  },

  async markInboxItemStatus(id: string, status: string, reason?: string | null): Promise<void> {
    if (await webActive()) {
      await wSend("POST", "/api/inbox/mark", { id, status, reason: reason ?? null });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("mark_inbox_item_status", { id, status, reason: reason ?? null });
  },

  async deleteInboxItem(id: string, reason?: string | null): Promise<boolean> {
    if (await webActive()) {
      await wSend("DELETE", `/api/inbox/${id}`, { reason: reason ?? null });
      return true;
    }
    if (!isTauri()) return true;
    return await invoke<boolean>("delete_inbox_item", { id, reason: reason ?? null });
  },

  async acceptInboxItem(id: string, reason?: string | null): Promise<string> {
    if (await webActive()) {
      const r = await wSend<{ carried_to?: string; ok?: boolean }>("POST", "/api/inbox/accept", {
        id,
        reason: reason ?? null,
      });
      return r.carried_to || "";
    }
    if (!isTauri()) return "";
    return await invoke<string>("accept_inbox_item", { id, reason: reason ?? null });
  },

  async evolveNote(id: string, reason?: string | null): Promise<string> {
    if (await webActive()) {
      await wSend("POST", "/api/inbox/mark", { id, status: "applied", reason: reason ?? null });
      return "";
    }
    if (!isTauri()) return "";
    return await invoke<string>("evolve_note", { id, reason: reason ?? null });
  },

  async refineInboxProposal(id: string, feedback: string): Promise<InboxItem> {
    if (await webActive()) {
      await wSend("POST", "/api/inbox/mark", { id, status: "read", reason: feedback });
      const items = await this.listInboxItems();
      const found = items.find((i) => i.id === id);
      if (!found) throw new Error("item não encontrado");
      return found;
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<InboxItem>("refine_inbox_proposal", { id, feedback });
  },

  async dismissInboxItem(id: string, reason?: string | null): Promise<void> {
    if (await webActive()) {
      await wSend("POST", "/api/inbox/mark", { id, status: "dismissed", reason: reason ?? null });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("dismiss_inbox_item", { id, reason: reason ?? null });
  },

  async snoozeInboxItem(id: string, reason?: string | null): Promise<void> {
    if (await webActive()) {
      await wSend("POST", "/api/inbox/mark", { id, status: "snoozed", reason: reason ?? null });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("snooze_inbox_item", { id, reason: reason ?? null });
  },

  async pruneDismissedInbox(): Promise<number> {
    if (await webActive()) {
      const r = await wSend<{ pruned: number }>("POST", "/api/inbox/prune", {});
      return r.pruned;
    }
    if (!isTauri()) return 0;
    return await invoke<number>("prune_dismissed_inbox");
  },

  async getUnreadInboxCount(): Promise<number> {
    if (await webActive()) {
      const r = await wGet<{ count: number }>("/api/inbox/unread-count");
      return r.count;
    }
    if (!isTauri()) return 0;
    return await invoke<number>("get_unread_inbox_count");
  },

  // --- Skill Cron Override ---

  async setSkillCron(skillId: string, cronExpr: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("set_skill_cron", { skillId, cronExpr });
  },

  async resetSkillCron(skillId: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("reset_skill_cron", { skillId });
  },

  async getSkillCronOverride(skillId: string): Promise<string | null> {
    if (!isTauri()) return null;
    return await invoke<string | null>("get_skill_cron_override", { skillId });
  },

  // --- Onboarding, Perfil & Autoaprendizado ---

  async getUserProfile(): Promise<UserProfile> {
    if (await webActive()) return await wGet<UserProfile>("/api/profile");
    if (!isTauri()) {
      return {
        name: "",
        communication_style: "direto_conciso",
        hotkey: "Ctrl+Space",
        onboarding_completed: false,
      };
    }
    return await invoke<UserProfile>("get_user_profile");
  },

  async saveOnboardingProfile(
    name: string,
    communicationStyle: string,
    hotkey: string,
    dateFormat?: string,
    deepseekApiKey?: string,
    groqApiKey?: string
  ): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", "/api/profile", {
        name,
        communication_style: communicationStyle,
        hotkey,
        date_format: dateFormat || "DD-MM-YY",
        deepseek_api_key: deepseekApiKey || undefined,
        groq_api_key: groqApiKey || undefined,
      });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("save_onboarding_profile", {
      name,
      communicationStyle,
      hotkey,
      dateFormat: dateFormat || "DD-MM-YY",
      deepseekApiKey: deepseekApiKey || null,
      groqApiKey: groqApiKey || null,
    });
  },

  async saveUserProfile(
    name: string,
    communicationStyle: string,
    hotkey: string,
    customInstructions?: string,
    dateFormat?: string,
    deepseekApiKey?: string,
    groqApiKey?: string
  ): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", "/api/profile", {
        name,
        communication_style: communicationStyle,
        hotkey,
        custom_instructions: customInstructions || undefined,
        date_format: dateFormat || undefined,
        deepseek_api_key: deepseekApiKey || undefined,
        groq_api_key: groqApiKey || undefined,
      });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("save_user_profile", {
      name,
      communicationStyle,
      hotkey,
      customInstructions: customInstructions || null,
      dateFormat: dateFormat || "DD-MM-YY",
      deepseekApiKey: deepseekApiKey || null,
      groqApiKey: groqApiKey || null,
    });
  },

  async getApiKeys(): Promise<ApiKeysConfig> {
    if (await webActive()) {
      const p = await wGet<UserProfile>("/api/profile");
      const masked = (v?: string) => (v && v !== "***" ? v : "");
      return { deepseek_api_key: masked(p.deepseek_api_key), groq_api_key: masked(p.groq_api_key) };
    }
    if (!isTauri()) return { deepseek_api_key: "", groq_api_key: "" };
    return await invoke<ApiKeysConfig>("get_api_keys");
  },

  async saveApiKeys(deepseekApiKey: string, groqApiKey: string): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", "/api/profile", { deepseek_api_key: deepseekApiKey, groq_api_key: groqApiKey });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("save_api_keys", {
      deepseekApiKey,
      groqApiKey,
    });
  },

  async resetOnboarding(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("reset_onboarding");
  },

  async updateGlobalShortcut(shortcut: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("update_global_shortcut", { shortcut });
  },

  async applyInstructionImprovement(id: string): Promise<void> {
    if (await webActive()) {
      await wSend("POST", "/api/inbox/mark", { id, status: "applied" });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("apply_instruction_improvement", { id });
  },

  async triggerSessionReflection(sessionId: string): Promise<string | null> {
    if (await webActive()) {
      const r = await wSend<{ inbox_id: string }>("POST", `/api/sessions/${sessionId}/consolidate`, {});
      return r.inbox_id;
    }
    if (!isTauri()) return null;
    return await invoke<string | null>("trigger_session_reflection", { sessionId });
  },

  // --- Skills & Hub ---
  async listSkills(): Promise<SkillInfo[]> {
    if (!isTauri()) return [];
    return await invoke<SkillInfo[]>("list_skills");
  },

  async openSkillsFolder(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("open_skills_folder");
  },

  async installSkillFromSource(source: string): Promise<string> {
    if (!isTauri()) return "Instalado (mock)";
    return await invoke<string>("install_skill_from_source", { source });
  },

  async toggleSkill(id: string, enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("toggle_skill", { id, enabled });
  },

  async deleteSkill(id: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("delete_skill", { id });
  },

  // --- Rotinas Agendadas ---
  async listScheduledRoutines(): Promise<ScheduledRoutine[]> {
    if (await webActive()) {
      const rows = await wGet<any[]>("/api/routines");
      return rows.map((r) => ({ ...r, ativo: !!r.ativo }));
    }
    if (!isTauri()) return [];
    return await invoke<ScheduledRoutine[]>("list_scheduled_routines");
  },

  async saveScheduledRoutine(routine: ScheduledRoutine): Promise<void> {
    if (await webActive()) {
      await wSend("POST", "/api/routines", routine);
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("save_scheduled_routine", { routine });
  },

  async deleteScheduledRoutine(id: string): Promise<boolean> {
    if (await webActive()) {
      await wSend("DELETE", `/api/routines/${id}`);
      return true;
    }
    if (!isTauri()) return true;
    return await invoke<boolean>("delete_scheduled_routine", { id });
  },

  async toggleScheduledRoutine(id: string, enabled: boolean): Promise<void> {
    if (await webActive()) {
      await wSend("PATCH", `/api/routines/${id}`, { ativo: enabled });
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("toggle_scheduled_routine", { id, enabled });
  },

  async triggerRoutineNow(id: string): Promise<any> {
    if (await webActive()) {
      const routines = await this.listScheduledRoutines();
      const r = routines.find((x) => x.id === id);
      if (!r) return null;
      const s = await this.newSession(r.titulo);
      const resp = await this.sendMessage(s.id, r.prompt, "text");
      return resp.assistant_message;
    }
    if (!isTauri()) return null;
    return await invoke<any>("trigger_routine_now", { id });
  },

  // --- MCP Sob Demanda ---
  async getMcpConfig(): Promise<string> {
    if (!isTauri()) return "{\n  \"servers\": {}\n}";
    return await invoke<string>("get_mcp_config");
  },

  async saveMcpConfig(configJson: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("save_mcp_config", { configJson });
  },

  async consolidateSession(sessionId: string): Promise<string | null> {
    if (await webActive()) {
      const r = await wSend<{ inbox_id: string }>("POST", `/api/sessions/${sessionId}/consolidate`, {});
      return r.inbox_id;
    }
    if (!isTauri()) return null;
    return await invoke<string | null>("consolidate_session", { sessionId });
  },

  async renameNote(identifier: string, novoTitulo: string): Promise<any> {
    if (await webActive()) {
      return await wSend("POST", "/api/notes/rename", { identifier, novoTitulo });
    }
    if (!isTauri()) return null;
    return await invoke<any>("rename_note", { identifier, novoTitulo });
  },

  async archiveAndDeleteNote(identifier: string, incorporadaEm?: string, motivo?: string): Promise<string> {
    if (await webActive()) {
      const r = await wSend<{ archived: string }>("POST", "/api/notes/archive-delete", {
        identifier,
        incorporadaEm,
        motivo,
      });
      return r.archived;
    }
    if (!isTauri()) return "";
    return await invoke<string>("archive_and_delete_note", { identifier, incorporadaEm, motivo });
  },

  async consolidateNotes(notaPadrao: string, fontes: string[], corpoFinal: string): Promise<any> {
    if (await webActive()) {
      return await wSend("POST", "/api/notes/consolidate", { notaPadrao, fontes, corpoFinal });
    }
    if (!isTauri()) return null;
    return await invoke<any>("consolidate_notes", { notaPadrao, fontes, corpoFinal });
  },

  async listGreetings(): Promise<any[]> {
    if (!isTauri()) return [];
    return await invoke<any[]>("list_greetings");
  },

  async ensureGreetings(): Promise<string> {
    if (!isTauri()) return "";
    return await invoke<string>("ensure_greetings");
  },

  // --- Kanban Semanal ---

  /**
   * Lê o quadro. Sem `semana`, o backend devolve apenas a semana aberta
   * (invariante anti-alucinação) — nunca uma semana antiga arbitrária.
   */
  async listKanbanWeek(semana?: string | null): Promise<KanbanBoard> {
    if (await webActive()) {
      const q = semana ? `?semana=${encodeURIComponent(semana)}` : "";
      return await wGet<KanbanBoard>(`/api/kanban${q}`);
    }
    if (!isTauri()) {
      const now = new Date();
      return {
        week: {
          id: "",
          year: now.getFullYear(),
          iso_week: 0,
          week_start: "",
          week_end: "",
          status: "open",
          created_at: "",
          closed_at: null,
        },
        tasks: [],
        links: [],
        habits: [],
      };
    }
    return await invoke<KanbanBoard>("list_kanban_week", {
      semana: semana ?? null,
    });
  },

  async createKanbanTask(
    titulo: string,
    column?: string,
    dueDate?: string | null
  ): Promise<KanbanTask> {
    if (await webActive()) {
      return await wSend<KanbanTask>("POST", "/api/kanban/tasks", { titulo, column, dueDate });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<KanbanTask>("create_kanban_task", {
      titulo,
      column: column ?? null,
      dueDate: dueDate ?? null,
    });
  },

  async moveKanbanTask(id: string, column: string, index: number): Promise<KanbanTask> {
    if (await webActive()) {
      return await wSend<KanbanTask>("POST", `/api/kanban/tasks/${id}/move`, { column, index });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<KanbanTask>("move_kanban_task", { id, column, index });
  },

  async updateKanbanTask(
    id: string,
    titulo: string,
    dueDate?: string | null
  ): Promise<KanbanTask> {
    if (await webActive()) {
      return await wSend<KanbanTask>("PATCH", `/api/kanban/tasks/${id}`, { titulo, dueDate });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<KanbanTask>("update_kanban_task", {
      id,
      titulo,
      dueDate: dueDate ?? null,
    });
  },

  /** Desvincula a tarefa: nenhum `.md` é apagado do cofre. */
  async deleteKanbanTask(id: string): Promise<void> {
    if (await webActive()) {
      await wSend("DELETE", `/api/kanban/tasks/${id}`);
      return;
    }
    if (!isTauri()) return;
    await invoke<void>("delete_kanban_task", { id });
  },

  // --- Kanban Fase 2: notas, entities e vínculos ---

  /** Cria (idempotente) a nota canônica da tarefa no vault padrão. */
  async createTaskNote(id: string): Promise<KanbanTask> {
    if (await webActive()) {
      await wSend("POST", `/api/kanban/tasks/${id}/note`, {});
      const board = await this.listKanbanWeek();
      const found = board.tasks.find((t) => t.id === id);
      if (!found) throw new Error("tarefa não encontrada após criar nota");
      return found;
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<KanbanTask>("create_task_note", { id });
  },

  /** Corpo da nota da tarefa (sem frontmatter); `null` quando não existe. */
  async getTaskNote(id: string): Promise<string | null> {
    if (await webActive()) {
      const r = await wGet<{ content: string | null }>(`/api/kanban/tasks/${id}/note`);
      return r.content;
    }
    if (!isTauri()) return null;
    return await invoke<string | null>("get_task_note", { id });
  },

  /** Substituição atômica do corpo da nota (debounce do editor). */
  async saveTaskNote(id: string, content: string): Promise<string> {
    if (await webActive()) {
      const r = await wSend<{ path: string }>("POST", `/api/kanban/tasks/${id}/note`, { content });
      return r.path;
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<string>("save_task_note", { id, content });
  },

  /** Vincula uma nota do vault padrão à tarefa (chip no card). */
  async linkTaskNote(id: string, notePath: string): Promise<TaskLinks> {
    if (await webActive()) {
      return await wSend<TaskLinks>("POST", `/api/kanban/tasks/${id}/link-note`, { notePath });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<TaskLinks>("link_task_note", { id, notePath });
  },

  /** Desvincula a nota — o `.md` permanece no cofre. */
  async unlinkTaskNote(id: string, notePath: string): Promise<TaskLinks> {
    if (await webActive()) {
      return await wSend<TaskLinks>("DELETE", `/api/kanban/tasks/${id}/link-note?notePath=${encodeURIComponent(notePath)}`);
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<TaskLinks>("unlink_task_note", { id, notePath });
  },

  /** Lista o índice derivado de entities (filtro opcional por subtipo/título). */
  async listEntities(
    subtipo?: string | null,
    query?: string | null
  ): Promise<EntityItem[]> {
    if (await webActive()) {
      const q = `?subtipo=${encodeURIComponent(subtipo ?? "")}&query=${encodeURIComponent(query ?? "")}`;
      return await wGet<EntityItem[]>(`/api/entities${q}`);
    }
    if (!isTauri()) return [];
    return await invoke<EntityItem[]>("list_entities", {
      subtipo: subtipo ?? null,
      query: query ?? null,
    });
  },

  /** Cria a entity como nota canônica (`tipo: entidade`) + índice derivado. */
  async createEntity(titulo: string, subtipo?: string | null): Promise<EntityItem> {
    if (await webActive()) {
      return await wSend<EntityItem>("POST", "/api/entities", { titulo, subtipo });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<EntityItem>("create_entity", {
      titulo,
      subtipo: subtipo ?? null,
    });
  },

  /** Vincula uma entity existente (validada no índice) à tarefa. */
  async linkTaskEntity(id: string, entityId: string): Promise<TaskLinks> {
    if (await webActive()) {
      return await wSend<TaskLinks>("POST", `/api/kanban/tasks/${id}/link-entity`, { entityId });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<TaskLinks>("link_task_entity", { id, entityId });
  },

  /** Desvincula a entity — a `.md` canônica permanece no cofre. */
  async unlinkTaskEntity(id: string, entityId: string): Promise<TaskLinks> {
    if (await webActive()) {
      return await wSend<TaskLinks>("DELETE", `/api/kanban/tasks/${id}/link-entity?entityId=${encodeURIComponent(entityId)}`);
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<TaskLinks>("unlink_task_entity", { id, entityId });
  },

  // --- Hábitos (Fase 4) ---

  /** Lista os hábitos com `streak_atual` derivado das métricas. */
  async listHabits(): Promise<Habit[]> {
    if (await webActive()) return await wGet<Habit[]>("/api/habits");
    if (!isTauri()) return [];
    return await invoke<Habit[]>("list_habits");
  },

  /**
   * Cria o hábito (cron validado no backend). A task do dia nasce no
   * próximo sync — nada é gerado no ato.
   */
  async createHabit(
    titulo: string,
    cronExpr: string,
    cor?: string | null
  ): Promise<Habit> {
    if (await webActive()) {
      return await wSend<Habit>("POST", "/api/habits", { titulo, cronExpr, cor });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<Habit>("create_habit", {
      titulo,
      cronExpr,
      cor: cor ?? null,
    });
  },

  /**
   * Edita título/cron/cor de um hábito existente (cron validado no backend).
   * Tasks já geradas e métricas históricas permanecem intactas.
   */
  async updateHabit(
    id: string,
    titulo: string,
    cronExpr: string,
    cor?: string | null
  ): Promise<Habit> {
    if (await webActive()) {
      return await wSend<Habit>("PATCH", `/api/habits/${id}`, { titulo, cronExpr, cor });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<Habit>("update_habit", {
      id,
      titulo,
      cronExpr,
      cor: cor ?? null,
    });
  },

  /** Ativa/desativa a geração (histórico e métricas preservados). */
  async setHabitActive(id: string, ativo: boolean): Promise<Habit> {
    if (await webActive()) {
      return await wSend<Habit>("POST", `/api/habits/${id}/active`, { ativo });
    }
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<Habit>("set_habit_active", { id, ativo });
  },

  /**
   * Remove o hábito: hard delete só se nunca gerou task; caso contrário
   * desativa (`ativo=0`). Devolve `true` quando apagou definitivamente.
   */
  async deleteHabit(id: string): Promise<boolean> {
    if (await webActive()) {
      const r = await wSend<{ deleted: boolean }>("DELETE", `/api/habits/${id}`);
      return r.deleted;
    }
    if (!isTauri()) return false;
    return await invoke<boolean>("delete_habit", { id });
  },

  // --- Insights (Fase 5) ---

  /**
   * Relatório agregado da aba Insights. O backend calcula tudo — o frontend
   * só desenha (invariante: nada de agregado no cliente).
   *
   * `periodo`: `"semana"` (padrão) ou `"mes"` — granularidade das linhas
   * "estimado vs realizado".
   */
  async listInsights(periodo?: string | null): Promise<Insights> {
    if (await webActive()) {
      return await wGet<Insights>(`/api/insights?periodo=${encodeURIComponent(periodo ?? "semana")}`);
    }
    if (!isTauri()) return Insights.empty(periodo ?? "semana");
    return await invoke<Insights>("list_insights", { periodo: periodo ?? null });
  },
};
