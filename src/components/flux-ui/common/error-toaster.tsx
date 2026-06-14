import * as React from "react";
import { toast } from "sonner";

/**
 * ErrorToaster — global UI-error capture surfaced as sonner toasts.
 *
 * Listens for:
 *   • `window.error`              — synchronous uncaught exceptions
 *   • `window.unhandledrejection` — async promise rejections
 *   • `console.error`             — anything we log explicitly (so React
 *     dev-mode warnings + intentional `console.error("...")` calls also
 *     get surfaced when the UI itself can't show them)
 *
 * Each toast carries a "Copy" action that copies the full message +
 * stack to the clipboard so the user can paste it back to us when the
 * native UI is broken (which was the explicit reason for adding this).
 *
 * Mounted once at the App root — no props, no state visible to the
 * outside.
 */
export function ErrorToaster(): null {
  React.useEffect(() => {
    // ── Dedupe: identical errors fire repeatedly during a render loop.
    // Suppress same message within a 1s window.
    const lastSeen = new Map<string, number>();
    const DEDUPE_MS = 1000;

    const surface = (
      kind: "error" | "promise" | "console",
      message: string,
      stack?: string,
    ) => {
      const key = `${kind}:${message}`;
      const now = Date.now();
      const prev = lastSeen.get(key);
      if (prev && now - prev < DEDUPE_MS) return;
      lastSeen.set(key, now);

      const fullText = stack ? `${message}\n\n${stack}` : message;

      toast.error(message, {
        description:
          kind === "promise"
            ? "Unhandled promise rejection"
            : kind === "console"
              ? "console.error"
              : "Uncaught exception",
        duration: 12_000,
        action: {
          label: "Copy",
          onClick: () => {
            void navigator.clipboard
              .writeText(fullText)
              .then(() => toast.success("Copied to clipboard", { duration: 1500 }))
              .catch(() =>
                toast.warning("Clipboard write failed — open devtools to inspect", {
                  duration: 3000,
                }),
              );
          },
        },
      });
    };

    const onError = (e: ErrorEvent) => {
      const msg = e.message || (e.error?.message ?? "Unknown error");
      const stack = e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`;
      surface("error", msg, stack);
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : safeStringify(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      surface("promise", msg, stack);
    };

    // Wrap console.error so dev-mode warnings + intentional logs also
    // surface — gated by `import.meta.env.DEV` to avoid noise in
    // production builds.
    const originalConsoleError = console.error;
    const wrappedConsoleError: typeof console.error = (...args) => {
      originalConsoleError(...args);
      if (!import.meta.env.DEV) return;
      try {
        const msg = args
          .map((a) =>
            a instanceof Error ? a.message : typeof a === "string" ? a : safeStringify(a),
          )
          .join(" ");
        // Skip React's internal "Warning:" / "Validation:" noise — they
        // already render fine in devtools and would flood the toaster.
        if (msg.startsWith("Warning:") || msg.includes("componentWillMount")) return;
        const stack = args.find((a) => a instanceof Error)?.stack;
        surface("console", msg, stack);
      } catch {
        // Never let our wrapper crash console.error itself.
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    console.error = wrappedConsoleError;

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      console.error = originalConsoleError;
    };
  }, []);

  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
