import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcSplit,
  IcArrowRight,
  IcArrowDown,
  IcArrowLeft,
  IcArrowUp,
} from "@/components/flux-ui/common/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/**
 * Split-direction picker on the doc-header. Built on shadcn
 * `DropdownMenu` (Radix) — replaces the prior `FlyoutMenu` portal
 * hook.
 */
type Props = {
  onSplit: (edge: "left" | "right" | "top" | "bottom") => void;
};

export function SplitMenuButton({ onSplit }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="tiny" aria-label="Split pane">
          <IcSplit />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuItem onSelect={() => onSplit("right")}>
          <IcArrowRight /> Split right
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSplit("bottom")}>
          <IcArrowDown /> Split down
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSplit("left")}>
          <IcArrowLeft /> Split left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSplit("top")}>
          <IcArrowUp /> Split up
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
