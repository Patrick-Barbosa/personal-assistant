import { invoke } from "@tauri-apps/api/core";
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
} from "./types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  async toggleOverlay(visible?: boolean): Promise<boolean> {
    if (!isTauri()) return false;
    return await invoke<boolean>("toggle_overlay", { visible });
  },

  async listSessions(): Promise<Session[]> {
    if (!isTauri()) return [...mockSessions];
    const raw = await invoke<any[]>("list_sessions");
    return raw.map((s) => ({
      ...s,
      title: s.title || s.titulo || "Conversa",
    }));
  },

  async getMessages(sessionId: string): Promise<Message[]> {
    if (!isTauri()) return mockMessages[sessionId] || [];
    return await invoke<Message[]>("get_messages", { sessionId });
  },

  async newSession(title?: string): Promise<Session> {
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
    if (!isTauri()) {
      const s = mockSessions.find((item) => item.id === sessionId);
      if (s) s.title = newTitle;
      return;
    }
    return await invoke<void>("rename_session", { sessionId, title: newTitle, newTitle });
  },

  async deleteSession(sessionId: string): Promise<void> {
    if (!isTauri()) {
      mockSessions = mockSessions.filter((item) => item.id !== sessionId);
      delete mockMessages[sessionId];
      return;
    }
    return await invoke<void>("delete_session", { sessionId });
  },

  async sendMessage(sessionId: string, content: string, origin = "text"): Promise<SendMessageResponse> {
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
    if (!isTauri()) return;
    await invoke<void>("reindex_vaults");
  },

  async listNoteTitles(): Promise<import("./types").NoteTitleItem[]> {
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
    if (!isTauri()) {
      return "Você é o Copernico (Second Brain) — assistente pessoal local do usuário.";
    }
    return await invoke<string>("get_system_prompt");
  },

  async setSystemPrompt(prompt: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("set_system_prompt", { prompt });
  },

  async resetSystemPrompt(): Promise<string> {
    if (!isTauri()) {
      return "Você é o Copernico (Second Brain) — assistente pessoal local do usuário.";
    }
    return await invoke<string>("reset_system_prompt");
  },

  async getVoiceSystemPrompt(): Promise<string> {
    if (!isTauri()) {
      return "Você é o Copernico respondendo por voz. Seja conciso, direto e sem markdown.";
    }
    return await invoke<string>("get_voice_system_prompt");
  },

  async setVoiceSystemPrompt(prompt: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("set_voice_system_prompt", { prompt });
  },

  async resetVoiceSystemPrompt(): Promise<string> {
    if (!isTauri()) {
      return "Você é o Copernico respondendo por voz. Seja conciso, direto e sem markdown.";
    }
    return await invoke<string>("reset_voice_system_prompt");
  },

  async syncActiveSession(sessionId: string | null): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("set_active_session_id", { sessionId });
  },

  async openBrainFolder(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("open_brain_folder");
  },

  async transcribeAudio(audioBytes: Uint8Array | number[], mimeType?: string): Promise<string> {
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
    if (!isTauri()) return 0.50;
    try {
      return await invoke<number>("get_wake_word_threshold");
    } catch {
      return 0.50;
    }
  },

  async setWakeWordThreshold(threshold: number): Promise<void> {
    if (!isTauri()) return;
    try {
      await invoke<void>("set_wake_word_threshold", { threshold });
    } catch (e) {
      console.warn("setWakeWordThreshold error:", e);
    }
  },

  async setWakeDetectionActive(active: boolean): Promise<void> {
    if (!isTauri()) return;
    try {
      await invoke<void>("set_wake_detection_active", { active });
    } catch (e) {
      console.warn("setWakeDetectionActive error:", e);
    }
  },

  async cancelWakeRecording(): Promise<void> {
    if (!isTauri()) return;
    try {
      await invoke<void>("cancel_wake_recording");
    } catch (e) {
      console.warn("cancelWakeRecording error:", e);
    }
  },

  /** Diagnóstico temporário: espelha log do indicador no copernico.log. */
  async reportSunDebug(message: string): Promise<void> {
    if (!isTauri()) return;
    try {
      await invoke<void>("report_sun_debug", { message });
    } catch (e) {
      console.warn("reportSunDebug error:", e);
    }
  },

  async deleteMessage(messageId: number | string): Promise<boolean> {
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
    if (!isTauri()) return "pt-BR-ThalitaNeural";
    return await invoke<string>("get_current_tts_voice");
  },

  async setTtsVoice(voice: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("set_tts_voice", { voice });
  },

  async testTtsVoice(voice?: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("test_tts_voice", { voice });
  },

  async speakText(text: string, voice?: string): Promise<void> {
    if (!isTauri()) {
      console.log("[Mock TTS] Falando:", text);
      return;
    }
    await invoke<void>("speak_text", { text, voice });
  },

  async stopTts(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("stop_tts");
  },

  async fadeOutTts(durationMs = 250): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("fade_out_tts", { durationMs });
  },

  async benchmarkTts(text?: string, voice?: string): Promise<TtsBenchmarkResult> {
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
    if (!isTauri()) return [];
    return await invoke<InboxItem[]>("list_inbox_items");
  },

  async markInboxItemStatus(id: string, status: string, reason?: string | null): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("mark_inbox_item_status", { id, status, reason: reason ?? null });
  },

  async deleteInboxItem(id: string, reason?: string | null): Promise<boolean> {
    if (!isTauri()) return true;
    return await invoke<boolean>("delete_inbox_item", { id, reason: reason ?? null });
  },

  async acceptInboxItem(id: string, reason?: string | null): Promise<string> {
    if (!isTauri()) return "";
    return await invoke<string>("accept_inbox_item", { id, reason: reason ?? null });
  },

  async evolveNote(id: string, reason?: string | null): Promise<string> {
    if (!isTauri()) return "";
    return await invoke<string>("evolve_note", { id, reason: reason ?? null });
  },

  async refineInboxProposal(id: string, feedback: string): Promise<InboxItem> {
    if (!isTauri()) throw new Error("Tauri não disponível");
    return await invoke<InboxItem>("refine_inbox_proposal", { id, feedback });
  },

  async dismissInboxItem(id: string, reason?: string | null): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("dismiss_inbox_item", { id, reason: reason ?? null });
  },

  async snoozeInboxItem(id: string, reason?: string | null): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("snooze_inbox_item", { id, reason: reason ?? null });
  },

  async pruneDismissedInbox(): Promise<number> {
    if (!isTauri()) return 0;
    return await invoke<number>("prune_dismissed_inbox");
  },

  async getUnreadInboxCount(): Promise<number> {
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
    dateFormat?: string
  ): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("save_onboarding_profile", {
      name,
      communicationStyle,
      hotkey,
      dateFormat: dateFormat || "DD-MM-YY",
    });
  },

  async saveUserProfile(
    name: string,
    communicationStyle: string,
    hotkey: string,
    customInstructions?: string,
    dateFormat?: string
  ): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("save_user_profile", {
      name,
      communicationStyle,
      hotkey,
      customInstructions: customInstructions || null,
      dateFormat: dateFormat || "DD-MM-YY",
    });
  },

  async updateGlobalShortcut(shortcut: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("update_global_shortcut", { shortcut });
  },

  async applyInstructionImprovement(id: string): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("apply_instruction_improvement", { id });
  },

  async triggerSessionReflection(sessionId: string): Promise<string | null> {
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
    if (!isTauri()) return [];
    return await invoke<ScheduledRoutine[]>("list_scheduled_routines");
  },

  async saveScheduledRoutine(routine: ScheduledRoutine): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("save_scheduled_routine", { routine });
  },

  async deleteScheduledRoutine(id: string): Promise<boolean> {
    if (!isTauri()) return true;
    return await invoke<boolean>("delete_scheduled_routine", { id });
  },

  async toggleScheduledRoutine(id: string, enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>("toggle_scheduled_routine", { id, enabled });
  },

  async triggerRoutineNow(id: string): Promise<any> {
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
    if (!isTauri()) return null;
    return await invoke<string | null>("consolidate_session", { sessionId });
  },

  async renameNote(identifier: string, novoTitulo: string): Promise<any> {
    if (!isTauri()) return null;
    return await invoke<any>("rename_note", { identifier, novoTitulo });
  },

  async archiveAndDeleteNote(identifier: string, incorporadaEm?: string, motivo?: string): Promise<string> {
    if (!isTauri()) return "";
    return await invoke<string>("archive_and_delete_note", { identifier, incorporadaEm, motivo });
  },

  async consolidateNotes(notaPadrao: string, fontes: string[], corpoFinal: string): Promise<any> {
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
};

