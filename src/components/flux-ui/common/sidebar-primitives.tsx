/**
 * Sidebar layout primitives — shared "contract" for every panel
 * in the left sidebar (Files, Search, Bookmarks, …).
 *
 * Why this file exists:
 *   The Files panel renders rows with very specific geometry
 *   (`h-6`, `gap-1.5`, `paddingLeft: 8 + depth * 12`, chevron column
 *   always reserved). Other panels (Bookmarks, Tags, Outline) want
 *   the SAME geometry so the sidebar reads as one consistent tree
 *   regardless of which view is active. Re-implementing the row
 *   classes in each panel made them drift apart visually — this
 *   module is the single source of truth.
 *
 * Exports:
 *   • `SidebarToolbar`  — header icon row (30px tall, centred).
 *   • `SidebarRow`      — tree row with chevron column, leading
 *                          icon, label, and optional trailing slot.
 *                          Indentation is `8 + depth * 12` px,
 *                          identical to the vault file tree.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { IcChevronDown } from "@/components/flux-ui/common/icons";
import { textNormal } from "@/lib/lattice-tokens";

const hoverBg = "hover:bg-[var(--hover)]";

export interface SidebarToolbarProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Standard 30px icon toolbar used at the top of every left-sidebar
 * panel. Icons are centred so they don't get clipped at the
 * sidebar's minimum width.
 */
export function SidebarToolbar({ children, className }: SidebarToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1 h-[30px] px-2 shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SidebarRowProps {
  /** 0-based nesting level — applied as `paddingLeft: 8 + depth * 12`,
   *  matching the vault file tree. */
  depth?: number;
  /** When provided, the row renders a chevron in the leading column
   *  (rotates 90° clockwise when `open` is `false`). When omitted,
   *  the column is reserved with an invisible spacer so leaf rows
   *  align with sibling rows that *do* have a chevron. */
  chevron?: { open: boolean };
  /** Leading icon element (already sized by the caller — should be
   *  `icon-sm` to match the file-tree leaf rows). */
  leading?: React.ReactNode;
  label: React.ReactNode;
  /** Right-aligned slot (count chip, hover-only trash, etc). The
   *  primitive doesn't impose a visibility rule — wrap in your own
   *  `group-hover` modifier as needed. */
  trailing?: React.ReactNode;
  /** Native title (rendered as the browser tooltip). */
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  className?: string;
  /** Visual "active" state — adds the lattice selected-row tint. */
  active?: boolean;
  /** Use `<button>` instead of `<div>`. Defaults to `<div>` so the
   *  row can host nested clickable trailing slots without nested
   *  button semantics. */
  asButton?: boolean;
}

/** Single sidebar tree row — geometrically identical to the Files
 *  panel rows so panels read as one tree across views. */
export function SidebarRow({
  depth = 0,
  chevron,
  leading,
  label,
  trailing,
  title,
  onClick,
  onDoubleClick,
  className,
  active,
  asButton,
}: SidebarRowProps) {
  const Tag = asButton ? "button" : "div";
  const inner = (
    <>
      {chevron ? (
        <IcChevronDown
          className={cn(
            "[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0 transition-transform",
            !chevron.open && "-rotate-90",
          )}
        />
      ) : (
        <span className="[width:var(--icon-xs)] [height:var(--icon-xs)] shrink-0" />
      )}
      {leading}
      <span className="truncate min-w-0 flex-1 text-left">{label}</span>
      {trailing}
    </>
  );

  return (
    <Tag
      type={asButton ? "button" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={title}
      className={cn(
        "group flex w-full min-w-0 items-center gap-1.5 h-6 rounded-[4px] text-[12px] select-none cursor-pointer px-2",
        textNormal,
        hoverBg,
        active && "bg-[var(--hover)]",
        className,
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {inner}
    </Tag>
  );
}
