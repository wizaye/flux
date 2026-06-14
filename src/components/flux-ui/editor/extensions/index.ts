/**
 * Re-exports for CodeMirror extension surface in flux.
 *
 * Ported (trimmed) from
 * `lattice/src/components/editor/extensions/index.ts`. We only ship
 * the vim extension in this phase; the other Obsidian-compat
 * extensions (callouts, embeds, live-preview, etc.) land in a
 * follow-up phase once their store dependencies have flux equivalents.
 */
export { vimMode, getVimStatus } from "./cm-vim";
