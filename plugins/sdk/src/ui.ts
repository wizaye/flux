/**
 * Re-export of host shadcn primitives that are safe for plugins to
 * use. Plugins import via `@flux/plugin-sdk/ui` so they don't have
 * to know where the host stores its components — keeps plugin
 * bundles portable across future host re-layouts.
 *
 * STATUS — Phase A:
 *   These re-exports exist for the eventual standalone plugin
 *   template (npm-installed SDK) where plugins can't reach into
 *   the host's `src/components/ui/*` directly. Until that ships,
 *   bundled plugins in this repo import shadcn primitives DIRECTLY
 *   from `@/components/ui/*` — it's one less layer of indirection
 *   and avoids re-typing the same component contract twice.
 *   See `docs/CURRENT_PROGRESS.md` §5.5 for the npm-publish plan.
 *
 * Only stable, low-controversy primitives go here:
 *   Button, Input, Textarea, Card, Tooltip, DropdownMenu, Dialog,
 *   Switch, Separator, ScrollArea
 *
 * Anything that needs host context (toaster, theme provider,
 * settings store) goes through the broker (`@flux/plugin-sdk/host`),
 * not through this module.
 */
export { Button } from "@/components/ui/button";

export { Input } from "@/components/ui/input";
export { Textarea } from "@/components/ui/textarea";
export { Separator } from "@/components/ui/separator";
export { Switch } from "@/components/ui/switch";
export { ScrollArea } from "@/components/ui/scroll-area";
export { Badge } from "@/components/ui/badge";

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export { Checkbox } from "@/components/ui/checkbox";

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
