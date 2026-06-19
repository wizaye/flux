/**
 * Vault-scoped bookmark store with optional titles and groups.
 *
 * Each bookmark is a richer entry than the original flat-id list:
 *   { id, title?, group? }
 *
 * Persistence is still localStorage keyed by vault path, but the
 * stored shape is now `{ entries: BookmarkEntry[], groups: string[] }`.
 * Older flat-id JSON ("['/foo.md', ...]") is migrated on read so
 * existing users keep their bookmarks.
 *
 * Why localStorage and not the SQLite index DB:
 *   • Bookmarks are tiny (paths + titles) and pre-vault — no need
 *     to marshal through Rust IPC.
 *   • Survives vault re-open without an index rebuild.
 *   • A future sync plugin can read/write a single JSON blob.
 */
import { create } from "zustand";
import { useVaultStore } from "./vault-store";

const LS_PREFIX = "flux.bookmarks.";
const MOCK_VAULT_KEY = "<mock>";

export interface BookmarkEntry {
  /** Vault-relative file path (the canonical identifier). */
  id: string;
  /** Optional display label. Defaults to the file's stem. */
  title?: string;
  /** Optional group name — empty / undefined means "Untitled group". */
  group?: string;
}

interface PersistedShape {
  entries: BookmarkEntry[];
  groups: string[];
}

function storageKeyFor(vaultPath: string): string {
  return LS_PREFIX + encodeURIComponent(vaultPath || MOCK_VAULT_KEY);
}

function loadFor(vaultPath: string): PersistedShape {
  if (typeof localStorage === "undefined") return { entries: [], groups: [] };
  try {
    const raw = localStorage.getItem(storageKeyFor(vaultPath));
    if (!raw) return { entries: [], groups: [] };
    const parsed: unknown = JSON.parse(raw);
    // Legacy: stored as a flat string[] — migrate to entries.
    if (Array.isArray(parsed)) {
      const entries = parsed
        .filter((s): s is string => typeof s === "string")
        .map((id) => ({ id }));
      return { entries, groups: [] };
    }
    // Current shape.
    if (parsed && typeof parsed === "object" && "entries" in parsed) {
      const obj = parsed as Partial<PersistedShape>;
      const entries = Array.isArray(obj.entries) ? obj.entries.filter(isEntry) : [];
      const groups = Array.isArray(obj.groups)
        ? obj.groups.filter((g): g is string => typeof g === "string")
        : [];
      return { entries, groups };
    }
    return { entries: [], groups: [] };
  } catch {
    return { entries: [], groups: [] };
  }
}

function isEntry(x: unknown): x is BookmarkEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Partial<BookmarkEntry>;
  return typeof o.id === "string";
}

function saveFor(vaultPath: string, data: PersistedShape): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKeyFor(vaultPath), JSON.stringify(data));
  } catch {
    /* quota — ignore */
  }
}

interface BookmarksState extends PersistedShape {
  /** Reload from localStorage for the currently-open vault. */
  reload: () => void;
  /** Whether the file is bookmarked (ignoring title / group). */
  has: (fileId: string) => boolean;
  /** Add or update a bookmark. */
  upsert: (entry: BookmarkEntry) => void;
  /** Remove a bookmark by file id. */
  remove: (fileId: string) => void;
  /** Convenience — add if missing, remove if present. */
  toggle: (fileId: string) => boolean;
  /** Rewrite a stored id (rename / move) without losing metadata. */
  rename: (oldId: string, newId: string) => void;
  /** Add or remove a group. Removing a group leaves orphan entries
   *  in the "Untitled group" bucket. */
  addGroup: (name: string) => void;
  removeGroup: (name: string) => void;
}

const currentVaultPath = (): string =>
  useVaultStore.getState().vaultHandle?.path ?? "";

