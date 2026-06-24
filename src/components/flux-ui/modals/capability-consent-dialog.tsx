/**
 * Capability consent dialog — shown the first time a user enables
 * an external (community) plugin. The user reviews the plugin's
 * declared required + optional capabilities, ticks the ones they
 * approve, and clicks Allow.
 *
 * Required capabilities are pre-checked and cannot be unchecked —
 * the plugin will not function without them. Optional caps default
 * on but can be unticked individually.
 *
 * The chosen set is persisted via `usePluginStore.grantCapabilities`
 * so subsequent toggles never re-prompt. Cancelling keeps the
 * plugin disabled and `grantedCapabilities` remains `null`.
 */
import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PluginManifest } from "@flux/plugin-sdk/types";

export interface CapabilityConsentDialogProps {
  open: boolean;
  manifest: PluginManifest | null;
  onCancel: () => void;
  /** Called with the final set of approved capability strings. */
  onApprove: (capabilities: string[]) => void;
}

export function CapabilityConsentDialog({
  open,
  manifest,
  onCancel,
  onApprove,
}: CapabilityConsentDialogProps) {
  const required = React.useMemo<string[]>(
    () => manifest?.capabilities?.required ?? [],
    [manifest],
  );
  const optional = React.useMemo<string[]>(
    () => manifest?.capabilities?.optional ?? [],
    [manifest],
  );

  // Optional caps default to checked; each open of the dialog
  // resets the selection so a previous reject doesn't leak in.
  const [pickedOptional, setPickedOptional] = React.useState<Set<string>>(
    () => new Set(optional),
  );
  React.useEffect(() => {
    if (open) setPickedOptional(new Set(optional));
  }, [open, optional]);

  if (!manifest) return null;

  const toggle = (cap: string) =>
    setPickedOptional((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Allow “{manifest.name}” to access:
          </AlertDialogTitle>
          <AlertDialogDescription>
            This plugin is installed in your vault and is asking
            for the following capabilities. You can change this
            later by uninstalling and reinstalling the plugin.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[260px] -mx-1 px-1">
          {required.length > 0 && (
            <section className="mb-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Required
              </h4>
              <ul className="space-y-1.5">
                {required.map((cap) => (
                  <li
                    key={cap}
                    className="flex items-start gap-2 text-[12.5px]"
                  >
                    <Checkbox checked disabled className="mt-0.5" />
                    <div>
                      <code className="text-foreground">{cap}</code>
                      <p className="text-muted-foreground text-[11.5px]">
                        {describeCapability(cap)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {optional.length > 0 && (
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Optional
              </h4>
              <ul className="space-y-1.5">
                {optional.map((cap) => (
                  <li
                    key={cap}
                    className="flex items-start gap-2 text-[12.5px]"
                  >
                    <Checkbox
                      checked={pickedOptional.has(cap)}
                      onCheckedChange={() => toggle(cap)}
                      className="mt-0.5"
                    />
                    <div>
                      <code className="text-foreground">{cap}</code>
                      <p className="text-muted-foreground text-[11.5px]">
                        {describeCapability(cap)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {required.length === 0 && optional.length === 0 && (
            <p className="text-[12.5px] text-muted-foreground py-3">
              This plugin does not request any capabilities. Click
              Allow to enable it.
            </p>
          )}
        </ScrollArea>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              onApprove([...required, ...Array.from(pickedOptional)])
            }
          >
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Short human-readable description for the SDK's canonical
 *  capability strings. Anything unknown falls through to the raw
 *  capability id so a future SDK never silently mislabels. */
function describeCapability(cap: string): string {
  switch (cap) {
    case "vault.read":
      return "Read text files inside your vault.";
    case "vault.write":
      return "Create and modify files inside your vault.";
    case "vault.list":
      return "List the contents of folders in your vault.";
    case "workspace.notice":
      return "Show toast notifications.";
    case "workspace.open":
      return "Open vault files in a new tab.";
    case "search.query":
      return "Run full-text searches across your vault.";
    case "plugin.storage.read":
      return "Read the plugin's own scoped key/value storage.";
    case "plugin.storage.write":
      return "Write to the plugin's own scoped key/value storage.";
    default:
      return cap;
  }
}
