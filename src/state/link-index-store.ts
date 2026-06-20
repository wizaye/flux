/**
 * Link-index store.
 *
 * Holds the vault-wide link graph + tag index — the shared source
 * of truth for the right-sidebar Backlinks / Outgoing / Tags
 * panels and the Graph view.
 *
 * Lifecycle:
 *   1. On vault open, the indexer hook calls `bulkReplace()` with
 *      the result of `scanVaultLinks()` from the Rust backend.
 *   2. The fs-watcher hook batches changed/removed paths from
 *      `flux://fs-changed` events and calls `patch()` with the
 *      result of `scanVaultLinksSubset()`. Old rows for those
 *      paths are removed before the new ones are added.
 *   3. Selectors expose the inverse maps the UI needs without
 *      re-walking the array on every render.
 *
 * Design notes:
 *   • The store keeps two materialised inverse maps
 *     (`backlinksBy`, `tagsBy`) recomputed once per mutation rather
 *     than per render — backlink lookups stay O(1).
 *   • Targets are normalised (lowercase, `.md` stripped, slash-
 *     separated) so `[[Foo]]`, `[[foo.md]]`, `[text](foo.md)`,
 *     `[other](sub/foo.md)` all match the same vault file.
 *   • Backlinks for a target match by basename OR by full
 *     normalised path, so unique notes and "two notes with the
 *     same display name" both resolve correctly.
 *   • Empty store is a valid state — selectors return empty arrays
 *     when no scan has run yet.
 */
import { create } from "zustand";

import type { LinkRef, LinkScanResult, TagRef } from "@/bindings";

export type { LinkRef, TagRef };

interface LinkIndexState {
  /** Every file path the indexer has seen (vault-relative). */
  files: Set<string>;
  /** Flat list of every outbound link. */
  links: LinkRef[];
  /** Flat list of every tag occurrence. */
  tags: TagRef[];
  /** target key (norm) → links pointing at it. */
  backlinksBy: Map<string, LinkRef[]>;
  /** tag → files using it. */
  tagsBy: Map<string, TagRef[]>;
  /** Was the store populated by at least one bulk scan? */
  hydrated: boolean;
  /** Scan currently in flight — UI can disable reindex buttons. */
  scanning: boolean;

  bulkReplace: (result: LinkScanResult) => void;
  patch: (result: LinkScanResult) => void;
  reset: () => void;
  setScanning: (scanning: boolean) => void;
}

function normalisePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function basenameNorm(p: string): string {
  const norm = normalisePath(p);
  const slash = norm.lastIndexOf("/");
  const base = slash >= 0 ? norm.slice(slash + 1) : norm;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function rebuildInverse(
  _files: Set<string>,
  links: LinkRef[],
  tags: TagRef[],
): { backlinksBy: Map<string, LinkRef[]>; tagsBy: Map<string, TagRef[]> } {
  const backlinksBy = new Map<string, LinkRef[]>();
  for (const link of links) {
    // Index under BOTH the normalised target and the basename so
    // either lookup pattern hits. Duplicates within a target's
    // bucket are deduped by `from + line + target`.
    const keys = new Set<string>();
    keys.add(link.targetNorm);
    const slash = link.targetNorm.lastIndexOf("/");
    if (slash >= 0) keys.add(link.targetNorm.slice(slash + 1));
    for (const key of keys) {
      const arr = backlinksBy.get(key);
      if (arr) arr.push(link);
      else backlinksBy.set(key, [link]);
    }
  }
  const tagsBy = new Map<string, TagRef[]>();
  for (const ref of tags) {
    const key = ref.tag.toLowerCase();
    const arr = tagsBy.get(key);
    if (arr) arr.push(ref);
    else tagsBy.set(key, [ref]);
  }
  // Pre-sort each bucket for deterministic UI ordering.
  for (const arr of backlinksBy.values()) {
    arr.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
  }
  for (const arr of tagsBy.values()) {
    arr.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
  }
  return { backlinksBy, tagsBy };
}

export const useLinkIndexStore = create<LinkIndexState>((set, get) => ({
  files: new Set(),
  links: [],
  tags: [],
  backlinksBy: new Map(),
  tagsBy: new Map(),
  hydrated: false,
  scanning: false,

  bulkReplace: (result) => {
    const files = new Set(result.files.map((p) => p.replace(/\\/g, "/")));
    const links = result.links;
    const tags = result.tags;
    const { backlinksBy, tagsBy } = rebuildInverse(files, links, tags);
    set({ files, links, tags, backlinksBy, tagsBy, hydrated: true });
  },

  patch: (result) => {
    const state = get();
    const touched = new Set(
      result.files.map((p) => p.replace(/\\/g, "/")),
    );
    // Drop existing rows whose `from` is in the touched set.
    const survivingLinks = state.links.filter((l) => !touched.has(l.from));
    const survivingTags = state.tags.filter((t) => !touched.has(t.from));

    // The result's `files` array includes paths that no longer
    // exist on disk (deletions) — they have no rows in
    // `result.links`/`result.tags`. The `survivingLinks`/`Tags`
    // filter above already removed them; nothing else to do.
    const nextLinks = [...survivingLinks, ...result.links];
    const nextTags = [...survivingTags, ...result.tags];

    const nextFiles = new Set(state.files);
    for (const p of touched) {
      // A patched path with no on-disk presence is signalled by an
      // empty contribution in result.links/tags — we can't tell
      // the difference here, so we just keep the set up-to-date
      // with EVERY scanned path. Worst case: dropped files linger
      // in `files` but contribute nothing to selectors.
      nextFiles.add(p);
    }

    const { backlinksBy, tagsBy } = rebuildInverse(
      nextFiles,
      nextLinks,
      nextTags,
    );
    set({
      files: nextFiles,
      links: nextLinks,
      tags: nextTags,
      backlinksBy,
      tagsBy,
      hydrated: true,
    });
  },

  reset: () =>
    set({
      files: new Set(),
      links: [],
      tags: [],
      backlinksBy: new Map(),
      tagsBy: new Map(),
      hydrated: false,
      scanning: false,
    }),

  setScanning: (scanning) => set({ scanning }),
}));

// ── Selectors ───────────────────────────────────────────────────────

/** Backlinks for a vault file by its full path. Matches both
 *  basename references (`[[Note]]`) and explicit-path references
 *  (`[[folder/Note]]`, `[label](folder/note.md)`). */
export function selectBacklinks(
  state: LinkIndexState,
  filePath: string | null,
): LinkRef[] {
  if (!filePath) return [];
  const norm = normalisePath(filePath);
  const noExt = norm.endsWith(".md") ? norm.slice(0, -3) : norm;
  const base = basenameNorm(filePath);
  const seen = new Set<string>();
  const out: LinkRef[] = [];
  const push = (refs: LinkRef[] | undefined) => {
    if (!refs) return;
    for (const r of refs) {
      // Skip self-references — a note that links to itself.
      if (normalisePath(r.from) === norm) continue;
      const key = `${r.from}:${r.line}:${r.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  };
  push(state.backlinksBy.get(noExt));
  if (base !== noExt) push(state.backlinksBy.get(base));
  out.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
  return out;
}

/** Outgoing links from a given file path. */
export function selectOutgoing(
  state: LinkIndexState,
  filePath: string | null,
): LinkRef[] {
  if (!filePath) return [];
  const norm = normalisePath(filePath);
  return state.links.filter((l) => normalisePath(l.from) === norm);
}

/** Tags in a given file path. */
export function selectTagsInFile(
  state: LinkIndexState,
  filePath: string | null,
): TagRef[] {
  if (!filePath) return [];
  const norm = normalisePath(filePath);
  return state.tags.filter((t) => normalisePath(t.from) === norm);
}

/** "Unlinked mentions" = files that contain the note's basename in
 *  plain prose but DON'T already link to it via wiki / md syntax.
 *  Cheap heuristic — we don't actually scan content here, we just
 *  surface every link whose `targetNorm` matches the basename but
 *  whose `from` is the active file (which can't be the case) — so
 *  it always returns an empty list today. Stub the API so we don't
 *  need to refactor consumers when full-text mention search lands.
 *
 *  (Implementing real "unlinked mention" search needs an FTS pass
 *  over file bodies — that's a follow-up wired to `search_files`.)
 */
export function selectUnlinkedMentions(
  _state: LinkIndexState,
  _filePath: string | null,
): LinkRef[] {
  return [];
}

/** Roll-up of every unique tag and its hit count. */
export function selectAllTags(
  state: LinkIndexState,
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const ref of state.tags) {
    const key = ref.tag.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
    );
}
