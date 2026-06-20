import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IcLink,
  IcLinkOff,
  IcList,
  IcTag,
} from "@/components/flux-ui/common/icons";
import {
  bgHeader,
  bgSidebar,
  borderTabBg,
  textMuted,
  textNormal,
  textFaint,
} from "@/lib/lattice-tokens";
import { HEADER_H, WIN_CONTROLS_W } from "@/lib/layout-constants";
import { useTabSyncStore } from "@/state/tab-sync-store";
import { useVaultStore } from "@/state/vault-store";
import {
  useLinkIndexStore,
  selectAllTags,
  selectBacklinks,
  selectOutgoing,
  selectTagsInFile,
  type LinkRef,
  type TagRef,
} from "@/state/link-index-store";

/**
 * Right sidebar — renders the 5 view-switcher tabs in the header, then
 * the per-view body (stub panels for now).
 *
 * OS-conditional rendering (mirrors lattice/src/components/layout/RightSidebar.tsx):
 *  - Windows / Linux: header pads `paddingRight: var(--win-controls-w)`
 *    (= 138 px) so the tabs never slip beneath the floating min / max /
 *    close cluster. The header also has `overflow: hidden` so anything
 *    spilling stops at the padding box.
 *  - macOS: no header padding — tabs reach the rightmost edge.
 *
 * Layout order: tabs cluster on the LEFT, drag-region fills the rest
 * on the RIGHT. The tabs cluster uses its own `overflow: hidden` +
 * `min-w-0` wrapper so the icons stop at the content edge instead of
 * spilling into the reserved win-controls padding.
 */

export type RightView = "links" | "outgoing" | "tags" | "outline";

interface RightSidebarProps {
  view: RightView;
  onChangeView: (view: RightView) => void;
  isMac: boolean;
}

const HEADER_TABS: Array<{ id: RightView; label: string; Icon: React.ComponentType<React.SVGAttributes<SVGElement>> }> = [
  { id: "links", label: "Backlinks", Icon: IcLink },
  { id: "outgoing", label: "Outgoing Links", Icon: IcLinkOff },
  { id: "tags", label: "Tags", Icon: IcTag },
  { id: "outline", label: "Outline", Icon: IcList },
];

export function RightSidebar({ view, onChangeView, isMac }: RightSidebarProps) {
  return (
    <div className={cn("flex h-full w-full flex-col", bgSidebar)}>
      <Header view={view} onChangeView={onChangeView} isMac={isMac} />
      <Body view={view} />
    </div>
  );
}

interface HeaderProps {
  view: RightView;
  onChangeView: (view: RightView) => void;
  isMac: boolean;
}

function Header({ view, onChangeView, isMac }: HeaderProps) {
  return (
    <div
      className={cn(
        "relative flex items-center shrink-0 gap-[2px] px-1.5 overflow-hidden",
        bgHeader,
      )}
      style={{
        height: HEADER_H,
        paddingRight: isMac ? undefined : WIN_CONTROLS_W,
      }}
      data-tauri-drag-region
    >
      {/* Tabs cluster — LEFT-aligned, clips its own overflow so icons
          can't bleed into the reserved win-controls padding. */}
      <div className="flex items-center gap-[2px] shrink min-w-0 overflow-hidden">
        {HEADER_TABS.map(({ id, label, Icon }) => (
          <IconButton
            key={id}
            active={view === id}
            tooltip={label}
            tooltipSide="bottom"
            data-tauri-drag-region={false}
            onClick={() => onChangeView(id)}
          >
            <Icon />
          </IconButton>
        ))}
      </div>
      {/* Drag region fills the remaining space on the right */}
      <div className="flex-1 h-full" data-tauri-drag-region />
      {/* Top-strip seam */}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute left-0 right-0 bottom-0 h-px", borderTabBg)}
      />
    </div>
  );
}

function Body({ view }: { view: RightView }) {
  // Active file drives every panel. When no note is open we still
  // render the panel chrome + an empty state so the layout doesn't
  // jump.
  const activeFile = useTabSyncStore((s) => s.activeFile);
  const activeFileId = activeFile?.fileId ?? null;
  const activeTitle = activeFile?.title ?? null;

  if (view === "links") return <BacklinksPanel fileId={activeFileId} title={activeTitle} />;
  if (view === "outgoing") return <OutgoingPanel fileId={activeFileId} />;
  if (view === "tags") return <TagsPanel fileId={activeFileId} />;
  return <OutlinePanel fileId={activeFileId} />;
}

