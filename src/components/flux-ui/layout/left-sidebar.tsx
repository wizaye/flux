import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty as ShadcnEmpty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import {
  IcBookmark,
  IcChevronDown,
  IcCollapseAll,
  IcCopy,
  IcFolder,
  IcGear,
  IcHelp,
  IcMoon,
  IcMore,
  IcNewFile,
  IcNewFolder,
  IcPanelLeft,
  IcPencil,
  IcRefresh,
  IcSearch,
  IcSortAZ,
  IcSun,
  IcTrash,
} from "@/components/flux-ui/common/icons";
import {
  bgHeader,
  bgSidebar,
  borderSoft,
  borderTabBg,
  textMuted,
  textNormal,
  hoverBg,
} from "@/lib/lattice-tokens";
import { HEADER_H, FOOTER_H } from "@/lib/layout-constants";
import { useTheme } from "@/components/theme-provider";
import type { LeftView } from "./activity-strip";

/**
 * Left sidebar — renders the column header (3 view-switcher tabs:
 * Files / Search / Bookmarks), per-view toolbar, body and footer.
 *
 * OS-conditional rendering (mirrors lattice/src/components/layout/LeftSidebar.tsx):
 *  - macOS: header pads `paddingLeft: 40` to clear the traffic-lights
 *    and renders an extra IcPanelLeft toggle at the END of the header
 *  - Windows / Linux: no header padding, no in-header toggle (the
 *    lstrip column owns the toggle on those platforms)
 *
 * The other view modes (changes / calendar / canvas) are routed
 * exclusively through the activity strip — they don't appear as
 * tabs here.
 */

interface LeftSidebarProps {
  view: LeftView;
  onChangeView: (view: LeftView) => void;
  onToggleSidebar: () => void;
  isMac: boolean;
  vaultName?: string;
  onOpenVaultPicker?: () => void;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
}

