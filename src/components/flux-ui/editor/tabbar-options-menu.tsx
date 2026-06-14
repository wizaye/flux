import { IconButton } from "@/components/flux-ui/common/icon-button";
import { IcChevronDown, IcStack, IcCloseAll, IcCheck, IcPlus } from "@/components/flux-ui/common/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * Tabbar overflow menu — `IcChevronDown` button at the right edge of
 * the pane tabbar. Now built on shadcn `DropdownMenu` (Radix), which
 * eliminates the custom `FlyoutMenu` + `useFlyoutMenu` portal hook
 * (auto-position, focus trap, outside-click dismissal all come from
 * Radix).
 */
type Props = {
  stackTabs: boolean;
  onToggleStack: () => void;
  onCloseAll: () => void;
  onNewTab: () => void;
};

export function TabbarOptionsMenu({
  stackTabs,
  onToggleStack,
  onCloseAll,
  onNewTab,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="tiny" aria-label="Tabbar options">
          <IcChevronDown />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem onSelect={onToggleStack}>
          {stackTabs ? <IcCheck /> : <IcStack />}
          Stack tabs
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCloseAll}>
          <IcCloseAll />
          Close all
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewTab}>
          <IcPlus />
          New tab
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
