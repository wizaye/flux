/**
 * Global vault search panel — Obsidian-style layout.
 *
 * Walks every text file in the vault, finds matching lines, groups
 * them by file. Clicking a result opens the file at that line. The
 * search runs against the live vault cache (`openFiles`) plus mock
 * inline content; for a real vault the first search lazily warms
 * the cache by reading each file from disk in parallel.
 *
 * UI layout (image-mapped to Obsidian's `Search` panel):
 *   • Rounded input shell with inline `Aa` toggle + clear (×) and
 *     a "show options" icon-button to the right that reveals the
 *     `ab` (whole-word) and `.*` (regex) toggles.
 *   • Three display-mode switches: collapse results, show more
 *     context.
 *   • Status line: result count on the left, sort dropdown on right.
 *   • Result list: each file is a collapsible group with file
 *     icon + name + match count chip; each match is a snippet card
 *     with highlighted hit + line number.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IcSearch,
  IcChevronDown,
  IcFile,
  IcClose,
  IcSliders,
} from "@/components/flux-ui/common/icons";
import { textNormal, textMuted, textFaint } from "@/lib/lattice-tokens";
import { useVaultStore } from "@/state/vault-store";
import type { FileNode } from "@/state/editor";
import { isTauri, readFile, searchFiles, type SearchHit } from "@/bindings";

interface Match {
  /** 1-based line number for display. */
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface FileHit {
  fileId: string;
  fileName: string;
  matches: Match[];
}

type SortKey =
  | "name-asc"
  | "name-desc"
  | "mtime-desc"
  | "mtime-asc"
  | "ctime-desc"
  | "ctime-asc"
  | "matches-desc";

const SORT_LABELS: Record<SortKey, string> = {
  "name-asc": "File name (A to Z)",
  "name-desc": "File name (Z to A)",
  "mtime-desc": "Modified time (new to old)",
  "mtime-asc": "Modified time (old to new)",
  "ctime-desc": "Created time (new to old)",
  "ctime-asc": "Created time (old to new)",
  "matches-desc": "Match count",
};

/** Files and folders that must NEVER appear in search results. */
function isExcludedPath(id: string): boolean {
  const parts = id.split(/[\\/]+/).filter(Boolean);
  for (const p of parts) {
    if (p === ".zenvault") return true;
    if (p === ".obsidian") return true;
    if (p === ".git") return true;
    if (p === "node_modules") return true;
    if (p === ".DS_Store") return true;
    if (p === "Thumbs.db") return true;
    if (p.startsWith(".") && p.length > 1) return true;
  }
  if (/\.(png|jpg|jpeg|gif|webp|svg|pdf|mp3|mp4|mov|zip|gz|tar)$/i.test(id)) {
    return true;
  }
  return false;
}

