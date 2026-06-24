/**
 * Cross-platform path-join helper for vault paths shown to the user
 * and sent across the IPC boundary.
 *
 * The Tauri folder-dialog returns an absolute path using the host
 * OS separator (`C:\Users\vijay` on Windows, `/home/vijay` on
 * Linux / macOS). Naïvely concatenating with `/` produced mixed
 * separators like `C:\Users\vijay/MyVault`, which the backend's
 * `canonicalise_rel` normalised silently — but the user still saw
 * the ugly preview and the "Vault will be created at" line.
 *
 * We pick a separator based on the parent path's existing one:
 *   • Path contains `\` and no `/` → use `\`.
 *   • Otherwise → `/` (universal — Rust / Node both accept it on
 *     Windows too).
 *
 * The helper also collapses a trailing separator so
 * `joinVaultPath("/home/vijay/", "Notes")` is `/home/vijay/Notes`
 * (not `/home/vijay//Notes`).
 */
export function joinVaultPath(parent: string, name: string): string {
  if (!parent) return name;
  if (!name) return parent;

  const useBackslash = parent.includes("\\") && !parent.includes("/");
  const sep = useBackslash ? "\\" : "/";
  const trimmed = parent.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${name}`;
}

/**
 * Characters Windows / macOS / Linux can't (or shouldn't) have in a
 * folder name, plus path separators. Used by the vault picker to
 * fail fast with a friendly toast instead of letting the backend
 * surface a cryptic OS error.
 *
 * Returns the offending characters so the message can list them.
 */
const VAULT_NAME_FORBIDDEN_CHARS = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"];

export function invalidVaultNameChars(name: string): string[] {
  const hit = new Set<string>();
  for (const ch of name) {
    if (VAULT_NAME_FORBIDDEN_CHARS.includes(ch)) hit.add(ch);
  }
  return Array.from(hit);
}
