import * as React from "react";
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
import {
  IcFiles,
  IcSearch,
  IcBookmark,
  IcSourceControl,
  IcCalendar,
  IcNewFile,
  IcNewFolder,
  IcArrowRight,
  IcArrowDown,
  IcSun,
  IcMoon,
  IcGear,
  IcHelp,
  IcCloudUpload,
  IcBook,
} from "@/components/flux-ui/common/icons";
import { useTheme } from "@/components/theme-provider";
import { usePluginStore } from "@/state/plugin-store";
import { useSettingsStore, bindingLabel } from "@/state/settings-store";

/**
 * Dummy global command palette built on shadcn `CommandDialog` (cmdk).
 * Triggered by Cmd/Ctrl+K and by the "Command" entry in the activity
 * strip. All commands are dummy stubs that `console.log` for now —
 * they'll be wired to real actions in later phases.
 *
 * Mirrors lattice's `CommandPalette` modal but uses shadcn primitives
 * (cmdk + Dialog) instead of a hand-rolled overlay/css.
 */
export type FluxCommandHandlers = {
  onRouteView?: (view: "files" | "search" | "bookmarks" | "changes" | "calendar") => void;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onSplit?: (edge: "left" | "right" | "top" | "bottom") => void;
  onOpenSettings?: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  handlers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handlers?: FluxCommandHandlers;
}) {
  const { setTheme } = useTheme();
  const hotkeys = useSettingsStore((s) => s.hotkeys);
  const run = React.useCallback(
    (fn: () => void) => {
      fn();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => handlers?.onRouteView?.("files"))}>
            <IcFiles /> Show Files
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onRouteView?.("search"))}>
            <IcSearch /> Search Vault
            <CommandShortcut>⌘⇧F</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onRouteView?.("bookmarks"))}>
            <IcBookmark /> Show Bookmarks
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onRouteView?.("changes"))}>
            <IcSourceControl /> Source Control
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onRouteView?.("calendar"))}>
            <IcCalendar /> Open Calendar
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="File">
          <CommandItem onSelect={() => run(() => console.log("cmd: new file"))}>
            <IcNewFile /> New File
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => console.log("cmd: new folder"))}>
            <IcNewFolder /> New Folder
          </CommandItem>
          <CommandItem onSelect={() => run(() => console.log("cmd: new paper"))}>
            <IcBook /> New Paper
          </CommandItem>
          <CommandItem onSelect={() => run(() => console.log("cmd: publish"))}>
            <IcCloudUpload /> Publish
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Layout">
          <CommandItem onSelect={() => run(() => handlers?.onSplit?.("right"))}>
            <IcArrowRight /> Split Right
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onSplit?.("bottom"))}>
            <IcArrowDown /> Split Down
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onToggleLeftSidebar?.())}>
            Toggle Left Sidebar
            <CommandShortcut>{bindingLabel(hotkeys.toggleLeftSidebar)}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onToggleRightSidebar?.())}>
            Toggle Right Sidebar
            <CommandShortcut>{bindingLabel(hotkeys.toggleRightSidebar)}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <IcSun /> Theme: Light
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <IcMoon /> Theme: Dark
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("system"))}>
            <IcGear /> Theme: System
          </CommandItem>
          <CommandItem onSelect={() => run(() => handlers?.onOpenSettings?.())}>
            <IcGear /> Open Settings
            <CommandShortcut>{bindingLabel(hotkeys.openSettings)}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => console.log("cmd: help"))}>
            <IcHelp /> Help & Docs
          </CommandItem>
        </CommandGroup>

        <PluginCommandsGroup runAndClose={run} />
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** Plugin-contributed palette commands. Rendered last so plugins
 *  never reorder built-in entries. Hidden when no enabled plugin
 *  contributes a `palette: true` command. */
function PluginCommandsGroup({
  runAndClose,
}: {
  runAndClose: (fn: () => void) => void;
}) {
  const paletteCommands = usePluginStore((s) => s.paletteCommands);
  const builtinComponents = usePluginStore((s) => s.builtinComponents);
  if (paletteCommands.length === 0) return null;
  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Plugins">
        {paletteCommands.map(({ pluginId, command }) => (
          <CommandItem
            key={`${pluginId}-${command.id}`}
            onSelect={() =>
              runAndClose(() => {
                // Built-in plugins ship a `commandHandlers` map; we
                // call it directly. External plugins (Phase C) will
                // get a `flux:plugin-command` window event their
                // bundle subscribes to.
                const handler =
                  builtinComponents[pluginId]?.commandHandlers?.[command.id];
                if (handler) {
                  handler();
                } else {
                  window.dispatchEvent(
                    new CustomEvent("flux:plugin-command", {
                      detail: { pluginId, commandId: command.id },
                    }),
                  );
                }
              })
            }
          >
            {command.label}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
