/**
 * Lattice → lucide icon map.
 *
 * Each export is a thin wrapper around a `lucide-react` icon so the
 * legacy call-sites can continue to import `Ic*` components verbatim.
 * Defaults: `strokeWidth={1.6}` and `className="size-[var(--icon-md)]"`
 * to mirror the legacy `.lattice-icon` sizing (clamped 16-20 px).
 *
 * Three custom utility icons live alongside the lucide aliases:
 *   - `IcPanelLeft`  — toggles between `PanelLeft` and `PanelLeftClose`
 *   - `IcPanelRight` — toggles between `PanelRight` and `PanelRightClose`
 *   - `IcSyncOff`    — `RefreshCwOff` (legacy `IcSyncIgnored`)
 *
 * Glyph sizes (responsive — match `lattice/src/App.css`):
 *   --icon-md  → clamp(16px, 0.45vw + 12px, 20px)
 *   --icon-sm  → clamp(13px, 0.35vw + 10px, 17px)
 *   --icon-xs  → clamp(11px, 0.20vw +  9px, 14px)
 */

import * as Lucide from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

type IconProps = React.ComponentProps<typeof Lucide.Folder>;

// Responsive sizing — applied as a CSS variable so the entire icon set
// scales with viewport without per-component prop drilling.
const ICON_SIZE_VARS = {
  "--icon-md": "clamp(16px, calc(0.45vw + 12px), 20px)",
  "--icon-sm": "clamp(13px, calc(0.35vw + 10px), 17px)",
  "--icon-xs": "clamp(11px, calc(0.20vw + 9px), 14px)",
} as React.CSSProperties;

/** Inject the icon-size custom properties onto the app root once. */
export function IconScale({ children }: { children: React.ReactNode }) {
  return (
    <div className="contents" style={ICON_SIZE_VARS}>
      {children}
    </div>
  );
}

/** Wrap a lucide icon with the lattice default sizing + stroke. */
function lc(
  Cmp: React.ComponentType<IconProps>,
): React.FC<IconProps> {
  const Wrapped: React.FC<IconProps> = ({ className, strokeWidth, ...rest }) => (
    <Cmp
      aria-hidden
      strokeWidth={strokeWidth ?? 1.6}
      className={cn(
        "shrink-0 [width:var(--icon-md)] [height:var(--icon-md)]",
        className,
      )}
      {...rest}
    />
  );
  Wrapped.displayName = `Lc(${Cmp.displayName || Cmp.name || "Icon"})`;
  return Wrapped;
}

// ─── Panel toggles (state-aware) ─────────────────────────────────────
type ToggleProps = IconProps & { open?: boolean };

export const IcPanelLeft: React.FC<ToggleProps> = ({
  open = true,
  className,
  strokeWidth,
  ...rest
}) => {
  const Cmp = open ? Lucide.PanelLeft : Lucide.PanelLeftClose;
  return (
    <Cmp
      aria-hidden
      strokeWidth={strokeWidth ?? 1.6}
      className={cn(
        "shrink-0 [width:var(--icon-md)] [height:var(--icon-md)]",
        className,
      )}
      {...rest}
    />
  );
};

export const IcPanelRight: React.FC<ToggleProps> = ({
  open = true,
  className,
  strokeWidth,
  ...rest
}) => {
  const Cmp = open ? Lucide.PanelRight : Lucide.PanelRightClose;
  return (
    <Cmp
      aria-hidden
      strokeWidth={strokeWidth ?? 1.6}
      className={cn(
        "shrink-0 [width:var(--icon-md)] [height:var(--icon-md)]",
        className,
      )}
      {...rest}
    />
  );
};

// ─── Window chrome ───────────────────────────────────────────────────
export const IcMinimize = lc(Lucide.Minus);
export const IcMaximize = lc(Lucide.Square);
export const IcRestore  = lc(Lucide.Copy); // two overlapping squares (closest lucide equivalent)
export const IcClose    = lc(Lucide.X);

// ─── Left-rail view switchers ────────────────────────────────────────
export const IcFolder        = lc(Lucide.Folder);
export const IcSearch        = lc(Lucide.Search);
export const IcBookmark      = lc(Lucide.Bookmark);
export const IcSourceControl = lc(Lucide.GitBranch);

// ─── Left activity strip ─────────────────────────────────────────────
export const IcGraph    = lc(Lucide.Workflow);
export const IcGrid     = lc(Lucide.LayoutGrid);
export const IcCalendar = lc(Lucide.Calendar);
export const IcFiles    = lc(Lucide.Files);
export const IcTerminal = lc(Lucide.Terminal);
export const IcKanban   = lc(Lucide.KanbanSquare);
export const IcBook     = lc(Lucide.Book);

// ─── File-tree toolbar ───────────────────────────────────────────────
export const IcEdit        = lc(Lucide.Pencil);
export const IcNewFile     = lc(Lucide.FilePlus);
export const IcNewFolder   = lc(Lucide.FolderPlus);
export const IcSortAZ      = lc(Lucide.ArrowDownAZ);
export const IcCollapseAll = lc(Lucide.ChevronsDownUp);
export const IcMore        = lc(Lucide.MoreHorizontal);

// ─── Chevrons + plus / minus ─────────────────────────────────────────
export const IcChevronDown  = lc(Lucide.ChevronDown);
export const IcChevronLeft  = lc(Lucide.ChevronLeft);
export const IcChevronRight = lc(Lucide.ChevronRight);
export const IcChevronUp    = lc(Lucide.ChevronUp);
export const IcPlus         = lc(Lucide.Plus);
export const IcMinus        = lc(Lucide.Minus);

