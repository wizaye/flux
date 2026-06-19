import * as React from "react";
import { cn } from "@/lib/utils";
import { BookmarksList } from "@/components/flux-ui/common/bookmarks-list";
import { VaultSearchPanel } from "@/components/flux-ui/common/vault-search-panel";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import { useFileOperations } from "@/hooks/use-file-operations";
import { useDirectoryOperations } from "@/hooks/use-directory-operations";
import { useVaultOperations } from "@/hooks/use-vault-operations";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/flux-ui/common/confirm-dialog";
import { TrashDialog } from "@/components/flux-ui/modals/trash-dialog";
import { FileHoverPreview } from "@/components/flux-ui/common/file-hover-preview";
import { setDragImageBelowCursor } from "@/components/flux-ui/editor/drag-ghost";
import { formatError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
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
  IcFile,
  IcFileCode,
  IcFileGeneric,
  IcFileImage,
  IcFileJson,
  IcFilePdf,
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
import type { FileNode } from "@/state/editor";

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
  /** When provided, the Files view renders the actual vault tree
   *  instead of the labelled stub list. */
  vaultTree?: FileNode[];
  /** Called when the user clicks a non-folder node in the vault tree. */
  onOpenFile?: (fileId: string) => void;
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
  vaultTree,
  onOpenFile,
}: LeftSidebarProps) {
  const [inlineEdit, setInlineEdit] = React.useState<InlineEditState>(null);
  const [trashOpen, setTrashOpen] = React.useState(false);
  const { createFile, renameFile } = useFileOperations();
  const { createDirectory } = useDirectoryOperations();
  const { refreshVault } = useVaultOperations();
  
  const handleInlineSubmit = React.useCallback(async (value: string) => {
    if (!inlineEdit) return;
    try {
      if (inlineEdit.type === 'newFile') {
        const newPath = inlineEdit.path ? `${inlineEdit.path}/${value}` : value;
        await createFile(newPath, `# ${value.replace('.md', '')}\n\n`);
        setInlineEdit(null);
        // The store mutator already inserted the node into the tree
        // surgically — no refresh needed. Auto-open the new file.
        if (onOpenFile) onOpenFile(newPath);
      } else if (inlineEdit.type === 'newFolder') {
        const newPath = inlineEdit.path ? `${inlineEdit.path}/${value}` : value;
        await createDirectory(newPath);
        setInlineEdit(null);
      } else if (inlineEdit.type === 'rename') {
        const oldPath = inlineEdit.path;
        await renameFile(oldPath, value);
        setInlineEdit(null);
      }
    } catch (error) {
      console.error('Inline edit failed:', error);
      toast.error('Operation failed', {
        description: formatError(error),
      });
    }
  }, [inlineEdit, createFile, createDirectory, renameFile, onOpenFile]);
  
  return (
    <div className={cn("flex h-full w-full flex-col", bgSidebar)}>
      <Header
        view={view}
        onChangeView={onChangeView}
        onToggleSidebar={onToggleSidebar}
        isMac={isMac}
      />
      <Toolbar
        view={view}
        onNewFile={() => setInlineEdit({ path: '', type: 'newFile' })}
        onNewFolder={() => setInlineEdit({ path: '', type: 'newFolder' })}
        onOpenTrash={() => setTrashOpen(true)}
        onRefresh={() => { void refreshVault(); }}
      />
      <Body 
        view={view} 
        vaultTree={vaultTree} 
        onOpenFile={onOpenFile}
        inlineEdit={inlineEdit}
        setInlineEdit={setInlineEdit}
        onInlineSubmit={handleInlineSubmit}
        onInlineCancel={() => setInlineEdit(null)}
      />
      <Footer
        vaultName={vaultName}
        onOpenVaultPicker={onOpenVaultPicker}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
      />
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} />
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

// ── Inline Input Component ────────────────────────────────────────
function InlineInput({
  defaultValue,
  onSubmit,
  onCancel,
  depth,
  kind,
}: {
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  depth: number;
  /** Drives the leading icon + chevron slot so the input lines up
   *  exactly with sibling rows in the tree (chevron column for
   *  folders, spacer for files). */
  kind: 'file' | 'folder';
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Focus + select on mount.
    const el = inputRef.current;
    if (el) {
      el.focus();
      const dotIndex = defaultValue.lastIndexOf('.');
      if (dotIndex > 0) {
        el.setSelectionRange(0, dotIndex);
      } else {
        el.select();
      }
    }
    // Click-outside cancel — registered AFTER a short delay so the
    // very click that opened us (and any Radix tooltip / menu close
    // cycle riding alongside it) doesn't immediately close us. We
    // intentionally don't use onBlur because Radix's focus
    // restoration fires a synthetic blur on the input that we can't
    // reliably distinguish from a real "user clicked elsewhere"
    // blur, which made the buttons appear broken.
    let detach: (() => void) | null = null;
    const armTimer = window.setTimeout(() => {
      const handler = (e: MouseEvent) => {
        const root = rootRef.current;
        if (root && !root.contains(e.target as Node)) {
          onCancel();
        }
      };
      document.addEventListener('mousedown', handler);
      detach = () => document.removeEventListener('mousedown', handler);
    }, 200);
    return () => {
      window.clearTimeout(armTimer);
      detach?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const value = inputRef.current?.value.trim();
      if (value) onSubmit(value);
      else onCancel();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  // Mirror VaultTreeNode's row layout so the icon + text column align
  // exactly. Folder rows show `IcChevronDown`; file rows show an
  // invisible chevron-sized spacer. The accent ring + tinted bg
  // signals "this row is being edited / created".
  const Leading = kind === 'folder' ? IcFolder : pickFileIcon(defaultValue);

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 h-6 px-2 rounded-[4px]",
        "ring-1 ring-accent/70 bg-accent/[0.06]",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {kind === 'folder' ? (
        <IcChevronDown
          className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0"
        />
      ) : (
        <span className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
      )}
      <Leading className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
      <input
        ref={inputRef}
        type="text"
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] text-foreground"
        defaultValue={defaultValue}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

export type InlineEditState = {
  path: string;
  type: 'newFile' | 'newFolder' | 'rename';
} | null;

function Toolbar({ view, onNewFile, onNewFolder, onOpenTrash, onRefresh }: {
  view: LeftView;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenTrash: () => void;
  onRefresh: () => void;
}) {
  // Only render the 30px toolbar shell for views that put icons in
  // it (Files, Changes). Search + Bookmarks render their own
  // toolbar inside the Body so they can own the row — rendering
  // an empty 30px frame here just pushes their content down and
  // misaligns it with the Files panel.
  if (view !== "files" && view !== "changes") return null;
  return (
    <>
      {/* Icon-only toolbar, centered horizontally. The view title
          ("Files" / "Search" / …) used to live on the left, but it
          ate enough horizontal space that the rightmost icons would
          overflow + get clipped at the sidebar's min width. Centering
          icon clusters keeps them visible at every column width. */}
      <div className="flex items-center justify-center gap-1 h-[30px] px-2 shrink-0">
        {view === "files" && (
          <>
            <IconButton size="tiny" tooltip="New file" onClick={onNewFile}><IcNewFile /></IconButton>
            <IconButton size="tiny" tooltip="New folder" onClick={onNewFolder}><IcNewFolder /></IconButton>
            <IconButton size="tiny" tooltip="Sort A → Z"><IcSortAZ /></IconButton>
            <IconButton size="tiny" tooltip="Collapse all"><IcCollapseAll /></IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="tiny" tooltip="More options"><IcMore /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem onSelect={onRefresh}>
                  <IcRefresh /> Refresh vault
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onOpenTrash}>
                  <IcTrash /> View trash…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {view === "changes" && (
          <>
            <IconButton size="tiny" tooltip="Refresh"><IcRefresh /></IconButton>
            <IconButton size="tiny" tooltip="More options"><IcMore /></IconButton>
          </>
        )}
      </div>
    </>
  );
}

// ─── Body (stub per view) ───────────────────────────────────────────

function Body({
  view,
  vaultTree,
  onOpenFile,
  inlineEdit,
  setInlineEdit,
  onInlineSubmit,
  onInlineCancel,
}: {
  view: LeftView;
  vaultTree?: FileNode[];
  onOpenFile?: (fileId: string) => void;
  inlineEdit?: InlineEditState;
  setInlineEdit?: (val: InlineEditState) => void;
  onInlineSubmit?: (value: string) => void;
  onInlineCancel?: () => void;
}) {
  return (
    // Force the Radix ScrollArea's internal viewport wrapper to behave
    // as a constrained block instead of its default `display: table;
    // min-width: 100%` — that intrinsic-min-content sizing is what
    // makes long file names refuse to ellipsize ("truncate" never
    // kicks in because the parent grows to fit content). The
    // descendant arbitrary-variant targets the wrapper Radix renders
    // inside the viewport.
    <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!min-w-0 [&>[data-slot=scroll-area-viewport]>div]:!w-full">
      <div className="flex flex-col py-0.5">
        {view === "files" && (
          vaultTree
            ? <VaultTree 
                nodes={vaultTree} 
                depth={0} 
                onOpenFile={onOpenFile}
                inlineEdit={inlineEdit}
                setInlineEdit={setInlineEdit}
                onInlineSubmit={onInlineSubmit}
                onInlineCancel={onInlineCancel}
              />
            : <StubList items={["Welcome.md", "Inbox.md", "Daily/", "Projects/"]} />
        )}
        {view === "search" && <VaultSearchPanel />}
        {view === "bookmarks" && <BookmarksList />}
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

// ─── Real vault tree ────────────────────────────────────────────────

/**
 * Recursive vault renderer used by the Files view when MOCK_VAULT
 * (or, later, the real Tauri vault) is wired in. Folders toggle their
 * expansion in local state; file clicks bubble up to `onOpenFile`.
 *
 * Kept intentionally lean — no hover previews, no context menu — so
 * we can exercise the editor surfaces (codemirror / preview / slides /
 * graph / pdf) without dragging the whole stub-list decoration along.
 */
function VaultTree({
  nodes,
  depth,
  onOpenFile,
  inlineEdit,
  setInlineEdit,
  onInlineSubmit,
  onInlineCancel,
}: {
  nodes: FileNode[];
  depth: number;
  onOpenFile?: (fileId: string) => void;
  inlineEdit?: InlineEditState;
  setInlineEdit?: (val: InlineEditState) => void;
  onInlineSubmit?: (value: string) => void;
  onInlineCancel?: () => void;
}) {
  // Sort: folders first, then files, each alpha by name.
  const sorted = React.useMemo(
    () =>
      [...nodes].sort((a, b) => {
        const aFolder = a.kind === "folder";
        const bFolder = b.kind === "folder";
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [nodes],
  );
  return (
    // Root-level ul keeps `px-1.5 py-1` for breathing room from the
    // toolbar; nested instances (rendered inside an open folder) get
    // 0 padding so the parent folder row sits flush against its
    // first child with the same 2px sibling rhythm as the rest of
    // the tree.
    <ul
      className={cn(
        "flex flex-col gap-0.5",
        depth === 0 ? "px-1.5 py-1" : "p-0",
      )}
    >
      {/* Inline input for new file/folder at root */}
      {inlineEdit && inlineEdit.path === '' && onInlineSubmit && onInlineCancel && (
        <InlineInput
          defaultValue={inlineEdit.type === 'newFile' ? 'Untitled.md' : 'New Folder'}
          onSubmit={onInlineSubmit}
          onCancel={onInlineCancel}
          depth={depth}
          kind={inlineEdit.type === 'newFolder' ? 'folder' : 'file'}
        />
      )}
      {sorted.map((node) => (
        <VaultTreeNode
          key={node.id}
          node={node}
          depth={depth}
          onOpenFile={onOpenFile}
          inlineEdit={inlineEdit}
          setInlineEdit={setInlineEdit}
          onInlineSubmit={onInlineSubmit}
          onInlineCancel={onInlineCancel}
        />
      ))}
    </ul>
  );
}

function VaultTreeNode({
  node,
  depth,
  onOpenFile,
  inlineEdit,
  setInlineEdit,
  onInlineSubmit,
  onInlineCancel,
}: {
  node: FileNode;
  depth: number;
  onOpenFile?: (fileId: string) => void;
  inlineEdit?: InlineEditState;
  setInlineEdit?: (val: InlineEditState) => void;
  onInlineSubmit?: (value: string) => void;
  onInlineCancel?: () => void;
}) {
  // Folders start CLOSED. Auto-expanding the root level was
  // confusing UX (new folders popped open immediately and the
  // sibling rhythm broke); users can click the chevron to open one.
  const [open, setOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isDropTarget, setIsDropTarget] = React.useState(false);
  const [highlightPulse, setHighlightPulse] = React.useState(false);
  const rowRef = React.useRef<HTMLLIElement | null>(null);
  const { deleteFile, moveFile } = useFileOperations();
  const isFolder = node.kind === "folder";

  // "Reveal in navigation" listener — dispatched by the doc-header's
  // ⋯ menu (and any other "scroll-to-this-file" trigger). Folders
  // auto-expand if the target is a descendant; the matching leaf
  // scrolls itself into view and pulses briefly so the user spots
  // where the file lives in the tree.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      const target = detail?.fileId;
      if (!target) return;
      // Normalise both sides so "a/b" and "a\\b" compare equal.
      const norm = (s: string) => s.replace(/[\\/]+/g, "/");
      const targetN = norm(target);
      const selfN = norm(node.id);
      if (isFolder) {
        // Open if the target file lives under this folder.
        if (targetN === selfN || targetN.startsWith(selfN + "/")) {
          setOpen(true);
        }
        return;
      }
      if (selfN === targetN) {
        // Scroll into view + pulse highlight. Two RAFs so any
        // folder-open state changes have a chance to lay out first.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            rowRef.current?.scrollIntoView({
              block: "center",
              behavior: "smooth",
            });
            setHighlightPulse(true);
            window.setTimeout(() => setHighlightPulse(false), 1500);
          });
        });
      }
    };
    window.addEventListener("flux-reveal-in-nav", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flux-reveal-in-nav",
        handler as EventListener,
      );
  }, [node.id, isFolder]);

  // Check if this node is being renamed
  const isRenaming = inlineEdit?.path === node.id && inlineEdit?.type === 'rename';

  const handleClick = () => {
    if (isFolder) {
      setOpen((v) => !v);
      return;
    }
    if (node.id) {
      onOpenFile?.(node.id);
    } else {
      console.error('[VaultTreeNode] node.id is undefined:', node);
    }
  };

  const handleRename = () => {
    if (setInlineEdit) {
      setInlineEdit({ path: node.id, type: 'rename' });
    }
  };

  const handleDeleteConfirmed = async () => {
    // Throws on failure — ConfirmDialog catches and keeps itself open.
    // The store mutator inside `deleteFile` removes the node from
    // the tree surgically; no full vault refresh required.
    await deleteFile(node.id);
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(node.id);
    toast.success("Path copied to clipboard");
  };

  // ── Native HTML5 drag-and-drop ────────────────────────────────────
  // Lets the user move files/folders into other folders inside the
  // sidebar. Pure file-tree DnD (the editor panes have their OWN DnD
  // for tab/file drops — they listen for different MIME types).
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("application/x-flux-tree-path", node.id);
    e.dataTransfer.effectAllowed = "move";
    // Replace the browser's washed-out element-copy ghost with a
    // small pill (bubble) anchored below + right of the cursor's
    // tail. Theme-aware (light/dark) — see setDragImageBelowCursor.
    setDragImageBelowCursor(e, node.name, {
      iconSvg: isFolder ? FOLDER_ICON_SVG : FILE_ICON_SVG,
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isFolder) return;
    const src = e.dataTransfer.types.includes("application/x-flux-tree-path");
    if (!src) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isDropTarget) setIsDropTarget(true);
  };

  const handleDragLeave = () => {
    if (isDropTarget) setIsDropTarget(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
    const src = e.dataTransfer.getData("application/x-flux-tree-path");
    if (!src || src === node.id) return;
    // Don't allow dropping a folder into itself or a descendant.
    if (node.id === src || node.id.startsWith(src + "/") || node.id.startsWith(src + "\\")) {
      toast.error("Cannot move a folder into itself");
      return;
    }
    const fileName = src.split(/[\\/]/).pop() ?? src;
    const dst = node.id ? `${node.id}/${fileName}` : fileName;
    try {
      await moveFile(src, dst);
      // `moveFile` updates the tree via `renameNodeInTree` already.
    } catch {
      /* useFileOperations toasts the error itself */
    }
  };

  // If renaming, show inline input instead of the row
  if (isRenaming && onInlineSubmit && onInlineCancel) {
    return (
      <li>
        <InlineInput
          defaultValue={node.name}
          onSubmit={onInlineSubmit}
          onCancel={onInlineCancel}
          depth={depth}
          kind={isFolder ? 'folder' : 'file'}
        />
      </li>
    );
  }

  // Pick a file icon by extension so files don't all look like folders.
  const FileIcon = pickFileIcon(node.name);

  return (
    // `gap-0.5` matches the parent `<ul>`'s sibling rhythm so an
    // open folder's first child sits the same 2px below its row as
    // any other sibling pair. When closed there's no second child,
    // so the gap is a no-op.
    <li
      ref={rowRef}
      className={cn(
        "flex flex-col gap-0.5 transition-shadow",
        highlightPulse && "ring-2 ring-[var(--text-link)] rounded-[6px]",
      )}
    >
      <ContextMenu>
        <FileHoverPreview node={node} onOpenFile={onOpenFile}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              draggable
              onClick={handleClick}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "flex w-full min-w-0 items-center gap-1.5 h-6 rounded-[4px] text-left text-[12px] select-none cursor-pointer",
                "px-2",
                textNormal,
                hoverBg,
                isDropTarget && "ring-1 ring-accent bg-accent/30",
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              {isFolder ? (
                <IcChevronDown
                  className={cn(
                    "[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0 transition-transform",
                    !open && "-rotate-90",
                  )}
                />
              ) : (
                <span className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
              )}
              {isFolder ? (
                <IcFolder className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0" />
              ) : (
                <FileIcon className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-80" />
              )}
              {/* No `title=` — the FileHoverPreview popover above
                  already shows the file body, and the browser's
                  native tooltip racing the hover card creates a
                  double-overlay that just gets in the way. */}
              <span className="truncate min-w-0 flex-1">{node.name}</span>
            </button>
          </ContextMenuTrigger>
        </FileHoverPreview>
        <ContextMenuContent className="min-w-[200px]">
          <ContextMenuLabel className="text-[11px] uppercase tracking-wide opacity-70 truncate">
            {node.name}
          </ContextMenuLabel>
          <ContextMenuSeparator />
          {isFolder && setInlineEdit && (
            <>
              <ContextMenuItem onSelect={() => setInlineEdit({ path: node.id, type: 'newFile' })}>
                <IcNewFile /> New File
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setInlineEdit({ path: node.id, type: 'newFolder' })}>
                <IcNewFolder /> New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {!isFolder && (
            <>
              <ContextMenuItem onSelect={() => handleClick()}>
                Open
                <ContextMenuShortcut>↵</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={handleCopyPath}>
            <IcCopy /> Copy path
            <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRename}>
            <IcPencil /> Rename…
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setConfirmOpen(true)}
          >
            <IcTrash /> Delete
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isFolder ? "Delete folder?" : "Delete file?"}
        description={
          <>
            <span className="font-medium">{node.name}</span> will be moved to
            the trash. You can restore it from{" "}
            <em>Files toolbar → ⋯ → View trash</em>.
          </>
        }
        confirmLabel="Move to trash"
        destructive
        onConfirm={handleDeleteConfirmed}
      />
      {isFolder && open && (
        <>
          {/* Inline input for new file/folder inside this folder */}
          {inlineEdit && inlineEdit.path === node.id && onInlineSubmit && onInlineCancel && (
            <InlineInput
              defaultValue={inlineEdit.type === 'newFile' ? 'Untitled.md' : 'New Folder'}
              onSubmit={onInlineSubmit}
              onCancel={onInlineCancel}
              depth={depth + 1}
              kind={inlineEdit.type === 'newFolder' ? 'folder' : 'file'}
            />
          )}
          {node.children && (
            <VaultTree
              nodes={node.children}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              inlineEdit={inlineEdit}
              setInlineEdit={setInlineEdit}
              onInlineSubmit={onInlineSubmit}
              onInlineCancel={onInlineCancel}
            />
          )}
        </>
      )}
    </li>
  );
}

/** Map a file extension to a Lucide-based icon component. Folders
 *  use `IcFolder` directly; this only handles file kinds. */
function pickFileIcon(name: string): React.ComponentType<React.SVGAttributes<SVGElement>> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".markdown")) {
    return IcFile;
  }
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg")
  ) {
    return IcFileImage;
  }
  if (lower.endsWith(".json")) return IcFileJson;
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".rs") ||
    lower.endsWith(".py") ||
    lower.endsWith(".go") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".rb")
  ) {
    return IcFileCode;
  }
  if (lower.endsWith(".pdf")) return IcFilePdf;
  return IcFileGeneric;
}

// Raw inline SVGs for the drag-ghost bubble. `setDragImage` requires
// a real DOM element, not React, so we can't reuse the lucide-react
// components directly — these are the equivalent Lucide paths copied
// verbatim. `currentColor` lets the chip recolour itself per theme.
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

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
