/**
 * Global busy overlay — full-screen scrim + dotmatrix loader.
 *
 * Mounted once at the App root. Shows when `useBusyStore` has any
 * active entries. The scrim blocks pointer events so clicks during a
 * long operation (vault open, PDF export, indexing) can't kick off
 * another action that fights for the same backend.
 *
 * Visual:
 *   • Soft scrim (slight darken in dark mode, light wash in light)
 *   • Centered DotmCircular5 (matches the loader used by the
 *     terminal palette so the visual vocabulary stays consistent)
 *   • Label of the topmost (most recently started) entry
 *   • Optional sublabel under the main label
 *
 * The overlay only blocks input AFTER a short grace window
 * (`GRACE_MS`). Quick operations (<160 ms) never paint — avoids
 * flashing a loader for an open-recent-vault that resolves
 * instantly.
 */
import * as React from "react";
import { DotmCircular5 } from "@/components/ui/dotm-circular-5";
import { useBusyStore } from "@/state/busy-store";
import { cn } from "@/lib/utils";

const GRACE_MS = 160;

export function GlobalBusyOverlay() {
  const entries = useBusyStore((s) => s.entries);
  const top = entries[entries.length - 1];
  const [showAfterGrace, setShowAfterGrace] = React.useState(false);

  React.useEffect(() => {
    if (!top) {
      setShowAfterGrace(false);
      return;
    }
    const t = window.setTimeout(() => setShowAfterGrace(true), GRACE_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [top?.id]);

  if (!top || !showAfterGrace) return null;

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3",
        "bg-black/35 dark:bg-black/55 backdrop-blur-[2px]",
        "animate-in fade-in-0 duration-150",
      )}
      // Swallow every pointer / wheel / key event while busy.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <DotmCircular5 size={56} dotSize={6} colorPreset="grad-aurora" />
      <div className="text-center">
        <p className="text-[13px] font-medium text-white drop-shadow-sm">
          {top.label}
        </p>
        {top.detail && (
          <p className="text-[11px] text-white/75 mt-1">{top.detail}</p>
        )}
      </div>
    </div>
  );
}
