import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DotmSquare3 } from "@/components/ui/dotm-square-3";
import { cn } from "@/lib/utils";
import {
  useSettingsStore,
  HOTKEY_LABELS,
  DEFAULT_HOTKEYS,
  bindingChips,
  makeBinding,
  type HotkeyId,
  type HotkeyBinding,
} from "@/state/settings-store";
import {
  IcArchive,
  IcBook,
  IcBookmark,
  IcCalendar,
  IcEdit,
  IcExtensions,
  IcFileLink,
  IcGear,
  IcHistory,
  IcKey,
  IcKeyboard,
  IcLinkOff,
  IcMerge,
  IcPaint,
  IcPreview,
  IcSwap,
  IcSync,
  IcTerminal,
} from "@/components/flux-ui/common/icons";

/**
 * SettingsDialog — flux's settings shell, structurally + visually
 * ported from `lattice/src/components/modals/SettingsModal.tsx` +
 * `SettingsModal.css`. Built on shadcn `Dialog` per project rules.
 *
 * Visual targets (mapped 1:1 to lattice CSS):
 *   ─ dialog       1100px × 740px, 12px radius, deep shadow
 *   ─ sidebar      240px wide, two-tone darker surface than content
 *   ─ content      lighter active surface, 36px padding, 760px text body
 *   ─ section item 30px high, gap-10, font 13px, --icon-sm icons
 *   ─ group label  font 11px / 600 / normal-case / 0.04em tracking
 *   ─ subheading   17px / 600  (settings-subheading)
 *   ─ row title    14px / 600  (settings-row-title)
 *   ─ row desc     12px / 1.45 muted  (settings-row-desc)
 *   ─ card         rounded 10px, 1px border, subtle bg
 *
 * The two-tone surface (sidebar `#161616` darker, content `#262626`
 * lighter — light mode mirrors with `#ece9e3` / `#ffffff`) is a hard
 * requirement: in the lattice port the greyed sidebar reads as
 * chrome while the content pane reads as the active workspace.
 */

type Section = {
  id: string;
  label: string;
  // Icons originate from `flux-ui/common/icons.tsx` (lucide-wrapped
  // SVGs). The Section component only needs `className`.
  Icon: React.FC<{ className?: string }>;
};

const OPTION_SECTIONS: Section[] = [
  { id: "general", label: "General", Icon: IcGear },
  { id: "editor", label: "Editor", Icon: IcEdit },
  { id: "files", label: "Files and links", Icon: IcFileLink },
  { id: "ai-privacy", label: "AI & Privacy", Icon: IcKey },
  { id: "appearance", label: "Appearance", Icon: IcPaint },
  { id: "hotkeys", label: "Hotkeys", Icon: IcKeyboard },
  { id: "keychain", label: "Keychain", Icon: IcKey },
  { id: "core-plugins", label: "Core plugins", Icon: IcArchive },
  { id: "community-plugins", label: "Community plugins", Icon: IcExtensions },
];

const CORE_PLUGIN_SECTIONS: Section[] = [
  { id: "backlinks", label: "Backlinks", Icon: IcLinkOff },
  { id: "canvas", label: "Canvas", Icon: IcBookmark },
  { id: "command-palette", label: "Command palette", Icon: IcTerminal },
  { id: "daily-notes", label: "Daily notes", Icon: IcCalendar },
  { id: "file-recovery", label: "File recovery", Icon: IcHistory },
  { id: "note-composer", label: "Note composer", Icon: IcMerge },
  { id: "page-preview", label: "Page preview", Icon: IcPreview },
  { id: "quick-switcher", label: "Quick switcher", Icon: IcSwap },
  { id: "sync", label: "Sync", Icon: IcSync },
  { id: "templates", label: "Templates", Icon: IcBook },
  { id: "unique-note-creator", label: "Unique note creator", Icon: IcEdit },
  { id: "web-viewer", label: "Web viewer", Icon: IcPreview },
];