export const useBookmarksStore = create<BookmarksState>((set, get) => {
  const initial = loadFor(currentVaultPath());
  return {
    entries: initial.entries,
    groups: initial.groups,

    reload: () => {
      const data = loadFor(currentVaultPath());
      set({ entries: data.entries, groups: data.groups });
    },

    has: (fileId) => get().entries.some((e) => e.id === fileId),

    upsert: (entry) => {
      const vp = currentVaultPath();
      set((s) => {
        const idx = s.entries.findIndex((e) => e.id === entry.id);
        const next =
          idx === -1
            ? [...s.entries, entry]
            : s.entries.map((e, i) => (i === idx ? { ...e, ...entry } : e));
        // If a brand-new group was provided, persist it too.
        const groups =
          entry.group && !s.groups.includes(entry.group)
            ? [...s.groups, entry.group]
            : s.groups;
        saveFor(vp, { entries: next, groups });
        return { entries: next, groups };
      });
    },

    remove: (fileId) => {
      const vp = currentVaultPath();
      set((s) => {
        const next = s.entries.filter((e) => e.id !== fileId);
        saveFor(vp, { entries: next, groups: s.groups });
        return { entries: next };
      });
    },

    toggle: (fileId) => {
      const has = get().has(fileId);
      if (has) get().remove(fileId);
      else get().upsert({ id: fileId });
      return !has;
    },

    rename: (oldId, newId) => {
      const vp = currentVaultPath();
      set((s) => {
        if (!s.entries.some((e) => e.id === oldId)) return s;
        const next = s.entries.map((e) =>
          e.id === oldId ? { ...e, id: newId } : e,
        );
        saveFor(vp, { entries: next, groups: s.groups });
        return { entries: next };
      });
    },

    addGroup: (name) => {
      const vp = currentVaultPath();
      const trimmed = name.trim();
      if (!trimmed) return;
      set((s) => {
        if (s.groups.includes(trimmed)) return s;
        const next = [...s.groups, trimmed];
        saveFor(vp, { entries: s.entries, groups: next });
        return { groups: next };
      });
    },

    removeGroup: (name) => {
      const vp = currentVaultPath();
      set((s) => {
        const next = s.groups.filter((g) => g !== name);
        // Orphan entries — clear their `group` so they show under
        // "Untitled group" instead of pointing at a stale name.
        const cleared = s.entries.map((e) =>
          e.group === name ? { ...e, group: undefined } : e,
        );
        saveFor(vp, { entries: cleared, groups: next });
        return { entries: cleared, groups: next };
      });
    },
  };
});

// Auto-reload bookmarks when the user switches vaults.
if (typeof window !== "undefined") {
  let lastPath = currentVaultPath();
  useVaultStore.subscribe((s) => {
    const next = s.vaultHandle?.path ?? "";
    if (next !== lastPath) {
      lastPath = next;
      useBookmarksStore.getState().reload();
    }
  });
}

// ── Convenience selector ────────────────────────────────────────────
/** Group entries by their `group` field for the sidebar tree.
 *  Takes only the data slice (not the full store) so callers can
 *  pass `{ entries, groups }` from `useMemo` without subscribing to
 *  the entire store (which would trigger React's
 *  "getSnapshot should be cached" infinite loop). */
export function selectBookmarksByGroup(
  state: Pick<BookmarksState, "entries" | "groups">,
): Array<{ name: string; entries: BookmarkEntry[] }> {
  const buckets = new Map<string, BookmarkEntry[]>();
  for (const e of state.entries) {
    const key = e.group?.trim() || "";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }
  // Stable ordering: predefined groups in store order, "Untitled
  // group" last (only if it has items), then any extra groups
  // referenced by entries but missing from `state.groups`.
  const out: Array<{ name: string; entries: BookmarkEntry[] }> = [];
  for (const g of state.groups) {
    out.push({ name: g, entries: buckets.get(g) ?? [] });
    buckets.delete(g);
  }
  const untitled = buckets.get("") ?? [];
  buckets.delete("");
  for (const [name, entries] of buckets) {
    out.push({ name, entries });
  }
  if (untitled.length > 0 || state.groups.length === 0) {
    out.push({ name: "", entries: untitled });
  }
  return out;
}
