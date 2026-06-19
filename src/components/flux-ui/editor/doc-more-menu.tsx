import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcMore,
  IcEye,
  IcCode,
  IcLink,
  IcMerge,
  IcBookmark,
  IcEdit,
  IcCopy,
  IcFolderOpened,
  IcLocation,
  IcFileAdd,
  IcSwap,
  IcFilePdf,
  IcSearch,
  IcReplace,
  IcHistory,
  IcLinkExternal,
  IcTrash,
  IcGraph,
} from "@/components/flux-ui/common/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

/**
 * Doc-header overflow menu — mirrors Obsidian's "More options" menu
 * structure so users get familiar muscle memory. Item ordering and
 * grouping (separators) match Obsidian exactly. Items without a
 * handler are disabled rather than hidden so the menu shape is
 * stable as features land.
 */
type Props = {
  viewMode: "source" | "live" | "preview" | "slides" | undefined;
  isBookmarked?: boolean;

  // View-switching commands
  onToggleReading: () => void;
  onSetSource: () => void;
  onSetLive: () => void;
  onSetSlides?: () => void;

  // Pane / window
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onOpenInNewWindow?: () => void;

  // File operations
  onRename: () => void;
  onMoveTo?: () => void;
  onToggleBookmark?: () => void;
  onMerge?: () => void;
  onAddProperty?: () => void;

  // Output
  onExportPdf?: () => void;

  // Search inside doc
  onFind?: () => void;
  onReplace?: () => void;

  // Misc
  onCopyPath: () => void;
  onVersionHistory?: () => void;

  // Linked views
  onOpenLocalGraph?: () => void;
  onOpenBacklinks?: () => void;
  onOpenOutgoingLinks?: () => void;
  onOpenFileProperties?: () => void;
  onOpenOutline?: () => void;

  // External
  onOpenInDefaultApp?: () => void;
  onShowInExplorer: () => void;
  onRevealInNav: () => void;

  // Destructive
  onDelete: () => void;
};

export function DocMoreMenu(props: Props) {
  const hasAnyLinkedView = !!(
    props.onOpenLocalGraph ||
    props.onOpenBacklinks ||
    props.onOpenOutgoingLinks ||
    props.onOpenFileProperties ||
    props.onOpenOutline
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="tiny" aria-label="More options">
          <IcMore />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        {/* ── Top group: matches Obsidian ── */}
        <DropdownMenuItem
          disabled={!props.onOpenBacklinks}
          onSelect={props.onOpenBacklinks}
        >
          <IcLink /> Backlinks in document
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={
            props.viewMode === "preview" ? props.onSetLive : props.onToggleReading
          }
        >
          <IcEye /> {props.viewMode === "preview" ? "Editing view" : "Reading view"}
          <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={
            props.viewMode === "source" ? props.onSetLive : props.onSetSource
          }
        >
          <IcCode />
          {props.viewMode === "source" ? "Live preview" : "Source mode"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Pane / window ── */}
        <DropdownMenuItem disabled={!props.onSplitRight} onSelect={props.onSplitRight}>
          <IcSwap /> Split right
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onSplitDown} onSelect={props.onSplitDown}>
          <IcSwap /> Split down
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.onOpenInNewWindow}
          onSelect={props.onOpenInNewWindow}
        >
          <IcLinkExternal /> Open in new window
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── File operations ── */}
        <DropdownMenuItem onSelect={props.onRename}>
          <IcEdit /> Rename…
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onMoveTo} onSelect={props.onMoveTo}>
          <IcSwap /> Move file to…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.onToggleBookmark}
          onSelect={props.onToggleBookmark}
        >
          <IcBookmark />
          {props.isBookmarked ? "Remove bookmark" : "Bookmark…"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onMerge} onSelect={props.onMerge}>
          <IcMerge /> Merge entire file with…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.onAddProperty}
          onSelect={props.onAddProperty}
        >
          <IcFileAdd /> Add file property
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onExportPdf} onSelect={props.onExportPdf}>
          <IcFilePdf /> Export to PDF…
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Search inside doc + misc ── */}
        <DropdownMenuItem disabled={!props.onFind} onSelect={props.onFind}>
          <IcSearch /> Find…
          <DropdownMenuShortcut>Ctrl+F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onReplace} onSelect={props.onReplace}>
          <IcReplace /> Replace…
          <DropdownMenuShortcut>Ctrl+H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onCopyPath}>
          <IcCopy /> Copy path
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.onVersionHistory}
          onSelect={props.onVersionHistory}
        >
          <IcHistory /> Open version history
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Linked views (sub-menu) ── */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!hasAnyLinkedView}>
            <IcLinkExternal /> Open linked view
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              disabled={!props.onOpenLocalGraph}
              onSelect={props.onOpenLocalGraph}
            >
              <IcGraph /> Open local graph
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!props.onOpenBacklinks}
              onSelect={props.onOpenBacklinks}
            >
              <IcLink /> Open backlinks
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!props.onOpenOutgoingLinks}
              onSelect={props.onOpenOutgoingLinks}
            >
              <IcLinkExternal /> Open outgoing links
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!props.onOpenFileProperties}
              onSelect={props.onOpenFileProperties}
            >
              <IcFileAdd /> Open file properties
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!props.onOpenOutline}
              onSelect={props.onOpenOutline}
            >
              <IcLink /> Open outline
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* ── External / system ── */}
        <DropdownMenuItem
          disabled={!props.onOpenInDefaultApp}
          onSelect={props.onOpenInDefaultApp}
        >
          <IcLinkExternal /> Open in default app
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onShowInExplorer}>
          <IcFolderOpened /> Show in system explorer
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onRevealInNav}>
          <IcLocation /> Reveal file in navigation
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
          <IcTrash /> Delete file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
