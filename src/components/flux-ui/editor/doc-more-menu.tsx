import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcMore,
  IcEye,
  IcCode,
  IcSlideshow,
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
} from "@/components/flux-ui/common/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";

/**
 * Doc-header overflow menu — long list of per-document commands.
 * Built on shadcn `DropdownMenu` (Radix). Phase-1 stubs are passed in
 * as `undefined` callbacks, which disable the corresponding items.
 */
type Props = {
  viewMode: "source" | "preview" | "slides" | undefined;
  onToggleReading: () => void;
  onSetSource: () => void;
  onSetSlides: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onShowInExplorer: () => void;
  onRevealInNav: () => void;
  onDelete: () => void;
  /** Optional stubs — wired up in later phases. */
  onBacklinks?: () => void;
  onMoveTo?: () => void;
  onToggleBookmark?: () => void;
  onMerge?: () => void;
  onAddProperty?: () => void;
  onExportPdf?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
  onVersionHistory?: () => void;
  onOpenLinkedView?: () => void;
  onOpenInNewWindow?: () => void;
};

export function DocMoreMenu(props: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="tiny" aria-label="More options">
          <IcMore />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuItem onSelect={props.onToggleReading}>
          <IcEye /> Reading view
          <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSetSource}>
          <IcCode /> Source mode
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSetSlides}>
          <IcSlideshow /> Slides view
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!props.onBacklinks} onSelect={props.onBacklinks}>
          <IcLink /> Backlinks
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onOpenLinkedView} onSelect={props.onOpenLinkedView}>
          <IcLinkExternal /> Open linked view
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onMerge} onSelect={props.onMerge}>
          <IcMerge /> Merge…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onToggleBookmark} onSelect={props.onToggleBookmark}>
          <IcBookmark /> Bookmark
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onAddProperty} onSelect={props.onAddProperty}>
          <IcFileAdd /> Add file property
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onRename}>
          <IcEdit /> Rename…
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onMoveTo} onSelect={props.onMoveTo}>
          <IcSwap /> Move file to…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onCopyPath}>
          <IcCopy /> Copy path
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onShowInExplorer}>
          <IcFolderOpened /> Show in system explorer
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onRevealInNav}>
          <IcLocation /> Reveal file in navigation
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!props.onExportPdf} onSelect={props.onExportPdf}>
          <IcFilePdf /> Export to PDF
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onFind} onSelect={props.onFind}>
          <IcSearch /> Find
          <DropdownMenuShortcut>Ctrl+F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onReplace} onSelect={props.onReplace}>
          <IcReplace /> Replace
          <DropdownMenuShortcut>Ctrl+H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onVersionHistory} onSelect={props.onVersionHistory}>
          <IcHistory /> Open version history
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.onOpenInNewWindow} onSelect={props.onOpenInNewWindow}>
          <IcLinkExternal /> Open in new window
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
          <IcTrash /> Delete file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