// ── Backlinks ─────────────────────────────────────────────────────

function BacklinksPanel({
  fileId,
  title,
}: {
  fileId: string | null;
  title: string | null;
}) {
  // Subscribe to a STABLE slice — `selectBacklinks` would build a
  // new array every render; Zustand caches the inverse map for us
  // so we pull that and run the selector in `useMemo`.
  const backlinksBy = useLinkIndexStore((s) => s.backlinksBy);
  const hydrated = useLinkIndexStore((s) => s.hydrated);
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const refs = React.useMemo(
    () =>
      selectBacklinks(
        { ...emptyState, backlinksBy, hydrated } as never,
        fileId,
      ),
    [backlinksBy, hydrated, fileId],
  );
  const grouped = React.useMemo(() => groupByFrom(refs), [refs]);

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        <Section title="Backlinks">
          <Stats backlinks={refs.length} unlinked={0} pages={grouped.length} />
          {!fileId ? (
            <Empty label="Open a note to see backlinks." />
          ) : !isVaultOpen ? (
            <Empty label="Open a vault to enable the link index." />
          ) : !hydrated ? (
            <Empty label="Building link index…" />
          ) : refs.length === 0 ? (
            <Empty
              label={
                title
                  ? `No notes link to "${title}" yet.`
                  : "No backlinks for the current note."
              }
            />
          ) : (
            <ul className="flex flex-col">
              {grouped.map((g) => (
                <FileGroup
                  key={g.from}
                  fromPath={g.from}
                  refs={g.refs}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </ScrollArea>
  );
}

// ── Outgoing ──────────────────────────────────────────────────────

function OutgoingPanel({ fileId }: { fileId: string | null }) {
  const links = useLinkIndexStore((s) => s.links);
  const hydrated = useLinkIndexStore((s) => s.hydrated);
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const refs = React.useMemo(
    () =>
      selectOutgoing(
        { ...emptyState, links, hydrated } as never,
        fileId,
      ),
    [links, hydrated, fileId],
  );
  const grouped = React.useMemo(() => groupByTarget(refs), [refs]);
  // Resolve each `targetNorm` to a real vault path so clicking
  // jumps to the right file. Fall back to opening by basename
  // search via the open-file event (the host's vault tree
  // resolver handles unresolved names by no-op).
  const vault = useVaultStore((s) => s.fileTree);
  const targetIndex = React.useMemo(() => buildBasenameIndex(vault), [vault]);

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        <Section title="Outgoing Links">
          <Stats backlinks={refs.length} unlinked={0} pages={grouped.length} />
          {!fileId ? (
            <Empty label="Open a note to see its outgoing links." />
          ) : !isVaultOpen ? (
            <Empty label="Open a vault to enable the link index." />
          ) : !hydrated ? (
            <Empty label="Building link index…" />
          ) : refs.length === 0 ? (
            <Empty label="No outgoing links from this note." />
          ) : (
            <ul className="flex flex-col">
              {grouped.map((g) => (
                <OutgoingRow
                  key={g.key}
                  targetNorm={g.key}
                  targetDisplay={g.display}
                  count={g.refs.length}
                  resolved={targetIndex.get(g.key) ?? null}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </ScrollArea>
  );
}

// ── Tags ──────────────────────────────────────────────────────────

function TagsPanel({ fileId }: { fileId: string | null }) {
  const tags = useLinkIndexStore((s) => s.tags);
  const tagsBy = useLinkIndexStore((s) => s.tagsBy);
  const hydrated = useLinkIndexStore((s) => s.hydrated);

  const inFile = React.useMemo(
    () =>
      selectTagsInFile({ ...emptyState, tags, hydrated } as never, fileId),
    [tags, hydrated, fileId],
  );
  const all = React.useMemo(
    () => selectAllTags({ ...emptyState, tags } as never),
    [tags],
  );
  const [openTag, setOpenTag] = React.useState<string | null>(null);

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        <Section title="Tags in this note">
          {!fileId ? (
            <Empty label="Open a note to see its tags." />
          ) : inFile.length === 0 ? (
            <Empty label="No tags in this note." />
          ) : (
            <div className="flex flex-wrap gap-1 px-3 pb-1">
              {uniqueTags(inFile).map((t) => (
                <TagChip
                  key={t}
                  tag={t}
                  active={openTag === t}
                  onClick={() =>
                    setOpenTag((cur) => (cur === t ? null : t))
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="All tags">
          {!hydrated ? (
            <Empty label="Building tag index…" />
          ) : all.length === 0 ? (
            <Empty label="No tags in this vault." />
          ) : (
            <div className="flex flex-wrap gap-1 px-3 pb-1">
              {all.map(({ tag, count }) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  count={count}
                  active={openTag === tag}
                  onClick={() =>
                    setOpenTag((cur) => (cur === tag ? null : tag))
                  }
                />
              ))}
            </div>
          )}
        </Section>

        {openTag && (
          <Section title={`Notes with #${openTag}`}>
            <TagFilesList tag={openTag} refs={tagsBy.get(openTag) ?? []} />
          </Section>
        )}
      </div>
    </ScrollArea>
  );
}

// ── Outline ───────────────────────────────────────────────────────

function OutlinePanel({ fileId }: { fileId: string | null }) {
  const openFiles = useVaultStore((s) => s.openFiles);
  const content = fileId ? openFiles.get(fileId) ?? null : null;
  const headings = React.useMemo(() => extractHeadings(content), [content]);

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        <Section title="Outline">
          {!fileId ? (
            <Empty label="Open a note to see its outline." />
          ) : content === null ? (
            <Empty label="No content loaded yet." />
          ) : headings.length === 0 ? (
            <Empty label="No headings in this note." />
          ) : (
            <ul className="flex flex-col">
              {headings.map((h) => (
                <li key={`${h.line}:${h.text}`}>
                  <button
                    type="button"
                    onClick={() => jumpTo(fileId, h.line)}
                    className={cn(
                      "w-full text-left text-[12.5px] py-0.5 rounded-sm hover:bg-[var(--hover)]",
                      "truncate",
                    )}
                    style={{ paddingLeft: 12 + (h.level - 1) * 10, paddingRight: 8 }}
                    title={h.text}
                  >
                    <span className={textMuted}>{"#".repeat(h.level)} </span>
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </ScrollArea>
  );
}

// ── Row helpers ───────────────────────────────────────────────────

function FileGroup({ fromPath, refs }: { fromPath: string; refs: LinkRef[] }) {
  const folder = folderOf(fromPath);
  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => openFile(fromPath)}
        className={cn(
          "flex items-baseline gap-1.5 min-h-6 py-1 px-3 text-[12.5px] hover:bg-[var(--hover)] text-left",
          textNormal,
        )}
        title={fromPath}
      >
        <IcLink className="opacity-70 shrink-0 self-center" />
        <span className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="truncate">{displayName(fromPath)}</span>
          {folder && (
            <span className={cn("truncate text-[10.5px] font-mono", textFaint)}>
              {folder}
            </span>
          )}
        </span>
        <span className={cn("text-[11px] self-center", textFaint)}>
          {refs.length}
        </span>
      </button>
      <ul className="flex flex-col pb-1">
        {refs.map((r) => (
          <li key={`${r.from}:${r.line}:${r.target}`}>
            <button
              type="button"
              onClick={() => jumpTo(fromPath, r.line)}
              className={cn(
                "flex w-full items-start gap-1 py-0.5 pl-8 pr-3 text-[12px] text-left",
                "hover:bg-[var(--hover)]",
                textMuted,
              )}
              title={r.snippet}
            >
              <span className="shrink-0 tabular-nums opacity-50">
                L{r.line}
              </span>
              <span className="truncate flex-1">{r.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

function OutgoingRow({
  targetDisplay,
  count,
  resolved,
}: {
  targetNorm: string;
  targetDisplay: string;
  count: number;
  resolved: string | null;
}) {
  const folder = resolved ? folderOf(resolved) : "";
  const label = resolved ? displayName(resolved) : targetDisplay;
  return (
    <li>
      <button
        type="button"
        onClick={() => resolved && openFile(resolved)}
        disabled={!resolved}
        className={cn(
          "flex w-full items-baseline gap-1.5 min-h-6 py-1 px-3 text-[12.5px] text-left",
          "hover:bg-[var(--hover)] disabled:opacity-60 disabled:hover:bg-transparent disabled:cursor-default",
          textNormal,
        )}
        title={resolved ? `Open ${resolved}` : `Unresolved: ${targetDisplay}`}
      >
        <IcLinkOff className="opacity-70 shrink-0 self-center" />
        <span className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className={cn("truncate", !resolved && "italic")}>
            {label}
          </span>
          {folder && (
            <span
              className={cn("truncate text-[10.5px] font-mono", textFaint)}
            >
              {folder}
            </span>
          )}
        </span>
        {count > 1 && (
          <span className={cn("text-[11px] self-center", textFaint)}>
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

function TagChip({
  tag,
  count,
  active,
  onClick,
}: {
  tag: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 h-5 px-1.5 rounded text-[11px] font-mono transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted hover:bg-accent text-muted-foreground",
      )}
    >
      <span>#{tag}</span>
      {count !== undefined && (
        <span className="opacity-70 tabular-nums">{count}</span>
      )}
    </button>
  );
}

function TagFilesList({ refs }: { tag: string; refs: TagRef[] }) {
  const grouped = React.useMemo(() => {
    const map = new Map<string, TagRef[]>();
    for (const r of refs) {
      const arr = map.get(r.from);
      if (arr) arr.push(r);
      else map.set(r.from, [r]);
    }
    return Array.from(map.entries()).map(([from, refs]) => ({ from, refs }));
  }, [refs]);

  if (grouped.length === 0) {
    return <Empty label="No notes with this tag." />;
  }
  return (
    <ul className="flex flex-col">
      {grouped.map((g) => {
        const folder = folderOf(g.from);
        return (
          <li key={g.from}>
            <button
              type="button"
              onClick={() => openFile(g.from)}
              className={cn(
                "flex w-full items-baseline gap-1.5 min-h-6 py-1 px-3 text-[12.5px] text-left",
                "hover:bg-[var(--hover)]",
                textNormal,
              )}
              title={g.from}
            >
              <IcTag className="opacity-70 shrink-0 self-center" />
              <span className="flex-1 min-w-0 flex flex-col leading-tight">
                <span className="truncate">{displayName(g.from)}</span>
                {folder && (
                  <span
                    className={cn(
                      "truncate text-[10.5px] font-mono",
                      textFaint,
                    )}
                  >
                    {folder}
                  </span>
                )}
              </span>
              <span className={cn("text-[11px] self-center", textFaint)}>
                {g.refs.length}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className={cn("flex items-center gap-1.5 h-[26px] px-3 text-[12px] font-semibold select-none", textNormal)}>
        <span className="flex-1 truncate">{title}</span>
      </div>
      {/* No horizontal padding here — children own their own padding
          so we don't double-pad and overflow at narrow widths. */}
      <div className="pb-3 pt-1">{children}</div>
    </div>
  );
}

function Stats({ backlinks, unlinked, pages }: { backlinks: number; unlinked: number; pages: number }) {
  return (
    <div className={cn("flex items-center gap-2 px-3 pb-2 pt-0.5 text-[11px] min-w-0", textMuted)}>
      <StatCell value={backlinks} label="linked" />
      <StatSep />
      <StatCell value={unlinked} label="unlinked" muted />
      <StatSep />
      <StatCell value={pages} label="pages" muted />
    </div>
  );
}

/** Decorative micro-divider between stat cells. Matches lattice's
 *  `.rs-stat-sep` — a plain 1×12px span. Shadcn's `<Separator>` can't
 *  be used here because its `data-vertical:self-stretch` defeats any
 *  explicit `h-*` we set. */
function StatSep() {
  return (
    <span
      aria-hidden
      className="block w-px h-3 bg-border opacity-60 shrink-0"
    />
  );
}

function StatCell({ value, label, muted }: { value: number; label: string; muted?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1 shrink-0">
      <span className={cn("text-[12px] font-semibold", muted ? textMuted : textNormal)}>
        {value}
      </span>
      <span className={textFaint}>{label}</span>
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className={cn("text-[12px] italic px-3 py-1", textFaint)}>
      {label}
    </p>
  );
}

// ── pure helpers ──────────────────────────────────────────────────

/** Empty `LinkIndexState` shell — we feed concrete slices into the
 *  selectors via spread so each panel can subscribe to its narrow
 *  slice (`links`, `backlinksBy`, `tags`) without re-rendering on
 *  unrelated index changes. The selectors only read the fields
 *  they need, so the rest can be `undefined as never`. */
const emptyState = {
  files: undefined as never,
  links: undefined as never,
  tags: undefined as never,
  backlinksBy: undefined as never,
  tagsBy: undefined as never,
  hydrated: false,
  scanning: false,
};

function openFile(fileId: string) {
  window.dispatchEvent(
    new CustomEvent("flux-open-file", { detail: { fileId } }),
  );
}

function jumpTo(fileId: string, line: number) {
  // Single event — the shell's `flux-open-file` listener waits two
  // RAFs for the editor view to mount before dispatching the
  // matching `flux-jump-to-line`. Splitting the event ourselves
  // races the mount and the jump quietly no-ops.
  window.dispatchEvent(
    new CustomEvent("flux-open-file", { detail: { fileId, line } }),
  );
}

function displayName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/** Folder portion of a vault-relative path, normalised to forward
 *  slashes and with a trailing separator stripped. Returns `""` for
 *  vault-root files so callers can branch on it cheaply. */
function folderOf(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(0, slash) : "";
}

function groupByFrom(
  refs: LinkRef[],
): Array<{ from: string; refs: LinkRef[] }> {
  const map = new Map<string, LinkRef[]>();
  for (const r of refs) {
    const arr = map.get(r.from);
    if (arr) arr.push(r);
    else map.set(r.from, [r]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, refs]) => ({ from, refs }));
}

function groupByTarget(
  refs: LinkRef[],
): Array<{ key: string; display: string; refs: LinkRef[] }> {
  const map = new Map<string, { display: string; refs: LinkRef[] }>();
  for (const r of refs) {
    const entry = map.get(r.targetNorm);
    if (entry) entry.refs.push(r);
    else map.set(r.targetNorm, { display: r.target, refs: [r] });
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, display: v.display, refs: v.refs }));
}

function uniqueTags(refs: TagRef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    const key = r.tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.tag);
  }
  return out;
}

interface VaultLikeNode {
  id: string;
  name: string;
  kind?: string;
  children?: VaultLikeNode[];
}

/** Build a `targetNorm → vault path` lookup. Maps both the basename
 *  (so `[[Note]]` → the only `Note.md` in the vault resolves) and
 *  the full normalised path (so `[[folder/Note]]` resolves
 *  unambiguously when two notes share a name). */
function buildBasenameIndex(tree: VaultLikeNode[]): Map<string, string> {
  const map = new Map<string, string>();
  function walk(nodes: VaultLikeNode[]) {
    for (const n of nodes) {
      if (n.kind === "file" && /\.md$/i.test(n.name)) {
        const base = n.name.replace(/\.md$/i, "").toLowerCase();
        const full = n.id.replace(/\\/g, "/").toLowerCase();
        const fullNoExt = full.replace(/\.md$/i, "");
        if (!map.has(base)) map.set(base, n.id);
        map.set(fullNoExt, n.id);
        // Also key without leading slash so backlink targets that
        // omit it still match.
        if (fullNoExt.startsWith("/")) {
          map.set(fullNoExt.slice(1), n.id);
        }
      }
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return map;
}

interface OutlineHeading {
  level: number;
  text: string;
  line: number;
}

function extractHeadings(content: string | null): OutlineHeading[] {
  if (!content) return [];
  const out: OutlineHeading[] = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    out.push({
      level: m[1].length,
      text: m[2].replace(/\s*#+\s*$/, ""), // strip trailing `#` decor
      line: i + 1,
    });
  }
  return out;
}

/**
 * Bookmarks panel was previously here, mirrored from the left-
 * sidebar. Removed because Obsidian keeps bookmarks exclusively in
 * the left sidebar — duplicating it on the right caused confusion
 * about where the canonical bookmark list lives.
 */
