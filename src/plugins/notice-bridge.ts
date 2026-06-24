/**
 * Bridges plugin-fired `flux-plugin-notice` window events into the
 * host's sonner toaster. Mounted once near the `<Toaster/>` so
 * every enabled plugin's `host.workspace.showNotice(...)` call
 * lands in the same notification stack the rest of the app uses.
 *
 * Contract — the SDK fires:
 *
 *   window.dispatchEvent(
 *     new CustomEvent("flux-plugin-notice", {
 *       detail: { pluginId, title, message?, tone? },
 *     })
 *   );
 *
 * Tone values map 1:1 to sonner variants. Unknown / missing tone
 * falls through to the default toast so a misbehaving plugin
 * cannot silently lose its message.
 */
import * as React from "react";
import { toast } from "sonner";

type Tone = "info" | "success" | "warning" | "error";

interface PluginNoticeDetail {
  pluginId?: string;
  title?: string;
  message?: string;
  tone?: Tone | string | null;
}

function isPluginNoticeDetail(value: unknown): value is PluginNoticeDetail {
  return typeof value === "object" && value !== null;
}

export function usePluginNoticeBridge(): void {
  React.useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<unknown>;
      if (!isPluginNoticeDetail(ce.detail)) return;
      const { title, message, tone } = ce.detail;
      // Empty title is treated as "no toast" so a plugin can't
      // spam blank popovers by passing an empty payload.
      if (!title || typeof title !== "string") return;
      const opts = message ? { description: message } : undefined;
      switch (tone) {
        case "success":
          toast.success(title, opts);
          return;
        case "warning":
          toast.warning(title, opts);
          return;
        case "error":
          toast.error(title, opts);
          return;
        case "info":
        default:
          toast(title, opts);
      }
    };
    window.addEventListener("flux-plugin-notice", handler as EventListener);
    return () => {
      window.removeEventListener(
        "flux-plugin-notice",
        handler as EventListener,
      );
    };
  }, []);
}
