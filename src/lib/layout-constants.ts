/**
 * Layout-shell sizing constants — ported 1:1 from the legacy lattice
 * source so the new shadcn/Tailwind shell renders at the exact same
 * dimensions. These match `lattice/src/App.css` and
 * `lattice/src/App.tsx`.
 */

// Sidebar widths (px)
export const LEFT_MIN = 220;
export const LEFT_DEFAULT = 240;
export const RIGHT_MIN = 220;
export const RIGHT_DEFAULT = 280;

// Activity strip width (px)
export const STRIP_W = 36;

// Auto-collapse threshold — dragging the splitter inward past this
// many pixels below the panel's minimum width snaps the panel into
// collapsed mode (VS Code / Obsidian convention).
export const LEFT_COLLAPSE_AT = LEFT_MIN - 40;
export const RIGHT_COLLAPSE_AT = RIGHT_MIN - 40;

// Chrome dimensions (px)
export const HEADER_H = 36;
export const FOOTER_H = 28;
export const PANE_TOOLBAR_H = 32;
export const WIN_CONTROLS_W = 138; // 3 buttons × 46px
export const RESIZE_ZONE_W = 6;

// Sidebar slide animation duration (ms) — toggle is the longer,
// fully decelerating slide; push is a snappier follow used when one
// sidebar squeezes the OTHER below its room budget during a drag.
export const SIDEBAR_ANIM_MS = 200;
export const PUSH_ANIM_MS = 90;
