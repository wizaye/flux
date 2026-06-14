/**
 * Tailwind className tokens that reproduce the legacy lattice colour
 * palette without touching `src/App.css`. Each export is a string of
 * Tailwind utilities (with `dark:` variants) that paints the exact
 * surface / text / border colour the legacy app used.
 *
 * Mapping anchor (lattice/src/App.css):
 *   --bg-app       #ffffff   /  #1e1e1e
 *   --bg-strip     #f3f3f1   /  #1a1a1a
 *   --bg-sidebar   #fafaf8   /  #1e1e1e
 *   --bg-editor    #ffffff   /  #1e1e1e
 *   --bg-header    #f3f3f1   /  #1a1a1a
 *   --bg-menu      #ffffff   /  #2b2b2b
 *   --hover        #ececea   /  #2a2a2a
 *   --accent       #7f6df2   (same in both modes)
 *   --resize-line  #7f6df2
 *   --divider      #e2e2df   /  #131313
 *   --border-soft  rgba(0,0,0,.06)   / rgba(255,255,255,.05)
 *   --border-strong rgba(0,0,0,.12)  / rgba(255,255,255,.10)
 *   --border-tab   rgba(0,0,0,.15)   / rgba(255,255,255,.12)
 *   --text-normal  #2e2e2e   /  #dcddde
 *   --text-muted   #6b6b6b   /  #8b8b8b
 *   --text-faint   #909090   /  #6a6a6a
 *
 * The `dark:` variants kick in via the `.dark` class on <html> applied
 * by ThemeProvider — same convention shadcn uses.
 */

// ─── Surfaces ───────────────────────────────────────────────────────
export const bgApp     = "bg-[#ffffff] dark:bg-[#1e1e1e]";
export const bgStrip   = "bg-[#f3f3f1] dark:bg-[#1a1a1a]";
export const bgSidebar = "bg-[#fafaf8] dark:bg-[#1e1e1e]";
export const bgEditor  = "bg-[#ffffff] dark:bg-[#1e1e1e]";
export const bgHeader  = "bg-[#f3f3f1] dark:bg-[#1a1a1a]";
export const bgMenu    = "bg-[#ffffff] dark:bg-[#2b2b2b]";

// ─── Hover surfaces ─────────────────────────────────────────────────
export const hoverBg   = "hover:bg-[#ececea] dark:hover:bg-[#2a2a2a]";
export const hoverText = "hover:text-[#2e2e2e] dark:hover:text-[#dcddde]";

// ─── Text ───────────────────────────────────────────────────────────
export const textNormal = "text-[#2e2e2e] dark:text-[#dcddde]";
export const textMuted  = "text-[#6b6b6b] dark:text-[#8b8b8b]";
export const textFaint  = "text-[#909090] dark:text-[#6a6a6a]";

// ─── Accent ─────────────────────────────────────────────────────────
export const accentBg   = "bg-[#7f6df2]";
export const accentText = "text-[#7f6df2]";

// ─── Borders ────────────────────────────────────────────────────────
export const borderSoft   = "border-black/[0.06] dark:border-white/[0.05]";
export const borderStrong = "border-black/[0.12] dark:border-white/[0.10]";
export const borderTab    = "border-black/[0.15] dark:border-white/[0.12]";

// Solid-fill equivalents (for ::after seams + dividers).
export const borderSoftBg   = "bg-black/[0.06] dark:bg-white/[0.05]";
export const borderStrongBg = "bg-black/[0.12] dark:bg-white/[0.10]";
export const borderTabBg    = "bg-black/[0.15] dark:bg-white/[0.12]";
export const dividerBg      = "bg-[#e2e2df] dark:bg-[#131313]";

// Close-button "win-btn.close:hover" red — Windows 11 caption colour.
export const closeHover     = "hover:bg-[#c42b1c] hover:text-white";

// Sync-off red used by the status pill.
export const errorText      = "text-[#e36464]";
export const errorBg        = "bg-[#e36464]";

// ─── Menu / drop overlay ────────────────────────────────────────────
/** Danger-row text in menus (Delete, etc.). Inherits hover-bg from MenuItem. */
export const dangerText     = "text-[#e36464]";
/** Selection / drop overlay translucent fill — used by `.drop-overlay`. */
export const selectionBg    = "bg-[#7f6df2]/15";
/** Menu surface elevation shadow. */
export const menuShadow     = "shadow-[0_6px_16px_rgba(0,0,0,0.32)]";
/** Glow used by the tab-insertion indicator. */
export const tabInsertionGlow = "shadow-[0_0_6px_rgba(127,109,242,0.6)]";