export function LeftSidebar({
  view,
  onChangeView,
  onToggleSidebar,
  isMac,
  vaultName,
  onOpenVaultPicker,
  onOpenSettings,
  onOpenHelp,
}: LeftSidebarProps) {
  return (
    <div className={cn("flex h-full w-full flex-col", bgSidebar)}>
      <Header
        view={view}
        onChangeView={onChangeView}
        onToggleSidebar={onToggleSidebar}
        isMac={isMac}
      />
      <Toolbar view={view} />
      <Body view={view} />
      <Footer
        vaultName={vaultName}
        onOpenVaultPicker={onOpenVaultPicker}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
      />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────

interface HeaderProps {
  view: LeftView;
  onChangeView: (view: LeftView) => void;
  onToggleSidebar: () => void;
  isMac: boolean;
}

const HEADER_TABS: Array<{ id: LeftView; label: string; Icon: React.ComponentType<React.SVGAttributes<SVGElement>> }> = [
  { id: "files", label: "Files", Icon: IcFolder },
  { id: "search", label: "Search", Icon: IcSearch },
  { id: "bookmarks", label: "Bookmarks", Icon: IcBookmark },
];

function Header({ view, onChangeView, onToggleSidebar, isMac }: HeaderProps) {
  return (
    <div
      className={cn(
        "relative flex items-center shrink-0 gap-[2px] px-1.5",
        bgHeader,
      )}
      style={{ height: HEADER_H, paddingLeft: isMac ? 40 : undefined }}
      data-tauri-drag-region
    >
      {HEADER_TABS.map(({ id, label, Icon }) => (
        <IconButton
          key={id}
          active={view === id}
          tooltip={label}
          tooltipSide="bottom"
          data-tauri-drag-region={false}
          onClick={() => onChangeView(id)}
        >
          <Icon />
        </IconButton>
      ))}
      {/* Drag region fills the remaining space */}
      <div className="flex-1 h-full" data-tauri-drag-region />
      {/* macOS-only collapse toggle on the right of the header */}
      {isMac && (
        <IconButton
          size="tiny"
          aria-label="Hide left sidebar"
          data-tauri-drag-region={false}
          onClick={onToggleSidebar}
          className="mr-1.5"
        >
          <IcPanelLeft open />
        </IconButton>
      )}
      {/* Top-strip seam */}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute left-0 right-0 bottom-0 h-px", borderTabBg)}
      />
    </div>
  );
}

// ─── Per-view toolbar ───────────────────────────────────────────────

const VIEW_TITLE: Record<LeftView, string> = {
  files: "Files",
  search: "Search",
  bookmarks: "Bookmarks",
  changes: "Source Control",
  calendar: "Calendar",
  canvas: "Canvas",
};

function Toolbar({ view }: { view: LeftView }) {
  return (
    <div className="flex items-center justify-start gap-1 h-[30px] px-2 shrink-0">
      <span
        className={cn(
          "text-[11px] font-semibold uppercase tracking-[0.04em] select-none",
          textMuted,
        )}
      >
        {VIEW_TITLE[view]}
      </span>
      <span className="flex-1 min-w-0" />
      {view === "files" && (
        <>
          <IconButton size="tiny" tooltip="New file"><IcNewFile /></IconButton>
          <IconButton size="tiny" tooltip="New folder"><IcNewFolder /></IconButton>
          <IconButton size="tiny" tooltip="Sort A → Z"><IcSortAZ /></IconButton>
          <IconButton size="tiny" tooltip="Collapse all"><IcCollapseAll /></IconButton>
          <IconButton size="tiny" tooltip="More options"><IcMore /></IconButton>
        </>
      )}
      {view === "changes" && (
        <>
          <IconButton size="tiny" tooltip="Refresh"><IcRefresh /></IconButton>
          <IconButton size="tiny" tooltip="More options"><IcMore /></IconButton>
        </>
      )}
    </div>
  );
}

// ─── Body (stub per view) ───────────────────────────────────────────

function Body({ view }: { view: LeftView }) {
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col py-0.5">
        {view === "files" && (
          <StubList items={["Welcome.md", "Inbox.md", "Daily/", "Projects/"]} />
        )}
        {view === "search" && (
          <div className="px-2 py-1 space-y-2">
            <Input
              type="search"
              placeholder="Search vault…"
              className="h-7 text-[12px]"
            />
            <SidebarEmpty
              Icon={IcSearch}
              title="Search this vault"
              description={<>Start typing to find notes, or press <Kbd>⌘K</Kbd> for the command palette.</>}
            />
          </div>
        )}
        {view === "bookmarks" && (
          <SidebarEmpty
            Icon={IcBookmark}
            title="No bookmarks yet"
            description="Star a file to keep it close."
          />
        )}
        {view === "changes" && (
          <SidebarEmpty
            Icon={IcRefresh}
            title="No source-control changes"
            description="Edit a file to see diffs appear here."
          />
        )}
        {view === "calendar" && (
          <SidebarEmpty
            Icon={IcFolder}
            title="Calendar panel"
            description="Daily notes & journal entries — coming soon."
          />
        )}
        {view === "canvas" && (
          <SidebarEmpty
            Icon={IcFolder}
            title="No canvases yet"
            description="Create a canvas to start a visual board."
          />
        )}
      </div>
    </ScrollArea>
  );
}

function StubList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5 px-1.5 py-1">
      {items.map((label) => {
        const isFolder = label.endsWith("/");
        const cleanName = isFolder ? label.slice(0, -1) : label;
        const ext = isFolder ? "folder" : label.split(".").pop() ?? "file";
        return (
          <HoverCard key={label} openDelay={350} closeDelay={120}>
            <ContextMenu>
              {/* Nested asChild triggers — Radix `Slot` composes through
                  HoverCardTrigger → ContextMenuTrigger → <li>, so a single
                  DOM node receives BOTH hover + contextmenu handlers. */}
              <HoverCardTrigger asChild>
                <ContextMenuTrigger asChild>
                  <li
                    className={cn(
                      "flex items-center gap-1.5 h-6 px-2 rounded-[4px] cursor-pointer text-[12px] select-none",
                      textNormal,
                      hoverBg,
                    )}
                  >
                    <IcFolder className="[width:var(--icon-sm)] [height:var(--icon-sm)]" />
                    <span className="truncate">{label}</span>
                  </li>
                </ContextMenuTrigger>
              </HoverCardTrigger>
              <ContextMenuContent className="min-w-[200px]">
                <ContextMenuLabel className="text-[11px] uppercase tracking-wide opacity-70 truncate">
                  {cleanName}
                </ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => console.log("file: open", label)}>
                  Open
                  <ContextMenuShortcut>↵</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => console.log("file: open new tab", label)}>
                  Open in new tab
                  <ContextMenuShortcut>⌘↵</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Open to the side</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="min-w-[160px]">
                    <ContextMenuItem onSelect={() => console.log("file: split right", label)}>
                      Split right
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => console.log("file: split down", label)}>
                      Split down
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => console.log("file: reveal", label)}>
                  Reveal in file explorer
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => console.log("file: copy path", label)}>
                  <IcCopy /> Copy path
                  <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => console.log("file: rename", label)}>
                  <IcPencil /> Rename…
                  <ContextMenuShortcut>F2</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => console.log("file: duplicate", label)}>
                  Duplicate
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => console.log("file: delete", label)}
                >
                  <IcTrash /> Delete
                  <ContextMenuShortcut>⌫</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <HoverCardContent
              side="right"
              align="start"
              sideOffset={10}
              className="w-80 p-0"
            >
              {/* shadcn `Item` provides header/content/footer slots so we
                  no longer hand-roll the preview’s nested flex columns. */}
              <Item size="sm" className="items-start rounded-md">
                <ItemMedia className="text-muted-foreground">
                  <IcFolder className="[width:var(--icon-md)] [height:var(--icon-md)]" />
                </ItemMedia>
                <ItemContent>
                  <ItemHeader>
                    <ItemTitle className="text-[12px] font-semibold">{cleanName}</ItemTitle>
                    <Kbd className="uppercase tracking-wide">{ext}</Kbd>
                  </ItemHeader>
                  <ItemDescription className="text-[11px]">
                    {isFolder
                      ? "Folder · 0 items · part of vault root"
                      : "Lorem ipsum dolor sit amet — preview of the file body. The first ~200 chars will be shown here once the editor is wired."}
                  </ItemDescription>
                  <ItemFooter className="text-[10px] tabular-nums text-muted-foreground">
                    <span>Modified —</span>
                    <span>Size —</span>
                    {!isFolder && <span>0 words</span>}
                  </ItemFooter>
                </ItemContent>
              </Item>
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </ul>
  );
}

