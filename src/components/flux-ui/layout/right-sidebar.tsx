import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IcArchive,
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

export type RightView = "links" | "outgoing" | "tags" | "saved" | "outline";

interface RightSidebarProps {
  view: RightView;
  onChangeView: (view: RightView) => void;
  isMac: boolean;
}

const HEADER_TABS: Array<{ id: RightView; label: string; Icon: React.ComponentType<React.SVGAttributes<SVGElement>> }> = [
  { id: "links", label: "Backlinks", Icon: IcLink },
  { id: "outgoing", label: "Outgoing Links", Icon: IcLinkOff },
  { id: "tags", label: "Tags", Icon: IcTag },
  { id: "saved", label: "Saved", Icon: IcArchive },
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
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        {view === "links" && (
          <Section title="Backlinks">
            <Stats backlinks={0} unlinked={0} pages={0} />
            <Empty label="No backlinks for the current note." />
          </Section>
        )}
        {view === "outgoing" && (
          <Section title="Outgoing Links">
            <Empty label="No outgoing links." />
          </Section>
        )}
        {view === "tags" && (
          <Section title="Tags">
            <Empty label="No tags." />
          </Section>
        )}
        {view === "saved" && (
          <Section title="Saved">
            <Empty label="No saved items." />
          </Section>
        )}
        {view === "outline" && (
          <Section title="Outline">
            <Empty label="No outline." />
          </Section>
        )}
      </div>
    </ScrollArea>
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
