/**
 * Flux settings dialog — Obsidian-parity layout with shadcn primitives.
 *
 * Layout:
 *   ─ 1100×740 fixed dialog, no padding (panes set their own)
 *   ─ Left:   240px sidebar with search + grouped section list
 *   ─ Right:  scrolling content with breadcrumb header + close button
 *   ─ Body:   grouped Sections (h2 title + card) containing Rows
 *             (title + description on the left, control on the right)
 *
 * All controls use shadcn primitives (`Switch`, `Select`, `Slider`,
 * `RadioGroup`, `Input`, `Button`) — no hand-rolled toggles — so the
 * focus rings, sizing, and theme tokens stay consistent with the rest
 * of the app.
 *
 * Section bodies in this file:
 *   • GeneralBody     — vault metadata, auto-update, restore prefs
 *   • EditorBody      — line numbers, word wrap, vim, font size,
 *                       default view mode
 *   • AppearanceBody  — theme, ribbon/tabbar toggles, theme palette
 *   • HotkeysBody     — keyboard recorder for every HotkeyId
 *   • FilesBody, AIPrivacyBody, KeychainBody, *PluginsBody — stubs
 *     that surface upcoming features via the same shell so the
 *     visual language stays consistent.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  IcSearch,
  IcClose,
  IcRefresh,
} from "@/components/flux-ui/common/icons";

// ── Section catalogue ────────────────────────────────────────────────

type Section = {
  id: string;
  label: string;
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

const ALL_SECTIONS: Section[] = [
  ...OPTION_SECTIONS,
  ...CORE_PLUGIN_SECTIONS,
  ...COMMUNITY_PLUGIN_SECTIONS,
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Dialog shell ─────────────────────────────────────────────────────

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [active, setActive] = React.useState<string>("general");
  const [query, setQuery] = React.useState("");

  // Filter the sidebar list when the user types in the search box.
  // Performs a case-insensitive contains match on section labels.
  const filteredOptions = React.useMemo(
    () => filterSections(OPTION_SECTIONS, query),
    [query],
  );
  const filteredCore = React.useMemo(
    () => filterSections(CORE_PLUGIN_SECTIONS, query),
    [query],
  );
  const filteredCommunity = React.useMemo(
    () => filterSections(COMMUNITY_PLUGIN_SECTIONS, query),
    [query],
  );

  const activeSection = React.useMemo(
    () => ALL_SECTIONS.find((s) => s.id === active) ?? OPTION_SECTIONS[0],
    [active],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // Lattice/Obsidian-parity dialog dimensions.
          "w-[min(1100px,96vw)] max-w-[min(1100px,96vw)] sm:max-w-[min(1100px,96vw)]",
          "h-[min(740px,92vh)]",
          // Two-pane grid: sidebar 240px, content fills the rest.
          "grid grid-cols-[240px_minmax(0,1fr)] gap-0 p-0 overflow-hidden",
          "bg-background border-border",
        )}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure flux preferences, appearance, hotkeys, and plugins.
        </DialogDescription>

        {/* ─── Sidebar ─────────────────────────────────────────────── */}
        <aside
          className={cn(
            "flex flex-col h-full min-h-0",
            "bg-muted/50 dark:bg-muted/20",
            "border-r border-border",
          )}
        >
          <div className="px-3 pt-3 pb-2">
            <div className="relative">
              <IcSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 [width:14px] [height:14px] opacity-60" />
              <Input
                placeholder="Search settings…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-7 text-[12px]"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <nav className="px-2 pb-4">
              <SectionGroup
                label="Options"
                sections={filteredOptions}
                active={active}
                onSelect={setActive}
              />
              <SectionGroup
                label="Core plugins"
                sections={filteredCore}
                active={active}
                onSelect={setActive}
              />
              <SectionGroup
                label="Community plugins"
                sections={filteredCommunity}
                active={active}
                onSelect={setActive}
              />
            </nav>
          </ScrollArea>
        </aside>

        {/* ─── Content pane ────────────────────────────────────────── */}
        <div className="relative flex flex-col h-full min-h-0 bg-background">
          {/* Header strip — section breadcrumb on the left, close on right */}
          <div className="flex items-center justify-between h-12 px-6 border-b border-border shrink-0">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span>Settings</span>
              <span className="opacity-50">/</span>
              <span className="text-foreground font-medium">
                {activeSection.label}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close settings"
              onClick={() => onOpenChange(false)}
              className="h-7 w-7 p-0 -mr-2"
            >
              <IcClose className="[width:14px] [height:14px]" />
            </Button>
          </div>

          {/* Body */}
          <ScrollArea className="flex-1 min-h-0">
            <main className="px-6 py-5">
              <div className="max-w-[760px]">
                <SectionBody section={activeSection} />
              </div>
            </main>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function filterSections(list: Section[], query: string): Section[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => s.label.toLowerCase().includes(q));
}

