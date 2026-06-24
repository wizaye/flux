/**
 * Plugin marketplace primitives.
 *
 * The marketplace itself is an external GitHub-hosted index
 * (`registry.json` per `docs/plugin-system.md` §13). This module
 * defines:
 *
 *   * the `RegistryEntry` schema community publishers conform to,
 *   * `fetchRegistry()` — GET the index from any URL,
 *   * `installFromUrl(url, opts)` — download a zip, optionally
 *     verify a sha256 digest via WebCrypto, hand the bytes to the
 *     Rust installer, refresh the plugin store.
 *
 * The user paste-installs by URL today; auto-discovery via a
 * curated index is a follow-up that just calls `fetchRegistry`
 * + renders the result.
 */
import { installPluginFromBytes, type InstallResult } from "@/bindings";
import { refreshExternalPlugins } from "./install";

/** Maximum size of a downloaded plugin payload. Mirrors the Rust
 *  `MAX_ZIP_BYTES` so a fetch that would be rejected server-side
 *  never reaches the IPC boundary. */
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export interface RegistryEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  /** Latest published version of this plugin. */
  latestVersion: string;
  /** Direct URL to the `.zip` artefact (typically a GitHub Release). */
  downloadUrl: string;
  /** Lowercase hex sha256 of `downloadUrl`. Optional but recommended. */
  sha256?: string;
  /** Repository URL the user can audit before installing. */
  repo?: string;
}

export type Registry = ReadonlyArray<RegistryEntry>;

/** Fetch the registry index from a URL. The format is a flat
 *  array of `RegistryEntry`; anything else throws so the UI can
 *  surface "the index at <url> is malformed". */
export async function fetchRegistry(url: string): Promise<Registry> {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) {
    throw new Error(
      `registry fetch failed: ${resp.status} ${resp.statusText}`,
    );
  }
  const json = (await resp.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new Error("registry: expected a top-level array of entries");
  }
  // Lightweight per-entry validation — anything missing required
  // fields is dropped with a console warn rather than tanking the
  // whole index.
  return json.filter((e): e is RegistryEntry => isRegistryEntry(e));
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.author === "string" &&
    typeof v.description === "string" &&
    typeof v.latestVersion === "string" &&
    typeof v.downloadUrl === "string"
  );
}

export interface InstallFromUrlOptions {
  /** Lowercase hex sha256 of the expected payload. When supplied,
   *  the downloaded bytes are verified via WebCrypto BEFORE being
   *  sent to Rust. Mismatch throws. */
  expectedSha256?: string;
}

/** Download a plugin zip from `url`, optionally verify its
 *  sha256, install via Rust, and refresh the plugin store. */
export async function installFromUrl(
  url: string,
  opts: InstallFromUrlOptions = {},
): Promise<InstallResult> {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) {
    throw new Error(
      `download failed: ${resp.status} ${resp.statusText}`,
    );
  }
  const ab = await resp.arrayBuffer();
  if (ab.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${ab.byteLength})`,
    );
  }
  const bytes = new Uint8Array(ab);

  if (opts.expectedSha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== opts.expectedSha256.toLowerCase()) {
      throw new Error(
        `checksum mismatch: expected ${opts.expectedSha256}, got ${actual}`,
      );
    }
  }

  const result = await installPluginFromBytes(bytes);
  await refreshExternalPlugins();
  return result;
}

/** Compute the lowercase hex sha256 of a byte buffer using
 *  WebCrypto. Works in every modern browser + the Tauri webview. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // SubtleCrypto wants a plain ArrayBuffer (not a SharedArrayBuffer-
  // typed view); the cast below is safe because `fetch().arrayBuffer()`
  // always returns a plain ArrayBuffer in browser + webview.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
