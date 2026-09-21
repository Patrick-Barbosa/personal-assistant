import { api } from "../api";

const THEME_STYLE_ID = "copernico-custom-theme";

export class ThemeEngine {
  static applyTheme(themeId: string, cssContent: string) {
    if (!themeId || themeId === "default") {
      this.clearTheme();
      return;
    }

    let styleEl = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = THEME_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssContent;
  }

  static clearTheme() {
    const styleEl = document.getElementById(THEME_STYLE_ID);
    if (styleEl) {
      styleEl.remove();
    }
  }

  static async init() {
    try {
      const activeThemeId = await api.getActiveTheme();
      if (activeThemeId && activeThemeId !== "default") {
        const themes = await api.listThemes();
        const found = themes.find((t) => t.id === activeThemeId);
        if (found && found.css) {
          this.applyTheme(found.id, found.css);
        }
      }
    } catch (e) {
      console.warn("[THEME] Falha ao inicializar tema ativo:", e);
    }
  }
}