const COMMUNITY_PLUGIN_SECTIONS: Section[] = [
  { id: "kanban", label: "Kanban", Icon: IcBookmark },
];

const ALL_SECTIONS = [
  ...OPTION_SECTIONS,
  ...CORE_PLUGIN_SECTIONS,
  ...COMMUNITY_PLUGIN_SECTIONS,
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [active, setActive] = React.useState<string>("appearance");

  const activeSection = React.useMemo(
    () => ALL_SECTIONS.find((s) => s.id === active) ?? OPTION_SECTIONS[0],
    [active],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Lattice: min(1100px, 96vw) × min(740px, 92vh)
          "w-[min(1100px,96vw)] max-w-[min(1100px,96vw)] sm:max-w-[min(1100px,96vw)]",
          "h-[min(740px,92vh)]",
          // Unified surface: matches sidebar so both panes feel like one
          // continuous chrome slab. Light = white, dark = near-black.
          "bg-white dark:bg-neutral-950",
          // Two-column layout, no padding (panes set their own).
          "grid grid-cols-[240px_minmax(0,1fr)] gap-0 p-0 overflow-hidden",
        )}
      >
        {/* sr-only — Radix a11y requirement */}
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure flux preferences, appearance, hotkeys, and plugins.
        </DialogDescription>

        {/* Left: section list (darker chrome surface — inverted) */}
        <ScrollArea
          className={cn(
            // min-h-0 is REQUIRED on grid items so the cell honours the
            // parent's fixed height instead of expanding to fit content.
            "h-full min-h-0",
            // Unified palette with right pane — sidebar slightly lifted
            // off the dialog canvas in light mode, identical in dark.
            "bg-neutral-100 dark:bg-neutral-950",
            "border-r border-neutral-200 dark:border-neutral-800",
            "rounded-l-xl",
          )}
        >
          <aside className="px-2 pt-3 pb-[18px]">
            <SectionGroup
              label="Options"
              sections={OPTION_SECTIONS}
              active={active}
              onSelect={setActive}
            />
            <SectionGroup
              label="Core plugins"
              sections={CORE_PLUGIN_SECTIONS}
              active={active}
              onSelect={setActive}
            />
            <SectionGroup
              label="Community plugins"
              sections={COMMUNITY_PLUGIN_SECTIONS}
              active={active}
              onSelect={setActive}
            />
          </aside>
        </ScrollArea>

        {/* Right: active surface */}
        <ScrollArea className="h-full min-h-0 rounded-r-xl">
          <main className="p-9">
            <div className="max-w-[760px]">
              <SectionBody section={activeSection} />
            </div>
          </main>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ── Sidebar helpers ──────────────────────────────────────────────────

