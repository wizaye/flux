import * as React from "react";
import { toast } from "sonner";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { DotmCircular5 } from "@/components/ui/dotm-circular-5";
import {
  IcTerminal,
  IcRefresh,
  IcSourceControl,
  IcCloudUpload,
  IcSearch,
  IcFiles,
  IcGear,
  IcHelp,
  IcTrash,
} from "@/components/flux-ui/common/icons";

/**
 * "Terminal" command runner — a second flavor of the shadcn
 * `CommandDialog` (cmdk) that mimics a quick-action shell so the
 * activity strip's terminal icon does something useful even before
 * we wire a real PTY/terminal backend.
 *
 * Triggered by:
 *   - the `terminal` entry in `activity-strip.tsx`
 *   - Cmd/Ctrl+`  (matches VS Code's terminal toggle hotkey)
 *
 * Groups: Quick (clear / refresh / reload), Vault (sync / search),
 * Git (status / pull / push / log), System (settings / help / quit).
 * Every action is a dummy `console.log` for now — they'll be wired
 * to real handlers in later phases.
 */
export function TerminalPalette({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings?: () => void;
}) {
  const run = React.useCallback(
    (label: string) => {
      console.log(`terminal: ${label}`);
      onOpenChange(false);
    },
    [onOpenChange],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Run command"
      description="Run a quick action. Press Escape to dismiss, or Cmd/Ctrl+K to toggle."
    >
      <Command>
        <CommandInput placeholder="Type a shell command or pick an action…" />
        <CommandList>
          <CommandEmpty>No command found.</CommandEmpty>

        <CommandGroup heading="Quick">
          <CommandItem onSelect={() => run("clear")}>
            <IcTerminal /> Clear
            <CommandShortcut>⌘L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("refresh-vault")}>
            <IcRefresh /> Refresh vault
            <CommandShortcut>⌘R</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("reload-window")}>
            <IcRefresh /> Reload window
            <CommandShortcut>⌘⇧R</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Vault">
          <CommandItem onSelect={() => run("search")}>
            <IcSearch /> Search files…
            <CommandShortcut>⌘⇧F</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("open-file")}>
            <IcFiles /> Open file…
            <CommandShortcut>⌘O</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              // Real loader + sonner demo: fire a toast.promise with a
              // dotmatrix circular loader as the icon. Mimics the
              // shape of a real "syncing…" flow until we wire git.
              const fake = new Promise<void>((res) =>
                window.setTimeout(res, 1600),
              );
              toast.promise(fake, {
                loading: "Syncing vault…",
                success: "Vault synced",
                error: "Sync failed",
                icon: <DotmCircular5 size={16} dotSize={2} />,
              });
            }}
          >
            <IcCloudUpload /> Sync vault
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Git">
          <CommandItem onSelect={() => run("git status")}>
            <IcSourceControl /> git status
          </CommandItem>
          <CommandItem onSelect={() => run("git pull")}>
            <IcSourceControl /> git pull
          </CommandItem>
          <CommandItem onSelect={() => run("git push")}>
            <IcSourceControl /> git push
          </CommandItem>
          <CommandItem onSelect={() => run("git log")}>
            <IcSourceControl /> git log
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="System">
          <CommandItem onSelect={() => { onOpenChange(false); onOpenSettings?.(); }}>
            <IcGear /> Open settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("help")}>
            <IcHelp /> Help & docs
          </CommandItem>
          <CommandItem onSelect={() => run("trash")} className="text-destructive data-[selected=true]:text-destructive">
            <IcTrash /> Empty trash
          </CommandItem>
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
