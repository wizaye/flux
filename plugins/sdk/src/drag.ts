/**
 * Drag-and-drop contract for plugin views.
 *
 * The host's editor pane reserves these MIME types for its own
 * drag operations:
 *
 *   • `application/x-flux-tab`     — open tab being torn between panes
 *   • `application/x-flux-file-id` — file dragged from the sidebar
 *
 * When the host sees either of these on a `dragover`, it shows the
 * split-preview overlay. **Plugin drags must NEVER use these MIMEs.**
 * Pick a unique namespaced type instead — convention:
 *
 *   `application/x-flux-plugin-<pluginId>-<thing>`
 *
 * `pluginDragMime("kanban", "card")` returns the canonical string
 * so plugins stay consistent. Using anything that starts with
 * `application/x-flux-plugin-` is also safe — the host's drag
 * handler only acts on the two reserved tab/file MIMEs above and
 * lets anything else fall through to the plugin's own handlers.
 *
 * Browser quirk: plugin drag handlers MUST call
 * `event.stopPropagation()` (or `event.preventDefault()` on a
 * dragover the plugin wants to accept). Otherwise the event bubbles
 * up to the host pane's listener, which — even though it now
 * ignores non-flux MIMEs — would still receive the event. Stopping
 * the bubble is cheap insurance against future host-side changes.
 */

/** Reserved MIMEs the host owns. Plugins must not write these. */
export const HOST_DRAG_MIMES = [
  "application/x-flux-tab",
  "application/x-flux-file-id",
] as const;
export type HostDragMime = (typeof HOST_DRAG_MIMES)[number];

/** Build a plugin-namespaced drag MIME. */
export function pluginDragMime(pluginId: string, kind: string): string {
  return `application/x-flux-plugin-${pluginId}-${kind}`;
}

/** Returns true when the drag event carries a host-reserved MIME.
 *  Plugins can call this to skip showing their own drop indicators
 *  while a tab/file drag is in flight. */
export function isHostDrag(e: { dataTransfer?: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return HOST_DRAG_MIMES.some((m) => types.includes(m));
}