function SectionGroup({
  label,
  sections,
  active,
  onSelect,
}: {
  label: string;
  sections: Section[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-[14px] first:mt-0">
      <div className="px-[10px] pt-[6px] pb-1 text-[11px] font-semibold tracking-[0.04em] text-neutral-500 dark:text-neutral-500">
        {label}
      </div>
      <ul className="flex flex-col gap-px m-0 p-0 list-none">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={cn(
                "group flex w-full items-center gap-[10px] h-[28px] px-[10px]",
                "rounded-[6px] text-[13px] text-left transition-colors duration-75",
                "outline-none focus-visible:ring-0",
                // Force ALL nested svg icons to a fixed small size,
                // bypassing the icon wrapper's --icon-md default.
                "[&_svg]:size-[14px] [&_svg]:shrink-0",
                active === s.id
                  ? // Active pill: clearly raised, brighter text.
                    "bg-white text-neutral-900 dark:bg-neutral-800 dark:text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none"
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-neutral-900 dark:hover:text-white",
              )}
              onClick={() => onSelect(s.id)}
            >
              <s.Icon />
              <span className="flex-1 truncate">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Content router ───────────────────────────────────────────────────

function SectionBody({ section }: { section: Section }) {
  if (section.id === "appearance") return <AppearanceBody />;
  if (section.id === "general") return <GeneralBody />;
  if (section.id === "hotkeys") return <HotkeysBody />;
  return <ComingSoonBody section={section} />;
}

// Section grouping — Obsidian-style. Optional H3 heading sits ABOVE
// a subtle rounded card containing the rows. Multiple Sections stack
// vertically inside a body to mirror Obsidian's grouped settings.
function Section({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-[28px] first:mt-0">
      {title && (
        <h3 className="m-0 mb-2 px-[2px] text-[15px] font-semibold tracking-[-0.005em] text-neutral-900 dark:text-white">
          {title}
        </h3>
      )}
      <div
        className={cn(
          // Subtle card grouping the rows together. Sits on top of
          // the unified near-black canvas in dark mode.
          "rounded-[10px] border",
          "bg-neutral-50 border-neutral-200",
          "dark:bg-neutral-900 dark:border-neutral-800",
          "px-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

// Flat row — sits inside a Section card. Title + description left,
// control right, subtle bottom divider between siblings.
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 py-[14px]",
        "border-b border-neutral-200 dark:border-neutral-800 last:border-b-0",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-neutral-900 dark:text-white">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[12px] leading-[1.45] text-neutral-600 dark:text-neutral-400">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Disabled "Manage" button used as the right-side control in several
// rows (Themes, Ribbon menu, fonts). Read-only placeholder until the
// underlying panels exist.
function ManageButton({ children = "Manage" }: { children?: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className={cn(
        "h-7 px-3 rounded-[6px] text-[12px] font-medium",
        "bg-neutral-100 border border-neutral-200 text-neutral-700",
        "dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200",
        "cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

// Lattice-style pill toggle (34×18px) — used inside Row controls.
function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="relative inline-block w-[34px] h-[18px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 z-10"
      />
      <span
        className={cn(
          "absolute inset-0 rounded-full transition-colors duration-100",
          "bg-muted-foreground/30",
          // Obsidian / lattice signature accent — purple stays the
          // brand toggle color across both themes.
          "peer-checked:bg-[#7f6df2]",
        )}
      />
      <span
        className={cn(
          "absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white",
          "shadow-[0_1px_2px_rgba(0,0,0,0.35)]",
          "transition-transform duration-100",
          "peer-checked:translate-x-[16px]",
        )}
      />
    </label>
  );
}

// ── Real section bodies ──────────────────────────────────────────────

function AppearanceBody() {
  const [isDark, setIsDark] = React.useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  React.useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const setTheme = (next: "light" | "dark") => {
    const root = document.documentElement;
    if (next === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("flux.theme", next);
    } catch {
      /* noop */
    }
  };

  return (
    <div>
      <Section>
        <Row
          title="Base color scheme"
          description="Choose flux's default color scheme."
        >
          <div className="inline-flex items-center gap-px rounded-[6px] border border-border/60 p-[2px]">
            <ThemeChip active={!isDark} onClick={() => setTheme("light")}>
              Light
            </ThemeChip>
            <ThemeChip active={isDark} onClick={() => setTheme("dark")}>
              Dark
            </ThemeChip>
          </div>
        </Row>
        <Row
          title="Accent color"
          description="Choose the accent color used throughout the app."
        >
          <div className="flex items-center gap-2">
            {["#7f6df2", "#ea580c", "#2563eb", "#16a34a", "#dc2626"].map(
              (c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Accent ${c}`}
                  className="w-4 h-4 rounded-full border border-border/60 opacity-50 cursor-not-allowed"
                  style={{ backgroundColor: c }}
                  disabled
                />
              ),
            )}
          </div>
        </Row>
        <Row
          title="Themes"
          description="Manage installed themes and browse community themes."
        >
          <ManageButton />
        </Row>
        <Row
          title="Current community themes"
          description="You currently have 0 themes installed."
        >
          <span />
        </Row>
      </Section>

      <Section title="Interface">
        <Row
          title="Inline title"
          description="Display the filename as an editable title inline with the file contents."
        >
          <Switch checked={true} onChange={() => {}} />
        </Row>
        <Row
          title="Show tab title bar"
          description="Display the header at the top of every tab."
        >
          <Switch checked={true} onChange={() => {}} />
        </Row>
        <Row
          title="Show ribbon"
          description="Display the vertical toolbar on the side of the window."
        >
          <Switch checked={true} onChange={() => {}} />
        </Row>
        <Row
          title="Ribbon menu configuration"
          description="Configure what commands appear in the ribbon menu."
        >
          <ManageButton />
        </Row>
      </Section>

      <Section title="Font">
        <Row
          title="Interface font"
          description="Set the base font for all of flux."
        >
          <ManageButton />
        </Row>
        <Row
          title="Text font"
          description="Set the font for editing and reading views."
        >
          <ManageButton />
        </Row>
      </Section>
    </div>
  );
}

function ThemeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-[22px] px-[10px] rounded-[4px] text-[11px] font-medium",
        "transition-colors duration-75 outline-none",
        active
          ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white"
          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60",
      )}
    >
      {children}
    </button>
  );
}

function GeneralBody() {
  const [autoRestore, setAutoRestore] = React.useState(true);
  const [confirmDelete, setConfirmDelete] = React.useState(true);
  const [autoUpdate, setAutoUpdate] = React.useState(true);
  return (
    <div>
      <Section>
        <Row
          title="Vault name"
          description="The display name for your current vault."
        >
          <Input
            defaultValue="My Vault"
            className={cn(
              "h-7 w-48 text-[12px] rounded-[6px]",
            )}
          />
        </Row>
        <Row
          title="Automatic updates"
          description="Turn this off to prevent the app from checking for updates."
        >
          <Switch checked={autoUpdate} onChange={setAutoUpdate} />
        </Row>
      </Section>

      <Section title="Workspace">
        <Row
          title="Auto-restore vault"
          description="Open the last active vault on startup."
        >
          <Switch checked={autoRestore} onChange={setAutoRestore} />
        </Row>
        <Row
          title="Confirm before delete"
          description="Show a confirmation dialog before deleting files."
        >
          <Switch checked={confirmDelete} onChange={setConfirmDelete} />
        </Row>
      </Section>
    </div>
  );
}

// ── Hotkey recorder ──────────────────────────────────────────────────────────

/**
 * Listens for the next keydown event and calls `onCapture` with the
 * resulting binding. Renders a bordered capture zone that intercepts
 * keys — Escape cancels without recording.
 */
function HotkeyRecorder({
  onCapture,
  onCancel,
}: {
  onCapture: (b: HotkeyBinding) => void;
  onCancel: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
    const el = ref.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      // Ignore bare modifier presses.
      if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return;

      onCapture(
        makeBinding(e.key, {
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        }),
      );
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [onCapture, onCancel]);

  return (
    <div
      ref={ref}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn(
        "inline-flex items-center justify-center h-[28px] min-w-[110px] px-3 rounded-[6px]",
        "text-[11px] text-neutral-500 dark:text-neutral-400",
        "border border-dashed border-[#7f6df2] bg-[#7f6df2]/5",
        "outline-none focus:ring-1 focus:ring-[#7f6df2]/60",
        "cursor-text select-none",
      )}
    >
      Press keys…
    </div>
  );
}

function HotkeyRow({
  id,
  binding,
  onSave,
  onReset,
}: {
  id: HotkeyId;
  binding: HotkeyBinding;
  onSave: (b: HotkeyBinding) => void;
  onReset: () => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const chips = bindingChips(binding);
  const isDefault =
    JSON.stringify(binding) === JSON.stringify(DEFAULT_HOTKEYS[id]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 py-[12px]",
        "border-b border-neutral-200 dark:border-neutral-800 last:border-b-0",
      )}
    >
      {/* Label */}
      <span className="flex-1 text-[13px] text-neutral-900 dark:text-white">
        {HOTKEY_LABELS[id]}
      </span>

      {/* Binding display / recorder */}
      {recording ? (
        <HotkeyRecorder
          onCapture={(b) => {
            onSave(b);
            setRecording(false);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <button
          type="button"
          title="Click to change shortcut"
          onClick={() => setRecording(true)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px]",
            "border border-transparent",
            "hover:border-neutral-300 dark:hover:border-neutral-600",
            "hover:bg-neutral-100 dark:hover:bg-neutral-800",
            "transition-colors duration-75 cursor-pointer",
          )}
        >
          {chips.map((k) => (
            <Kbd key={k} className="h-[20px] min-w-[20px] px-1.5 text-[10px]">
              {k}
            </Kbd>
          ))}
        </button>
      )}

      {/* Reset to default */}
      <button
        type="button"
        title="Reset to default"
        disabled={isDefault}
        onClick={onReset}
        className={cn(
          "text-[11px] px-2 h-[22px] rounded-[5px]",
          "border border-neutral-200 dark:border-neutral-700",
          "text-neutral-500 dark:text-neutral-400",
          "hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200",
          "transition-colors duration-75",
          "disabled:opacity-30 disabled:cursor-not-allowed",
        )}
      >
        Reset
      </button>
    </div>
  );
}

function HotkeysBody() {
  const { hotkeys, setHotkey, resetHotkey, resetAllHotkeys } = useSettingsStore();
  const [filter, setFilter] = React.useState("");

  const ids = Object.keys(HOTKEY_LABELS) as HotkeyId[];
  const visible = ids.filter((id) =>
    filter === "" ||
    HOTKEY_LABELS[id].toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Input
          placeholder="Filter shortcuts…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={cn("h-8 flex-1 text-[12px] rounded-[6px]")}
        />
        <button
          type="button"
          onClick={resetAllHotkeys}
          className={cn(
            "shrink-0 h-8 px-3 rounded-[6px] text-[12px]",
            "border border-neutral-200 dark:border-neutral-700",
            "text-neutral-600 dark:text-neutral-400",
            "hover:bg-neutral-100 dark:hover:bg-neutral-800",
            "transition-colors duration-75",
          )}
        >
          Reset all
        </button>
      </div>
      <p className="mb-3 text-[11px] text-neutral-500 dark:text-neutral-500">
        Click a shortcut to record a new key combination. Press{" "}
        <Kbd className="h-[16px] min-w-[16px] px-1 text-[9px]">Esc</Kbd> to
        cancel recording.
      </p>
      <Section>
        {visible.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-neutral-500">
            No matching shortcuts.
          </div>
        ) : (
          visible.map((id) => (
            <HotkeyRow
              key={id}
              id={id}
              binding={hotkeys[id]}
              onSave={(b) => setHotkey(id, b)}
              onReset={() => resetHotkey(id)}
            />
          ))
        )}
      </Section>
    </div>
  );
}

function ComingSoonBody({ section }: { section: Section }) {
  return (
    <div className="flex items-center justify-center min-h-[480px]">
      <Empty className="border-0 bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="default" className="bg-transparent size-auto">
            <DotmSquare3
              size={28}
              dotSize={3}
              aria-label={`${section.label} loading`}
            />
          </EmptyMedia>
          <EmptyTitle className="text-[14px] font-semibold text-neutral-900 dark:text-white">
            {section.label}
          </EmptyTitle>
          <EmptyDescription className="text-[12px] leading-[1.5] max-w-[320px] text-neutral-600 dark:text-neutral-400">
            This panel is not wired up yet. The lattice port is staged in
            phases — sections light up as their underlying stores land.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
            Tip: hit <Kbd className="h-[18px] min-w-[18px] px-1.5 text-[10px]">Esc</Kbd> to close.
          </p>
        </EmptyContent>
      </Empty>
    </div>
  );
}
