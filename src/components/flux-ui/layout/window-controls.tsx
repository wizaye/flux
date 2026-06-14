import * as React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IcClose, IcMaximize, IcMinimize, IcRestore } from "@/components/flux-ui/common/icons";
import {
  bgHeader,
  borderTabBg,
} from "@/lib/lattice-tokens";
import { WIN_CONTROLS_W, HEADER_H } from "@/lib/layout-constants";

/**
 * Windows / Linux custom window-control cluster — Minimize / Maximize
 * / Restore / Close, floating absolutely at top-right of the app.
 * Hidden on macOS where the OS draws the traffic-light buttons.
 *
 * Ports the legacy behaviour from
 * `lattice/src/components/layout/TopBar.tsx`:
 *   - Wraps `getCurrentWindow()` in try/catch so a pre-tauri render
 *     (or browser preview) doesn't blow up.
 *   - Listens to `onResized` so the middle button glyph swaps between
 *     Maximize and Restore as the OS reports state changes.
 *   - 46-wide buttons × 3, full header height, opaque header bg so the
 *     right-sidebar header icons sliding underneath are fully occluded.
 */

function safeWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

function detectIsMac(): boolean {
  // Works inside both the Tauri webview and a plain browser preview —
  // we don't need the plugin-os dependency just for an OS sniff.
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platformStr =
    typeof navigator.platform === "string" ? navigator.platform : "";
  return /Mac|iPhone|iPad/.test(platformStr) || /Mac OS X/.test(ua);
}

export function WindowControls() {
  const [isMaximized, setIsMaximized] = React.useState(false);
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    setIsMac(detectIsMac());

    const win = safeWindow();
    if (!win) return;

    let mounted = true;
    win.isMaximized().then((m) => {
      if (mounted) setIsMaximized(m);
    });

    const unlisten = win.onResized(async () => {
      try {
        const m = await win.isMaximized();
        if (mounted) setIsMaximized(m);
      } catch {
        // ignore
      }
    });

    return () => {
      mounted = false;
      unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  if (isMac) return null;

  const win = safeWindow();
  const minimize = () => void win?.minimize().catch(() => undefined);
  const toggleMaximize = () => void win?.toggleMaximize().catch(() => undefined);
  const close = () => void win?.close().catch(() => undefined);

  return (
    <div
      className={cn(
        "absolute top-0 right-0 z-[100] flex items-center",
        bgHeader,
      )}
      style={{ width: WIN_CONTROLS_W, height: HEADER_H }}
    >
      {/* Top-strip seam continuation (matches `.win-controls::after`). */}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute left-0 right-0 bottom-0 h-px", borderTabBg)}
      />
      <WinButton onClick={minimize} >
        <IcMinimize style={{ width: 12, height: 12 }} strokeWidth={1.5} />
      </WinButton>
      <WinButton onClick={toggleMaximize} >
        {isMaximized ? (
          <IcRestore style={{ width: 12, height: 12 }} strokeWidth={1.5} />
        ) : (
          /* Maximize is a hollow square — at 12px it visually outweighs
             the 12px minimize bar and close X (filled outline reads
             heavier than a single stroke). Drop ~2px to match. Inline
             `style` is required because the Tailwind arbitrary class
             `[width:Npx]` is not picked up at build time and the icon
             defaults to `var(--icon-md)` (16px). */
          <IcMaximize style={{ width: 10, height: 10 }} strokeWidth={1.5} />
        )}
      </WinButton>
      <WinButton onClick={close} variant="close">
        <IcClose style={{ width: 12, height: 12 }} strokeWidth={1.5} />
      </WinButton>
    </div>
  );
}

function WinButton({
  onClick,
  variant,
  children,
}: {
  onClick: () => void;
  variant?: "close";
  children: React.ReactNode;
}) {
  return (
        <Button
          variant="ghost"
          onClick={onClick}
          className={cn(
            "inline-flex shrink-0 items-center justify-center p-0 rounded-none border-0 bg-transparent",
            "w-[46px]",
            "text-[#6b6b6b] dark:text-[#8b8b8b]",
            "transition-[background,color] duration-75 active:translate-y-0",
            // Native Windows title-bar buttons have no focus ring; suppress
            // shadcn's default `focus-visible:ring-3` so they don't pick
            // one up after click.
            "focus-visible:ring-0 focus-visible:border-transparent",
            variant === "close"
              ? "hover:bg-[#c42b1c] hover:text-white"
              : "hover:bg-[#ececea] dark:hover:bg-[#2a2a2a] hover:text-[#2e2e2e] dark:hover:text-[#dcddde]",
          )}
          style={{ height: HEADER_H }}
        >
          {children}
        </Button>
  );
}
