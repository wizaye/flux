/**
 * Reusable confirmation dialog — shadcn `AlertDialog`-based.
 *
 * Built on the proper modal-confirm primitive (Radix `AlertDialog`)
 * rather than a generic `Dialog`: better default focus management,
 * forced modal semantics, and the canonical destructive-action
 * shape. The browser's native `confirm()` is blocked in some Tauri
 * webview configurations and can't be themed; use this everywhere.
 *
 *   const [open, setOpen] = React.useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Delete file?"
 *     description={`"${name}" will be moved to the trash.`}
 *     confirmLabel="Delete"
 *     destructive
 *     onConfirm={async () => deleteFile(path)}
 *   />
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button with destructive styling. */
  destructive?: boolean;
  /**
   * When provided, renders a "Don't ask again" checkbox in the
   * footer. The handler is invoked with the checkbox value once the
   * user clicks confirm. Useful for destructive prompts the user
   * wants to skip in the future (Obsidian-style "Merge" / "Delete
   * for good").
   */
  dontAskAgain?: {
    label?: string;
    onChange: (skip: boolean) => void;
  };
  /** Called when the user clicks the confirm button. May be async —
   *  the dialog stays open while it runs, then auto-closes on success
   *  (or stays open if the handler throws so the user sees the error). */
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  dontAskAgain,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [skip, setSkip] = React.useState(false);

  // Reset the checkbox whenever the dialog reopens.
  React.useEffect(() => {
    if (open) setSkip(false);
  }, [open]);

  const handleConfirm = async (e: React.MouseEvent) => {
    if (busy) return;
    // Stop AlertDialogAction from auto-closing — we want to keep
    // the dialog up while the async work runs, and only dismiss on
    // success.
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      if (dontAskAgain && skip) dontAskAgain.onChange(true);
      onOpenChange(false);
    } catch {
      // Caller's error toast (formatError) surfaces details; keep
      // the dialog open so the user can retry / cancel.
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className={cn(dontAskAgain && "items-center gap-3")}>
          {dontAskAgain && (
            <label
              htmlFor="confirm-dont-ask"
              className="flex items-center gap-2 mr-auto text-[12px] text-muted-foreground cursor-pointer select-none"
            >
              <Checkbox
                id="confirm-dont-ask"
                checked={skip}
                onCheckedChange={(v) => setSkip(v === true)}
              />
              {dontAskAgain.label ?? "Don't ask again"}
            </label>
          )}
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={busy}
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