function flatten(
  tree: FileNode[],
  loaded: Map<string, string>,
): Array<{ id: string; name: string; content: string }> {
  const out: Array<{ id: string; name: string; content: string }> = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (isExcludedPath(n.id)) continue;
      if (n.kind === "file") {
        const live = loaded.get(n.id);
        const content = live ?? n.content ?? "";
        if (content) out.push({ id: n.id, name: n.name, content });
      }
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

function flattenAllFiles(
  tree: FileNode[],
): Array<{ id: string; content: string }> {
  const out: Array<{ id: string; content: string }> = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (isExcludedPath(n.id)) continue;
      if (n.kind === "file") out.push({ id: n.id, content: n.content ?? "" });
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

/** Decode an FTS5 `snippet()` result back into the `Match` shape the
 *  result-card renderer expects. The Rust side wraps each match in
 *  `<mark>…</mark>`; we strip the tags and record the byte range so
 *  the same highlighter that handles the JS scanner can render it.
 *  Line number is unknown (FTS doesn't track it) — show 1 as a
 *  placeholder; clicking still opens the file. */
function ftsHitToMatches(hit: SearchHit): Match[] {
  const raw = hit.snippet;
  const open = raw.indexOf("<mark>");
  if (open < 0) {
    return [{ line: 1, text: raw, matchStart: 0, matchEnd: 0 }];
  }
  const close = raw.indexOf("</mark>", open);
  if (close < 0) {
    return [{ line: 1, text: raw, matchStart: 0, matchEnd: 0 }];
  }
  const before = raw.slice(0, open);
  const match = raw.slice(open + 6, close);
  const after = raw.slice(close + 7);
  const text = before + match + after;
  return [
    {
      line: 1,
      text,
      matchStart: before.length,
      matchEnd: before.length + match.length,
    },
  ];
}

function scanFile(
  body: string,
  needle: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
  maxPerFile = 50,
): Match[] {
  if (!needle) return [];
  const lines = body.split(/\r?\n/);
  const out: Match[] = [];
  let re: RegExp;
  try {
    if (useRegex) {
      re = new RegExp(needle, caseSensitive ? "g" : "gi");
    } else {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
      re = new RegExp(pattern, caseSensitive ? "g" : "gi");
    }
  } catch {
    return [];
  }
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({
        line: i + 1,
        text,
        matchStart: m.index,
        matchEnd: m.index + m[0].length,
      });
      if (out.length >= maxPerFile) return out;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

export function VaultSearchPanel() {
  const fileTree = useVaultStore((s) => s.fileTree);
  const openFiles = useVaultStore((s) => s.openFiles);
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);

  const [query, setQuery] = React.useState("");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [useRegex, setUseRegex] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [collapseResults, setCollapseResults] = React.useState(false);
  const [showMoreContext, setShowMoreContext] = React.useState(false);
  const [explainTerms, setExplainTerms] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<SortKey>("name-asc");
  const [results, setResults] = React.useState<FileHit[]>([]);
  const [scanning, setScanning] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ initialQuery?: string }>).detail;
      if (detail?.initialQuery !== undefined) setQuery(detail.initialQuery);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("flux-focus-search", handler as EventListener);
    return () =>
      window.removeEventListener("flux-focus-search", handler as EventListener);
  }, []);

  React.useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setScanning(false);
      return;
    }
    let cancelled = false;
    setScanning(true);
    const t = setTimeout(async () => {
      // ── Native FTS5 path (real vault in Tauri) ─────────────────
      // BM25-ranked snippets come back pre-highlighted with <mark>,
      // which we strip + re-locate so the existing match-card
      // renderer keeps working without an HTML-in-React detour.
      if (isVaultOpen && isTauri) {
        try {
          const ftsHits = await searchFiles(query, 200);
          if (cancelled) return;
          const hits: FileHit[] = ftsHits.map((h: SearchHit) => {
            const m = ftsHitToMatches(h);
            return {
              fileId: h.relativePath,
              fileName:
                h.relativePath.split(/[\\/]/).pop() ?? h.relativePath,
              matches: m,
            };
          });
          setResults(hits);
          setScanning(false);
          return;
        } catch (err) {
          console.warn("[search] FTS query failed, falling back:", err);
          // fall through to the JS scanner below
        }
      }
      // ── JS scanner fallback (browser preview / FTS error) ──────
      const candidates = flattenAllFiles(fileTree);
      if (isVaultOpen && isTauri) {
        await Promise.all(
          candidates.map(async (f) => {
            if (openFiles.has(f.id) || f.content) return;
            try {
              const body = await readFile(f.id);
              useVaultStore.getState().setFileContent(f.id, body);
            } catch {
              /* skip unreadable */
            }
          }),
        );
      }
      if (cancelled) return;
      const fresh = flatten(
        useVaultStore.getState().fileTree,
        useVaultStore.getState().openFiles,
      );
      const hits: FileHit[] = [];
      for (const f of fresh) {
        const matches = scanFile(
          f.content,
          query,
          caseSensitive,
          useRegex,
          wholeWord,
        );
        if (matches.length > 0) {
          hits.push({ fileId: f.id, fileName: f.name, matches });
        }
      }
      if (!cancelled) {
        setResults(hits);
        setScanning(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, caseSensitive, wholeWord, useRegex, fileTree, openFiles, isVaultOpen]);

  const sorted = React.useMemo(() => {
    const list = [...results];
    if (sortBy === "name-asc") {
      list.sort((a, b) => a.fileName.localeCompare(b.fileName));
    } else if (sortBy === "name-desc") {
      list.sort((a, b) => b.fileName.localeCompare(a.fileName));
    } else if (sortBy === "matches-desc") {
      list.sort((a, b) => b.matches.length - a.matches.length);
    } else {
      // Modified/Created time — fileTree doesn't carry timestamps
      // yet, so fall back to alphabetical until the Tauri side wires
      // mtime/ctime into FileNode. Keeps the UI useful and the
      // option list complete for parity with Obsidian.
      list.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }
    return list;
  }, [results, sortBy]);

  const totalMatches = React.useMemo(
    () => results.reduce((sum, r) => sum + r.matches.length, 0),
    [results],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Search box: shadcn InputGroup with leading search icon,
          inline Aa (match-case), clear (×), and a trailing settings
          icon-button. Row height matches the 30px toolbar slot used
          by the Files panel so all three left-sidebar views align
          vertically. */}
      <div className="flex items-center gap-1 h-[30px] px-2 shrink-0">
        <InputGroup className="h-7 flex-1">
          <InputGroupAddon align="inline-start">
            <IcSearch className="[width:12px] [height:12px] opacity-60" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="text-[12px]"
          />
          <InputGroupAddon align="inline-end" className="gap-0.5">
            <InlineToggle
              label="Aa"
              title="Match case"
              active={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            />
            {query && (
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <IcClose className="[width:11px] [height:11px]" />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        <button
          type="button"
          title="Search settings"
          aria-pressed={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
          className={cn(
            "shrink-0 h-7 w-7 rounded-md flex items-center justify-center transition-colors",
            showAdvanced
              ? "bg-[var(--text-link)]/15 text-[var(--text-link)]"
              : "text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text-normal)]",
          )}
        >
          <IcSliders className="[width:14px] [height:14px]" />
        </button>
      </div>

      {/* ── Options panel — only when the settings icon is toggled ── */}
      {showAdvanced && (
        <div className="px-3 py-1.5 space-y-1">
          <div className="flex items-center gap-2 pb-1">
            <InlineToggle
              label="ab"
              title="Whole word"
              active={wholeWord}
              onClick={() => setWholeWord((v) => !v)}
            />
            <InlineToggle
              label=".*"
              title="Use regex"
              active={useRegex}
              onClick={() => setUseRegex((v) => !v)}
            />
          </div>
          <RowSwitch
            label="Collapse results"
            checked={collapseResults}
            onChange={setCollapseResults}
          />
          <RowSwitch
            label="Show more context"
            checked={showMoreContext}
            onChange={setShowMoreContext}
          />
          <RowSwitch
            label="Explain search terms"
            checked={explainTerms}
            onChange={setExplainTerms}
          />
        </div>
      )}

      {/* ── Status + sort ── */}
      {query.trim() && (
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
          <span>
            {scanning
              ? "Searching…"
              : totalMatches === 0
                ? "No results"
                : `${totalMatches} result${totalMatches === 1 ? "" : "s"}`}
          </span>
          {totalMatches > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-normal)] cursor-pointer outline-none"
                >
                  {SORT_LABELS[sortBy]}
                  <IcChevronDown className="[width:10px] [height:10px] opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px]">
                <DropdownMenuRadioGroup
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as SortKey)}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[])
                    .filter((k) => k !== "matches-desc")
                    .map((k) => (
                      <DropdownMenuRadioItem key={k} value={k}>
                        {SORT_LABELS[k]}
                      </DropdownMenuRadioItem>
                    ))}
                  <DropdownMenuRadioItem value="matches-desc">
                    {SORT_LABELS["matches-desc"]}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* ── Results ── */}
      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!min-w-0 [&>[data-slot=scroll-area-viewport]>div]:!w-full">
        {!query.trim() ? (
          <div
            className={cn(
              "flex flex-col items-center gap-2 px-4 py-6 text-center",
              textMuted,
            )}
          >
            <IcSearch className="[width:var(--icon-lg)] [height:var(--icon-lg)] opacity-50" />
            <p className="text-[12px]">
              Search every note in the vault. Tap the sliders icon for
              match-case, regex and display options.
            </p>
          </div>
        ) : sorted.length === 0 && !scanning ? (
          <p className={cn("text-[12px] italic px-3 py-3", textFaint)}>
            No matches for <span className="font-mono">"{query}"</span>.
          </p>
        ) : (
          <ul className="px-1 pb-2 flex flex-col min-w-0">
            {sorted.map((hit) => (
              <FileResultGroup
                key={hit.fileId}
                hit={hit}
                showMoreContext={showMoreContext}
                forceCollapsed={collapseResults}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function FileResultGroup({
  hit,
  showMoreContext,
  forceCollapsed,
}: {
  hit: FileHit;
  showMoreContext: boolean;
  forceCollapsed: boolean;
}) {
  const [openLocal, setOpenLocal] = React.useState(true);
  // When the global "Collapse results" toggle flips on, force all
  // groups closed; flipping it off restores per-group local state.
  React.useEffect(() => {
    if (forceCollapsed) setOpenLocal(false);
  }, [forceCollapsed]);
  const open = forceCollapsed ? false : openLocal;
  return (
    <li className="flex flex-col mb-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpenLocal((v) => !v)}
        className={cn(
          "group flex w-full min-w-0 items-center gap-1.5 h-7 px-1.5 rounded-[4px] text-[12px] select-none cursor-pointer",
          "font-medium",
          textNormal,
          "hover:bg-[var(--hover)]",
        )}
        title={hit.fileId}
      >
        <IcChevronDown
          className={cn(
            "[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0 transition-transform",
            !open && "-rotate-90",
          )}
        />
        <IcFile className="[width:var(--icon-sm)] [height:var(--icon-sm)] shrink-0 opacity-70" />
        <span className="truncate flex-1 min-w-0">
          {hit.fileName.replace(/\.md$/i, "")}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-full",
            "bg-[var(--hover)] text-[var(--text-faint)]",
            "group-hover:bg-[var(--text-link)]/15 group-hover:text-[var(--text-link)]",
          )}
        >
          {hit.matches.length}
        </span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1 pl-2.5 pr-1 py-1 min-w-0">
          {hit.matches.map((m, i) => (
            <MatchCard
              key={`${hit.fileId}:${m.line}:${i}`}
              fileId={hit.fileId}
              match={m}
              showMoreContext={showMoreContext}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MatchCard({
  fileId,
  match,
  showMoreContext,
}: {
  fileId: string;
  match: Match;
  showMoreContext: boolean;
}) {
  // Context window — narrower by default (Obsidian-style snippet);
  // widens to a generous slice when the user enables "Show more
  // context".
  const PREVIEW_CONTEXT = showMoreContext ? 80 : 30;
  const start = Math.max(0, match.matchStart - PREVIEW_CONTEXT);
  const end = Math.min(match.text.length, match.matchEnd + PREVIEW_CONTEXT);
  const leftEllipsis = start > 0 ? "…" : "";
  const rightEllipsis = end < match.text.length ? "…" : "";
  const before = match.text.slice(start, match.matchStart);
  const hit = match.text.slice(match.matchStart, match.matchEnd);
  const after = match.text.slice(match.matchEnd, end);

  return (
    <li
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("flux-open-file", {
            detail: { fileId, line: match.line },
          }),
        );
      }}
      className={cn(
        "cursor-pointer rounded-md px-2 py-1.5 text-[11.5px] leading-snug min-w-0",
        "border border-transparent hover:border-[var(--border-strong)] hover:bg-[var(--hover)]",
        textMuted,
      )}
      title={`${fileId}:${match.line}`}
    >
      <div className="font-mono break-words whitespace-pre-wrap min-w-0">
        {leftEllipsis}
        {before}
        <mark
          className="rounded-[2px] px-0.5"
          style={{
            background: "rgba(127, 109, 242, 0.30)",
            color: "var(--text-normal)",
          }}
        >
          {hit}
        </mark>
        {after}
        {rightEllipsis}
      </div>
    </li>
  );
}

/** Tiny labelled toggle used inside the search bar (Aa / ab / .*). */
function InlineToggle({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-5 px-1.5 rounded-[4px] text-[11px] font-mono select-none cursor-pointer transition-colors shrink-0",
        active
          ? "bg-[var(--text-link)]/15 text-[var(--text-link)]"
          : "text-[var(--text-muted)] hover:bg-[var(--hover)]",
      )}
    >
      {label}
    </button>
  );
}

/** Labelled row with a shadcn Switch on the right — matches the
 *  Obsidian search-panel "Collapse results", "Show more context",
 *  "Explain search terms" toggles. */
function RowSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 h-6 cursor-pointer select-none text-[11.5px] text-[var(--text-normal)]">
      <span className="flex-1">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
