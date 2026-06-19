/**
 * Apply theme + font-size settings to the document root.
 *
 * Theme:
 *   "system" → follows the OS preference via `prefers-color-scheme`
 *   "light"  → forces `.dark` off
 *   "dark"   → forces `.dark` on
 *
 * Font size: writes `--editor-font-size` to `:root` so the CodeMirror
 * theme + markdown preview both pick it up via their existing
 * `var(--editor-font-size, 16px)` declarations.
 *
 * Mounted once at the top of the app. Re-runs whenever the user
 * changes either setting in the settings dialog; the OS-preference
 * listener (only attached when `theme === "system"`) tears down on
 * cleanup.
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/state/settings-store";

export function useThemeAndFontSync(): void {
  const theme = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);

  // Theme
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      if (dark) root.classList.add("dark");
      else root.classList.remove("dark");
    };
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mql.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    apply(theme === "dark");
  }, [theme]);

  // Font size
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${fontSize}px`,
    );
  }, [fontSize]);
}