/** Wraps shadcn `Empty` with sidebar-tight spacing and a built-in icon
 *  + title + description structure. Replaces the previous one-liner
 *  italic <p> stub so we get richer, more polished empty states for
 *  free across bookmarks/changes/calendar/canvas/search. */
function SidebarEmpty({
  Icon,
  title,
  description,
}: {
  Icon: React.ComponentType<React.SVGAttributes<SVGElement>>;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <ShadcnEmpty className="border-0 px-3 py-6 gap-2">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="text-[12px]">{title}</EmptyTitle>
        <EmptyDescription className="text-[11px]">{description}</EmptyDescription>
      </EmptyHeader>
    </ShadcnEmpty>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────

interface FooterProps {
  vaultName?: string;
  onOpenVaultPicker?: () => void;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
}

function Footer({
  vaultName,
  onOpenVaultPicker,
  onOpenSettings,
  onOpenHelp,
}: FooterProps) {
  const { setTheme } = useTheme();
  const [isDark, setIsDark] = React.useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  // Keep the toggle glyph in sync with the resolved theme.
  React.useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "relative flex items-center gap-[2px] px-1.5 shrink-0 border-t",
        bgSidebar,
        borderSoft,
      )}
      style={{ height: FOOTER_H }}
    >
      {/* Vault picker — flexes to fill, ellipsizes name. Backed by
          shadcn DropdownMenu so the popover, focus trap, escape /
          outside-click handling and keyboard nav all come for free. */}
      <div className="relative flex items-center flex-1 min-w-0 overflow-hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              title="Switch vault"
              className={cn(
                "h-6 px-1.5 rounded-[4px] max-w-full min-w-0 gap-1 border-0 bg-transparent",
                "text-[12px] font-normal active:translate-y-0",
                textMuted,
                "hover:bg-[#ececea] dark:hover:bg-[#2a2a2a] hover:text-[#2e2e2e] dark:hover:text-[#dcddde]",
                "data-[state=open]:bg-[#ececea] dark:data-[state=open]:bg-[#2a2a2a]",
                // Suppress shadcn's `focus-visible:ring-3` — Radix returns
                // focus to the trigger after the menu closes (Chromium
                // treats programmatic focus as keyboard-focus), which
                // would otherwise paint a 3px ring around this tiny
                // footer button. Lattice has no such ring.
                "focus-visible:ring-0 focus-visible:border-transparent",
              )}
            >
              <IcChevronDown className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
              <span className={cn("font-medium truncate min-w-0 flex-1 text-left", textNormal)}>
                {vaultName ?? "No vault"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-[200px]">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide opacity-70">
              Vaults
            </DropdownMenuLabel>
            <DropdownMenuItem disabled>
              <IcFolder className="[width:var(--icon-sm)] [height:var(--icon-sm)]" />
              <span className="truncate">{vaultName ?? "No vault"}</span>
              <span className="ml-auto text-[10px] opacity-70">active</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenVaultPicker}>
              Open another vault…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenVaultPicker}>
              Manage vaults…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Trailing icon cluster — never compressed. No separator: matches
          lattice's `.ls-footer-icons` which clusters via margin-left:auto. */}
      <div className="inline-flex items-center gap-[2px] shrink-0 ml-auto">
        <IconButton
          size="tiny"
          tooltip={isDark ? "Switch to light theme" : "Switch to dark theme"}
          tooltipSide="top"
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? <IcSun /> : <IcMoon />}
        </IconButton>
        <IconButton size="tiny" tooltip="Help" tooltipSide="top" onClick={onOpenHelp}>
          <IcHelp />
        </IconButton>
        <IconButton size="tiny" tooltip="Settings" tooltipSide="top" onClick={onOpenSettings}>
          <IcGear />
        </IconButton>
      </div>
    </div>
  );
}
