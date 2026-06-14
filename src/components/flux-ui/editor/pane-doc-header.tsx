import { cn } from "@/lib/utils";
import { bgEditor, textMuted, textNormal, borderSoftBg } from "@/lib/lattice-tokens";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import { IcArrowLeft, IcArrowRight, IcEye, IcCode } from "@/components/flux-ui/common/icons";
import { SplitMenuButton } from "./split-menu-button";
import { DocMoreMenu } from "./doc-more-menu";
import type { Tab } from "@/state/editor";

/**
 * Thin strip below the pane tabbar carrying:
 *   • back / forward stubs (will hook into pane navigation history
 *     once tab.viewMode + per-pane history land in Phase 2)
 *   • centred document title
 *   • split-direction picker
 *   • source ↔ reading toggle
 *   • overflow / more menu
 *
 * Mirrors `PaneDocHeader` from `lattice/src/components/editor/EditorArea.tsx`.
 */

type Props = {
  tab: Tab | null;
  onSplit: (edge: "left" | "right" | "top" | "bottom") => void;
  onToggleReading: () => void;
  /** Switch the active tab to Reveal.js slides view. */
  onSetSlides: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onShowInExplorer: () => void;
  onRevealInNav: () => void;
  onDelete: () => void;
  /** Extra right padding to clear Windows caption controls when this
   *  is the top-right leaf and the R-sidebar is collapsed.
   *  Mirrors the inset applied to the tabbar above. */
  topRightInsetPx?: number;
  /** True when the column-width transition is currently disabled (drag). */
  dragging?: boolean;
};

export function PaneDocHeader({
  tab,
  onSplit,
  onToggleReading,
  onSetSlides,
  onRename,
  onCopyPath,
  onShowInExplorer,
  onRevealInNav,
  onDelete,
  topRightInsetPx = 0,
  dragging = false,
}: Props) {
  const reading = tab?.viewMode === "preview";
  const title = tab?.title || "Untitled";

  return (
    <div
      className={cn(
        "relative flex items-center shrink-0 h-[32px]",
        // Mirror lattice `.pane-doc-header { background: var(--bg-editor) }`
        // — the doc-header reads as part of the editor surface, not as a
        // second chrome strip stacked under the tabbar.
        bgEditor,
      )}
      style={{
        // Lattice `.pane-doc-header { padding: 0 8px }`
        paddingLeft: 8,
        // Reserve room for the Windows caption controls when this leaf
        // owns the top-right corner and the R-sidebar is hidden — keeps
        // the `⋯` overflow button from disappearing under the close box.
        paddingRight: topRightInsetPx > 0 ? topRightInsetPx + 8 : 8,
        transition: dragging
          ? "none"
          : "padding 200ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      {/* Back / forward — stubs in Phase 1 */}
      <div className="flex items-center gap-0.5">
        <IconButton size="tiny" aria-label="Back" disabled>
          <IcArrowLeft />
        </IconButton>
        <IconButton size="tiny" aria-label="Forward" disabled>
          <IcArrowRight />
        </IconButton>
      </div>

      {/* Centred title — absolute so back/forward + actions don't push it */}
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 max-w-[60%] truncate text-[12px] leading-none",
          textNormal,
        )}
        title={title}
      >
        <span className={cn(textMuted)}>{title}</span>
      </div>

      {/* Right actions */}
      <div className="ml-auto flex items-center gap-0.5">
        <SplitMenuButton onSplit={onSplit} />
        <IconButton
          size="tiny"
          aria-label={reading ? "Switch to source" : "Switch to reading view"}
          active={reading}
          onClick={onToggleReading}
        >
          {reading ? <IcCode /> : <IcEye />}
        </IconButton>
        <DocMoreMenu
          viewMode={tab?.viewMode}
          onToggleReading={onToggleReading}
          onSetSource={() => {
            if (reading) onToggleReading();
          }}
          onSetSlides={onSetSlides}
          onRename={onRename}
          onCopyPath={onCopyPath}
          onShowInExplorer={onShowInExplorer}
          onRevealInNav={onRevealInNav}
          onDelete={onDelete}
        />
      </div>

      {/* Bottom hairline */}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute left-0 right-0 bottom-0 h-px", borderSoftBg)}
      />
    </div>
  );
}