// ── Sidebar group ────────────────────────────────────────────────────

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
  if (sections.length === 0) return null;
  return (
    <div className="mt-3 first:mt-1">
      <div className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-[0.06em] uppercase text-muted-foreground/80">
        {label}
      </div>
      <ul className="flex flex-col gap-px">
        {sections.map((s) => {
          const isActive = active === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn(
                  "group flex w-full items-center gap-2 h-7 px-2 rounded-md text-[12.5px] text-left",
                  "transition-colors duration-75 outline-none",
                  "[&_svg]:size-[14px] [&_svg]:shrink-0",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <s.Icon />
                <span className="flex-1 truncate">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Body router ──────────────────────────────────────────────────────

function SectionBody({ section }: { section: Section }) {
  switch (section.id) {
    case "general":
      return <GeneralBody />;
    case "editor":
      return <EditorBody />;
    case "appearance":
      return <AppearanceBody />;
    case "hotkeys":
      return <HotkeysBody />;
    case "files":
      return <FilesLinksBody />;
    case "ai-privacy":
      return <AIPrivacyBody />;
    default:
      return <ComingSoonBody section={section} />;
  }
}

// ── Reusable primitives ──────────────────────────────────────────────

/**
 * Section title — sits above a card (or list of rows). Obsidian uses
 * the title as a visual divider, not as a tooltip / header chrome,
 * so we keep it lightweight: regular weight, slightly larger than
 * body text, with generous top spacing on subsequent sections.
 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className={cn(
        "text-[18px] font-semibold tracking-tight text-foreground",
        "mt-8 mb-3 first:mt-0",
      )}
    >
      {children}
    </h2>
  );
}

/**
 * Row — single setting entry with title + optional description on the
 * left, control on the right. Border between rows is a subtle bottom
 * line; last row drops it so cards have clean bottom edges.
 */
function Row({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 py-3.5 first:pt-3 last:pb-3",
        "border-b border-border last:border-b-0",
        className,
      )}
    >
      <div className="flex-1 min-w-0 pr-2">
        <div className="text-[13.5px] font-medium text-foreground leading-snug">
          {title}
        </div>
        {description && (
          <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center pt-0.5">{children}</div>
    </div>
  );
}

// ── General ──────────────────────────────────────────────────────────

function GeneralBody() {
  const skipMergeConfirm = useSettingsStore((s) => s.skipMergeConfirm);
  const setSkipMergeConfirm = useSettingsStore((s) => s.setSkipMergeConfirm);

  return (
    <div>
      <SectionTitle>General</SectionTitle>
      <Row
        title="Vault name"
        description="The display name for your current vault. Used in the title bar and breadcrumbs."
      >
        <Input
          defaultValue="My Vault"
          className="h-8 w-[220px] text-[12.5px]"
        />
      </Row>
      <Row
        title="Automatic updates"
        description="Check for new flux releases on launch and notify when one is available."
      >
        <Switch defaultChecked />
      </Row>
      <Row
        title="Open last vault on startup"
        description="When enabled, flux re-opens the most recently used vault automatically."
      >
        <Switch defaultChecked />
      </Row>

      <SectionTitle>Confirmation prompts</SectionTitle>
      <Row
        title="Confirm merge"
        description={
          <>
            Show a confirmation dialog before merging the source file
            into the target. Disabled when you check{" "}
            <em>Don't ask again</em> on the merge prompt.
          </>
        }
      >
        <Switch
          checked={!skipMergeConfirm}
          onCheckedChange={(v) => setSkipMergeConfirm(!v)}
        />
      </Row>
      <Row
        title="Confirm file deletion"
        description="Show a confirmation dialog before moving a file to trash."
      >
        <Switch defaultChecked />
      </Row>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────

function EditorBody() {
  const lineNumbers = useSettingsStore((s) => s.lineNumbers);
  const setLineNumbers = useSettingsStore((s) => s.setLineNumbers);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const setWordWrap = useSettingsStore((s) => s.setWordWrap);
  const vimMode = useSettingsStore((s) => s.vimMode);
  const setVimMode = useSettingsStore((s) => s.setVimMode);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const defaultViewMode = useSettingsStore((s) => s.defaultViewMode);
  const setDefaultViewMode = useSettingsStore((s) => s.setDefaultViewMode);

  return (
    <div>
      <SectionTitle>Editor</SectionTitle>
      <Row
        title="Default editing mode"
        description="Mode every markdown file opens in. Live preview renders inline (Obsidian-style); Source keeps raw markdown visible; Reading is read-only."
      >
        <Select
          value={defaultViewMode}
          onValueChange={(v) =>
            setDefaultViewMode(v as "source" | "live" | "preview")
          }
        >
          <SelectTrigger className="w-[180px] h-8 text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="live">Live preview</SelectItem>
            <SelectItem value="source">Source mode</SelectItem>
            <SelectItem value="preview">Reading view</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row
        title="Font size"
        description={`Base font size used by the editor and reading view (${fontSize}px).`}
      >
        <div className="w-[200px] flex items-center gap-3">
          <Slider
            min={11}
            max={24}
            step={1}
            value={[fontSize]}
            onValueChange={([v]) => v !== undefined && setFontSize(v)}
            className="flex-1"
          />
          <span className="w-8 text-right text-[12px] tabular-nums text-muted-foreground">
            {fontSize}
          </span>
        </div>
      </Row>

      <Row
        title="Show line numbers"
        description="Display line numbers in the CodeMirror gutter."
      >
        <Switch checked={lineNumbers} onCheckedChange={setLineNumbers} />
      </Row>

      <Row
        title="Soft wrap long lines"
        description="Wrap long lines at the pane edge instead of horizontally scrolling."
      >
        <Switch checked={wordWrap} onCheckedChange={setWordWrap} />
      </Row>

      <Row
        title="Vim key bindings"
        description="Enable Vim-style modal editing inside the CodeMirror editor."
      >
        <Switch checked={vimMode} onCheckedChange={setVimMode} />
      </Row>

      <SectionTitle>Code blocks</SectionTitle>
      <Row
        title="Syntax highlighting"
        description="Use Shiki to colourise fenced code blocks (uses VS Code's themes)."
      >
        <Switch defaultChecked disabled />
      </Row>
    </div>
  );
}

// ── Appearance ───────────────────────────────────────────────────────

function AppearanceBody() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const showRibbon = useSettingsStore((s) => s.showRibbon);
  const setShowRibbon = useSettingsStore((s) => s.setShowRibbon);
  const showTabBar = useSettingsStore((s) => s.showTabBar);
  const setShowTabBar = useSettingsStore((s) => s.setShowTabBar);

  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <Row
        title="Base color scheme"
        description="Match the system, or pin to light / dark."
      >
        <RadioGroup
          value={theme}
          onValueChange={(v) => setTheme(v as "system" | "light" | "dark")}
          className="flex items-center gap-1.5"
        >
          {(["system", "light", "dark"] as const).map((opt) => (
            <label
              key={opt}
              htmlFor={`theme-${opt}`}
              className={cn(
                "flex items-center gap-2 h-8 px-3 rounded-md border cursor-pointer select-none capitalize text-[12.5px]",
                "transition-colors duration-75",
                theme === opt
                  ? "bg-accent text-accent-foreground border-accent"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
            >
              <RadioGroupItem id={`theme-${opt}`} value={opt} className="sr-only" />
              {opt}
            </label>
          ))}
        </RadioGroup>
      </Row>

      <Row
        title="Accent color"
        description="Color used for active selections, links, and the brand toggle."
      >
        <div className="flex items-center gap-2">
          {[
            { c: "#7f6df2", name: "Iris" },
            { c: "#ea580c", name: "Orange" },
            { c: "#2563eb", name: "Blue" },
            { c: "#16a34a", name: "Green" },
            { c: "#dc2626", name: "Red" },
          ].map(({ c, name }) => (
            <button
              key={c}
              type="button"
              aria-label={`Accent ${name}`}
              title={name}
              className={cn(
                "w-5 h-5 rounded-full ring-1 ring-border opacity-60 cursor-not-allowed",
              )}
              style={{ backgroundColor: c }}
              disabled
            />
          ))}
        </div>
      </Row>

      <SectionTitle>Interface</SectionTitle>
      <Row
        title="Show ribbon"
        description="Display the vertical activity bar with view-switcher icons on the left edge."
      >
        <Switch checked={showRibbon} onCheckedChange={setShowRibbon} />
      </Row>
      <Row
        title="Show tab bar"
        description="Display the editor tab bar above each pane. Hide it for a borderless writing surface."
      >
        <Switch checked={showTabBar} onCheckedChange={setShowTabBar} />
      </Row>
      <Row
        title="Translucent window"
        description="Use a slightly translucent background (macOS / Windows 11 vibrancy effect)."
      >
        <Switch defaultChecked={false} disabled />
      </Row>
    </div>
  );
}

// ── Files & links ────────────────────────────────────────────────────

function FilesLinksBody() {
  return (
    <div>
      <SectionTitle>Files</SectionTitle>
      <Row
        title="Default location for new notes"
        description="Folder to place new notes in. Use a forward slash for nesting; leave blank for vault root."
      >
        <Input
          defaultValue=""
          placeholder="vault root"
          className="h-8 w-[220px] text-[12.5px]"
        />
      </Row>
      <Row
        title="Confirm file deletion"
        description="Show a confirmation dialog before moving a file to trash."
      >
        <Switch defaultChecked />
      </Row>
      <Row
        title="Always use atomic writes"
        description="Write to a temp file in the same directory, fsync, then rename. Safer for power loss; slightly slower."
      >
        <Switch defaultChecked disabled />
      </Row>

      <SectionTitle>Links</SectionTitle>
      <Row
        title="Use [[wikilinks]]"
        description="Use `[[Note name]]` syntax for internal links. When disabled, links use the Markdown `[text](url)` form."
      >
        <Switch defaultChecked />
      </Row>
      <Row
        title="Update links on rename"
        description="When you rename or move a file, find every `[[wikilink]]` and `[text](path.md)` referencing it and update them."
      >
        <Switch defaultChecked />
      </Row>
    </div>
  );
}

// ── AI & Privacy ─────────────────────────────────────────────────────

function AIPrivacyBody() {
  return (
    <div>
      <SectionTitle>AI</SectionTitle>
      <Row
        title="Enable AI features"
        description="Master switch for autocomplete, summaries, and the explain-this-block command. When off, no AI surfaces are visible."
      >
        <Switch defaultChecked />
      </Row>
      <Row
        title="Embeddings provider"
        description="Engine used to generate semantic embeddings for related-notes suggestions."
      >
        <Select defaultValue="local">
          <SelectTrigger className="w-[180px] h-8 text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local (Ollama)</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="off">Off</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <SectionTitle>Privacy</SectionTitle>
      <Row
        title="Send anonymous telemetry"
        description="Help improve flux by sending crash reports and anonymous usage metrics. No vault content is ever transmitted."
      >
        <Switch defaultChecked={false} />
      </Row>
      <Row
        title="Allow cloud LLM calls"
        description="When disabled, only user-initiated AI commands run; background tasks (autocomplete, summaries) skip cloud calls entirely."
      >
        <Switch defaultChecked />
      </Row>
    </div>
  );
}

// ── Hotkeys ──────────────────────────────────────────────────────────

function HotkeysBody() {
  const hotkeys = useSettingsStore((s) => s.hotkeys);
  const setHotkey = useSettingsStore((s) => s.setHotkey);
  const resetHotkey = useSettingsStore((s) => s.resetHotkey);
  const resetAllHotkeys = useSettingsStore((s) => s.resetAllHotkeys);
  const [filter, setFilter] = React.useState("");

  const ids = Object.keys(HOTKEY_LABELS) as HotkeyId[];
  const visible = ids.filter(
    (id) =>
      filter === "" ||
      HOTKEY_LABELS[id].toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <SectionTitle>Hotkeys</SectionTitle>

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <IcSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 [width:14px] [height:14px] opacity-60" />
          <Input
            placeholder="Filter shortcuts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-7 text-[12.5px]"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[12px]"
          onClick={resetAllHotkeys}
        >
          <IcRefresh className="[width:13px] [height:13px] mr-1" />
          Reset all
        </Button>
      </div>

      <p className="mb-3 text-[12px] text-muted-foreground">
        Click a shortcut to record a new key combination. Press{" "}
        <Kbd className="h-[16px] min-w-[16px] px-1 text-[9px]">Esc</Kbd> to
        cancel recording.
      </p>

      <div className="rounded-lg border border-border bg-card/40 px-4">
        {visible.length === 0 ? (
          <div className="py-6 text-center text-[12.5px] text-muted-foreground">
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
      </div>
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
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-b-0">
      <span className="flex-1 text-[13px] text-foreground">
        {HOTKEY_LABELS[id]}
      </span>

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
            "inline-flex items-center gap-1 px-2 py-1 rounded-md",
            "border border-transparent hover:border-border hover:bg-accent/40",
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

      <Button
        variant="ghost"
        size="sm"
        title="Reset to default"
        disabled={isDefault}
        onClick={onReset}
        className="h-7 px-2 text-[11px]"
      >
        Reset
      </Button>
    </div>
  );
}

/**
 * Captures the next non-modifier keydown and reports a binding. Esc
 * cancels without saving. Auto-focuses on mount.
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
      tabIndex={0}
      className={cn(
        "inline-flex items-center justify-center h-7 min-w-[120px] px-3 rounded-md",
        "text-[11.5px] text-muted-foreground",
        "border border-dashed border-[var(--text-link)] bg-[var(--text-link)]/5",
        "outline-none focus:ring-1 focus:ring-[var(--text-link)]/60",
        "cursor-text select-none animate-pulse",
      )}
    >
      Press keys…
    </div>
  );
}

// ── Coming-soon placeholder ──────────────────────────────────────────

function ComingSoonBody({ section }: { section: Section }) {
  return (
    <div>
      <SectionTitle>{section.label}</SectionTitle>
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-10 text-center">
        <section.Icon />
        <div className="mt-3 text-[13.5px] font-medium text-foreground">
          {section.label}
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground max-w-[420px] mx-auto">
          This panel is coming in a future release. Track progress in the
          project plan or pick another section from the sidebar.
        </p>
        <div className="mt-4">
          <Separator className="opacity-50" />
        </div>
        <Button variant="outline" size="sm" className="mt-4 text-[12px]" disabled>
          Notify me when ready
        </Button>
      </div>
    </div>
  );
}
