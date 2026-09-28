pub mod habit;
pub mod inbox;
pub mod insights;
pub mod kanban;
pub mod note;
pub mod plugin;
pub mod routine;
pub mod search;
pub mod session;
pub mod skill;
pub mod voice;

// Re-exports for ergonomic access
pub use habit::Habit;
pub use inbox::InboxItem;
pub use insights::{
    DayBarPoint, DayHabitMetric, DayTaskCount, Insights, LineSeriesPoint, StreakCard,
    WeekTaskCount, WeekTrendPoint,
};
pub use kanban::{
    EntityIndexEntry, EntitySubtipo, KanbanBoard, KanbanTask, KanbanWeek, TaskColumn, TaskKind,
    TaskLinks, TaskStatus, WeekStatus,
};
pub use note::{
    BaseFile, GraphData, GraphLink, GraphNode, Note, NoteFrontmatter, NoteTitleItem, RenameReport,
};
pub use plugin::{
    ExternalMcpConfigFile, McpServerConfig, McpToolInfo, PluginManifest, PluginMeta,
    PluginProvides, PluginRuntime, SkillConfig, SkillExecution, SkillTrigger, ThemeConfig,
    ViewConfig,
};
pub use routine::ScheduledRoutine;
pub use search::SearchResult;
pub use session::{
    ChatMessage, ChatUsage, FunctionCall, Message, SendMessageResponse, Session, ToolCall,
};
pub use skill::SkillInfo;
pub use voice::{
    GreetingItem, GreetingKind, ThinkingAudioItem, TtsBenchmarkResult, VoiceInfo,
    THINKING_AUDIOS_DIR, THINKING_FADE_OUT_MS, THINKING_TEMPLATES, TOTAL_THINKING_AUDIOS,
};
