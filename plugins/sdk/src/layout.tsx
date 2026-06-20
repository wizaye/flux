/**
 * `PluginPaneLayout` — shared chrome for plugin editor views.
 *
 * Mirrors the geometry contract that built-in views get from the
 * host's internal `EditorPaneLayout`:
 *
 *   • Full pane height/width with `min-w-0 min-h-0` so a child
 *     scroller can rely on the standard `flex:1; overflow:auto`
 *     pattern.
 *   • Optional 42 px header row with a title + optional action slot
 *     on the right.
 *   • Body wrapper is `overflow-hidden` so horizontal scrollers
 *     (kanban columns, wide tables) clip to the pane bounds instead
 *     of bleeding past the right sidebar.
 *
 * Plugins are FREE to render their own root layout — this primitive
 * is offered for convenience, not enforced. The host pane already
 * clips overflow at its own wrapper now, so even raw plugin views
 * stay inside their bounds.
 */
import * as React from "react";

export interface PluginPaneLayoutProps {
  /** Optional title row. Hidden when `title` is omitted. */
  title?: React.ReactNode;
  /** Right-aligned slot inside the title row (icon buttons, etc). */
  actions?: React.ReactNode;
  /** Body content. */
  children: React.ReactNode;
  /** Extra classes applied to the body wrapper. */
  bodyClassName?: string;
}

export function PluginPaneLayout({
  title,
  actions,
  children,
  bodyClassName,
}: PluginPaneLayoutProps) {
  return (
    <div className="flex flex-col w-full h-full min-h-0 min-w-0">
      {title !== undefined && (
        <div className="flex items-center gap-3 h-[42px] px-4 shrink-0 border-b border-[var(--border-strong)]/40">
          <div className="flex-1 min-w-0 text-[13px] font-medium tracking-tight truncate">
            {title}
          </div>
          {actions && (
            <div className="flex items-center gap-1 shrink-0">{actions}</div>
          )}
        </div>
      )}
      <div
        className={
          "relative flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden " +
          (bodyClassName ?? "")
        }
      >
        {children}
      </div>
    </div>
  );
}
