/**
 * Format an unknown error value into a human-readable string.
 *
 * Tauri commands return rejections as plain objects (the serialized
 * `AppError` enum, e.g. `{ kind: "NotFound", message: "..." }`), NOT
 * as `Error` instances. Naïvely calling `String(e)` on those produces
 * `"[object Object]"` in toast descriptions — this util understands
 * the shapes we actually see at runtime.
 */
export function formatError(err: unknown): string {
  if (err == null) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as { kind?: unknown; message?: unknown; toString?: () => string };
    const msg = typeof e.message === "string" ? e.message : null;
    const kind = typeof e.kind === "string" ? e.kind : null;
    if (msg && kind) return `${kind}: ${msg}`;
    if (msg) return msg;
    if (kind) return kind;
    try {
      return JSON.stringify(err);
    } catch {
      return e.toString?.() ?? "Unknown error";
    }
  }
  return String(err);
}