// ─── Canvas ──────────────────────────────────────────────────────────
export const IcStickyNote = lc(Lucide.StickyNote);
export const IcLayout     = lc(Lucide.Layout);

// ─── Canvas toolbar ──────────────────────────────────────────────────
export const IcCursor    = lc(Lucide.MousePointer2);
export const IcHand      = lc(Lucide.Hand);
export const IcPencil    = lc(Lucide.Pencil);
export const IcEraser    = lc(Lucide.Eraser);
export const IcSquare    = lc(Lucide.Square);
export const IcCircle    = lc(Lucide.Circle);
export const IcDiamond   = lc(Lucide.Diamond);
export const IcArrowTool = lc(Lucide.ArrowRight);
export const IcTextTool  = lc(Lucide.Type);
export const IcGroup     = lc(Lucide.Group);
export const IcExport    = lc(Lucide.Upload);
export const IcKebab     = lc(Lucide.MoreVertical);
export const IcGrip      = lc(Lucide.GripVertical);

// ─── Right rail ──────────────────────────────────────────────────────
export const IcLink    = lc(Lucide.Link);
export const IcLinkOff = lc(Lucide.Link2Off);
export const IcTag     = lc(Lucide.Tag);
export const IcArchive = lc(Lucide.Archive);
export const IcList    = lc(Lucide.List);

// ─── Editor doc header ───────────────────────────────────────────────
export const IcArrowLeft  = lc(Lucide.ArrowLeft);
export const IcArrowRight = lc(Lucide.ArrowRight);
export const IcArrowUp    = lc(Lucide.ArrowUp);
export const IcArrowDown  = lc(Lucide.ArrowDown);

// ─── Misc / footer ───────────────────────────────────────────────────
export const IcSwap   = lc(Lucide.ArrowLeftRight);
export const IcSplit  = lc(Lucide.SplitSquareHorizontal);
export const IcHelp   = lc(Lucide.HelpCircle);
export const IcGear   = lc(Lucide.Settings);
export const IcLock   = lc(Lucide.Lock);
export const IcExpand = lc(Lucide.Maximize2);
export const IcSun    = lc(Lucide.Sun);
export const IcMoon   = lc(Lucide.Moon);

// ─── Settings modal — section icons ──────────────────────────────────
export const IcFileLink      = lc(Lucide.FileSymlink);
export const IcPaint         = lc(Lucide.Palette);
export const IcKeyboard      = lc(Lucide.Keyboard);
export const IcKey           = lc(Lucide.Key);
export const IcExtensions    = lc(Lucide.Puzzle);
export const IcHistory       = lc(Lucide.History);
export const IcPreview       = lc(Lucide.Eye);
export const IcSync          = lc(Lucide.RefreshCw);
export const IcSyncIgnored   = lc(Lucide.RefreshCwOff);
export const IcMerge         = lc(Lucide.GitMerge);
export const IcCheck         = lc(Lucide.Check);
export const IcFileSubmodule = lc(Lucide.FolderGit);

// ─── VCS / BYOC ──────────────────────────────────────────────────────
export const IcGitCommit      = lc(Lucide.GitCommitHorizontal);
export const IcGitBranch      = lc(Lucide.GitBranch);
export const IcGitPullRequest = lc(Lucide.GitPullRequest);
export const IcDiff           = lc(Lucide.GitCompare);
export const IcDiscard        = lc(Lucide.RotateCcw);
export const IcCloud          = lc(Lucide.Cloud);
export const IcCloudUpload    = lc(Lucide.CloudUpload);
export const IcCloudDownload  = lc(Lucide.CloudDownload);
export const IcRefresh        = lc(Lucide.RefreshCw);
export const IcSparkle        = lc(Lucide.Sparkles);

// ─── Tabbar / doc menus ──────────────────────────────────────────────
export const IcStack        = lc(Lucide.Layers);
export const IcCloseAll     = lc(Lucide.XCircle);
export const IcEye          = lc(Lucide.Eye);
export const IcCode         = lc(Lucide.Code);
export const IcSlideshow    = lc(Lucide.Presentation);
export const IcLinkExternal = lc(Lucide.ExternalLink);
export const IcFileAdd      = lc(Lucide.FilePlus2);
export const IcFilePdf      = lc(Lucide.FileText);
export const IcReplace      = lc(Lucide.Replace);
export const IcCopy         = lc(Lucide.Copy);
export const IcFolderOpened = lc(Lucide.FolderOpen);
export const IcLocation     = lc(Lucide.MapPin);
export const IcTrash        = lc(Lucide.Trash2);

// ─── Tab context menu ────────────────────────────────────────────────
export const IcPin    = lc(Lucide.Pin);
export const IcPinned = lc(Lucide.PinOff);
export const IcUnlink = lc(Lucide.Unlink);
export const IcSplitH = lc(Lucide.SplitSquareHorizontal);
export const IcSplitV = lc(Lucide.SplitSquareVertical);

// ─── Command palette ─────────────────────────────────────────────────
export const IcCommand = lc(Lucide.Command);

// ─── Graph view overlay ──────────────────────────────────────────────
export const IcWand   = lc(Lucide.Wand2);
export const IcCamera = lc(Lucide.Camera);
